import { bootstrapData, clearAllData, clearOutbox, deleteOutboxOp, enqueueOutbox, getAllData, getCategory, getSyncMeta, readOutbox, removeMovement, replaceLocalData, saveCategory, saveMovement, saveSyncMeta } from './db';
import { EPOCH_UPDATED_AT } from './data';
import { resolveUserId, supabase } from './supabase';
import type { Category, Movement, MovementType, OutboxOp, Subcategory, SyncState } from './types';

// -----------------------------------------------------------------------------
// Filas del servidor
//
// Ninguna lleva user_id: la columna tiene DEFAULT auth.uid() y mandarlo desde el cliente sería, en
// el mejor caso, redundante. `amount` es number y no string: PostgREST serializa numeric con to_json
// de Postgres, así que numeric(12,2) llega como número JSON y cabe de sobra en un double. Nada de
// parseFloat. Los timestamps son text ISO en Postgres para que comparar strings sea comparar fechas.
// -----------------------------------------------------------------------------

// `type` y no `interface`: TypeScript solo deduce índice de string en los alias, y sin él una fila no
// se puede meter en el `payload: Record<string, unknown>` de OutboxOp.
export type CategoryRow = { id: string; name: string; type: MovementType; order: number; archived: boolean; updated_at: string };
export type SubcategoryRow = { id: string; category_id: string; name: string; order: number; archived: boolean; updated_at: string };
export type MovementRow = { id: string; type: MovementType; amount: number; date: string; category_id: string; subcategory_id: string | null; concept: string; notes: string | null; created_at: string; updated_at: string };

export interface Snapshot { movements: Movement[]; categories: Category[] }

// El payload del outbox se guarda ya como fila, así que al releerlo hay que estrecharlo de vuelta.
const asRow = <T>(payload: Record<string, unknown>) => payload as unknown as T;

export const toCategoryRow = (category: Category): CategoryRow => ({ id: category.id, name: category.name, type: category.type, order: category.order, archived: category.archived, updated_at: category.updatedAt });
export const fromCategoryRow = (row: CategoryRow): Omit<Category, 'subcategories'> => ({ id: row.id, name: row.name, type: row.type, order: row.order, archived: row.archived, updatedAt: row.updated_at });
export const toSubRow = (categoryId: string, sub: Subcategory): SubcategoryRow => ({ id: sub.id, category_id: categoryId, name: sub.name, order: sub.order, archived: sub.archived, updated_at: sub.updatedAt });
export const fromSubRow = (row: SubcategoryRow): Subcategory => ({ id: row.id, name: row.name, order: row.order, archived: row.archived, updatedAt: row.updated_at });
// El select de subcategoría del modal usa value="" para "Sin subcategoría", y '' no es un id válido:
// la FK lo rechazaría. Se mapea a null aquí, en el único sitio que conoce el esquema del servidor.
export const toMovementRow = (movement: Movement): MovementRow => ({ id: movement.id, type: movement.type, amount: movement.amount, date: movement.date, category_id: movement.categoryId, subcategory_id: movement.subcategoryId || null, concept: movement.concept, notes: movement.notes || null, created_at: movement.createdAt, updated_at: movement.updatedAt });
export const fromMovementRow = (row: MovementRow): Movement => ({ id: row.id, type: row.type, amount: row.amount, date: row.date, categoryId: row.category_id, ...(row.subcategory_id ? { subcategoryId: row.subcategory_id } : {}), concept: row.concept, ...(row.notes ? { notes: row.notes } : {}), createdAt: row.created_at, updatedAt: row.updated_at });

/** Timestamp que nunca retrocede en este dispositivo. */
// El trigger LWW del servidor descarta lo que llegue con updated_at <= al que ya tiene, así que un
// reloj que se atrase (cambio de hora, NTP) dejaría de poder escribir hasta ponerse al día. Forzar
// al menos un milisegundo sobre el último sello emitido evita ese bloqueo silencioso.
export function monotonicStamp(now: number, last: string | null) {
  const previous = last ? Date.parse(last) : NaN;
  return new Date(Number.isNaN(previous) ? now : Math.max(now, previous + 1)).toISOString();
}

// -----------------------------------------------------------------------------
// Diff de un documento de categoría
// -----------------------------------------------------------------------------

const sameCategory = (a: Omit<Category, 'subcategories'>, b: Category) => a.name === b.name && a.type === b.type && a.order === b.order && a.archived === b.archived;
const sameSub = (a: Subcategory, b: Subcategory) => a.name === b.name && a.order === b.order && a.archived === b.archived;

/**
 * Compara el documento embebido que llega de la UI contra el que hay guardado y devuelve el
 * documento ya sellado más las filas que hay que subir.
 */
// La UI trabaja con la categoría entera (App.tsx llama a saveCategory con todo el árbol), pero en
// Postgres cada categoría y cada subcategoría son filas con su propio LWW. Si subiéramos el
// documento completo, "renombrar la categoría en el portátil" y "añadir una subcategoría en el
// móvil" se pisarían: ganaría el último documento entero y el otro cambio desaparecería. Por eso
// solo viajan las filas que de verdad cambiaron.
// Devuelve también `doc` porque IndexedDB y el servidor tienen que guardar EL MISMO updatedAt: si
// aquí sellara una cosa y en local se guardara otra, el LWW compararía contra un valor que no tiene
// nadie. Las filas sin cambios conservan su sello anterior para no ganar por antigüedad falsa.
export function diffCategoryDoc(prev: Category | undefined, next: Category, stamp: string): { doc: Category; ops: OutboxOp[] } {
  const ops: OutboxOp[] = [];
  const categoryChanged = !prev || !sameCategory(prev, next);
  const doc: Category = {
    ...next,
    updatedAt: !categoryChanged && prev ? prev.updatedAt : stamp,
    subcategories: next.subcategories.map((sub) => {
      const before = prev?.subcategories.find((candidate) => candidate.id === sub.id);
      if (before && sameSub(before, sub)) return { ...sub, updatedAt: before.updatedAt };
      const stamped = { ...sub, updatedAt: stamp };
      ops.push({ table: 'subcategories', kind: 'upsert', id: sub.id, payload: toSubRow(next.id, stamped), updatedAt: stamp });
      return stamped;
    }),
  };
  // Delante de sus subcategorías: en una categoría recién creada, la FK de subcategories exige que
  // la fila padre ya exista, y el push respeta el orden de la cola.
  if (categoryChanged) ops.unshift({ table: 'categories', kind: 'upsert', id: next.id, payload: toCategoryRow(doc), updatedAt: stamp });
  // Una subcategoría que desaparezca de `next` se ignora a propósito: la UI archiva y nunca borra, y
  // el servidor ni siquiera concede DELETE sobre subcategories.
  return { doc, ops };
}

// -----------------------------------------------------------------------------
// Reensamblado del snapshot remoto
// -----------------------------------------------------------------------------

/** Reconstruye la forma embebida que espera el resto de la app a partir de las tablas normalizadas. */
// Normalizar en el servidor es lo que permite el LWW por subcategoría, pero calculations.ts y toda la
// UI siguen esperando Category con sus subcategories dentro. La traducción vive aquí y solo aquí.
export function assembleCategories(catRows: CategoryRow[], subRows: SubcategoryRow[]): Category[] {
  const byCategory = new Map<string, Subcategory[]>();
  for (const row of subRows) {
    const list = byCategory.get(row.category_id);
    if (list) list.push(fromSubRow(row)); else byCategory.set(row.category_id, [fromSubRow(row)]);
  }
  // Las subcategorías sin categoría se caen solas al no encontrar padre. No deberían existir (hay FK
  // con ON DELETE CASCADE), pero reensamblar es el sitio barato de no fiarse.
  return catRows
    .map((row) => ({ ...fromCategoryRow(row), subcategories: (byCategory.get(row.id) ?? []).sort((a, b) => a.order - b.order) }))
    .sort((a, b) => a.order - b.order);
}

// -----------------------------------------------------------------------------
// Reparación de referencias colgantes
// -----------------------------------------------------------------------------

// Orden alto para que las categorías de recuperación queden al final de la lista, detrás de las
// reales. El sello de época hace que el LWW del servidor nunca las deje pisar nada.
const RECOVERED_ORDER = 900;
const recoveredCategory = (type: MovementType): Category => ({ id: `recuperados-${type}`, name: 'Recuperados', type, order: RECOVERED_ORDER, archived: true, updatedAt: EPOCH_UPDATED_AT, subcategories: [] });

/** Deja los movimientos en un estado que las FK del servidor acepten. */
// En IndexedDB categoryId y subcategoryId son strings sin integridad referencial, así que puede
// haber movimientos apuntando a categorías que ya no existen. Postgres sí tiene FK y rechazaría esas
// filas con un 23503, que el push trata como op irrecuperable: se perderían movimientos reales. Una
// categoría por tipo y no una sola porque el modal filtra las categorías por el tipo del movimiento
// (App.tsx), y con una sola de gasto los ingresos recuperados no se podrían ni reasignar a mano.
export function repairDanglingRefs(movements: Movement[], categories: Category[]): Snapshot {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const created = new Map<MovementType, Category>();
  const repaired = movements.map((movement) => {
    const category = byId.get(movement.categoryId);
    if (category) return movement.subcategoryId && !category.subcategories.some((sub) => sub.id === movement.subcategoryId) ? { ...movement, subcategoryId: undefined } : movement;
    const fallback = created.get(movement.type) ?? recoveredCategory(movement.type);
    created.set(movement.type, fallback);
    return { ...movement, categoryId: fallback.id, subcategoryId: undefined };
  });
  // Idempotente: si las categorías de recuperación ya están en la lista, los movimientos las
  // encuentran por id y no se crea ninguna nueva.
  return { movements: repaired, categories: created.size ? [...categories, ...created.values()] : categories };
}

// -----------------------------------------------------------------------------
// Mezcla del pull con lo que aún no se ha subido
// -----------------------------------------------------------------------------

/** Snapshot del servidor con las escrituras locales pendientes reproducidas encima. */
// Sin esto, un pull que llegue justo después de guardar un movimiento devolvería la versión vieja y
// borraría de la pantalla algo que el usuario acaba de escribir. Lo pendiente siempre gana en local;
// el servidor ya lo recibirá y decidirá por LWW.
export function applyPullToLocal(snapshot: Snapshot, pending: OutboxOp[]): Snapshot {
  const movements = new Map(snapshot.movements.map((movement) => [movement.id, movement]));
  const categories = new Map(snapshot.categories.map((category) => [category.id, category]));
  for (const op of pending) {
    if (op.table === 'movements') {
      if (op.kind === 'delete') movements.delete(op.id);
      else if (op.payload) movements.set(op.id, fromMovementRow(asRow<MovementRow>(op.payload)));
      continue;
    }
    if (!op.payload) continue;
    if (op.table === 'categories') {
      const row = asRow<CategoryRow>(op.payload);
      categories.set(op.id, { ...fromCategoryRow(row), subcategories: categories.get(op.id)?.subcategories ?? [] });
      continue;
    }
    const row = asRow<SubcategoryRow>(op.payload);
    const parent = categories.get(row.category_id);
    // Sin padre no hay dónde colgarla. La op sigue en la cola y el próximo pull la traerá ya subida.
    if (!parent) continue;
    const sub = fromSubRow(row);
    categories.set(parent.id, { ...parent, subcategories: [...parent.subcategories.filter((candidate) => candidate.id !== sub.id), sub].sort((a, b) => a.order - b.order) });
  }
  return { movements: [...movements.values()], categories: [...categories.values()] };
}

// -----------------------------------------------------------------------------
// Estado observable
// -----------------------------------------------------------------------------

const listeners = new Set<(state: SyncState) => void>();
let state: SyncState = { status: 'idle', pendingOps: 0, lastSyncAt: null, lastError: null };
const setState = (patch: Partial<SyncState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(state); };

export const getSyncState = () => state;
/** Se suscribe al estado del sync. Invoca el callback de inmediato con el estado actual. */
export function subscribeSyncState(callback: (state: SyncState) => void) {
  listeners.add(callback); callback(state);
  return () => { listeners.delete(callback); };
}

// -----------------------------------------------------------------------------
// Sellado de escrituras
// -----------------------------------------------------------------------------

// El último sello emitido se cachea en memoria para no leer IndexedDB en cada escritura, y se
// persiste porque el reloj puede atrasarse entre dos sesiones, no solo dentro de una.
let lastStamp: string | null = null;
let storedStamp: Promise<string | null> | null = null;

async function nextStamp() {
  if (!storedStamp) storedStamp = getSyncMeta().then((meta) => meta.lastStampAt);
  if (lastStamp === null) lastStamp = await storedStamp;
  // La asignación va sin await de por medio: dos escrituras seguidas no pueden mirar el mismo valor
  // y acabar con el mismo sello, que el LWW del servidor descartaría como empate.
  const stamp = monotonicStamp(Date.now(), lastStamp);
  lastStamp = stamp;
  await saveSyncMeta({ lastStampAt: stamp });
  return stamp;
}

// -----------------------------------------------------------------------------
// Escrituras: IndexedDB primero, servidor después
// -----------------------------------------------------------------------------

// Mismo contrato que las de db.ts para que App.tsx siga siendo "escribir y recargar". La red no
// aparece por ninguna parte: lo que se encola aquí se sube cuando se pueda, y mientras tanto la app
// funciona igual sin conexión.
async function enqueue(ops: OutboxOp[]) {
  if (ops.length) await enqueueOutbox(ops);
  setState({ pendingOps: (await readOutbox()).length });
  scheduleSync();
}

export async function saveMovementSynced(movement: Movement) {
  // Se re-sella aquí aunque MovementModal ya ponga un updatedAt: así solo hay un sitio que decide
  // los sellos y todos son monótonos.
  const stamped = { ...movement, updatedAt: await nextStamp() };
  await saveMovement(stamped);
  await enqueue([{ table: 'movements', kind: 'upsert', id: stamped.id, payload: toMovementRow(stamped), updatedAt: stamped.updatedAt }]);
}

export async function removeMovementSynced(id: string) {
  await removeMovement(id);
  // El servidor deja una lápida al borrar y con ella descarta un upsert tardío de otro dispositivo,
  // así que un borrado nunca resucita.
  await enqueue([{ table: 'movements', kind: 'delete', id, updatedAt: await nextStamp() }]);
}

export async function saveCategorySynced(category: Category) {
  const { doc, ops } = diffCategoryDoc(await getCategory(category.id), category, await nextStamp());
  await saveCategory(doc);
  await enqueue(ops);
}

/** Borrado total. A diferencia del resto, este exige conexión. */
// Un borrado que se encolara podría cruzarse con un dispositivo que aún tiene cambios pendientes y
// repoblaría lo que se acaba de vaciar. Hacerlo en el servidor primero incrementa el wipe_epoch, que
// es lo que hace que los demás dispositivos tiren su cola en vez de resucitar los datos.
export async function clearAllDataSynced() {
  const userId = await resolveUserId();
  const { data, error } = await supabase.rpc('wipe_all_data');
  if (error) throw new Error('Necesitas conexión para borrar todo');
  await clearAllData();
  // clearAllData vacía también `meta`, y ahí vive el userId del que depende el arranque sin conexión.
  // migratedAt vuelve a null a propósito: el borrado resiembra las categorías por defecto en local y
  // el servidor se ha quedado sin ninguna, así que hay que volver a subirlas o el próximo movimiento
  // no tendría categoría a la que apuntar.
  await saveSyncMeta({ userId, dataUserId: userId, wipeEpoch: Number(data), migratedAt: null });
  lastPullKey = null;
  setState({ pendingOps: 0, lastError: null });
  // Cuanto antes se vuelva a vincular, mejor: hasta que las categorías resembradas no estén arriba,
  // un movimiento nuevo no tendría a qué apuntar en el servidor.
  scheduleSync();
}

// -----------------------------------------------------------------------------
// Push
// -----------------------------------------------------------------------------

type ServerError = { code?: string; message?: string } | null;

// Solo las violaciones de integridad (clase 23) y de dato (clase 22) son definitivas: reintentarlas
// daría siempre el mismo error y atascarían la cola para siempre. Todo lo demás —red, 5xx, 401 con
// el token caducado, incluso un 42501— se reintenta, porque tirar una escritura del usuario por un
// fallo pasajero es mucho peor que reintentar de más.
const isPermanent = (code?: string) => !!code && (code.startsWith('22') || code.startsWith('23'));

async function pushOp(op: OutboxOp): Promise<ServerError> {
  if (op.kind === 'delete') return (await supabase.from(op.table).delete().eq('id', op.id)).error;
  if (!op.payload) return null;
  // Sin .select() encadenado: la respuesta viene vacía y una fila descartada por el LWW del servidor
  // es indistinguible de una aplicada, que es justo lo que queremos. El push es ciego.
  return (await supabase.from(op.table).upsert(op.payload)).error;
}

/** Sube la cola en orden. Devuelve false si hubo que abortar (entonces no toca hacer pull). */
async function pushOutbox() {
  for (const { seq, op } of await readOutbox()) {
    const error = await pushOp(op);
    if (error && !isPermanent(error.code)) { setState({ pendingOps: (await readOutbox()).length }); return false; }
    if (error) {
      console.error('Operación de sync descartada por irrecuperable:', op, error);
      setState({ lastError: `Un cambio no se pudo sincronizar (${error.code}) y se ha descartado.` });
    }
    // Solo se saca de la cola tras la confirmación del servidor: si la app muere a mitad, la op sigue
    // ahí y se reintenta. Todas son idempotentes (upsert por id, delete por id).
    await deleteOutboxOp(seq);
  }
  setState({ pendingOps: 0 });
  return true;
}

// -----------------------------------------------------------------------------
// Pull
// -----------------------------------------------------------------------------

// Huella del último snapshot recibido. Si el servidor devuelve exactamente lo mismo, no se reescribe
// IndexedDB ni se llama a reload(): sin esto, el sondeo de cada minuto repintaría los gráficos y
// remontaría la tabla sin que nada hubiera cambiado.
let lastPullKey: string | null = null;

async function fetchSnapshot() {
  const [movements, categories, subcategories] = await Promise.all([
    supabase.from('movements').select('*'),
    supabase.from('categories').select('*'),
    supabase.from('subcategories').select('*'),
  ]);
  const failed = [movements, categories, subcategories].find((result) => result.error);
  if (failed) throw new Error(failed.error?.message ?? 'Error al descargar los datos');
  const movementRows = (movements.data ?? []) as MovementRow[], catRows = (categories.data ?? []) as CategoryRow[], subRows = (subcategories.data ?? []) as SubcategoryRow[];
  // "Vacío" se mide por categorías: no puede haber movimientos sin ellas (hay FK), así que cero
  // categorías significa servidor virgen.
  return { key: JSON.stringify([movementRows, catRows, subRows]), snapshot: { movements: movementRows.map(fromMovementRow), categories: assembleCategories(catRows, subRows) } as Snapshot, empty: catRows.length === 0 };
}

// -----------------------------------------------------------------------------
// Primera vinculación del dispositivo
// -----------------------------------------------------------------------------

/** Encola un snapshot entero. Las categorías van delante porque los movimientos dependen de ellas. */
// Va por el outbox y no en bloque a propósito: si se corta la conexión a mitad, lo ya confirmado no
// se repite y el resto se reintenta solo. Una subida en bloque sería más rápida pero habría que
// rehacerla entera, y esto ocurre una única vez por dispositivo.
function snapshotToOps({ movements, categories }: Snapshot, keep: (op: OutboxOp) => boolean = () => true) {
  const ops: OutboxOp[] = [];
  for (const category of categories) {
    ops.push({ table: 'categories', kind: 'upsert', id: category.id, payload: toCategoryRow(category), updatedAt: category.updatedAt });
    for (const sub of category.subcategories) ops.push({ table: 'subcategories', kind: 'upsert', id: sub.id, payload: toSubRow(category.id, sub), updatedAt: sub.updatedAt });
  }
  for (const movement of movements) ops.push({ table: 'movements', kind: 'upsert', id: movement.id, payload: toMovementRow(movement), updatedAt: movement.updatedAt });
  return ops.filter(keep);
}

// Las ops de la vinculación tienen que ir DELANTE de lo que ya hubiera encolado, o un movimiento
// escrito antes de vincular llegaría antes que su categoría y la FK lo rechazaría (y el push, al
// verlo irrecuperable, lo descartaría). Como el outbox es autoincremental, adelantarlas obliga a
// reescribir la cola entera. Lo anterior se conserva en vez de darlo por incluido en el snapshot:
// un borrado pendiente no deja rastro en la caché y se perdería.
async function prependOps(ops: OutboxOp[]) {
  const pending = (await readOutbox()).map((entry) => entry.op);
  await clearOutbox();
  await enqueueOutbox([...ops, ...pending]);
}

/** Vincula este dispositivo con el servidor la primera vez. */
// Siempre pull antes que push: subir a ciegas sobre un servidor que ya tiene datos duplicaría el
// árbol de categorías del otro dispositivo. Es idempotente porque los ids del cliente son la clave
// primaria en Postgres: repetirlo es un upsert, no una duplicación.
async function firstSync() {
  const { key, snapshot, empty } = await fetchSnapshot();
  if (empty) await uploadEverything(); else await mergeWithServer(snapshot, key);
  await saveSyncMeta({ migratedAt: new Date().toISOString() });
}

// Servidor virgen: manda lo local. bootstrapData por si la caché estaba vacía, porque el servidor
// necesita el árbol de categorías antes que cualquier movimiento.
async function uploadEverything() {
  await bootstrapData();
  const local = await getAllData();
  const repaired = repairDanglingRefs(local.movements, local.categories);
  await replaceLocalData(() => repaired);
  await prependOps(snapshotToOps(repaired));
}

// El servidor ya tiene datos (segundo dispositivo). Manda lo remoto, pero sin tirar lo que solo
// existe aquí: los movimientos son uuid y no chocan, y las categorías comparten id porque los slugs
// son deterministas. Se sube lo que el servidor no tiene y lo que este dispositivo haya tocado; las
// semillas intactas se reconocen por su sello de época y se descartan sin más.
async function mergeWithServer(snapshot: Snapshot, key: string) {
  const local = await getAllData();
  const remoteCategories = new Set(snapshot.categories.map((category) => category.id));
  const remoteSubs = new Set(snapshot.categories.flatMap((category) => category.subcategories.map((sub) => sub.id)));
  const remoteMovements = new Set(snapshot.movements.map((movement) => movement.id));
  const known = [...snapshot.categories, ...local.categories.filter((category) => !remoteCategories.has(category.id))];
  const knownIds = new Set(known.map((category) => category.id));
  const repaired = repairDanglingRefs(local.movements, known);
  // Las categorías locales más las que la reparación haya tenido que inventar. Las que solo están en
  // el servidor no se tocan: ya están donde tienen que estar.
  const candidates = [...local.categories, ...repaired.categories.filter((category) => !knownIds.has(category.id))];
  const mine = (op: OutboxOp) => {
    if (op.table === 'movements') return !remoteMovements.has(op.id);
    const remote = op.table === 'categories' ? remoteCategories : remoteSubs;
    return !remote.has(op.id) || op.updatedAt !== EPOCH_UPDATED_AT;
  };
  const ops = snapshotToOps({ movements: repaired.movements, categories: candidates }, mine);
  if (ops.length) await prependOps(ops);
  // Lo encolado se reproduce sobre el snapshot, así que sobrevive a esta sustitución de la caché.
  await replaceLocalData((pending) => applyPullToLocal(snapshot, pending));
  lastPullKey = key;
  await onRemoteChange?.();
}

async function pullAndApply() {
  const { key, snapshot } = await fetchSnapshot();
  if (key === lastPullKey) return;
  await replaceLocalData((pending) => applyPullToLocal(snapshot, pending));
  lastPullKey = key;
  await onRemoteChange?.();
}

// -----------------------------------------------------------------------------
// Ciclo de sincronización
// -----------------------------------------------------------------------------

const SYNC_LOCK = 'finhub-sync';
const POLL_MS = 60_000;
const DEBOUNCE_MS = 800;

let inFlight: Promise<void> | null = null;
let rerun = false;
let onRemoteChange: (() => Promise<void>) | null = null;
let debounce: number | undefined;

const scheduleSync = () => { window.clearTimeout(debounce); debounce = window.setTimeout(() => { void syncNow(); }, DEBOUNCE_MS); };

// Dos capas de exclusión mutua. La de módulo evita que los disparadores (arranque, online, volver a
// la pestaña, sondeo, debounce) se pisen entre sí; el web lock evita lo mismo entre pestañas del
// mismo navegador, que comparten IndexedDB pero no variables. jsdom no trae navigator.locks, de ahí
// la comprobación en vez de darlo por hecho.
function withLock(run: () => Promise<void>) {
  const locks: LockManager | undefined = navigator.locks;
  return locks ? locks.request(SYNC_LOCK, run) : run();
}

/** Sincroniza ahora. Las llamadas concurrentes se funden en una sola ejecución más un repaso. */
export function syncNow(): Promise<void> {
  if (inFlight) { rerun = true; return inFlight; }
  inFlight = (async () => {
    try { do { rerun = false; await withLock(runSync); } while (rerun); }
    finally { inFlight = null; }
  })();
  return inFlight;
}

async function runSync() {
  if (!navigator.onLine) { setState({ status: 'offline' }); return; }
  const userId = await resolveUserId();
  if (!userId) { setState({ status: 'auth-required' }); return; }
  setState({ status: 'syncing' });
  try {
    const meta = await adoptUser(userId);
    await adoptWipeEpoch(meta.wipeEpoch);
    // Antes del push: hasta que este dispositivo no se ha vinculado, su cola no basta para dejar el
    // servidor coherente (las categorías por defecto se siembran en local y nunca pasan por ella, así
    // que un movimiento suyo se estrellaría contra la FK).
    if (!meta.migratedAt) await firstSync();
    if (!(await pushOutbox())) { setState({ status: 'error' }); return; }
    // Solo se hace pull con la cola vacía: aplicar el snapshot con escrituras sin subir dejaría la
    // pantalla mostrando la versión vieja de algo que el usuario acaba de escribir.
    if ((await readOutbox()).length) { setState({ status: 'idle' }); return; }
    await pullAndApply();
    const lastSyncAt = new Date().toISOString();
    await saveSyncMeta({ lastSyncAt });
    setState({ status: 'idle', lastSyncAt });
  } catch (error) {
    console.error('Sync fallido, se reintentará:', error);
    setState({ status: navigator.onLine ? 'error' : 'offline' });
  }
}

// Cambio de usuario en el mismo navegador: la caché es del anterior y no puede mezclarse. No sirve
// mirar meta.userId, que resolveUserId() ya ha puesto al día con el usuario actual.
async function adoptUser(userId: string) {
  const meta = await getSyncMeta();
  if (meta.dataUserId === userId) return meta;
  if (meta.dataUserId) { await clearOutbox(); lastPullKey = null; }
  await saveSyncMeta({ dataUserId: userId, ...(meta.dataUserId ? { migratedAt: null, wipeEpoch: 0, lastSyncAt: null } : {}) });
  return getSyncMeta();
}

// Un "Borrar todo" hecho desde otro dispositivo sube el epoch. Este dispositivo puede llevar horas
// sin conexión y con cambios encolados: subirlos repoblaría lo que se acaba de vaciar. El wipe purga
// también las lápidas, así que el trigger anti-resurrección no cubre este caso; el epoch es la única
// defensa, y por eso se comprueba ANTES de pushear.
async function adoptWipeEpoch(localEpoch: number) {
  const { data, error } = await supabase.rpc('current_wipe_epoch');
  if (error) throw new Error(error.message);
  const remoteEpoch = Number(data);
  if (remoteEpoch === localEpoch) return;
  await clearOutbox();
  await saveSyncMeta({ wipeEpoch: remoteEpoch });
  lastPullKey = null;
  setState({ pendingOps: 0 });
}

/** Arranca el sync y registra sus disparadores. Devuelve la función de parada. */
// Sin Realtime a propósito: el momento que importa es "abro el móvil y veo lo del portátil", y eso
// lo cubre visibilitychange con latencia percibida cero. Un websocket añadiría reconexión y refresco
// de token a cambio de unos segundos que esta app no necesita.
export function initSync(onChange: () => Promise<void>) {
  onRemoteChange = onChange;
  const wake = () => { void syncNow(); };
  const goOffline = () => setState({ status: 'offline' });
  // El sondeo solo con la pestaña visible: en segundo plano gastaría batería para nada, porque al
  // volver a ella el propio visibilitychange ya sincroniza.
  const whenVisible = () => { if (document.visibilityState === 'visible') void syncNow(); };
  window.addEventListener('online', wake);
  window.addEventListener('offline', goOffline);
  document.addEventListener('visibilitychange', whenVisible);
  const poll = window.setInterval(whenVisible, POLL_MS);
  void readOutbox().then((queued) => setState({ pendingOps: queued.length }));
  // lastSyncAt se persiste en meta pero el estado en memoria arranca a null: sin esto, al recargar la
  // página la UI diría "todo al día" sin fecha hasta que terminara el primer sync (y sin red, nunca).
  void getSyncMeta().then((meta) => setState({ lastSyncAt: meta.lastSyncAt }));
  void syncNow();
  return () => {
    window.removeEventListener('online', wake);
    window.removeEventListener('offline', goOffline);
    document.removeEventListener('visibilitychange', whenVisible);
    window.clearInterval(poll); window.clearTimeout(debounce);
    onRemoteChange = null;
  };
}

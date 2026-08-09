import { openDB, type DBSchema } from 'idb';
import { defaultCategories, EPOCH_UPDATED_AT } from './data';
import type { Category, Movement, OutboxOp, Preferences, SyncMeta } from './types';

interface FinanceDB extends DBSchema {
  movements: { key: string; value: Movement; indexes: { date: string; type: string } };
  categories: { key: string; value: Category };
  preferences: { key: string; value: Preferences };
  // Clave autoincremental FUERA de línea: el seq es la clave, no un campo del valor. El orden de las
  // claves es el orden causal de las escrituras, que es lo que el push tiene que respetar.
  outbox: { key: number; value: OutboxOp };
  meta: { key: string; value: SyncMeta };
}

// Cómo se veían las categorías antes de la v3. Solo existe para tipar el backfill: es un artefacto
// de migración, no parte del modelo, así que no vive en types.ts.
type LegacyCategory = Omit<Category, 'updatedAt' | 'subcategories'> & { updatedAt?: string; subcategories: (Omit<Category['subcategories'][number], 'updatedAt'> & { updatedAt?: string })[] };

const DB_NAME = 'finhub-finanzas';
// Nombre de la base bajo la marca anterior ("Cielo"). IndexedDB no tiene "rename": un nombre nuevo
// es una base vacía. migrateFromLegacyDb copia los datos una sola vez para no dejar huérfano el
// histórico de quien ya tuviera movimientos guardados antes del cambio de marca.
const LEGACY_DB_NAME = 'cielo-finanzas';
const DEFAULT_SYNC_META: SyncMeta = { userId: null, migratedAt: null, lastSyncAt: null, wipeEpoch: 0, lastStampAt: null };
const META_KEY = 'sync';

// true solo si la base "finhub-finanzas" no existía y se ha creado ahora mismo (oldVersion 0):
// es la única situación en la que tiene sentido buscar datos bajo el nombre antiguo.
let isFreshDb = false;

export const dbPromise = openDB<FinanceDB>(DB_NAME, 3, {
  async upgrade(db, oldVersion, _newVersion, tx) {
    if (oldVersion === 0) isFreshDb = true;
    if (oldVersion < 1) {
      const movements = db.createObjectStore('movements', { keyPath: 'id' });
      movements.createIndex('date', 'date'); movements.createIndex('type', 'type');
      db.createObjectStore('categories', { keyPath: 'id' });
      db.createObjectStore('preferences');
    }
    if (oldVersion < 3) {
      // Los createObjectStore van primero y síncronos, antes de cualquier await.
      db.createObjectStore('outbox', { autoIncrement: true });
      db.createObjectStore('meta');
      // Backfill de updatedAt. Los put se emiten SIN await, todos en el mismo microtask en que
      // resuelve el getAll: encadenar un await por cada put es lo que cierra la transacción
      // versionchange antes de tiempo. openDB ya espera a tx.done.
      const categories = tx.objectStore('categories');
      const rows = (await categories.getAll()) as unknown as LegacyCategory[];
      for (const category of rows) categories.put({ ...category, updatedAt: category.updatedAt ?? EPOCH_UPDATED_AT, subcategories: category.subcategories.map((sub) => ({ ...sub, updatedAt: sub.updatedAt ?? EPOCH_UPDATED_AT })) } as Category);
    }
  },
}).then(async (db) => { if (isFreshDb) await migrateFromLegacyDb(db); return db; });

// Copia única de 'cielo-finanzas' a 'finhub-finanzas' cuando esta última se acaba de crear.
// indexedDB.databases() es necesario para comprobar que la base antigua existe SIN abrirla: abrir
// por nombre con openDB la crearía vacía si no existiera, y con eso perderíamos la comprobación.
async function migrateFromLegacyDb(db: Awaited<ReturnType<typeof openDB<FinanceDB>>>) {
  if (typeof indexedDB.databases !== 'function') return;
  const existing = await indexedDB.databases();
  if (!existing.some((entry) => entry.name === LEGACY_DB_NAME)) return;
  const legacy = await openDB<FinanceDB>(LEGACY_DB_NAME);
  const [movements, categories, preferences, outboxKeys, outboxOps, meta] = await Promise.all([
    legacy.getAll('movements'), legacy.getAll('categories'), legacy.get('preferences', 'main'),
    legacy.getAllKeys('outbox'), legacy.getAll('outbox'), legacy.get('meta', META_KEY),
  ]);
  legacy.close();
  if (!movements.length && !categories.length) return; // base antigua vacía: nada que copiar
  const tx = db.transaction(['movements', 'categories', 'preferences', 'outbox', 'meta'], 'readwrite');
  await Promise.all([
    ...movements.map((m) => tx.objectStore('movements').put(m)),
    ...categories.map((c) => tx.objectStore('categories').put(c)),
    ...(preferences ? [tx.objectStore('preferences').put(preferences, 'main')] : []),
    ...outboxOps.map((op, i) => tx.objectStore('outbox').put(op, outboxKeys[i])),
    ...(meta ? [tx.objectStore('meta').put(meta, META_KEY)] : []),
    tx.done,
  ]);
}

export async function bootstrapData() {
  const db = await dbPromise;
  if ((await db.count('categories')) === 0) {
    const tx = db.transaction('categories', 'readwrite');
    await Promise.all([...defaultCategories.map((category) => tx.store.put(category)), tx.done]);
  }
}
export async function getAllData() { const db = await dbPromise; return { movements: await db.getAll('movements'), categories: await db.getAll('categories') }; }
export async function saveMovement(movement: Movement) { return (await dbPromise).put('movements', movement); }
export async function removeMovement(id: string) { return (await dbPromise).delete('movements', id); }
export async function saveCategory(category: Category) { return (await dbPromise).put('categories', category); }
export async function savePreferences(value: Preferences) { return (await dbPromise).put('preferences', value, 'main'); }
export async function loadPreferences() { return (await dbPromise).get('preferences', 'main'); }
// Vacía también outbox y meta: dejar ops encoladas tras un "Borrar todo" repoblaría el servidor
// recién vaciado. meta es bookkeeping reconstruible (el epoch se relee, la migración es idempotente).
export async function clearAllData() { const db = await dbPromise; const tx = db.transaction(['movements','categories','preferences','outbox','meta'], 'readwrite'); await Promise.all([tx.objectStore('movements').clear(),tx.objectStore('categories').clear(),tx.objectStore('preferences').clear(),tx.objectStore('outbox').clear(),tx.objectStore('meta').clear(),tx.done]); await bootstrapData(); }

export async function enqueueOutbox(ops: OutboxOp[]) { const tx = (await dbPromise).transaction('outbox', 'readwrite'); await Promise.all([...ops.map((op) => tx.store.add(op)), tx.done]); }
// getAllKeys y getAll devuelven ambos en orden de clave, así que el zip empareja bien.
export async function readOutbox() { const tx = (await dbPromise).transaction('outbox'); const [seqs, ops] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]); return seqs.map((seq, i) => ({ seq, op: ops[i] })); }
export async function deleteOutboxOp(seq: number) { return (await dbPromise).delete('outbox', seq); }
export async function clearOutbox() { return (await dbPromise).clear('outbox'); }

export async function getSyncMeta(): Promise<SyncMeta> { return { ...DEFAULT_SYNC_META, ...(await (await dbPromise).get('meta', META_KEY)) }; }
// Read-modify-write dentro de UNA transacción: si no, dos parches concurrentes se pisarían.
export async function saveSyncMeta(patch: Partial<SyncMeta>) { const tx = (await dbPromise).transaction('meta', 'readwrite'); const current = await tx.store.get(META_KEY); await tx.store.put({ ...DEFAULT_SYNC_META, ...current, ...patch }, META_KEY); await tx.done; }

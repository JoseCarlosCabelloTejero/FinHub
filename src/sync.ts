import { EPOCH_UPDATED_AT } from './data';
import type { Category, Movement, MovementType, OutboxOp, Subcategory } from './types';

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

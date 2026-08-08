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

const DB_NAME = 'cielo-finanzas';
const DEFAULT_SYNC_META: SyncMeta = { userId: null, migratedAt: null, lastSyncAt: null, wipeEpoch: 0, lastStampAt: null };
const META_KEY = 'sync';

export const dbPromise = openDB<FinanceDB>(DB_NAME, 3, {
  async upgrade(db, oldVersion, _newVersion, tx) {
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
});

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

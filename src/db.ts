import { openDB, type DBSchema } from 'idb';
import { defaultCategories } from './data';
import type { Category, Movement, Preferences } from './types';

interface FinanceDB extends DBSchema {
  movements: { key: string; value: Movement; indexes: { date: string; type: string } };
  categories: { key: string; value: Category };
  preferences: { key: string; value: Preferences };
}

const DB_NAME = 'cielo-finanzas';
export const dbPromise = openDB<FinanceDB>(DB_NAME, 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const movements = db.createObjectStore('movements', { keyPath: 'id' });
      movements.createIndex('date', 'date'); movements.createIndex('type', 'type');
      db.createObjectStore('categories', { keyPath: 'id' });
      db.createObjectStore('preferences');
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
export async function clearAllData() { const db = await dbPromise; const tx = db.transaction(['movements','categories','preferences'], 'readwrite'); await Promise.all([tx.objectStore('movements').clear(),tx.objectStore('categories').clear(),tx.objectStore('preferences').clear(),tx.done]); await bootstrapData(); }

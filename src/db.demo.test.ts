// Fichero aparte por el mismo motivo que las otras pruebas de migración: dbPromise se abre al importar
// './db', así que la marca de la demo y la base "vieja" tienen que estar puestas ANTES del import.
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';

describe('base de datos del modo demo', () => {
  it('abre una base propia y no hereda nada de la del usuario', async () => {
    // Alguien que ya usó la app antes del rebranding: si la demo disparara la copia desde el nombre
    // antiguo, se llevaría dentro sus movimientos, su outbox y su meta. Es el fallo que evita el
    // `!isDemo()` del .then de dbPromise.
    const legacy = await openDB('cielo-finanzas', 3, { upgrade(db) {
      const movements = db.createObjectStore('movements', { keyPath: 'id' });
      movements.createIndex('date', 'date'); movements.createIndex('type', 'type');
      db.createObjectStore('categories', { keyPath: 'id' });
      db.createObjectStore('preferences');
      db.createObjectStore('outbox', { autoIncrement: true });
      db.createObjectStore('meta');
    } });
    await legacy.put('movements', { id: 'real', type: 'expense', amount: 999, date: '2026-08-01', categoryId: 'expense-coche', concept: 'Movimiento de verdad', createdAt: '', updatedAt: '' });
    await legacy.put('categories', { id: 'expense-coche', name: 'Coche', type: 'expense', order: 0, archived: false, updatedAt: '', subcategories: [] });
    legacy.close();

    localStorage.setItem('finhub-demo', '1');
    const { dbPromise, getAllData } = await import('./db');
    const db = await dbPromise;

    expect(db.name).toBe('finhub-demo');
    expect((await getAllData()).movements).toEqual([]);
    localStorage.clear();
  });
});

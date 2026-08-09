// Fichero aparte a propósito: db.ts crea dbPromise en el import (singleton de módulo), así que en
// db.test.ts la base ya estaría abierta en v3 antes de poder sembrar una v2. Vitest aísla el
// registro de módulos y el fake-indexeddb de setup.ts por fichero, de ahí que aquí sí se pueda.
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { EPOCH_UPDATED_AT } from './data';

describe('migración de IndexedDB v2 a v3',()=>{
  it('crea outbox y meta, rellena updatedAt y no toca los movimientos',async()=>{
    // 1. Una base tal y como la tiene hoy el navegador del usuario: v2, sin updatedAt en categorías.
    const legacy=await openDB('finhub-finanzas',2,{upgrade(db){const movements=db.createObjectStore('movements',{keyPath:'id'});movements.createIndex('date','date');movements.createIndex('type','type');db.createObjectStore('categories',{keyPath:'id'});db.createObjectStore('preferences')}});
    await legacy.put('categories',{id:'expense-coche',name:'Coche',type:'expense',order:0,archived:false,subcategories:[{id:'expense-coche-gasolina',name:'Gasolina',order:0,archived:false}]});
    await legacy.put('movements',{id:'m1',type:'expense',amount:42.5,date:'2026-08-01',categoryId:'expense-coche',subcategoryId:'expense-coche-gasolina',concept:'Repostaje',createdAt:'2026-08-01T09:00:00.000Z',updatedAt:'2026-08-01T09:00:00.000Z'});
    legacy.close(); // si no se cierra, la transacción versionchange de la v3 se queda bloqueada

    // 2. Importar db.ts dispara el upgrade.
    const {dbPromise,getAllData}=await import('./db');
    const db=await dbPromise;

    expect(db.version).toBe(3);
    expect(db.objectStoreNames.contains('outbox')).toBe(true);
    expect(db.objectStoreNames.contains('meta')).toBe(true);

    const {categories,movements}=await getAllData();
    const coche=categories.find(c=>c.id==='expense-coche')!;
    expect(coche.updatedAt).toBe(EPOCH_UPDATED_AT);
    expect(coche.subcategories[0].updatedAt).toBe(EPOCH_UPDATED_AT);
    expect(coche.name).toBe('Coche');
    expect(movements).toEqual([expect.objectContaining({id:'m1',amount:42.5,updatedAt:'2026-08-01T09:00:00.000Z'})]);
  });
});

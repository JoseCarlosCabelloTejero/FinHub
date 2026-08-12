// Fichero aparte por el mismo motivo que db.migration.test.ts: dbPromise es un singleton que se abre
// al importar, así que la base v3 hay que sembrarla antes de importar './db'.
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';

describe('migración de IndexedDB v3 a v4 (dominio patrimonio)',()=>{
  it('crea accounts y closings vacíos sin tocar datos ni cola',async()=>{
    // 1. Una base v3 tal y como la tiene hoy cualquier navegador ya migrado.
    const legacy=await openDB('finhub-finanzas',3,{upgrade(db){
      const movements=db.createObjectStore('movements',{keyPath:'id'});
      movements.createIndex('date','date');movements.createIndex('type','type');
      db.createObjectStore('categories',{keyPath:'id'});
      db.createObjectStore('preferences');
      db.createObjectStore('outbox',{autoIncrement:true});
      db.createObjectStore('meta');
    }});
    await legacy.put('movements',{id:'m1',type:'expense',amount:42.5,date:'2026-08-01',categoryId:'expense-coche',concept:'Repostaje',createdAt:'2026-08-01T09:00:00.000Z',updatedAt:'2026-08-01T09:00:00.000Z'});
    await legacy.put('outbox',{table:'movements',kind:'upsert',id:'m1',payload:{id:'m1'},updatedAt:'2026-08-01T09:00:00.000Z'});
    legacy.close(); // si no se cierra, la transacción versionchange de la v4 se queda bloqueada

    // 2. Importar db.ts dispara el upgrade v3 → v4.
    const {dbPromise,getAllData,readOutbox}=await import('./db');
    const db=await dbPromise;

    expect(db.version).toBe(4);
    expect(db.objectStoreNames.contains('accounts')).toBe(true);
    expect(db.objectStoreNames.contains('closings')).toBe(true);

    const data=await getAllData();
    expect(data.movements).toEqual([expect.objectContaining({id:'m1',amount:42.5})]);
    // Sin semillas: el dominio patrimonio nace vacío, a diferencia de las categorías.
    expect(data.accounts).toEqual([]);
    expect(data.closings).toEqual([]);
    expect((await readOutbox()).map(e=>e.op.id)).toEqual(['m1']);
  });
});

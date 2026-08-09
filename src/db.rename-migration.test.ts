// Fichero aparte por el mismo motivo que db.migration.test.ts: dbPromise es un singleton que se
// abre al importar, así que hay que sembrar la base "vieja" antes de importar './db'.
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';

describe('migración de nombre de base (rebranding Cielo → FinHub)',()=>{
  it('copia los datos de cielo-finanzas a finhub-finanzas la primera vez',async()=>{
    // 1. Base bajo el nombre antiguo, como la tendría alguien que usó la app antes del rebranding.
    const legacy=await openDB('cielo-finanzas',3,{upgrade(db){
      const movements=db.createObjectStore('movements',{keyPath:'id'});
      movements.createIndex('date','date');movements.createIndex('type','type');
      db.createObjectStore('categories',{keyPath:'id'});
      db.createObjectStore('preferences');
      db.createObjectStore('outbox',{autoIncrement:true});
      db.createObjectStore('meta');
    }});
    await legacy.put('categories',{id:'expense-coche',name:'Coche',type:'expense',order:0,archived:false,updatedAt:'',subcategories:[]});
    await legacy.put('movements',{id:'m1',type:'expense',amount:10,date:'2026-08-01',categoryId:'expense-coche',concept:'Test',createdAt:'2026-08-01T09:00:00.000Z',updatedAt:'2026-08-01T09:00:00.000Z'});
    await legacy.put('preferences',{theme:'dark'} as never,'main');
    legacy.close(); // si no se cierra, la base nueva bloquea la lectura de la vieja

    // 2. Importar db.ts abre "finhub-finanzas" vacía y dispara la copia desde el nombre antiguo.
    const {dbPromise,getAllData,loadPreferences}=await import('./db');
    const db=await dbPromise;

    expect(db.name).toBe('finhub-finanzas');
    const {categories,movements}=await getAllData();
    expect(movements).toEqual([expect.objectContaining({id:'m1',amount:10})]);
    expect(categories.find(c=>c.id==='expense-coche')).toBeTruthy();
    expect(await loadPreferences()).toEqual({theme:'dark'});
  });
});

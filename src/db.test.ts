import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, deleteOutboxOp, enqueueOutbox, getAllData, getSyncMeta, readOutbox, saveMovement, saveSyncMeta } from './db';
import type { OutboxOp } from './types';
describe('persistencia',()=>{beforeEach(async()=>clearAllData());it('persiste movimientos entre lecturas',async()=>{await saveMovement({id:'one',type:'income',amount:100,date:'2026-01-01',categoryId:'income',concept:'Nómina',createdAt:'',updatedAt:''});expect((await getAllData()).movements).toHaveLength(1)});it('restaura categorías iniciales tras borrar',async()=>{expect((await getAllData()).categories.length).toBeGreaterThan(0)})});

const op=(id:string):OutboxOp=>({table:'movements',kind:'upsert',id,payload:{id},updatedAt:'2026-08-08T10:00:00.000Z'});

describe('outbox',()=>{
  beforeEach(async()=>clearAllData());
  it('conserva el orden de encolado',async()=>{await enqueueOutbox([op('a'),op('b')]);await enqueueOutbox([op('c')]);const queued=await readOutbox();expect(queued.map(q=>q.op.id)).toEqual(['a','b','c']);expect(queued.map(q=>q.seq)).toEqual([...queued.map(q=>q.seq)].sort((x,y)=>x-y))});
  it('borra solo la op indicada',async()=>{await enqueueOutbox([op('a'),op('b')]);await deleteOutboxOp((await readOutbox())[0].seq);expect((await readOutbox()).map(q=>q.op.id)).toEqual(['b'])});
  it('"borrar todo" vacía la cola para no repoblar el servidor',async()=>{await enqueueOutbox([op('a')]);await clearAllData();expect(await readOutbox()).toHaveLength(0)});
});

describe('meta de sync',()=>{
  beforeEach(async()=>clearAllData());
  it('devuelve valores por defecto cuando no hay registro',async()=>expect(await getSyncMeta()).toEqual({userId:null,migratedAt:null,lastSyncAt:null,wipeEpoch:0,lastStampAt:null}));
  it('un parche no pisa el resto de campos',async()=>{await saveSyncMeta({userId:'u1'});await saveSyncMeta({wipeEpoch:3});const meta=await getSyncMeta();expect(meta.userId).toBe('u1');expect(meta.wipeEpoch).toBe(3)});
});

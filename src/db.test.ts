import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, deleteOutboxOp, enqueueOutbox, getAllData, getSyncMeta, readOutbox, replaceLocalData, saveAccount, saveClosing, saveMovement, saveSyncMeta } from './db';
import type { Account, Closing, Movement, OutboxOp } from './types';
const account=(id:string):Account=>({id,name:id,nature:'asset',isInvestment:false,isLiquid:true,archived:false,order:0,updatedAt:''});
const closing=(accountId:string,month='2026-01'):Closing=>({id:`${accountId}:${month}`,accountId,month,balance:100,updatedAt:''});
describe('persistencia',()=>{beforeEach(async()=>clearAllData());it('persiste movimientos entre lecturas',async()=>{await saveMovement({id:'one',type:'income',amount:100,date:'2026-01-01',categoryId:'income',concept:'Nómina',createdAt:'',updatedAt:''});expect((await getAllData()).movements).toHaveLength(1)});it('restaura categorías iniciales tras borrar',async()=>{expect((await getAllData()).categories.length).toBeGreaterThan(0)});it('persiste cuentas y cierres',async()=>{await saveAccount(account('a1'));await saveClosing(closing('a1'));const data=await getAllData();expect(data.accounts.map(a=>a.id)).toEqual(['a1']);expect(data.closings.map(c=>c.id)).toEqual(['a1:2026-01'])});it('"borrar todo" vacía cuentas y cierres y NO los resiembra',async()=>{await saveAccount(account('a1'));await saveClosing(closing('a1'));await clearAllData();const data=await getAllData();expect(data.accounts).toHaveLength(0);expect(data.closings).toHaveLength(0)})});

const op=(id:string):OutboxOp=>({table:'movements',kind:'upsert',id,payload:{id},updatedAt:'2026-08-08T10:00:00.000Z'});

describe('outbox',()=>{
  beforeEach(async()=>clearAllData());
  it('conserva el orden de encolado',async()=>{await enqueueOutbox([op('a'),op('b')]);await enqueueOutbox([op('c')]);const queued=await readOutbox();expect(queued.map(q=>q.op.id)).toEqual(['a','b','c']);expect(queued.map(q=>q.seq)).toEqual([...queued.map(q=>q.seq)].sort((x,y)=>x-y))});
  it('borra solo la op indicada',async()=>{await enqueueOutbox([op('a'),op('b')]);await deleteOutboxOp((await readOutbox())[0].seq);expect((await readOutbox()).map(q=>q.op.id)).toEqual(['b'])});
  it('"borrar todo" vacía la cola para no repoblar el servidor',async()=>{await enqueueOutbox([op('a')]);await clearAllData();expect(await readOutbox()).toHaveLength(0)});
});

const movement=(id:string):Movement=>({id,type:'expense',amount:5,date:'2026-01-01',categoryId:'income',concept:id,createdAt:'',updatedAt:''});

describe('reemplazo de la caché local',()=>{
  beforeEach(async()=>clearAllData());
  it('sustituye movimientos y categorías por lo que devuelve compute',async()=>{await saveMovement(movement('viejo'));await replaceLocalData(()=>({movements:[movement('nuevo')],categories:[],accounts:[],closings:[]}));const data=await getAllData();expect(data.movements.map(m=>m.id)).toEqual(['nuevo']);expect(data.categories).toHaveLength(0)});
  it('le pasa a compute las ops que seguían sin subir',async()=>{await enqueueOutbox([op('a'),op('b')]);let seen:OutboxOp[]=[];await replaceLocalData(pending=>{seen=pending;return{movements:[],categories:[],accounts:[],closings:[]}});expect(seen.map(o=>o.id)).toEqual(['a','b'])});
  // El olvido clásico al añadir una colección: si compute no la devolviera (o el reemplazo no la
  // escribiera), el primer pull borraría en silencio los cierres locales.
  it('sustituye también cuentas y cierres',async()=>{await saveAccount(account('vieja'));await saveClosing(closing('vieja'));await replaceLocalData(()=>({movements:[],categories:[],accounts:[account('nueva')],closings:[closing('nueva')]}));const data=await getAllData();expect(data.accounts.map(a=>a.id)).toEqual(['nueva']);expect(data.closings.map(c=>c.id)).toEqual(['nueva:2026-01'])});
});

describe('meta de sync',()=>{
  beforeEach(async()=>clearAllData());
  it('devuelve valores por defecto cuando no hay registro',async()=>expect(await getSyncMeta()).toEqual({userId:null,dataUserId:null,migratedAt:null,lastSyncAt:null,wipeEpoch:0,lastStampAt:null}));
  it('un parche no pisa el resto de campos',async()=>{await saveSyncMeta({userId:'u1'});await saveSyncMeta({wipeEpoch:3});const meta=await getSyncMeta();expect(meta.userId).toBe('u1');expect(meta.wipeEpoch).toBe(3)});
});

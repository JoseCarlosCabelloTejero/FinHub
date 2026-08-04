import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, getAllData, saveMovement } from './db';
describe('persistencia',()=>{beforeEach(async()=>clearAllData());it('persiste movimientos entre lecturas',async()=>{await saveMovement({id:'one',type:'income',amount:100,date:'2026-01-01',categoryId:'income',concept:'Nómina',createdAt:'',updatedAt:''});expect((await getAllData()).movements).toHaveLength(1)});it('restaura categorías iniciales tras borrar',async()=>{expect((await getAllData()).categories.length).toBeGreaterThan(0)})});

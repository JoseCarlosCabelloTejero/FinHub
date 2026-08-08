import { describe, expect, it } from 'vitest';
import { filterPeriod, summary, topCategories, weeklyBreakdown, weekOfMonth, weeksInMonth } from './calculations';
import { EPOCH_UPDATED_AT } from './data';
import type { Category, Movement } from './types';
const movement=(type:'income'|'expense',amount:number,date='2026-04-10',categoryId='x',subcategoryId?:string):Movement=>({id:crypto.randomUUID(),type,amount,date,categoryId,subcategoryId,concept:'Test',createdAt:'',updatedAt:''});
describe('cálculos financieros',()=>{it('calcula ingresos, gastos, ahorro y tasa',()=>{expect(summary([movement('income',2000),movement('expense',500)])).toEqual({income:2000,expenses:500,savings:1500,rate:75})});it('evita dividir entre cero',()=>expect(summary([movement('expense',20)]).rate).toBe(0));it('filtra por mes',()=>expect(filterPeriod([movement('income',1),movement('income',1,'2026-05-01')],'2026-04-01','month')).toHaveLength(1));it('filtra por año',()=>expect(filterPeriod([movement('income',1),movement('income',1,'2025-05-01')],'2026-04-01','year')).toHaveLength(1))});
describe('topCategories',()=>{
  const list=(n:number)=>Array.from({length:n},(_,i)=>({name:`C${i}`,value:n-i}));
  it('deja la lista intacta si cabe en el límite',()=>expect(topCategories(list(4),6)).toHaveLength(4));
  it('deja la lista intacta justo en el límite',()=>expect(topCategories(list(6),6)).toHaveLength(6));
  it('agrupa la cola en "Otros"',()=>{const r=topCategories(list(8),6);expect(r).toHaveLength(6);expect(r[5]).toEqual({name:'Otros',value:3+2+1})});
  it('conserva el total',()=>{const d=list(9);const total=d.reduce((n,x)=>n+x.value,0);expect(topCategories(d,6).reduce((n,x)=>n+x.value,0)).toBe(total)});
});

describe('semanas del mes',()=>{
  it('mapea el día 1 y el 7 a la semana 1',()=>{expect(weekOfMonth('2026-04-01')).toBe(1);expect(weekOfMonth('2026-04-07')).toBe(1)});
  it('mapea el día 8 a la semana 2 y el 28 a la 4',()=>{expect(weekOfMonth('2026-04-08')).toBe(2);expect(weekOfMonth('2026-04-28')).toBe(4)});
  it('agrupa los días 29 al 31 en la semana 5',()=>{expect(weekOfMonth('2026-03-29')).toBe(5);expect(weekOfMonth('2026-03-31')).toBe(5)});
  it('recorta a 4 semanas en febrero de 28 días',()=>expect(weeksInMonth('2026-02-01')).toBe(4));
  it('devuelve 5 semanas en febrero bisiesto',()=>expect(weeksInMonth('2028-02-01')).toBe(5));
  it('devuelve 5 semanas en un mes normal',()=>expect(weeksInMonth('2026-04-15')).toBe(5));
});

describe('weeklyBreakdown',()=>{
  const cat=(id:string,name:string,order:number,subs:[string,string][]):Category=>({id,name,type:'expense',order,archived:false,updatedAt:EPOCH_UPDATED_AT,subcategories:subs.map(([sid,sname],i)=>({id:sid,name:sname,order:i,archived:false,updatedAt:EPOCH_UPDATED_AT}))});
  const categories:Category[]=[{id:'inc',name:'Ingresos',type:'income',order:0,archived:false,updatedAt:EPOCH_UPDATED_AT,subcategories:[]},cat('fijos','Fijos',0,[['piso','Piso'],['luz','Luz']]),cat('ocio','Ocio',1,[['comida','Comida']])];
  const run=(items:Movement[])=>weeklyBreakdown(items,categories,'2026-04-01');
  const group=(items:Movement[],name:string)=>run(items).groups.find(g=>g.name===name)!;
  const spread=[movement('expense',10,'2026-04-03','fijos','piso'),movement('expense',20,'2026-04-10','fijos','piso'),movement('expense',30,'2026-04-25','fijos','piso')];

  it('reparte los gastos en la semana que les toca',()=>expect(group(spread,'Fijos').rows.find(r=>r.name==='Piso')!.weeks).toEqual([10,20,0,30,0]));
  it('cuadra el total de cada fila con la suma de sus semanas',()=>{const piso=group(spread,'Fijos').rows.find(r=>r.name==='Piso')!;expect(piso.total).toBe(piso.weeks.reduce((n,x)=>n+x,0))});
  it('cuadra el total del mes con la suma de los totales de semana',()=>{const g=run([...spread,movement('expense',5,'2026-04-02','ocio','comida')]);expect(g.total).toBe(65);expect(g.weekTotals.reduce((n,x)=>n+x,0)).toBe(g.total)});
  it('suma las subcategorías en el total de su categoría',()=>{const g=group([...spread,movement('expense',7,'2026-04-03','fijos','luz')],'Fijos');expect(g.total).toBe(67);expect(g.rows.reduce((n,r)=>n+r.total,0)).toBe(g.total)});
  it('calcula el porcentaje sobre los ingresos del mes',()=>{const g=run([movement('income',1763.70,'2026-04-01','inc'),movement('expense',480,'2026-04-01','fijos','piso')]);expect(g.groups.find(x=>x.name==='Fijos')!.percent!.toFixed(2)).toBe('27.22')});
  it('deja el porcentaje a null si no hay ingresos',()=>expect(run(spread).percent).toBeNull());
  it('ignora los ingresos en el desglose de gasto',()=>{const g=run([movement('income',900,'2026-04-01','fijos','piso')]);expect(g.total).toBe(0);expect(g.income).toBe(900)});
  it('agrupa en "Sin subcategoría" los movimientos sin subcategoryId',()=>{const g=group([movement('expense',12,'2026-04-03','fijos')],'Fijos');expect(g.rows.at(-1)).toMatchObject({name:'Sin subcategoría',total:12});expect(g.total).toBe(12)});
  it('agrupa en "Sin subcategoría" las subcategorías huérfanas',()=>{const g=group([movement('expense',12,'2026-04-03','fijos','ya-no-existe')],'Fijos');expect(g.rows.at(-1)).toMatchObject({name:'Sin subcategoría',total:12})});
  it('agrupa en "Sin categoría" los movimientos con categoryId huérfano',()=>{const g=run([movement('expense',40,'2026-04-03','borrada')]);expect(g.groups.at(-1)).toMatchObject({name:'Sin categoría',total:40});expect(g.total).toBe(40)});
  it('no inventa la fila "Sin subcategoría" si no hace falta',()=>expect(group(spread,'Fijos').rows.map(r=>r.name)).toEqual(['Piso','Luz']));
  it('respeta el orden de categorías y subcategorías',()=>expect(run([]).groups.map(g=>g.name)).toEqual(['Fijos','Ocio']));
  it('usa solo las semanas reales del mes',()=>expect(weeklyBreakdown([],categories,'2026-02-01').weeks).toEqual([1,2,3,4]));
});

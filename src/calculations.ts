import { endOfMonth, endOfYear, format, getDaysInMonth, isWithinInterval, parseISO, startOfMonth, startOfYear } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Category, Movement } from './types';
import { OTROS_ID } from './theme';

export const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const percent = new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2 });
export function periodBounds(date: string, mode: 'month'|'year') { const parsed = parseISO(date); return mode === 'month' ? { start: startOfMonth(parsed), end: endOfMonth(parsed) } : { start: startOfYear(parsed), end: endOfYear(parsed) }; }
export function filterPeriod(items: Movement[], date: string, mode: 'month'|'year') { const bounds = periodBounds(date, mode); return items.filter((item) => isWithinInterval(parseISO(item.date), bounds)); }
export function summary(items: Movement[]) { const income = items.reduce((n,m) => n + (m.type === 'income' ? m.amount : 0), 0); const expenses = items.reduce((n,m) => n + (m.type === 'expense' ? m.amount : 0), 0); const savings = income - expenses; return { income, expenses, savings, rate: income ? (savings / income) * 100 : 0 }; }
/** Semana 1..5 dentro del mes, por día natural: 1-7 → 1, 8-14 → 2 … 29-31 → 5.
 *  No son semanas de calendario. La comparten `trendData()` y `weeklyBreakdown()`: si divergieran,
 *  el gráfico y la tabla contarían el mismo gasto en semanas distintas. */
export function weekOfMonth(date: string) { return Math.min(Math.ceil(parseISO(date).getDate()/7), 5); }
/** Columnas de semana que tiene realmente el mes: 4 en febrero de 28 días, 5 en el resto. */
export function weeksInMonth(date: string) { return Math.min(Math.ceil(getDaysInMonth(parseISO(date))/7), 5); }
export function trendData(items: Movement[], date: string, mode: 'month'|'year') {
  const keys = mode === 'month' ? Array.from({length: 5},(_,i)=>String(i+1)) : Array.from({length:12},(_,i)=>String(i));
  return keys.map((key, index) => { const matches = items.filter(m => mode === 'month' ? weekOfMonth(m.date) === Number(key) : parseISO(m.date).getMonth() === Number(key)); const s = summary(matches); return { name: mode === 'month' ? `S${key}` : format(new Date(2024,index,1),'MMM',{locale:es}), ingresos:s.income, gastos:s.expenses, ahorro:s.savings }; });
}
export interface WeeklyRow { id: string; name: string; archived: boolean; weeks: number[]; total: number; percent: number|null }
export interface WeeklyGroup extends WeeklyRow { rows: WeeklyRow[] }
/** Cruce gasto × semana para un mes: filas de subcategoría agrupadas por categoría, con totales por
 *  semana, total del mes y % sobre los ingresos del mes (null si no hay ingresos: nunca dividir entre cero).
 *  `items` debe venir ya filtrado al mes de `date`. */
export function weeklyBreakdown(items: Movement[], categories: Category[], date: string) {
  const weeks = Array.from({length: weeksInMonth(date)},(_,i)=>i+1);
  const expenses = items.filter(m=>m.type==='expense');
  const income = items.reduce((n,m)=>n+(m.type==='income'?m.amount:0),0);
  const percentOf = (total:number) => income ? (total/income)*100 : null;
  const row = (id:string,name:string,archived:boolean,matches:Movement[]):WeeklyRow => { const cells = weeks.map(w=>matches.reduce((n,m)=>n+(weekOfMonth(m.date)===w?m.amount:0),0)); const total = cells.reduce((n,x)=>n+x,0); return {id,name,archived,weeks:cells,total,percent:percentOf(total)}; };
  const groups: WeeklyGroup[] = categories.filter(c=>c.type==='expense').sort((a,b)=>a.order-b.order).map(c=>{
    const own = expenses.filter(m=>m.categoryId===c.id);
    const subs = [...c.subcategories].sort((a,b)=>a.order-b.order).map(s=>row(s.id,s.name,c.archived||s.archived,own.filter(m=>m.subcategoryId===s.id)));
    // Los movimientos sin subcategoría (o con una que ya no existe) tienen que verse: si no, el total
    // de la categoría no cuadraría con la suma de sus filas.
    const loose = own.filter(m=>!c.subcategories.some(s=>s.id===m.subcategoryId));
    return { ...row(c.id,c.name,c.archived,own), rows: loose.length ? [...subs, row(`${c.id}--none`,'Sin subcategoría',c.archived,loose)] : subs };
  });
  // Sin integridad referencial, un `categoryId` puede no resolver (categoría renombrada o borrada a mano).
  // Ese dinero se agrupa aparte en vez de desaparecer: el pie de la tabla debe cuadrar con el KPI de gastos.
  const known = new Set(categories.filter(c=>c.type==='expense').map(c=>c.id));
  const orphans = expenses.filter(m=>!known.has(m.categoryId));
  if (orphans.length) groups.push({ ...row('--orphan','Sin categoría',false,orphans), rows: [] });
  const weekTotals = weeks.map((_,i)=>groups.reduce((n,g)=>n+g.weeks[i],0));
  const total = weekTotals.reduce((n,x)=>n+x,0);
  return { weeks, groups, weekTotals, total, income, percent: percentOf(total) };
}
export function categoryData(items: Movement[], categories: Category[]) { return categories.filter(c=>c.type==='expense').map(c=>({categoryId:c.id,name:c.name,value:items.filter(m=>m.type==='expense'&&m.categoryId===c.id).reduce((n,m)=>n+m.amount,0)})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value); }
/** Recorta la lista (ya ordenada de mayor a menor) a `limit` entradas agrupando la cola en "Otros".
 *  La rampa del donut solo distingue bien 6 tonos; más allá el color deja de informar. `Otros` no es
 *  una categoría real, así que lleva el `categoryId` sentinel `OTROS_ID` en vez del de una categoría. */
export function topCategories(data: {categoryId: string; name: string; value: number}[], limit = 6) {
  if (data.length <= limit) return data;
  const head = data.slice(0, limit - 1);
  const rest = data.slice(limit - 1).reduce((n, x) => n + x.value, 0);
  return [...head, { categoryId: OTROS_ID, name: 'Otros', value: rest }];
}

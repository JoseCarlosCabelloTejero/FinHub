import { endOfMonth, endOfYear, format, isWithinInterval, parseISO, startOfMonth, startOfYear } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Category, Movement } from './types';

export const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export function periodBounds(date: string, mode: 'month'|'year') { const parsed = parseISO(date); return mode === 'month' ? { start: startOfMonth(parsed), end: endOfMonth(parsed) } : { start: startOfYear(parsed), end: endOfYear(parsed) }; }
export function filterPeriod(items: Movement[], date: string, mode: 'month'|'year') { const bounds = periodBounds(date, mode); return items.filter((item) => isWithinInterval(parseISO(item.date), bounds)); }
export function summary(items: Movement[]) { const income = items.reduce((n,m) => n + (m.type === 'income' ? m.amount : 0), 0); const expenses = items.reduce((n,m) => n + (m.type === 'expense' ? m.amount : 0), 0); const savings = income - expenses; return { income, expenses, savings, rate: income ? (savings / income) * 100 : 0 }; }
export function trendData(items: Movement[], date: string, mode: 'month'|'year') {
  const keys = mode === 'month' ? Array.from({length: 5},(_,i)=>String(i+1)) : Array.from({length:12},(_,i)=>String(i));
  return keys.map((key, index) => { const matches = items.filter(m => mode === 'month' ? Math.min(Math.ceil(parseISO(m.date).getDate()/7),5) === Number(key) : parseISO(m.date).getMonth() === Number(key)); const s = summary(matches); return { name: mode === 'month' ? `S${key}` : format(new Date(2024,index,1),'MMM',{locale:es}), ingresos:s.income, gastos:s.expenses, ahorro:s.savings }; });
}
export function categoryData(items: Movement[], categories: Category[]) { return categories.filter(c=>c.type==='expense').map(c=>({name:c.name,value:items.filter(m=>m.type==='expense'&&m.categoryId===c.id).reduce((n,m)=>n+m.amount,0)})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value); }

import { describe, expect, it } from 'vitest';
import { filterPeriod, summary } from './calculations';
import type { Movement } from './types';
const movement=(type:'income'|'expense',amount:number,date='2026-04-10'):Movement=>({id:crypto.randomUUID(),type,amount,date,categoryId:'x',concept:'Test',createdAt:'',updatedAt:''});
describe('cálculos financieros',()=>{it('calcula ingresos, gastos, ahorro y tasa',()=>{expect(summary([movement('income',2000),movement('expense',500)])).toEqual({income:2000,expenses:500,savings:1500,rate:75})});it('evita dividir entre cero',()=>expect(summary([movement('expense',20)]).rate).toBe(0));it('filtra por mes',()=>expect(filterPeriod([movement('income',1),movement('income',1,'2026-05-01')],'2026-04-01','month')).toHaveLength(1));it('filtra por año',()=>expect(filterPeriod([movement('income',1),movement('income',1,'2025-05-01')],'2026-04-01','year')).toHaveLength(1))});

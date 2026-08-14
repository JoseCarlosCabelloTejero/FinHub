import { describe, expect, it } from 'vitest';
import { closingId, monthDelta, unclassified } from './calculations';
import { defaultCategories } from './data';
import { getAllData, readOutbox } from './db';
import { demoSeed, DEMO_ACCOUNTS, resetDemo } from './demoData';

// Febrero a propósito: es el mes que caza un día 29, 30 o 31 colado en las semillas.
const NOW = new Date(2026, 1, 15);
const seed = demoSeed(NOW);
const months = [...new Set(seed.movements.map((m) => m.date.slice(0, 7)))].sort();

describe('datos de la demo', () => {
  it('cubre los cuatro meses que acaban en el de hoy', () => {
    expect(months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('todas las fechas son válidas y caen en su mes', () => {
    for (const movement of seed.movements) {
      const parsed = new Date(`${movement.date}T00:00:00`);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(movement.date.slice(0, 7)).toBe(`${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`);
    }
  });

  // Un id inventado dejaría el movimiento en "Sin categoría" y fuera del desglose semanal, que es lo
  // que la demo tiene que lucir. Los ids salen del slug de data.ts, así que renombrar un grupo allí
  // rompe este test antes que la demo.
  it('todas las categorías y subcategorías existen de verdad', () => {
    const byId = new Map(defaultCategories.map((category) => [category.id, category]));
    for (const movement of seed.movements) {
      const category = byId.get(movement.categoryId);
      expect(category, `categoría inexistente: ${movement.categoryId}`).toBeTruthy();
      expect(category!.type).toBe(movement.type);
      expect(category!.subcategories.some((sub) => sub.id === movement.subcategoryId), `subcategoría inexistente: ${movement.subcategoryId}`).toBe(true);
    }
  });

  it('cada movimiento apunta a una cuenta que existe, o a ninguna', () => {
    const ids = new Set(DEMO_ACCOUNTS.map((account) => account.id));
    for (const movement of seed.movements) if (movement.accountId) expect(ids.has(movement.accountId)).toBe(true);
  });

  it('cierra las tres cuentas todos los meses, con id determinista', () => {
    for (const month of months) for (const account of DEMO_ACCOUNTS) {
      const closing = seed.closings.find((c) => c.id === closingId(account.id, month));
      expect(closing, `falta el cierre de ${account.name} en ${month}`).toBeTruthy();
      expect(closing!.balance).not.toBeNull();
    }
    expect(seed.closings).toHaveLength(months.length * DEMO_ACCOUNTS.length);
  });

  it('solo la cuenta de inversión lleva aportado', () => {
    for (const closing of seed.closings) expect(closing.contributed !== undefined).toBe(closing.accountId === 'demo-broker');
  });

  // El test que de verdad importa: si los saldos no se despejaran de los movimientos, Patrimonio
  // abriría acusando al decorado de tener cientos de euros sin registrar.
  it('no deja descuadre en ningún mes comparable', () => {
    for (const month of months.slice(1)) {
      const delta = monthDelta(DEMO_ACCOUNTS, seed.closings, month);
      expect(delta?.complete, `mes incompleto: ${month}`).toBe(true);
      expect(unclassified(DEMO_ACCOUNTS, seed.closings, seed.movements, month)?.amount).toBeCloseTo(0, 6);
    }
  });

  it('el primer mes no tiene con qué compararse y no inventa un descuadre', () => {
    expect(monthDelta(DEMO_ACCOUNTS, seed.closings, months[0])).toBeNull();
  });

  // El decorado se escribe por db.ts y no por sync.ts, así que no debe encolar nada ni re-sellar: lo
  // que se comprueba aquí es que lo sembrado llega entero y que las categorías por defecto siguen ahí.
  it('sembrar deja la base con el decorado y el árbol de categorías', async () => {
    await resetDemo();
    const data = await getAllData();
    expect(data.movements).toHaveLength(seed.movements.length);
    expect(data.accounts).toHaveLength(DEMO_ACCOUNTS.length);
    expect(data.closings).toHaveLength(seed.closings.length);
    expect(data.categories).toHaveLength(defaultCategories.length);
    expect(await readOutbox()).toHaveLength(0);
  });

  it('sembrar dos veces no duplica nada', async () => {
    await resetDemo(); await resetDemo();
    expect((await getAllData()).movements).toHaveLength(seed.movements.length);
  });

  it('los meses no son copias: cada uno tiene su propio gasto', () => {
    const totals = months.map((month) => seed.movements.filter((m) => m.date.startsWith(month) && m.type === 'expense').reduce((total, m) => total + m.amount, 0));
    expect(new Set(totals).size).toBe(months.length);
  });
});

import { describe, expect, it } from 'vitest';
import { applyPullToLocal, assembleCategories, diffCategoryDoc, fromMovementRow, monotonicStamp, repairDanglingRefs, toCategoryRow, toMovementRow, toSubRow } from './sync';
import type { Category, Movement, Subcategory } from './types';

const T0 = '2026-01-01T00:00:00.000Z';
const STAMP = '2026-02-01T00:00:00.000Z';
const sub = (id: string, over: Partial<Subcategory> = {}): Subcategory => ({ id, name: id, order: 0, archived: false, updatedAt: T0, ...over });
const cat = (id: string, over: Partial<Category> = {}): Category => ({ id, name: id, type: 'expense', order: 0, archived: false, updatedAt: T0, subcategories: [], ...over });
const mov = (id: string, over: Partial<Movement> = {}): Movement => ({ id, type: 'expense', amount: 10, date: '2026-01-05', categoryId: 'c1', concept: id, createdAt: T0, updatedAt: T0, ...over });
const rowsOf = (category: Category) => ({ catRow: toCategoryRow(category), subRows: category.subcategories.map((s) => toSubRow(category.id, s)) });

describe('diffCategoryDoc', () => {
  const base = cat('c1', { subcategories: [sub('s1'), sub('s2', { order: 1 })] });

  it('sube la categoría y todas sus subcategorías cuando es nueva', () => {
    const { doc, ops } = diffCategoryDoc(undefined, base, STAMP);
    expect(ops.map((o) => [o.table, o.id])).toEqual([['categories', 'c1'], ['subcategories', 's1'], ['subcategories', 's2']]);
    expect(doc.updatedAt).toBe(STAMP);
    expect(doc.subcategories.every((s) => s.updatedAt === STAMP)).toBe(true);
  });

  it('la categoría va delante de sus subcategorías, que dependen de ella por FK', () => expect(diffCategoryDoc(undefined, base, STAMP).ops[0].table).toBe('categories'));

  it('renombrar solo encola la fila de la categoría', () => {
    const { doc, ops } = diffCategoryDoc(base, { ...base, name: 'Coche' }, STAMP);
    expect(ops).toHaveLength(1);
    expect(ops[0].table).toBe('categories');
    expect(doc.updatedAt).toBe(STAMP);
    expect(doc.subcategories.map((s) => s.updatedAt)).toEqual([T0, T0]);
  });

  it('añadir una subcategoría no toca el sello de la categoría', () => {
    const { doc, ops } = diffCategoryDoc(base, { ...base, subcategories: [...base.subcategories, sub('s3', { order: 2 })] }, STAMP);
    expect(ops.map((o) => [o.table, o.id])).toEqual([['subcategories', 's3']]);
    expect(doc.updatedAt).toBe(T0);
  });

  it('archivar una subcategoría encola solo esa', () => {
    const next = { ...base, subcategories: base.subcategories.map((s) => (s.id === 's2' ? { ...s, archived: true } : s)) };
    expect(diffCategoryDoc(base, next, STAMP).ops.map((o) => o.id)).toEqual(['s2']);
  });

  it('un documento idéntico no encola nada y conserva los sellos', () => {
    const { doc, ops } = diffCategoryDoc(base, { ...base }, STAMP);
    expect(ops).toHaveLength(0);
    expect(doc).toEqual(base);
  });

  it('el payload de una subcategoría dice a qué categoría pertenece', () => expect(diffCategoryDoc(undefined, base, STAMP).ops[1].payload).toMatchObject({ id: 's1', category_id: 'c1', updated_at: STAMP }));
});

describe('assembleCategories', () => {
  it('reconstruye el documento embebido tal cual salió', () => {
    const original = cat('c1', { subcategories: [sub('s1'), sub('s2', { order: 1 })] });
    const { catRow, subRows } = rowsOf(original);
    expect(assembleCategories([catRow], subRows)).toEqual([original]);
  });

  it('ordena las subcategorías por order aunque el servidor las devuelva revueltas', () => {
    const original = cat('c1', { subcategories: [sub('s1'), sub('s2', { order: 1 })] });
    const { catRow, subRows } = rowsOf(original);
    expect(assembleCategories([catRow], [...subRows].reverse())[0].subcategories.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('descarta las subcategorías que no tienen categoría', () => expect(assembleCategories([], [toSubRow('fantasma', sub('s1'))])).toEqual([]));
});

describe('repairDanglingRefs', () => {
  const categories = [cat('c1', { subcategories: [sub('s1')] })];

  it('reasigna a una categoría de recuperación del mismo tipo', () => {
    const repaired = repairDanglingRefs([mov('m1', { type: 'income', categoryId: 'borrada' })], categories);
    expect(repaired.movements[0].categoryId).toBe('recuperados-income');
    expect(repaired.categories.find((c) => c.id === 'recuperados-income')).toMatchObject({ type: 'income', archived: true });
  });

  it('limpia la subcategoría que no pertenece a su categoría', () => expect(repairDanglingRefs([mov('m1', { subcategoryId: 'otra' })], categories).movements[0].subcategoryId).toBeUndefined());

  it('no toca nada cuando las referencias son válidas', () => {
    const movements = [mov('m1', { subcategoryId: 's1' })];
    const repaired = repairDanglingRefs(movements, categories);
    expect(repaired.movements).toEqual(movements);
    expect(repaired.categories).toBe(categories);
  });

  it('es idempotente', () => {
    const once = repairDanglingRefs([mov('m1', { categoryId: 'borrada' })], categories);
    const twice = repairDanglingRefs(once.movements, once.categories);
    expect(twice.movements).toEqual(once.movements);
    expect(twice.categories).toHaveLength(once.categories.length);
  });
});

describe('applyPullToLocal', () => {
  const snapshot = { movements: [mov('m1'), mov('m2')], categories: [cat('c1', { subcategories: [sub('s1')] })] };

  it('sin nada pendiente devuelve el snapshot del servidor', () => expect(applyPullToLocal(snapshot, [])).toEqual(snapshot));

  it('una escritura pendiente sobrevive al pull', () => {
    const pending = { table: 'movements' as const, kind: 'upsert' as const, id: 'm1', payload: toMovementRow(mov('m1', { concept: 'recién escrito' })), updatedAt: STAMP };
    expect(applyPullToLocal(snapshot, [pending]).movements.find((m) => m.id === 'm1')?.concept).toBe('recién escrito');
  });

  it('un borrado pendiente quita la fila que traía el servidor', () => {
    const pending = { table: 'movements' as const, kind: 'delete' as const, id: 'm1', updatedAt: STAMP };
    expect(applyPullToLocal(snapshot, [pending]).movements.map((m) => m.id)).toEqual(['m2']);
  });

  it('una subcategoría pendiente se cuelga de su categoría', () => {
    const pending = { table: 'subcategories' as const, kind: 'upsert' as const, id: 's2', payload: toSubRow('c1', sub('s2', { order: 1 })), updatedAt: STAMP };
    expect(applyPullToLocal(snapshot, [pending]).categories[0].subcategories.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('una categoría pendiente no se lleva por delante sus subcategorías', () => {
    const pending = { table: 'categories' as const, kind: 'upsert' as const, id: 'c1', payload: toCategoryRow(cat('c1', { name: 'Coche' })), updatedAt: STAMP };
    const [category] = applyPullToLocal(snapshot, [pending]).categories;
    expect(category.name).toBe('Coche');
    expect(category.subcategories.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('mapeo de filas', () => {
  it('la subcategoría vacía del formulario viaja como null', () => expect(toMovementRow(mov('m1', { subcategoryId: '' })).subcategory_id).toBeNull());
  it('las notas vacías viajan como null', () => expect(toMovementRow(mov('m1', { notes: '' })).notes).toBeNull());
  it('el importe se mantiene numérico en el viaje de vuelta', () => expect(fromMovementRow(toMovementRow(mov('m1', { amount: 12.34 }))).amount).toBe(12.34));
  it('un movimiento sin subcategoría vuelve sin la clave', () => expect(fromMovementRow(toMovementRow(mov('m1'))).subcategoryId).toBeUndefined());
});

describe('monotonicStamp', () => {
  it('avanza un milisegundo cuando el reloj se ha atrasado', () => expect(monotonicStamp(Date.parse('2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:05.000Z')).toBe('2026-01-01T00:00:05.001Z'));
  it('usa el reloj cuando va por delante del último sello', () => expect(monotonicStamp(Date.parse(STAMP), T0)).toBe(STAMP));
  it('sin sello previo devuelve la hora actual', () => expect(monotonicStamp(Date.parse(STAMP), null)).toBe(STAMP));
});

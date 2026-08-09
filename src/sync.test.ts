import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPullToLocal, assembleCategories, diffCategoryDoc, fromMovementRow, monotonicStamp, repairDanglingRefs, toCategoryRow, toMovementRow, toSubRow } from './sync';
import type { Category, Movement, OutboxOp, Subcategory } from './types';

// supabase.ts lanza al importarse si faltan las variables de entorno, así que los tests no pueden
// cargarlo de verdad (mismo motivo que en Login.test.tsx). vi.hoisted es necesario porque la fábrica
// del mock se eleva por encima de las declaraciones del fichero.
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), upsert: vi.fn(), remove: vi.fn(), select: vi.fn(), resolveUserId: vi.fn() }));
vi.mock('./supabase', () => ({
  resolveUserId: mocks.resolveUserId,
  supabase: {
    rpc: (name: string) => mocks.rpc(name),
    from: (table: string) => ({
      upsert: (payload: unknown) => mocks.upsert(table, payload),
      delete: () => ({ eq: (_column: string, id: string) => mocks.remove(table, id) }),
      select: () => mocks.select(table),
    }),
  },
}));

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

// El motor guarda estado a nivel de módulo (cola en vuelo, huella del último pull, último sello), así
// que cada test necesita un módulo recién importado y no basta con limpiar IndexedDB.
describe('motor de sync', () => {
  let sync: typeof import('./sync');
  let db: typeof import('./db');
  const netError = { code: '', message: 'Failed to fetch' };
  const queue = (...ops: OutboxOp[]) => db.enqueueOutbox(ops);
  const opFor = (id: string): OutboxOp => ({ table: 'movements', kind: 'upsert', id, payload: toMovementRow(mov(id)), updatedAt: STAMP });

  beforeEach(async () => {
    // Solo setTimeout: así el debounce de las escrituras nunca dispara un sync a destiempo, pero
    // fake-indexeddb conserva el setImmediate con el que agenda los eventos de sus transacciones
    // (fingirlo también deja colgada cualquier operación contra la base).
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.resolveUserId.mockResolvedValue('u1');
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.select.mockResolvedValue({ data: [], error: null });
    db = await import('./db');
    await db.clearAllData();
    sync = await import('./sync');
  });
  afterEach(() => vi.useRealTimers());

  it('sube la cola en el orden en que se escribió', async () => {
    await queue(opFor('a'), opFor('b'), opFor('c'));
    await sync.syncNow();
    expect(mocks.upsert.mock.calls.map((call) => (call[1] as { id: string }).id)).toEqual(['a', 'b', 'c']);
    expect(await db.readOutbox()).toHaveLength(0);
  });

  it('un fallo de red deja lo que queda en la cola y no hace pull', async () => {
    await queue(opFor('a'), opFor('b'), opFor('c'));
    mocks.upsert.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: netError });
    await sync.syncNow();
    expect((await db.readOutbox()).map((entry) => entry.op.id)).toEqual(['b', 'c']);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(sync.getSyncState().status).toBe('error');
  });

  it('descarta la op que el servidor nunca aceptaría y sigue con el resto', async () => {
    await queue(opFor('a'), opFor('b'));
    mocks.upsert.mockResolvedValueOnce({ error: { code: '23503', message: 'FK' } });
    await sync.syncNow();
    expect(await db.readOutbox()).toHaveLength(0);
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(sync.getSyncState().lastError).toContain('23503');
  });

  it('aplica en local lo que baja del servidor', async () => {
    const category = cat('c1', { subcategories: [sub('s1')] });
    mocks.select.mockImplementation((table: string) => Promise.resolve({ data: table === 'movements' ? [toMovementRow(mov('m1'))] : table === 'categories' ? [toCategoryRow(category)] : [toSubRow('c1', sub('s1'))], error: null }));
    await sync.syncNow();
    const data = await db.getAllData();
    expect(data.movements.map((m) => m.id)).toEqual(['m1']);
    expect(data.categories).toEqual([category]);
  });

  it('no reescribe nada si el servidor devuelve lo mismo que la vez anterior', async () => {
    const reload = vi.fn(async () => {});
    const stop = sync.initSync(reload);
    await sync.syncNow();
    await sync.syncNow();
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('funde las llamadas concurrentes en una ejecución y un repaso', async () => {
    await Promise.all([sync.syncNow(), sync.syncNow(), sync.syncNow()]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('usa el web lock cuando el navegador lo trae', async () => {
    const request = vi.fn((_name: string, run: () => Promise<void>) => run());
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    await sync.syncNow();
    expect(request).toHaveBeenCalledWith('finhub-sync', expect.any(Function));
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('un borrado total en otro dispositivo tira la cola en vez de repoblarlo', async () => {
    await queue(opFor('a'));
    mocks.rpc.mockResolvedValue({ data: 4, error: null });
    await sync.syncNow();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(await db.readOutbox()).toHaveLength(0);
    expect((await db.getSyncMeta()).wipeEpoch).toBe(4);
  });

  it('un usuario distinto no hereda la cola del anterior', async () => {
    await db.saveSyncMeta({ dataUserId: 'otro' });
    await queue(opFor('a'));
    await sync.syncNow();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(await db.readOutbox()).toHaveLength(0);
    expect(await db.getSyncMeta()).toMatchObject({ dataUserId: 'u1', migratedAt: null });
  });

  it('sin sesión no toca el servidor', async () => {
    mocks.resolveUserId.mockResolvedValue(null);
    await sync.syncNow();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(sync.getSyncState().status).toBe('auth-required');
  });

  describe('escrituras', () => {
    it('guarda el movimiento y lo encola con el mismo sello', async () => {
      await sync.saveMovementSynced(mov('m1', { updatedAt: 'sello viejo' }));
      const [{ op }] = await db.readOutbox();
      const stored = (await db.getAllData()).movements[0];
      expect(op).toMatchObject({ table: 'movements', kind: 'upsert', id: 'm1' });
      expect((op.payload as { updated_at: string }).updated_at).toBe(stored.updatedAt);
      expect(stored.updatedAt).not.toBe('sello viejo');
    });

    it('el borrado se encola como delete', async () => {
      await sync.saveMovementSynced(mov('m1'));
      await sync.removeMovementSynced('m1');
      expect((await db.readOutbox()).map((entry) => entry.op.kind)).toEqual(['upsert', 'delete']);
      expect((await db.getAllData()).movements).toHaveLength(0);
    });

    it('renombrar una categoría solo encola su fila', async () => {
      const category = cat('c1', { subcategories: [sub('s1'), sub('s2', { order: 1 })] });
      await db.saveCategory(category);
      await sync.saveCategorySynced({ ...category, name: 'Coche' });
      expect((await db.readOutbox()).map((entry) => [entry.op.table, entry.op.id])).toEqual([['categories', 'c1']]);
    });

    it('el borrado total exige conexión y no destruye nada si el servidor falla', async () => {
      await sync.saveMovementSynced(mov('m1'));
      mocks.rpc.mockResolvedValue({ data: null, error: netError });
      await expect(sync.clearAllDataSynced()).rejects.toThrow('Necesitas conexión');
      expect((await db.getAllData()).movements).toHaveLength(1);
    });

    it('tras el borrado total se adopta el epoch nuevo y se conserva la sesión', async () => {
      mocks.rpc.mockResolvedValue({ data: 7, error: null });
      await sync.clearAllDataSynced();
      expect(await db.getSyncMeta()).toMatchObject({ userId: 'u1', dataUserId: 'u1', wipeEpoch: 7, migratedAt: null });
      expect(await db.readOutbox()).toHaveLength(0);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPullToLocal, assembleCategories, canSkipPull, diffCategoryDoc, fromAccountRow, fromClosingRow, fromMovementRow, monotonicStamp, repairDanglingRefs, toAccountRow, toCategoryRow, toClosingRow, toMovementRow, toSubRow } from './sync';
import { defaultCategories } from './data';
import type { Account, Category, Closing, Movement, OutboxOp, Subcategory } from './types';

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
const acc = (id: string, over: Partial<Account> = {}): Account => ({ id, name: id, nature: 'asset', isInvestment: false, isLiquid: true, archived: false, order: 0, updatedAt: T0, ...over });
const cierre = (accountId: string, over: Partial<Closing> = {}): Closing => ({ id: `${accountId}:2026-01`, accountId, month: '2026-01', balance: 100, updatedAt: T0, ...over });
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
  const accounts = [acc('a1')];

  it('reasigna a una categoría de recuperación del mismo tipo', () => {
    const repaired = repairDanglingRefs([mov('m1', { type: 'income', categoryId: 'borrada' })], categories, accounts);
    expect(repaired.movements[0].categoryId).toBe('recuperados-income');
    expect(repaired.categories.find((c) => c.id === 'recuperados-income')).toMatchObject({ type: 'income', archived: true });
  });

  it('limpia la subcategoría que no pertenece a su categoría', () => expect(repairDanglingRefs([mov('m1', { subcategoryId: 'otra' })], categories, accounts).movements[0].subcategoryId).toBeUndefined());

  // Sin cuenta de recuperación, a diferencia de las categorías: "sin cuenta" es un estado normal del
  // modelo. Lo que no puede pasar es perder el movimiento, que es dinero real del usuario.
  it('limpia la cuenta que ya no existe sin perder el movimiento', () => {
    const repaired = repairDanglingRefs([mov('m1', { accountId: 'fantasma' })], categories, accounts);
    expect(repaired.movements).toHaveLength(1);
    expect(repaired.movements[0].accountId).toBeUndefined();
  });

  it('respeta la cuenta que sí existe', () => expect(repairDanglingRefs([mov('m1', { accountId: 'a1' })], categories, accounts).movements[0].accountId).toBe('a1'));

  it('no toca nada cuando las referencias son válidas', () => {
    const movements = [mov('m1', { subcategoryId: 's1', accountId: 'a1' })];
    const repaired = repairDanglingRefs(movements, categories, accounts);
    expect(repaired.movements).toEqual(movements);
    expect(repaired.categories).toBe(categories);
  });

  it('es idempotente', () => {
    const once = repairDanglingRefs([mov('m1', { categoryId: 'borrada', accountId: 'fantasma' })], categories, accounts);
    const twice = repairDanglingRefs(once.movements, once.categories, accounts);
    expect(twice.movements).toEqual(once.movements);
    expect(twice.categories).toHaveLength(once.categories.length);
  });
});

describe('applyPullToLocal', () => {
  const snapshot = { movements: [mov('m1'), mov('m2')], categories: [cat('c1', { subcategories: [sub('s1')] })], accounts: [acc('a1')], closings: [cierre('a1')] };

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

  it('una cuenta y un cierre pendientes sobreviven al pull', () => {
    const pending = [
      { table: 'accounts' as const, kind: 'upsert' as const, id: 'a2', payload: toAccountRow(acc('a2')), updatedAt: STAMP },
      { table: 'account_closings' as const, kind: 'upsert' as const, id: 'a1:2026-02', payload: toClosingRow(cierre('a1', { id: 'a1:2026-02', month: '2026-02', balance: 250 })), updatedAt: STAMP },
    ];
    const merged = applyPullToLocal(snapshot, pending);
    expect(merged.accounts.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(merged.closings.map((c) => c.id)).toEqual(['a1:2026-01', 'a1:2026-02']);
  });

  it('un cierre pendiente pisa la versión que traía el servidor', () => {
    const pending = { table: 'account_closings' as const, kind: 'upsert' as const, id: 'a1:2026-01', payload: toClosingRow(cierre('a1', { balance: 999 })), updatedAt: STAMP };
    expect(applyPullToLocal(snapshot, [pending]).closings.find((c) => c.id === 'a1:2026-01')?.balance).toBe(999);
  });
});

describe('mapeo de filas', () => {
  it('la subcategoría vacía del formulario viaja como null', () => expect(toMovementRow(mov('m1', { subcategoryId: '' })).subcategory_id).toBeNull());
  it('las notas vacías viajan como null', () => expect(toMovementRow(mov('m1', { notes: '' })).notes).toBeNull());
  it('el importe se mantiene numérico en el viaje de vuelta', () => expect(fromMovementRow(toMovementRow(mov('m1', { amount: 12.34 }))).amount).toBe(12.34));
  it('un movimiento sin subcategoría vuelve sin la clave', () => expect(fromMovementRow(toMovementRow(mov('m1'))).subcategoryId).toBeUndefined());
  it('la cuenta vacía del formulario viaja como null', () => expect(toMovementRow(mov('m1', { accountId: '' })).account_id).toBeNull());
  it('un movimiento sin cuenta vuelve sin la clave', () => expect(fromMovementRow(toMovementRow(mov('m1'))).accountId).toBeUndefined());
  it('la cuenta sobrevive al viaje de ida y vuelta', () => expect(fromMovementRow(toMovementRow(mov('m1', { accountId: 'a1' })))).toEqual(mov('m1', { accountId: 'a1' })));
  it('la cuenta no pierde sus flags en el viaje de ida y vuelta', () => { const account = acc('a1', { nature: 'liability', isInvestment: true, isLiquid: false }); expect(fromAccountRow(toAccountRow(account))).toEqual(account); });
  it('un cierre vaciado conserva el balance null', () => expect(fromClosingRow(toClosingRow(cierre('a1', { balance: null }))).balance).toBeNull());
  it('un aportado a cero no se pierde en el viaje de vuelta', () => expect(fromClosingRow(toClosingRow(cierre('a1', { contributed: 0 }))).contributed).toBe(0));
  it('un cierre sin aportado vuelve sin la clave', () => expect(fromClosingRow(toClosingRow(cierre('a1'))).contributed).toBeUndefined());
  it('la nota vacía del cierre viaja como null', () => expect(toClosingRow(cierre('a1', { note: '' })).note).toBeNull());
});

describe('monotonicStamp', () => {
  it('avanza un milisegundo cuando el reloj se ha atrasado', () => expect(monotonicStamp(Date.parse('2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:05.000Z')).toBe('2026-01-01T00:00:05.001Z'));
  it('usa el reloj cuando va por delante del último sello', () => expect(monotonicStamp(Date.parse(STAMP), T0)).toBe(STAMP));
  it('sin sello previo devuelve la hora actual', () => expect(monotonicStamp(Date.parse(STAMP), null)).toBe(STAMP));
});

describe('canSkipPull', () => {
  it('se salta el pull cuando la huella es la misma y no se ha subido nada', () => expect(canSkipPull('d0', 'd0', false)).toBe(true));
  it('pulla cuando la huella del servidor ha cambiado', () => expect(canSkipPull('d1', 'd0', false)).toBe(false));
  it('pulla cuando nunca se ha aplicado ninguna', () => expect(canSkipPull('d0', null, false)).toBe(false));
  // La huella se lee al principio del ciclo, antes del push: si este ciclo ha subido algo, ya es
  // vieja y coincidir no significa "no hay nada nuevo".
  it('pulla siempre después de subir algo, aunque la huella coincida', () => expect(canSkipPull('d0', 'd0', true)).toBe(false));
  // Un servidor que no responde la huella (o una versión sin el RPC) tiene que degradar al
  // comportamiento de antes: descargarlo todo, nunca saltárselo.
  it('sin huella del servidor no se salta nada', () => expect(canSkipPull(null, null, false)).toBe(false));
});

// El motor guarda estado a nivel de módulo (cola en vuelo, huella del último pull, último sello), así
// que cada test necesita un módulo recién importado y no basta con limpiar IndexedDB.
describe('motor de sync', () => {
  let sync: typeof import('./sync');
  let db: typeof import('./db');
  const netError = { code: '', message: 'Failed to fetch' };
  const queue = (...ops: OutboxOp[]) => db.enqueueOutbox(ops);
  const pushedIds = () => mocks.upsert.mock.calls.map((call) => (call[1] as { id: string }).id);
  const pushedTables = () => mocks.upsert.mock.calls.map((call) => call[0] as string);
  const opFor = (id: string): OutboxOp => ({ table: 'movements', kind: 'upsert', id, payload: toMovementRow(mov(id)), updatedAt: STAMP });

  beforeEach(async () => {
    // Solo setTimeout: así el debounce de las escrituras nunca dispara un sync a destiempo, pero
    // fake-indexeddb conserva el setImmediate con el que agenda los eventos de sus transacciones
    // (fingirlo también deja colgada cualquier operación contra la base).
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.resolveUserId.mockResolvedValue('u1');
    // Forma que devuelve sync_fingerprint(): epoch y digest en la misma respuesta. Un digest estable
    // entre llamadas es justo lo que permite al segundo ciclo saltarse el pull.
    mocks.rpc.mockResolvedValue({ data: { wipe_epoch: 0, digest: 'd0' }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.select.mockResolvedValue({ data: [], error: null });
    db = await import('./db');
    await db.clearAllData();
    // Dispositivo ya vinculado: sin esto cada sync arrancaría por la primera subida, que tiene su
    // propio bloque de tests más abajo.
    await db.saveSyncMeta({ dataUserId: 'u1', migratedAt: T0 });
    sync = await import('./sync');
  });
  afterEach(() => vi.useRealTimers());

  it('sube la cola en el orden en que se escribió', async () => {
    await queue(opFor('a'), opFor('b'), opFor('c'));
    await sync.syncNow();
    expect(pushedIds()).toEqual(['a', 'b', 'c']);
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
    mocks.select.mockImplementation((table: string) => Promise.resolve({ data: table === 'movements' ? [toMovementRow(mov('m1'))] : table === 'categories' ? [toCategoryRow(category)] : table === 'subcategories' ? [toSubRow('c1', sub('s1'))] : table === 'accounts' ? [toAccountRow(acc('a1'))] : [toClosingRow(cierre('a1'))], error: null }));
    await sync.syncNow();
    const data = await db.getAllData();
    expect(data.movements.map((m) => m.id)).toEqual(['m1']);
    expect(data.categories).toEqual([category]);
    expect(data.accounts).toEqual([acc('a1')]);
    expect(data.closings).toEqual([cierre('a1')]);
  });

  it('no reescribe nada si el servidor devuelve lo mismo que la vez anterior', async () => {
    const reload = vi.fn(async () => {});
    const stop = sync.initSync(reload);
    await sync.syncNow();
    await sync.syncNow();
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('no descarga las tablas cuando la huella del servidor no ha cambiado', async () => {
    await sync.syncNow();
    expect(mocks.select).toHaveBeenCalled();
    mocks.select.mockClear();
    await sync.syncNow();
    // Este es el objetivo entero del cambio: el segundo ciclo se queda en el RPC de la huella y no
    // llega a pedir ni una tabla.
    expect(mocks.select).not.toHaveBeenCalled();
  });

  // La cifra que justifica todo el cambio: el ciclo en reposo (arranque con caché, sondeo de 60 s,
  // visibilitychange) pasa de 6 peticiones —el RPC del epoch más las cinco tablas— a exactamente 1.
  it('un ciclo en reposo cuesta una sola petición', async () => {
    await sync.syncNow();
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: { wipe_epoch: 0, digest: 'd0' }, error: null });
    await sync.syncNow();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('vuelve a descargar en cuanto la huella cambia', async () => {
    await sync.syncNow();
    mocks.select.mockClear();
    mocks.rpc.mockResolvedValue({ data: { wipe_epoch: 0, digest: 'otro' }, error: null });
    await sync.syncNow();
    expect(mocks.select).toHaveBeenCalled();
  });

  it('hace pull tras subir algo aunque la huella no haya cambiado', async () => {
    await sync.syncNow();          // deja la huella 'd0' aplicada
    mocks.select.mockClear();
    await queue(opFor('a'));
    await sync.syncNow();
    // La huella se leyó antes del push, así que da igual que coincida: hay que confirmar lo subido.
    expect(pushedIds()).toEqual(['a']);
    expect(mocks.select).toHaveBeenCalled();
  });

  // Cazado en la QA: el ciclo posterior a un push se bajaba las cinco tablas para nada. La huella se
  // lee antes de subir, así que la que se apuntaba describía el servidor de ANTES del push y el ciclo
  // siguiente la veía distinta. Un pull de más por cada push, autocorrectivo pero gratuito de evitar.
  it('tras un push no se descarga de más en el ciclo siguiente', async () => {
    await sync.syncNow();
    await queue(opFor('a'));
    mocks.rpc
      .mockResolvedValueOnce({ data: { wipe_epoch: 0, digest: 'antes' }, error: null })  // antes de subir
      .mockResolvedValue({ data: { wipe_epoch: 0, digest: 'despues' }, error: null });   // ya con lo subido
    await sync.syncNow();          // sube y pulla: correcto, aquí sí toca
    mocks.select.mockClear();
    await sync.syncNow();          // el servidor no ha cambiado desde el pull anterior
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('persiste la huella para que una recarga no vuelva a descargarlo todo', async () => {
    await sync.syncNow();
    expect((await db.getSyncMeta()).lastFingerprint).toBe('d0');
  });

  it('un borrado total en otro dispositivo tira también la huella', async () => {
    await sync.syncNow();
    mocks.rpc.mockResolvedValue({ data: { wipe_epoch: 9, digest: 'd0' }, error: null });
    mocks.select.mockClear();
    await sync.syncNow();
    // El digest sigue siendo 'd0', así que sin invalidar la huella el cortocircuito se habría saltado
    // el pull que vacía la pantalla, y el usuario seguiría viendo datos que ya no existen.
    expect(mocks.select).toHaveBeenCalled();
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
    mocks.rpc.mockResolvedValue({ data: { wipe_epoch: 4, digest: 'd1' }, error: null });
    await sync.syncNow();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(await db.readOutbox()).toHaveLength(0);
    expect((await db.getSyncMeta()).wipeEpoch).toBe(4);
  });

  it('un usuario distinto no hereda la cola del anterior', async () => {
    await db.saveSyncMeta({ dataUserId: 'otro' });
    await queue(opFor('a'));
    await sync.syncNow();
    expect(pushedIds()).not.toContain('a');
    expect(await db.getSyncMeta()).toMatchObject({ dataUserId: 'u1' });
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

    it('guarda el cierre y lo encola con el mismo sello', async () => {
      await sync.saveClosingSynced(cierre('a1', { updatedAt: 'sello viejo' }));
      const [{ op }] = await db.readOutbox();
      const stored = (await db.getAllData()).closings[0];
      expect(op).toMatchObject({ table: 'account_closings', kind: 'upsert', id: 'a1:2026-01' });
      expect((op.payload as { updated_at: string }).updated_at).toBe(stored.updatedAt);
      expect(stored.updatedAt).not.toBe('sello viejo');
    });

    it('vaciar un cierre encola un upsert con balance null, nunca un delete', async () => {
      await sync.saveClosingSynced(cierre('a1'));
      await sync.saveClosingSynced(cierre('a1', { balance: null }));
      const ops = (await db.readOutbox()).map((entry) => entry.op);
      expect(ops.map((op) => op.kind)).toEqual(['upsert', 'upsert']);
      expect((ops[1].payload as { balance: number | null }).balance).toBeNull();
      expect((await db.getAllData()).closings[0].balance).toBeNull();
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

  // El dispositivo aún no se ha vinculado: meta.migratedAt sigue a null.
  describe('primera vinculación', () => {
    beforeEach(async () => db.saveSyncMeta({ migratedAt: null }));
    const remoteSeeds = (table: string) => Promise.resolve({ data: table === 'categories' ? defaultCategories.map(toCategoryRow) : table === 'subcategories' ? defaultCategories.flatMap((c) => c.subcategories.map((s) => toSubRow(c.id, s))) : [], error: null });

    it('con el servidor vacío sube todo lo local, categorías antes que movimientos', async () => {
      await db.saveMovement(mov('m1', { categoryId: 'income' }));
      await sync.syncNow();
      expect(pushedIds()).toContain('m1');
      expect(pushedTables().indexOf('movements')).toBeGreaterThan(pushedTables().lastIndexOf('categories'));
      expect((await db.getSyncMeta()).migratedAt).not.toBeNull();
    });

    it('repara las referencias huérfanas para que la FK no rechace el movimiento', async () => {
      await db.saveMovement(mov('m1', { categoryId: 'esta-ya-no-existe' }));
      await sync.syncNow();
      const pushed = mocks.upsert.mock.calls.find((call) => (call[1] as { id: string }).id === 'm1');
      expect((pushed?.[1] as { category_id: string }).category_id).toBe('recuperados-expense');
      expect(pushedIds()).toContain('recuperados-expense');
    });

    it('con el servidor ya poblado no reenvía las categorías por defecto intactas', async () => {
      mocks.select.mockImplementation(remoteSeeds);
      await db.saveMovement(mov('m1', { categoryId: 'income' }));
      await sync.syncNow();
      expect(pushedTables()).toEqual(['movements']);
      expect((await db.getAllData()).movements.map((m) => m.id)).toEqual(['m1']);
    });

    // Con el servidor YA POBLADO, el primer login hacía dos rondas completas: la de firstSync y la del
    // pullAndApply del mismo ciclo, que se descargaba entero para tirarlo contra lastPullKey.
    // (En un servidor virgen siguen siendo dos, y debe ser así: uploadEverything sube todo, y hay que
    // pullear para confirmar qué aceptó el LWW del servidor.)
    it('con el servidor poblado, el primer login descarga las cinco tablas una sola vez', async () => {
      mocks.select.mockImplementation(remoteSeeds);
      await sync.syncNow();
      expect(mocks.select).toHaveBeenCalledTimes(5);
    });

    it('sí reenvía una categoría que este dispositivo había tocado', async () => {
      mocks.select.mockImplementation(remoteSeeds);
      await db.saveCategory({ ...defaultCategories[0], name: 'Mis ingresos', updatedAt: STAMP });
      await sync.syncNow();
      expect(pushedIds()).toContain('income');
    });

    it('lo que ya estaba encolado se pushea después de las categorías que necesita', async () => {
      await queue(opFor('m1'));
      await sync.syncNow();
      expect(pushedTables()[0]).toBe('categories');
      expect(pushedIds()).toContain('m1');
    });

    it('no repite la subida en el siguiente sync', async () => {
      await db.saveMovement(mov('m1', { categoryId: 'income' }));
      await sync.syncNow();
      const first = mocks.upsert.mock.calls.length;
      await sync.syncNow();
      expect(mocks.upsert.mock.calls).toHaveLength(first);
    });

    it('las cuentas se suben antes que sus cierres, que dependen de ellas por FK', async () => {
      await db.saveAccount(acc('a1'));
      await db.saveClosing(cierre('a1'));
      await db.saveMovement(mov('m1', { categoryId: 'income' }));
      await sync.syncNow();
      const tables = pushedTables();
      expect(tables.indexOf('account_closings')).toBeGreaterThan(tables.lastIndexOf('accounts'));
      expect(tables.indexOf('categories')).toBeGreaterThan(tables.lastIndexOf('account_closings'));
    });

    // El test que sostiene la fase: un 23503 en el push se trata como irrecuperable y descarta la op,
    // así que un movimiento que llegara antes que su cuenta se perdería para siempre.
    it('la cuenta se sube antes que el movimiento que la referencia', async () => {
      await db.saveAccount(acc('a1'));
      await db.saveMovement(mov('m1', { categoryId: 'income', accountId: 'a1' }));
      await sync.syncNow();
      const ids = pushedIds();
      expect(ids.indexOf('a1')).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf('a1')).toBeLessThan(ids.indexOf('m1'));
      expect(mocks.upsert.mock.calls.find((call) => (call[1] as { id: string }).id === 'm1')?.[1]).toMatchObject({ account_id: 'a1' });
    });

    it('un movimiento con una cuenta que ya no existe se sube sin ella, no se descarta', async () => {
      await db.saveMovement(mov('m1', { categoryId: 'income', accountId: 'fantasma' }));
      await sync.syncNow();
      expect(pushedIds()).toContain('m1');
      expect(mocks.upsert.mock.calls.find((call) => (call[1] as { id: string }).id === 'm1')?.[1]).toMatchObject({ account_id: null });
    });

    it('un cierre cuya cuenta no existe se omite en vez de estrellarse contra la FK', async () => {
      await db.saveClosing(cierre('fantasma'));
      await sync.syncNow();
      expect(pushedIds()).not.toContain('fantasma:2026-01');
    });

    it('una cuenta que el servidor ya tiene no se reenvía, pero su cierre editado sí', async () => {
      mocks.select.mockImplementation((table: string) => table === 'accounts' ? Promise.resolve({ data: [toAccountRow(acc('a1'))], error: null }) : remoteSeeds(table));
      await db.saveAccount(acc('a1'));
      await db.saveClosing(cierre('a1', { balance: 999, updatedAt: STAMP }));
      await sync.syncNow();
      expect(pushedTables()).toEqual(['account_closings']);
    });
  });
});

// Bloque aparte del "motor de sync" y el último del fichero: la marca de la demo vive en localStorage,
// que no se resetea entre tests, así que se limpia en el afterEach para no contaminar a nadie.
describe('modo demo', () => {
  let sync: typeof import('./sync');
  let db: typeof import('./db');

  beforeEach(async () => {
    // La marca va ANTES de los imports: db.ts elige el nombre de la base en el import.
    localStorage.setItem('finhub-demo', '1');
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.resolveUserId.mockResolvedValue('u1');
    mocks.rpc.mockResolvedValue({ data: { wipe_epoch: 0, digest: 'd0' }, error: null });
    db = await import('./db');
    await db.clearAllData();
    sync = await import('./sync');
  });
  afterEach(() => { vi.useRealTimers(); localStorage.clear() });

  it('escribe en su propia base, no en la del usuario', async () => expect((await db.dbPromise).name).toBe('finhub-demo'));

  it('la escritura se guarda en local pero no se encola ni se sube', async () => {
    await sync.saveMovementSynced(mov('m1'));
    expect((await db.getAllData()).movements.map((m) => m.id)).toEqual(['m1']);
    expect(await db.readOutbox()).toHaveLength(0);
    await vi.runAllTimersAsync(); // por si quedara programado un sync con debounce
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('initSync no arranca el motor y deja el estado en demo', () => {
    const stop = sync.initSync(async () => {});
    expect(sync.getSyncState()).toMatchObject({ status: 'demo', pendingOps: 0 });
    expect(mocks.select).not.toHaveBeenCalled();
    stop();
  });

  it('ni un syncNow forzado llega al servidor', async () => {
    await sync.syncNow();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('"borrar todo" vacía lo local sin pedir conexión', async () => {
    await sync.saveMovementSynced(mov('m1'));
    await sync.clearAllDataSynced();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await db.getAllData()).movements).toHaveLength(0);
  });
});

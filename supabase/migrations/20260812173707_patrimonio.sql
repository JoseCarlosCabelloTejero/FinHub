-- =============================================================================
-- Dominio patrimonio: cuentas y cierres mensuales.
--
-- El modelo esta decidido en docs/domains/patrimonio.md y la decision que lo
-- sostiene ("la foto manda") en docs/decisions/009-la-foto-manda-cierre-mensual.md.
-- Este fichero hereda TODAS las premisas del esquema base (20260808133140):
-- timestamps como text collate "C" con formato toISOString(), IDs generados en
-- cliente, PK siempre (user_id, id), y el DEFAULT auth.uid() para que el cliente
-- nunca mande user_id.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Tablas
-- -----------------------------------------------------------------------------

create table public.accounts (
  user_id       uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id            text    collate "C" not null,
  name          text    not null,
  -- El signo con el que la cuenta entra en el patrimonio lo decide esta columna,
  -- NUNCA el dato: el saldo de un cierre se teclea siempre en positivo ("debo
  -- 84.300") y un pasivo resta al agregarse. Es el mismo invariante que ya usa
  -- movements ("el importe nunca es negativo; el signo lo da el tipo") y elimina
  -- de raiz el error de entrada manual mas probable.
  nature        text    not null,
  -- Si su valor puede moverse sin que entre dinero (broker si, ahorro no). Solo a
  -- estas cuentas se les pregunta el aportado en el cierre.
  is_investment boolean not null default false,
  -- Si cuenta para el "disponible manana". Aplica a activos Y a pasivos: la
  -- corriente suma, la tarjeta resta, el broker y la hipoteca se ignoran.
  is_liquid     boolean not null default false,
  -- Las cuentas se archivan, nunca se borran: los cierres historicos las
  -- referencian. Mismo patron y misma razon que las categorias (ADR 005).
  archived      boolean not null default false,
  "order"       integer not null default 0,
  updated_at    text    collate "C" not null,

  constraint accounts_pkey primary key (user_id, id),
  constraint accounts_nature_check check (nature in ('asset', 'liability')),
  constraint accounts_updated_at_iso
    check (updated_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
);

-- El valor de UNA cuenta en UN mes: un "cierre" ("snapshot" ya significa el
-- estado completo del servidor en este proyecto; ver el glosario). El grano del
-- conflicto es la pareja (cuenta, mes) y el id determinista lo materializa: dos
-- dispositivos que cierren la misma cuenta el mismo mes convergen a la MISMA
-- fila y el LWW por fila resuelve solo, igual que las subcategorias (ADR 007).
create table public.account_closings (
  user_id     uuid          not null default auth.uid() references auth.users (id) on delete cascade,
  id          text          collate "C" not null,
  account_id  text          collate "C" not null,
  -- 'YYYY-MM'. Sin granularidad diaria: es un no objetivo del dominio, no una
  -- limitacion pendiente. Los cierres NO pasan por el filtrado de periodo.
  month       text          collate "C" not null,
  -- NULL = "mes no revisado". Un cierre se edita o se vacia, nunca se borra: asi
  -- este dominio no necesita su propia tabla de lapidas (simplificacion
  -- deliberada; no deshacerla sin pasar por el ADR). Siempre >= 0 cuando no es
  -- NULL: el signo ya lo puso la naturaleza de la cuenta.
  balance     numeric(12,2),
  -- Dinero propio que entro ese mes. En una cuenta de inversion es lo que separa
  -- ahorro de rentabilidad; en un pasivo significa "principal amortizado". Sin
  -- check de signo a proposito: una retirada del broker es un aportado negativo.
  contributed numeric(12,2),
  note        text,
  updated_at  text          collate "C" not null,

  constraint account_closings_pkey primary key (user_id, id),
  -- La FK incluye user_id, como todas: impide colgar un cierre de la cuenta de
  -- otro usuario aunque los ids coincidieran.
  constraint account_closings_account_fkey
    foreign key (user_id, account_id) references public.accounts (user_id, id)
    on delete cascade,
  -- El invariante del id determinista no depende de que el cliente se porte bien.
  constraint account_closings_id_shape
    check (id = account_id || ':' || month),
  constraint account_closings_month_shape
    check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint account_closings_balance_check
    check (balance is null or balance >= 0),
  constraint account_closings_updated_at_iso
    check (updated_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
);

-- Referencia opcional de un movimiento a su cuenta. La UI que la escribe llega en
-- la fase 4 del plan; la columna nace ya para que esa fase sea 100% cliente, sin
-- segunda migracion. Nullable e inerte hasta entonces: PostgREST solo actualiza
-- las columnas presentes en el payload, asi que un cliente anterior no la pisa.
-- Mismo patron exacto que subcategory_id: MATCH SIMPLE, SET NULL con lista de
-- columnas (PG 15+) para no anular user_id, y el check del '' porque el select
-- del modal usara value="" para "Sin cuenta".
alter table public.movements
  add column account_id text collate "C",
  add constraint movements_account_fkey
    foreign key (user_id, account_id) references public.accounts (user_id, id)
    on delete set null (account_id),
  add constraint movements_account_id_not_empty
    check (account_id is null or account_id <> '');


-- -----------------------------------------------------------------------------
-- Indices: solo el lado hijo de cada FK, mismo criterio que el esquema base (el
-- pull trae las tablas enteras, asi que no hay lector para nada mas).
-- -----------------------------------------------------------------------------

create index account_closings_account_idx on public.account_closings (user_id, account_id);
create index movements_account_idx        on public.movements (user_id, account_id);


-- -----------------------------------------------------------------------------
-- LWW: la funcion generica existente vale tal cual (su unico requisito es que la
-- tabla tenga updated_at, y ambas lo tienen).
-- -----------------------------------------------------------------------------

create trigger accounts_lww         before update on public.accounts
  for each row execute function public.discard_stale_write();
create trigger account_closings_lww before update on public.account_closings
  for each row execute function public.discard_stale_write();

-- Sin trigger de lapidas ni anti-resurreccion: el cliente nunca emite DELETE
-- sobre estas tablas (las cuentas se archivan, los cierres se vacian), asi que
-- no hay borrado que proteger. El unico borrado real es wipe_all_data().


-- -----------------------------------------------------------------------------
-- RLS y grants, calcados del esquema base. Sin politica DELETE ni grant DELETE a
-- proposito, como categories/subcategories.
-- -----------------------------------------------------------------------------

alter table public.accounts         enable row level security;
alter table public.account_closings enable row level security;

create policy accounts_select_own on public.accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy accounts_insert_own on public.accounts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy accounts_update_own on public.accounts
  for update to authenticated using ((select auth.uid()) = user_id)
                              with check ((select auth.uid()) = user_id);

create policy account_closings_select_own on public.account_closings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy account_closings_insert_own on public.account_closings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy account_closings_update_own on public.account_closings
  for update to authenticated using ((select auth.uid()) = user_id)
                              with check ((select auth.uid()) = user_id);

revoke all on table public.accounts, public.account_closings
  from public, anon, authenticated;

grant select, insert, update on table public.accounts         to authenticated;
grant select, insert, update on table public.account_closings to authenticated;


-- -----------------------------------------------------------------------------
-- wipe_all_data() aprende las tablas nuevas
-- -----------------------------------------------------------------------------

-- Identica a la version del esquema base salvo los dos DELETE nuevos. "Borrar
-- todo" tiene que barrer tambien cuentas y cierres, o la proxima sincronizacion
-- repoblaria un patrimonio que el usuario creia eliminado. Sin resiembra: el
-- dominio patrimonio no tiene datos por defecto.
create or replace function public.wipe_all_data() returns bigint
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_epoch bigint;
begin
  if v_uid is null then
    raise exception 'No hay sesion activa: auth.uid() es NULL'
      using errcode = '42501';
  end if;

  -- Primero el epoch: si algo falla despues, toda la transaccion se deshace y no
  -- queda un epoch incrementado sobre datos intactos.
  insert into public.sync_meta as m (user_id, wipe_epoch, updated_at)
  values (v_uid, 1, public.iso_now())
  on conflict (user_id) do update
    set wipe_epoch = m.wipe_epoch + 1,
        updated_at = excluded.updated_at
  returning m.wipe_epoch into v_epoch;

  -- Borrados ordenados de hijo a padre. movements va antes que accounts porque
  -- ahora la referencia (su SET NULL dispararia escrituras inutiles al reves).
  delete from public.movements        where user_id = v_uid;
  delete from public.subcategories    where user_id = v_uid;
  delete from public.categories       where user_id = v_uid;
  delete from public.account_closings where user_id = v_uid;
  delete from public.accounts         where user_id = v_uid;

  -- SIEMPRE el ultimo: el DELETE de movimientos de arriba acaba de disparar el
  -- trigger AFTER DELETE y ha creado una lapida por movimiento.
  delete from public.movement_tombstones where user_id = v_uid;

  return v_epoch;
end;
$$;


-- Recarga del cache de esquema de PostgREST (necesario en `db push` remoto).
notify pgrst, 'reload schema';

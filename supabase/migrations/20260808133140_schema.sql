-- =============================================================================
-- Fase 1: esquema base de sync (IndexedDB -> Supabase).
--
-- Premisas que atraviesan todo el fichero:
--   * Todos los timestamps y fechas son `text`, nunca timestamptz. El cliente
--     los produce con Date.prototype.toISOString() ("YYYY-MM-DDTHH:mm:ss.sssZ",
--     ancho fijo y siempre UTC). Guardarlos tal cual garantiza round-trip byte a
--     byte y que la comparacion lexicografica == comparacion cronologica, que es
--     de lo que depende TODA la logica LWW. Un timestamptz los reformatearia
--     ("2026-08-08 12:00:00+00") y romperia esa equivalencia en el cliente.
--   * `collate "C"` en esas columnas para que `<=` sea comparacion de bytes
--     pura, independiente del lc_collate de la base.
--   * Los IDs son strings generados en cliente (slugs estables para el arbol por
--     defecto, uuid v4 para lo creado a mano). Se conservan como PK: la subida
--     inicial y el push son upserts ciegos e idempotentes.
--   * La PK es SIEMPRE (user_id, id), no id: dos usuarios comparten los mismos
--     slugs por defecto ('income', 'expense-coche'), asi que una PK solo sobre
--     `id` colisionaria entre usuarios y el ON CONFLICT DO UPDATE de PostgREST
--     intentaria actualizar la fila del otro usuario.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------

-- "Ahora" en el MISMO formato exacto que toISOString(): ancho fijo, UTC,
-- milisegundos siempre a 3 digitos. Sin esto, un timestamp escrito por el
-- servidor (los tombstones) no seria comparable con los del cliente.
create or replace function public.iso_now() returns text
  language sql
  stable
  set search_path = ''
as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

comment on function public.iso_now() is
  'Timestamp UTC con el formato exacto de Date.prototype.toISOString().';


-- -----------------------------------------------------------------------------
-- Tablas de datos
-- -----------------------------------------------------------------------------

create table public.categories (
  -- El DEFAULT hace que el cliente NUNCA tenga que mandar user_id en el payload.
  -- Postgres aplica los DEFAULT antes de disparar los triggers BEFORE, asi que
  -- NEW.user_id ya viene relleno dentro de ellos.
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id         text    collate "C" not null,
  name       text    not null,
  type       text    not null,
  -- "order" va entrecomillado: es palabra reservada. Ver nota 8 al final.
  "order"    integer not null default 0,
  archived   boolean not null default false,
  -- Sin DEFAULT a proposito: si el cliente se olvida de mandarlo queremos un 400
  -- ruidoso, no un valor que convierta la escritura en descartada para siempre.
  updated_at text    collate "C" not null,

  constraint categories_pkey primary key (user_id, id),
  constraint categories_type_check check (type in ('income', 'expense')),
  constraint categories_updated_at_iso
    check (updated_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
);

create table public.subcategories (
  -- En el cliente van embebidas dentro de Category; aqui se normalizan para
  -- poder tener FK real desde movements. El cliente las reensambla al hacer pull.
  user_id     uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id          text    collate "C" not null,
  category_id text    collate "C" not null,
  name        text    not null,
  "order"     integer not null default 0,
  archived    boolean not null default false,
  updated_at  text    collate "C" not null,

  constraint subcategories_pkey primary key (user_id, id),
  -- La FK incluye user_id: impide colgar una subcategoria de la categoria de
  -- otro usuario aunque los ids coincidan (los slugs por defecto SI coinciden).
  constraint subcategories_category_fkey
    foreign key (user_id, category_id) references public.categories (user_id, id)
    on delete cascade,
  constraint subcategories_updated_at_iso
    check (updated_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
);

create table public.movements (
  user_id        uuid          not null default auth.uid() references auth.users (id) on delete cascade,
  id             text          collate "C" not null,
  type           text          not null,
  amount         numeric(12,2) not null,
  date           text          collate "C" not null,   -- 'YYYY-MM-DD', tal cual lo produce <input type="date">
  category_id    text          collate "C" not null,
  subcategory_id text          collate "C",            -- nullable: "Sin subcategoria"
  concept        text          not null,
  notes          text,
  created_at     text          collate "C" not null,
  updated_at     text          collate "C" not null,

  constraint movements_pkey primary key (user_id, id),
  constraint movements_category_fkey
    foreign key (user_id, category_id) references public.categories (user_id, id)
    on delete cascade,
  -- MATCH SIMPLE (el default): si subcategory_id es NULL la restriccion se da
  -- por satisfecha sin mirar user_id, que es exactamente lo que queremos.
  -- MATCH FULL exigiria que TODAS las columnas fuesen NULL a la vez y, como
  -- user_id es NOT NULL, rechazaria cualquier movimiento sin subcategoria.
  --
  -- SET NULL con lista de columnas (Postgres 15+): un `on delete set null` a
  -- secas sobre una FK compuesta pondria a NULL TAMBIEN user_id, que es NOT NULL,
  -- y el borrado fallaria. Ademas conserva el movimiento al borrar la
  -- subcategoria, en linea con "archivar preserva el historico".
  constraint movements_subcategory_fkey
    foreign key (user_id, subcategory_id) references public.subcategories (user_id, id)
    on delete set null (subcategory_id),

  constraint movements_type_check check (type in ('income', 'expense')),
  constraint movements_amount_check check (amount >= 0),
  -- El select de subcategoria del modal usa value="" para "Sin subcategoria".
  -- Sin este check, un '' que se cuele produce un 23503 desconcertante en vez de
  -- un error que nombre el problema. El mapper del cliente debe hacer '' -> null.
  constraint movements_subcategory_id_not_empty
    check (subcategory_id is null or subcategory_id <> ''),
  constraint movements_date_iso check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint movements_created_at_iso
    check (created_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'),
  constraint movements_updated_at_iso
    check (updated_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
);


-- -----------------------------------------------------------------------------
-- Tablas server-only
-- -----------------------------------------------------------------------------

-- Lapidas de movimientos borrados. El cliente NUNCA la lee ni la escribe: solo
-- la tocan los triggers (SECURITY DEFINER) y el RPC de wipe.
--
-- OJO: no referencia auth.users a proposito. El trigger AFTER DELETE inserta
-- filas aqui mientras el borrado en cascada de un usuario esta en curso; con una
-- FK a auth.users ese INSERT chocaria con la fila de usuario ya borrada y haria
-- fallar `delete from auth.users`. Sin FK, el ledger queda huerfano (unos bytes)
-- y el borrado de usuario siempre funciona.
create table public.movement_tombstones (
  user_id    uuid not null,
  id         text collate "C" not null,
  deleted_at text collate "C" not null,

  constraint movement_tombstones_pkey primary key (user_id, id),
  constraint movement_tombstones_deleted_at_iso
    check (deleted_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
);

comment on table public.movement_tombstones is
  'Server-only. Sin grants para anon/authenticated y sin politicas RLS.';

-- Contador de "borrar todo". El cliente lo LEE (para detectar que otro
-- dispositivo hizo un wipe y vaciar su cache local antes de pushear), pero no lo
-- escribe: solo lo incrementa wipe_all_data().
create table public.sync_meta (
  user_id    uuid   not null references auth.users (id) on delete cascade,
  wipe_epoch bigint not null default 0,
  updated_at text   collate "C" not null default public.iso_now(),

  constraint sync_meta_pkey primary key (user_id)
);


-- -----------------------------------------------------------------------------
-- Indices
--
-- Deliberadamente pocos:
--   * No hace falta indice sobre user_id: es la columna LIDER de todas las PK,
--     asi que el pull completo (`where user_id = ...`) ya usa el indice de PK.
--   * No hay indice por date/type/updated_at: el pull se trae la tabla entera y
--     App.tsx filtra y ordena en memoria. Anadir uno seria coste de escritura sin
--     lector. (Si algun dia se hace pull incremental, entonces si:
--     movements (user_id, updated_at)).
--   * Si hacen falta los del lado hijo de cada FK: sin ellos, el ON DELETE
--     CASCADE / SET NULL hace un seq scan por cada fila padre borrada.
-- -----------------------------------------------------------------------------

create index subcategories_category_idx on public.subcategories (user_id, category_id);
create index movements_category_idx     on public.movements (user_id, category_id);
create index movements_subcategory_idx  on public.movements (user_id, subcategory_id);


-- -----------------------------------------------------------------------------
-- Trigger LWW: descarta escrituras viejas
-- -----------------------------------------------------------------------------

-- Una sola funcion generica para las 3 tablas: en PL/pgSQL, NEW/OLD son records
-- y `new.updated_at` se resuelve en tiempo de ejecucion contra la tabla que
-- dispara el trigger. Contrapartida: colgarla de una tabla sin updated_at
-- compila bien y peta al disparar.
--
-- SECURITY INVOKER (default) a proposito: no toca ninguna otra tabla, asi que no
-- necesita privilegios prestados. Minimo privilegio.
create or replace function public.discard_stale_write() returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  -- RETURN NULL (no RETURN OLD): en un trigger BEFORE ... FOR EACH ROW, devolver
  -- NULL cancela la operacion para esa fila, en silencio y sin escritura. Con
  -- RETURN OLD la fila SI se reescribiria (tupla muerta, evento UPDATE en el WAL
  -- que Realtime difundiria, triggers AFTER disparados) y el contador de filas
  -- afectadas seria 1. Todo eso es ruido con cero valor.
  --
  -- `<=` y no `<`: el empate se descarta. Eso es justo lo que hace idempotente el
  -- reintento del outbox tras un fallo de red (llega con el mismo updated_at, se
  -- descarta, y el estado final es identico).
  if (new.updated_at collate "C") <= old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

comment on function public.discard_stale_write() is
  'LWW: descarta el UPDATE si updated_at no es estrictamente mas nuevo.';

create trigger categories_lww    before update on public.categories
  for each row execute function public.discard_stale_write();
create trigger subcategories_lww before update on public.subcategories
  for each row execute function public.discard_stale_write();
create trigger movements_lww     before update on public.movements
  for each row execute function public.discard_stale_write();


-- -----------------------------------------------------------------------------
-- Trigger anti-resurreccion
-- -----------------------------------------------------------------------------

-- Escenario que cubre: B edita el movimiento M sin conexion; A lo borra y pushea;
-- B pushea despues. Como la fila ya no existe, el upsert de B entra por la rama
-- INSERT del ON CONFLICT y el trigger BEFORE UPDATE (LWW) no llega a ejecutarse:
-- M resucitaria. Aqui se compara contra la lapida.
--
-- SECURITY DEFINER es OBLIGATORIO: las funciones de trigger corren con los
-- privilegios de quien ejecuta el DML (rol `authenticated`), y a ese rol se le ha
-- revocado todo sobre movement_tombstones. Sin SECURITY DEFINER, cada INSERT de
-- un movimiento fallaria con "permission denied for table movement_tombstones".
--
-- Con SECURITY DEFINER la funcion corre como su owner (`postgres`), que es dueno
-- de la tabla y por tanto SALTA la RLS (no hay FORCE ROW LEVEL SECURITY). Por eso
-- el filtro `t.user_id = new.user_id` es carga estructural, no decorativo: es lo
-- unico que impide mirar las lapidas de otro usuario.
--
-- `set search_path = ''` evita el secuestro del search_path (que alguien cree un
-- `movement_tombstones` en un esquema propio que se resuelva antes) y obliga a
-- cualificar todo; pg_catalog sigue implicito.
create or replace function public.block_resurrected_movement() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_deleted_at text;
begin
  select t.deleted_at into v_deleted_at
    from public.movement_tombstones t
   where t.user_id = new.user_id
     and t.id = new.id;

  -- `>=` : ante empate exacto gana el borrado. Borrar es la operacion
  -- destructiva y explicita; resucitar por accidente es peor que perder una
  -- edicion concurrente del mismo milisegundo.
  if v_deleted_at is not null and (v_deleted_at collate "C") >= new.updated_at then
    return null;
  end if;

  return new;
end;
$$;

create trigger movements_block_resurrection before insert on public.movements
  for each row execute function public.block_resurrected_movement();


-- -----------------------------------------------------------------------------
-- Trigger de lapidas automaticas
-- -----------------------------------------------------------------------------

-- En servidor y no en cliente: el cliente puede quedarse sin bateria, sin red o
-- cerrar la pestana entre el DELETE y el INSERT de la lapida, y ademas necesitaria
-- permisos de escritura sobre la tabla que precisamente queremos aislarle. Aqui es
-- atomico con el DELETE por construccion y cubre TODA via de borrado (cliente,
-- cascada al borrar una categoria, psql).
create or replace function public.record_movement_tombstone() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.movement_tombstones as t (user_id, id, deleted_at)
  values (
    old.user_id,
    old.id,
    -- greatest(): el reloj del servidor puede ir por detras del dispositivo que
    -- creo la version borrada. Garantizando deleted_at >= updated_at de la fila
    -- borrada, el borrado siempre gana a la version que borro.
    greatest(old.updated_at collate "C", public.iso_now())
  )
  on conflict (user_id, id) do update
    -- Un id puede borrarse mas de una vez (borrar -> recrear -> borrar). Nos
    -- quedamos con la lapida mas reciente; sin esto, el segundo DELETE fallaria
    -- por PK duplicada y el usuario no podria borrar el movimiento.
    set deleted_at = greatest(t.deleted_at, excluded.deleted_at);

  return null; -- en un trigger AFTER el valor devuelto se ignora
end;
$$;

create trigger movements_record_tombstone after delete on public.movements
  for each row execute function public.record_movement_tombstone();


-- -----------------------------------------------------------------------------
-- RLS
--
-- `enable`, no `force`. `force row level security` sujetaria tambien al OWNER a
-- las politicas, y eso ROMPERIA el diseno: los triggers SECURITY DEFINER y el RPC
-- de wipe corren como `postgres` sobre movement_tombstones, que no tiene NI UNA
-- politica -> todo denegado. El bypass del owner es la pieza que hace que
-- "server-only" funcione.
-- -----------------------------------------------------------------------------

alter table public.categories          enable row level security;
alter table public.subcategories       enable row level security;
alter table public.movements           enable row level security;
alter table public.sync_meta           enable row level security;
-- Sin politicas: RLS activa + cero politicas = denegacion total. La barrera real
-- frente al cliente son los grants (mas abajo); esto es la red.
alter table public.movement_tombstones enable row level security;

-- Politicas separadas por operacion en vez de un `for all`:
--   * `for all ... using (x)` funciona (Postgres reutiliza USING como WITH CHECK
--     si no se declara), pero de forma implicita y facil de romper.
--   * Separadas se ve de un vistazo que SELECT/DELETE solo tienen USING y que
--     INSERT/UPDATE tienen WITH CHECK. El WITH CHECK es la parte que de verdad
--     sostiene el modelo: sin el, un payload con user_id ajeno se colaria pese al
--     DEFAULT.
--   * `to authenticated` evita que la politica se evalue siquiera para anon.
--   * `(select auth.uid())` en vez de `auth.uid()`: el planificador lo convierte
--     en un InitPlan evaluado UNA vez por consulta en lugar de una vez por fila.
--   * Si auth.uid() es NULL (sin JWT), la comparacion da NULL -> denegado. Falla
--     cerrado.

create policy categories_select_own on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy categories_insert_own on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy categories_update_own on public.categories
  for update to authenticated using ((select auth.uid()) = user_id)
                                with check ((select auth.uid()) = user_id);
-- Sin politica DELETE a proposito: las categorias se archivan (archived = true),
-- nunca se borran. El unico borrado masivo es wipe_all_data(), que corre como
-- owner y no pasa por RLS.

create policy subcategories_select_own on public.subcategories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy subcategories_insert_own on public.subcategories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy subcategories_update_own on public.subcategories
  for update to authenticated using ((select auth.uid()) = user_id)
                                with check ((select auth.uid()) = user_id);

create policy movements_select_own on public.movements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy movements_insert_own on public.movements
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy movements_update_own on public.movements
  for update to authenticated using ((select auth.uid()) = user_id)
                             with check ((select auth.uid()) = user_id);
create policy movements_delete_own on public.movements
  for delete to authenticated using ((select auth.uid()) = user_id);

-- sync_meta: solo lectura. La escritura pasa exclusivamente por wipe_all_data().
create policy sync_meta_select_own on public.sync_meta
  for select to authenticated using ((select auth.uid()) = user_id);


-- -----------------------------------------------------------------------------
-- Grants
--
-- La RLS filtra FILAS; los grants deciden si la TABLA existe para el rol. Para
-- aislar de verdad movement_tombstones hacen falta los dos: sin grants PostgREST
-- ni siquiera la publica en su esquema (403 limpio) en lugar de devolver una
-- lista vacia que parece una tabla legitima y sin datos.
--
-- En proyectos nuevos las tablas ya NO se exponen solas a anon/authenticated,
-- pero proyectos antiguos conservan un ALTER DEFAULT PRIVILEGES que si lo hace.
-- El REVOKE explicito hace que este fichero se comporte igual en los dos casos.
-- -----------------------------------------------------------------------------

revoke all on table
  public.categories, public.subcategories, public.movements,
  public.movement_tombstones, public.sync_meta
  from public, anon, authenticated;

grant select, insert, update         on table public.categories    to authenticated;
grant select, insert, update         on table public.subcategories to authenticated;
grant select, insert, update, delete on table public.movements     to authenticated;
grant select                         on table public.sync_meta     to authenticated;
-- public.movement_tombstones: ningun grant, a proposito.


-- -----------------------------------------------------------------------------
-- RPC de lectura del epoch
-- -----------------------------------------------------------------------------

-- La fila de sync_meta se crea de forma perezosa dentro de wipe_all_data(); antes
-- del primer wipe no existe. Esta funcion evita que el cliente tenga que
-- distinguir "no hay fila" de "epoch 0" (con .single() eso seria un PGRST116 que
-- parece un error). SECURITY INVOKER: pasa por RLS y por el grant de SELECT.
create or replace function public.current_wipe_epoch() returns bigint
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select coalesce(
    (select m.wipe_epoch from public.sync_meta m where m.user_id = auth.uid()),
    0::bigint
  );
$$;


-- -----------------------------------------------------------------------------
-- RPC de borrado total
-- -----------------------------------------------------------------------------

-- Equivalente en servidor del "Borrar todo" (que ya pide doble confirmacion en la
-- UI). SECURITY DEFINER porque toca dos tablas sobre las que `authenticated` no
-- tiene los grants necesarios: sync_meta (solo SELECT) y movement_tombstones
-- (nada).
--
-- No recibe parametros: una version con `wipe_all_data(p_user_id uuid)` seria un
-- IDOR de manual, porque como definer saltaria la RLS.
create or replace function public.wipe_all_data() returns bigint
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_epoch bigint;
begin
  -- Sin esto, `where user_id = null` no borraria nada y el insert en sync_meta
  -- petaria con un 23502 opaco. 42501 lo traduce PostgREST a 401/403.
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

  -- Borrados ordenados de hijo a padre. Las FK son ON DELETE CASCADE, asi que
  -- bastaria con borrar categories; se hace explicito para que el orden respecto
  -- al purgado de lapidas sea evidente y no dependa de la cascada.
  delete from public.movements     where user_id = v_uid;
  delete from public.subcategories where user_id = v_uid;
  delete from public.categories    where user_id = v_uid;

  -- SIEMPRE el ultimo: el DELETE de movimientos de arriba acaba de disparar el
  -- trigger AFTER DELETE y ha creado una lapida por movimiento. Purgarlas antes
  -- las dejaria recien resucitadas.
  delete from public.movement_tombstones where user_id = v_uid;

  return v_epoch;
end;
$$;

comment on function public.wipe_all_data() is
  'Borra todos los datos del usuario e incrementa wipe_epoch. Devuelve el nuevo epoch.';


-- -----------------------------------------------------------------------------
-- Grants de funciones
--
-- Postgres concede EXECUTE a PUBLIC en toda funcion nueva; hay que revocarlo
-- antes de conceder. Especialmente critico en wipe_all_data(), que es SECURITY
-- DEFINER.
--
-- Las funciones de trigger no se blindan porque Postgres ya se niega a
-- ejecutarlas fuera de un trigger, y su privilegio de EXECUTE solo se comprueba
-- al CREAR el trigger, no al dispararlo.
-- -----------------------------------------------------------------------------

revoke all on function public.iso_now()            from public;
revoke all on function public.current_wipe_epoch() from public;
revoke all on function public.wipe_all_data()      from public;

grant execute on function public.current_wipe_epoch() to authenticated;
grant execute on function public.wipe_all_data()      to authenticated;


-- -----------------------------------------------------------------------------
-- NOTAS PARA LAS FASES 2 y 4 (cliente). No son opcionales.
--   1. `amount` llega como NUMERO JSON, no como string (PostgREST usa to_json).
--      numeric(12,2) cabe de sobra en un double: NO hacer parseFloat.
--   2. El cliente NO debe mandar user_id en el payload: aplica el DEFAULT.
--   3. El cliente NO debe encadenar .select() al .upsert(): sin el, la respuesta
--      es 201 con cuerpo vacio y una fila descartada por LWW es indistinguible de
--      una aplicada, que es lo que queremos en un push ciego.
--   4. Category y sus subcategorias necesitan updatedAt en src/types.ts, y hay
--      que bumpearlo en TODA mutacion (renombrar, archivar, reordenar, anadir).
--   5. updated_at monotono por dispositivo:
--        new Date(Math.max(Date.now(), Date.parse(prev.updatedAt)+1)).toISOString()
--   6. subcategoryId: el modal usa value="" -> mapear '' a null antes de subir.
--   7. Antes de cada push, leer current_wipe_epoch(). Un wipe purga las lapidas,
--      asi que el trigger anti-resurreccion no protege ahi: el epoch es la unica
--      defensa.
--   8. "order" choca con el parametro reservado `order` de PostgREST: no se puede
--      filtrar por el via API. Inofensivo, App.tsx ordena en JS.
-- -----------------------------------------------------------------------------

-- Recarga del cache de esquema de PostgREST (necesario en `db push` remoto;
-- `db reset` ya lo hace).
notify pgrst, 'reload schema';

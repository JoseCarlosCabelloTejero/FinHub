-- =============================================================================
-- Huella de sincronizacion: saber si hay que hacer pull SIN hacer el pull.
--
-- El motivo esta en docs/decisions/011-huella-de-sincronizacion.md. En corto:
-- el cliente ya tenia `lastPullKey` (el JSON del ultimo snapshot recibido) para
-- no repintar cuando nada habia cambiado, pero comparaba DESPUES de descargar
-- las cinco tablas enteras. Los bytes ya habian viajado, y eso ocurria en cada
-- arranque, cada `visibilitychange` y cada 60 s con la pestana visible.
--
-- Esta funcion es el gemelo servidor de esa clave: la misma idea, calculada
-- antes de mover los datos.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- sync_fingerprint()
-- -----------------------------------------------------------------------------

-- Devuelve las DOS cosas que el ciclo de sync necesita antes de decidir nada:
-- el wipe_epoch (que ya se leia con su propio RPC) y un digest del estado. Van
-- juntas a proposito: en el ciclo en reposo esto es la UNICA peticion que sale.
--
-- SECURITY INVOKER (el default, explicito por documentacion): pasa por RLS y por
-- los grants de SELECT, asi que el digest se calcula solo sobre las filas del
-- llamante. Un SECURITY DEFINER aqui seria un agujero de manual — veria las
-- filas de todos y filtraria por diferencia de digest.
--
-- STABLE y no VOLATILE: dentro de una misma sentencia no cambia, que es lo que
-- permite a Postgres ejecutarla una sola vez.
create or replace function public.sync_fingerprint() returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select jsonb_build_object(
    'wipe_epoch', public.current_wipe_epoch(),
    'digest', (
      -- md5 sobre el CONJUNTO de pares (id, updated_at), no sobre
      -- `count(*) + max(updated_at)`, que seria mas barato pero puede quedarse
      -- ciego: si el dispositivo B tiene el reloj adelantado y escribe con sello
      -- T5, una escritura POSTERIOR del dispositivo A con sello T3 deja count y
      -- max intactos, y el cambio se perderia en silencio. Es justo el desfase
      -- horario que monotonicStamp() existe para sobrevivir (ver src/sync.ts), asi
      -- que la huella no puede ser ciega a el. Cualquier alta, baja o modificacion
      -- cambia el conjunto, y por tanto el digest.
      --
      -- El prefijo por tabla evita que un mismo id en dos tablas se solape (los
      -- ids de categoria son slugs deterministas, no uuid).
      --
      -- `order by k` dentro del string_agg: sin el, el orden de las filas no esta
      -- garantizado y el digest cambiaria sin que cambiara nada.
      select md5(coalesce(string_agg(k, ',' order by k), ''))
      from (
        select 'm:' || id || ':' || updated_at as k from public.movements
        union all select 'c:' || id || ':' || updated_at from public.categories
        union all select 's:' || id || ':' || updated_at from public.subcategories
        union all select 'a:' || id || ':' || updated_at from public.accounts
        union all select 'l:' || id || ':' || updated_at from public.account_closings
      ) t
    )
  );
$$;

comment on function public.sync_fingerprint() is
  'Huella del estado del usuario (digest md5) + wipe_epoch. El cliente se salta el pull completo cuando el digest no ha cambiado.';


-- -----------------------------------------------------------------------------
-- Grants
--
-- Postgres concede EXECUTE a PUBLIC en toda funcion nueva; hay que revocarlo
-- antes de conceder, igual que en el esquema base.
--
-- current_wipe_epoch() se conserva con su grant intacto: sigue siendo la lectura
-- suelta del epoch y esta funcion la reutiliza en vez de duplicar el coalesce.
-- -----------------------------------------------------------------------------

revoke all on function public.sync_fingerprint() from public;
grant execute on function public.sync_fingerprint() to authenticated;


-- Recarga del cache de esquema de PostgREST (necesario en `db push` remoto;
-- `db reset` ya lo hace).
notify pgrst, 'reload schema';

-- =============================================================================
-- Cierra a `anon` la ejecucion de las funciones.
--
-- El esquema base ya previo esta trampa PARA LAS TABLAS y la comento alli: los
-- proyectos antiguos conservan un ALTER DEFAULT PRIVILEGES que concede permisos
-- solos a anon/authenticated, asi que el revoke tiene que nombrar los roles y no
-- basta con PUBLIC. Por eso las tablas hacen:
--
--   revoke all on table ... from public, anon, authenticated;
--
-- Pero las FUNCIONES se quedaron a medias: solo revocan `from public`. Revocar de
-- PUBLIC no elimina un grant explicito a un rol con nombre, asi que en un proyecto
-- antiguo `anon` conserva el EXECUTE.
--
-- Comprobado contra los dos entornos llamando a current_wipe_epoch() sin sesion:
--   * local (proyecto nuevo) -> 42501 "permission denied for FUNCTION current_wipe_epoch"
--   * produccion (antiguo)   -> 42501 "permission denied for TABLE sync_meta"
-- El segundo mensaje delata que anon SI paso el control de EXECUTE y fallo despues.
--
-- Hoy no es explotable: las tres funciones fallan cerradas por su cuenta. Las dos
-- SECURITY INVOKER chocan contra la RLS, y wipe_all_data() aborta con su guard de
-- `auth.uid() is null`. Pero eso deja la unica defensa de una funcion DEFINER y
-- destructiva en su propio cuerpo, cuando el SQL da a entender que tambien esta el
-- grant. Esto lo alinea con lo que el fichero ya dice.
-- =============================================================================

-- Idempotente y seguro de reaplicar. Se revoca de los tres y se vuelve a conceder
-- solo a `authenticated`, que es quien de verdad las llama desde el cliente.
revoke all on function public.iso_now()            from public, anon, authenticated;
revoke all on function public.current_wipe_epoch() from public, anon, authenticated;
revoke all on function public.wipe_all_data()      from public, anon, authenticated;
revoke all on function public.sync_fingerprint()   from public, anon, authenticated;

-- iso_now() NO se concede a nadie, igual que en el esquema base. No la llama el
-- cliente: solo los cuerpos de las funciones SECURITY DEFINER (que corren como
-- `postgres`) y el DEFAULT de sync_meta.updated_at. Ese DEFAULT se evalua con los
-- privilegios de quien inserta, y en sync_meta solo inserta wipe_all_data(), que es
-- definer — `authenticated` no tiene grant de INSERT en esa tabla, asi que nunca
-- llega a evaluarlo.
grant execute on function public.current_wipe_epoch() to authenticated;
grant execute on function public.wipe_all_data()      to authenticated;
grant execute on function public.sync_fingerprint()   to authenticated;

-- Recarga del cache de esquema de PostgREST (necesario en `db push` remoto;
-- `db reset` ya lo hace).
notify pgrst, 'reload schema';

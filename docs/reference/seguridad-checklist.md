---
tags: [type/reference, domain/auth, area/servidor]
up: "[[00-index]]"
---

# Checklist de seguridad

Qué está cerrado, **dónde** está cerrado y **cómo comprobarlo**. Esta nota no configura nada: es la
lista para auditar.

> Lo marcado **✅ verificado** se comprobó a mano contra Supabase local (`npx supabase db reset` sobre
> las tres migraciones) el 2026-08-15, con dos usuarios distintos y con la anon key suelta. Lo marcado
> **⬜ solo dashboard** no se puede comprobar desde el repo: `config.toml` gobierna **únicamente** el
> entorno local.

## 1. Lo que ya está bien — no lo "arregles"

| Qué | Dónde | Comprobación |
|---|---|---|
| RLS activa en las **7** tablas | `schema.sql:331-337`, `patrimonio.sql:131-132` | ✅ un segundo usuario ve `[]` en todas |
| Políticas separadas por operación, con `WITH CHECK` en INSERT/UPDATE | `schema.sql:352-383` | ✅ |
| `(select auth.uid())` y no `auth.uid()` | ídem | InitPlan: una vez por consulta, no por fila |
| `to authenticated` en todas | ídem | La política ni se evalúa para `anon` |
| Sin política DELETE en categorías, subcategorías, cuentas y cierres | `schema.sql:359-361` | Se archivan → [[005-categorias-se-archivan]] |
| `revoke all` + grants mínimos por tabla | `schema.sql:399-408` | ✅ `anon` recibe **401 / 42501** en `movements` |
| `movement_tombstones` sin grants **ni** políticas | `schema.sql:337`, `:408` | ✅ **401 / 42501** incluso con sesión válida |
| `set search_path = ''` en **todas** las funciones | las tres migraciones | ✅ `db lint` limpio |
| `SECURITY DEFINER` solo donde hace falta, y con filtro por `user_id` dentro | `schema.sql:255-277` | El `where t.user_id = new.user_id` es carga estructural |
| `wipe_all_data()` **sin parámetros** | `schema.sql:440-442` | Un `wipe_all_data(uuid)` sería un IDOR de manual |
| `sync_fingerprint()` es **invoker**, no definer | `20260815172816` | ✅ el digest de otro usuario es el del conjunto vacío → [[011-huella-de-sincronizacion]] |
| Registro cerrado | `config.toml:183` (`[auth]`) | ✅ `POST /auth/v1/signup` → **422 `signup_disabled`** |
| El cliente nunca manda `user_id` | `sync.ts:10-13` | Lo pone el `default auth.uid()` |
| Los `select` del pull no piden `user_id` | `sync.ts`, listas `*_COLS` | ✅ la respuesta ya no lo trae |

**La anon key del bundle es pública por diseño.** Está pensada para ir en el navegador; quien
autoriza es la RLS más los grants, no el secreto de esa clave. **No es una filtración y no hay nada
que rotar.** La que no puede salir del servidor nunca es la `service_role`, que **no está en el repo**
(`.env.local` no se versiona; `.env.example` sí, y no lleva valores).

## 2. `user_id` en las respuestas

Salía en cada fila porque el pull hacía `select('*')`. **No era una fuga de confidencialidad**: es el
uid del propio llamante, y ya viaja dentro del JWT que el navegador guarda en `localStorage`.
Devolvértelo a ti mismo sobre TLS no revela nada que no tuvieras.

Se ha quitado igualmente, con lista explícita de columnas — por bytes en cada pull y porque con `*`
una columna nueva en el servidor cambiaba el `lastPullKey` del cliente y forzaba un repintado espurio.

**Siguiente escalón, si algún día se quiere blindar en la base**: `grant select (id, name, …)` por
columna en vez de sobre la tabla entera, para que un `?select=user_id` a mano devuelva 403. Tiene un
filo: con grants por columna **cualquier `select('*')` pasa a fallar** con `permission denied`, así
que exige que el cliente no vuelva a usarlo nunca. No se ha hecho: el beneficio es marginal (ver el
párrafo de arriba) y el modo de fallo, ruidoso.

## 3. ⬜ Solo dashboard de producción

`config.toml` **no** gobierna producción. Estos hay que mirarlos en el proyecto real, y la lista
autoritativa la da el propio Supabase:

```bash
npx supabase db lint --level warning   # esquema (local o con --db-url)
```
más **Advisors → Security Advisor** en el dashboard, que es lo que cubre lo de auth.

- **Protección de contraseñas filtradas (HIBP)** — Authentication → Policies. Con
  `minimum_password_length = 6` y sin requisitos de composición (`password_requirements = ""`), es la
  defensa que más aporta y la más barata.
- **MFA / TOTP** — hoy desactivado (`[auth.mfa]`). Para una app de finanzas con un solo usuario es la
  mejora con mejor relación coste/beneficio de esta lista.
- **`jwt_expiry`** (local: 3600) y **timebox de sesión** (`[auth.sessions]`, sin configurar).
- **Captcha en el login** (`[auth.captcha]`, comentado). Los rate limits sí están:
  `sign_in_sign_ups = 30`/5 min.
- **`enable_signup = false`** también en producción → [[supabase-auth]].
- **Esquemas expuestos por la API**: `["public", "graphql_public"]`. `graphql_public` da un endpoint
  GraphQL sobre las mismas tablas; sigue pasando por RLS y por los grants, así que no abre nada, pero
  si no se usa es superficie que se puede cerrar.

## 4. Hallazgo cerrado — `anon` podía ejecutar las funciones en producción

**Encontrado el 2026-08-15 comparando local contra producción, y esta es la lección**: que el SQL diga
`revoke` no significa que el permiso esté revocado en el proyecto real.

El esquema base previó la trampa **para las tablas** —`revoke all on table ... from public, anon,
authenticated`, con su comentario sobre los proyectos antiguos y su `ALTER DEFAULT PRIVILEGES`— pero
**para las funciones solo revocó `from public`**. Revocar de `PUBLIC` no elimina un grant explícito a
un rol con nombre, así que en un proyecto antiguo `anon` conservaba el `EXECUTE`.

Cómo se ve, llamando a `current_wipe_epoch()` **sin sesión**:

| Entorno | Respuesta | Qué significa |
|---|---|---|
| Local (proyecto nuevo) | `permission denied for FUNCTION current_wipe_epoch` | `anon` ni entra |
| Producción (antiguo) | `permission denied for TABLE sync_meta` | `anon` **pasó** el EXECUTE y falló después |

**No era explotable**, y se comprobó: las dos funciones `security invoker` chocan contra la RLS, y
`wipe_all_data()` aborta con su guard de `auth.uid() is null`. Pero dejaba la única defensa de una
función `SECURITY DEFINER` y destructiva en su propio cuerpo, cuando el fichero da a entender que
también estaba el grant.

> **`wipe_all_data()` no se probó contra producción, ni debe probarse.** El razonamiento dice que sin
> JWT aborta antes de cualquier `delete`, pero el precio de equivocarse son datos reales. Para
> ejercerla, base local.

Corregido en `20260815182515_revoke_function_grants_anon.sql`, que nombra los tres roles y vuelve a
conceder solo a `authenticated`. `iso_now()` sigue sin concederse a nadie (403 desde la API): la usan
los cuerpos de las funciones definer y el `DEFAULT` de `sync_meta.updated_at`, y en esa tabla solo
inserta `wipe_all_data()`.

**Ojo al verificarlo**: un proyecto local nuevo **no reproduce la condición**, así que en local solo se
puede comprobar que no hay regresión. La comprobación de verdad es repetir la llamada de la tabla de
arriba contra producción después del `db push`.

✅ **Hecho el 2026-08-15 tras aplicar la migración**: producción responde ya `permission denied for
function` en `current_wipe_epoch`, `sync_fingerprint` e `iso_now`, igual que local. `wipe_all_data()`
**no se sondeó**, y no hace falta: los cuatro `revoke` van en la misma migración, que se aplica
atómicamente, y las otras tres cambiaron.

**Cómo repetir esta auditoría** (solo lectura, y la anon key es pública por diseño):

```bash
URL=$(grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2-)
AK=$(grep '^VITE_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2-)
curl -s -X POST "$URL/rest/v1/rpc/current_wipe_epoch" -H "apikey: $AK" \
  -H 'Content-Type: application/json' -d '{}'
# Se espera: permission denied for FUNCTION current_wipe_epoch
# Si dijera "for TABLE sync_meta", anon habría recuperado el EXECUTE.
```

## 5. Hallazgo abierto — `signOut` no revoca el refresh token

`src/supabase.ts:40` usa `signOut({ scope: 'local' })`. **Es una decisión, no un descuido**: `'global'`
llama al servidor, así que cerrar sesión dejaría de funcionar sin conexión, y con un solo usuario no
hay otras sesiones que revocar. El comentario del código lo dice.

**Riesgo residual**: en un dispositivo prestado o robado, "cerrar sesión" borra la sesión local pero
deja un refresh token **todavía canjeable** hasta que caduque.

Alternativa si compensa: intentar `scope: 'global'` y caer a `'local'` cuando falle por red. Cuesta
tres líneas. **No se ha cambiado**: es un cambio de comportamiento que merece su propia decisión.
Mientras tanto, la salida de emergencia es el dashboard (Users → ⋮ → *Sign out user*).

## 6. Bomba de relojería: `max_rows`

El pull es **completo y sin paginar**. PostgREST corta en `max_rows`: **100000** en local
(`config.toml:23`) y **10000 en producción**. Al superarlo, la respuesta se trunca **en silencio** —
sin error, sin aviso: la app perdería movimientos sin que nada lo diga.

No es un problema de seguridad y hoy no está cerca, pero es exactamente el umbral en el que toca el
pull incremental → [[011-huella-de-sincronizacion]]. Si el histórico se acerca a esa cifra, revisar
antes de que muerda.

Related: [[postgres-schema]] · [[supabase-auth]] · [[006-un-solo-usuario]] · [[sync-model]] · [[comandos-y-entorno]] · [[011-huella-de-sincronizacion]]

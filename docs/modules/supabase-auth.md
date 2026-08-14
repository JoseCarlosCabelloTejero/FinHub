---
tags: [type/module, domain/auth, area/cliente, area/servidor]
up: "[[00-index]]"
---

# Módulo: supabase + auth

El cliente de Supabase, la sesión y la pantalla de login. Incluye **la configuración manual del
dashboard**, que no queda reflejada en ningún fichero del repo: si esta nota se pierde, hay que
redescubrirla entrando al panel.

**Fuente de verdad**: `src/supabase.ts` · `src/Login.tsx` · `supabase/config.toml` · dashboard de Supabase

La app **exige login** para llegar a tus datos y **solo permite un usuario**, el propietario
→ [[006-un-solo-usuario]]. La única entrada sin cuenta es el **modo demo**, y su regla es que nada de
aquí se ejecuta: en demo no se llama a `resolveUserId()`, ni se suscribe a `onAuthChange`, ni se toca la
sesión → [[010-modo-demo]].

## El cliente

```ts
createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
```

- **Singleton de módulo**, como `dbPromise` en [[db]]: el cliente guarda la sesión y el temporizador de
  refresco, así que dos instancias competirían por la misma clave de `localStorage`.
- `detectSessionInUrl: false` porque no hay magic link ni OAuth: nadie vuelve nunca con un token en el
  hash, así que inspeccionar la URL en cada arranque sería trabajo inútil.
- Si faltan `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY`, **el módulo lanza un error al importarse**.
  Es a propósito: un cliente a medio construir da errores de red desconcertantes en la primera llamada
  en vez de aquí. Síntoma típico: **pantalla en blanco** → te falta `.env.local`. Ese throw alcanza
  también al modo demo, porque `sync.ts` importa este módulo estáticamente: la demo garantiza que **no se
  escribe** en Supabase, no que la app funcione sin proyecto configurado.

## Funciones

| Función | Qué hace |
|---|---|
| `signIn(email, password)` | Devuelve `null` si fue bien, o un `AuthFailure` |
| `signOut()` | Limpia `meta.userId` **y luego** cierra sesión con `scope: 'local'` |
| `resolveUserId()` | Estado de sesión inicial. `null` = hay que pedir login |
| `onAuthChange(cb)` | Suscripción a transiciones de sesión. Devuelve la baja |

Tres decisiones dentro:

- **`signOut` con `scope: 'local'`** — no llama al servidor, así que cerrar sesión funciona también sin
  conexión. Con un único usuario no hay otras sesiones que revocar. **El orden importa**: limpiar
  `meta.userId` *antes*, porque es la llave del modo offline de `resolveUserId`.
- **El fallback offline de `resolveUserId`** — sin conexión y con el access token caducado (dura 1 h),
  `getSession()` devuelve `session: null` aunque la sesión siga guardada. Sin el fallback a
  `meta.userId`, abrir la app offline una hora después del último refresco te dejaría fuera de tus
  propios datos locales.
- **`onAuthChange` ignora `INITIAL_SESSION`** — llega con `session: null` en ese mismo caso offline y,
  como se emite *después* de que `resolveUserId` haya resuelto, echaría al usuario al login. El estado
  inicial lo fija `resolveUserId`; la suscripción solo atiende transiciones. Y **nada de
  `await supabase.auth.*` dentro del callback** (deadlock documentado en supabase-js); IndexedDB sí.

`isNetworkAuthError` comprueba `error.name === 'AuthRetryableFetchError'` a mano porque supabase-js
**no reexporta** `isAuthRetryableFetchError`: solo vive en `@supabase/auth-js`, que es una dependencia
transitiva (declararla como directa obligaría a mantener dos versiones en lock-step).

## Copy de error en `Login.tsx`

| `AuthFailure` | Mensaje |
|---|---|
| `credentials` | "Correo o contraseña incorrectos." |
| `offline` | "Sin conexión. Inténtalo cuando vuelvas a tener red." |
| `rate-limit` | "Demasiados intentos. Espera unos minutos." |
| `unknown` | "No se ha podido iniciar sesión. Inténtalo de nuevo." |

**No distingue si el correo existe** a propósito: decir "ese correo no existe" confirmaría a un
desconocido qué cuentas hay. Los otros casos sí se distinguen porque cambian lo que el usuario tiene
que hacer. El código real de un `unknown` se registra en consola; el sospechoso habitual es
`email_not_confirmed`.

En el camino feliz **no hay callback ni `setSending(false)`**: `signIn` guarda la sesión, dispara
`SIGNED_IN` y el gate de [[ui-app]] cambia de pantalla desmontando el formulario.

Debajo del botón de entrar hay un **"Probar la demo"** (`.secondary`) con su nota de qué implica. Va con
`type="button"` obligatorio: sin él enviaría el formulario de login antes de entrar en la demo, y el
usuario vería el error de campos vacíos. Cambia de pantalla recargando, no por `SIGNED_IN`.
→ [[010-modo-demo]]

## ⚙️ Configuración manual del dashboard (no versionable)

Lo que se puede versionar vive en el repo (`supabase/config.toml`, `supabase/migrations/`). Esto **hay
que hacerlo a mano** en el proyecto remoto:

1. **Authentication → Sign In / Providers → Email**
   - *"Allow new users to sign up"* → **OFF**. Es la primera de las tres capas que cierran el acceso
     (las otras dos: el cliente no expone `signUp`, y la RLS filtra por `user_id = auth.uid()`).
   - *"Confirm email"* → **OFF** (estado actual). Ojo con el nombre del flag en la API: desactivar ese
     toggle deja `mailer_autoconfirm: true`, o sea **auto-confirmar**, no *pedir confirmación*. Sin
     registros públicos no hay correos que confirmar, así que no abre nada.
2. **Authentication → Users → Add user → Create new user** — correo y contraseña del propietario. Con
   "Confirm email" en OFF el usuario nace confirmado y el checkbox "Auto Confirm User" da igual. Si
   algún día se vuelve a exigir confirmación **hay que marcarlo**: si no, el login falla con
   `email_not_confirmed`, que en la app se ve como el mensaje genérico.
3. **Cambiar o recuperar la contraseña** — desde el mismo panel (Users → ⋮ → Reset password). La app
   **no tiene** flujo de "olvidé mi contraseña" a propósito: implicaría correos de reset y redirect
   URLs para una app de una sola persona.
4. **Authentication → URL Configuration → Site URL** — ya configurada con el dominio de producción. Con login por contraseña **no hacen falta
   redirects de correo**, que es una de las ventajas frente al magic link. → [[deploy-vercel]]

### Entorno local (`supabase start`)

`supabase/config.toml` ya lleva `enable_signup = false` tanto en `[auth]` (línea ~181) como en
`[auth.email]` (línea ~227) — **los dos tienen que estar en `false`** para cerrar la puerta—, así que el
local se comporta igual que producción. El usuario de pruebas se crea desde Studio
(http://localhost:54323 → Authentication → Add user): la **API de admin no pasa por ese flag**.

## Comportamiento offline (limitación asumida)

- **Con sesión previa en ese navegador**: la app funciona sin conexión (ver el fallback de arriba). Al
  volver la red, supabase-js refresca con el refresh token y todo sigue. Si el refresh token estuviera
  revocado, salta `SIGNED_OUT` y entonces sí se pide login.
- **Sin haber entrado nunca en ese navegador**: la app **no** se puede usar sin conexión. Es inherente
  al login obligatorio y se acepta como parte de la migración.

Related: [[login]] · [[postgres-schema]] · [[006-un-solo-usuario]] · [[comandos-y-entorno]] · [[010-modo-demo]]

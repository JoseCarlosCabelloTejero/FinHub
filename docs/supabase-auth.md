# Auth de Supabase: configuración manual

La app exige login y **solo permite un usuario**, el propietario. Lo que se puede versionar vive en el
repo (`supabase/config.toml`, `supabase/migrations/`); lo que sigue **hay que hacerlo a mano en el
dashboard** y no queda reflejado en ningún fichero, de ahí esta nota.

## Proyecto remoto (dashboard)

1. **Authentication → Sign In / Providers → Email**
   - "Allow new users to sign up" → **OFF**. Es la primera de las tres capas que cierran el acceso
     (las otras dos: el cliente no expone `signUp`, y la RLS filtra por `user_id = auth.uid()`).
   - "Confirm email" puede quedarse como esté: sin registros públicos no hay correos que confirmar.
2. **Authentication → Users → Add user → Create new user**
   - Correo y contraseña del propietario.
   - **Marcar "Auto Confirm User"**. Sin esto el usuario nace sin confirmar y el login falla con
     `email_not_confirmed`, que en la app se ve como el mensaje genérico "No se ha podido iniciar
     sesión" (el código real se registra en la consola).
3. **Cambiar la contraseña / recuperarla**: desde este mismo panel (Users → ⋮ → Reset password). La
   app **no tiene** flujo de "olvidé mi contraseña" a propósito: implicaría correos de reset y
   redirect URLs para una app de una sola persona.

La `Site URL` y las redirect URLs se configuran en la fase 7 (deploy). Con login por contraseña no
hacen falta redirects de correo, que es una de las ventajas frente al magic link.

## Entorno local (`supabase start`)

`supabase/config.toml` ya lleva `enable_signup = false` en `[auth]` y en `[auth.email]`, así que el
local se comporta igual que producción. El usuario de pruebas se crea desde Studio
(`http://localhost:54323` → Authentication → Add user): la API de admin **no** pasa por ese flag.

## Variables de entorno

`.env.local` (no versionado, ver `.env.example`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

`src/supabase.ts` lanza un error en el arranque si falta alguna, en vez de dejar un cliente a medio
construir que falle más tarde con errores de red confusos.

## Comportamiento offline (limitación asumida)

- **Con sesión previa en ese navegador**: la app funciona sin conexión. Si el access token ya caducó
  (dura 1 h) `getSession()` devuelve `null` aunque la sesión siga guardada, así que
  `resolveUserId()` cae al `userId` recordado en el store `meta` de IndexedDB. Al volver la red,
  supabase-js refresca con el refresh token y todo sigue. Si el refresh token estuviera revocado,
  salta `SIGNED_OUT` y entonces sí se pide login.
- **Sin haber entrado nunca en ese navegador**: la app no se puede usar sin conexión. Es inherente al
  login obligatorio y se acepta como parte de la decisión de la migración.

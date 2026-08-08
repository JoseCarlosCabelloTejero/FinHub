import { createClient } from '@supabase/supabase-js';
import { getSyncMeta, saveSyncMeta } from './db';

const url = import.meta.env.VITE_SUPABASE_URL, anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Fallo ruidoso y en el arranque: sin estas dos variables no hay app, y un cliente a medio construir
// da errores de red desconcertantes en la primera llamada en vez de aquí.
if (!url || !anonKey) throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copia .env.example a .env.local y rellénalas.');

// Singleton a nivel de módulo, como dbPromise en db.ts: el cliente guarda la sesión y el temporizador
// de refresco, así que dos instancias competirían por la misma clave de localStorage.
export const supabase = createClient(url, anonKey, {
  // detectSessionInUrl: false porque no hay magic link ni OAuth. Nadie vuelve nunca con un token en
  // el hash, así que que el cliente inspeccione la URL en cada arranque sería trabajo inútil.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export type AuthFailure = 'credentials' | 'offline' | 'rate-limit' | 'unknown';

// supabase-js NO reexporta isAuthRetryableFetchError; solo vive en @supabase/auth-js, que es una
// dependencia transitiva (declararla como directa obligaría a mantener dos versiones en lock-step).
// La implementación de la librería es exactamente esta comprobación del name.
const isNetworkAuthError = (error: unknown) => (error as { name?: string } | null)?.name === 'AuthRetryableFetchError';

/** Devuelve null si el login fue bien, o el motivo del fallo. El copy en español vive en Login.tsx. */
export async function signIn(email: string, password: string): Promise<AuthFailure | null> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) { await saveSyncMeta({ userId: data.user.id }); return null }
  if (isNetworkAuthError(error)) return 'offline';
  if (error.code === 'over_request_rate_limit' || error.status === 429) return 'rate-limit';
  if (error.code === 'invalid_credentials' || error.code === 'user_not_found') return 'credentials';
  // Todo lo demás se muestra genérico (no filtra si el correo existe) pero se registra: el caso
  // típico es email_not_confirmed por crear el usuario en el dashboard sin "Auto Confirm User".
  console.error('Error de autenticación no contemplado:', error.code, error.message);
  return 'unknown';
}

// scope 'local' y no el 'global' por defecto: no llama al servidor, así que cerrar sesión funciona
// también sin conexión. Con un único usuario no hay otras sesiones que revocar.
// El orden importa: limpiar meta.userId ANTES, porque es la llave del modo offline de resolveUserId.
export async function signOut() { await saveSyncMeta({ userId: null }); await supabase.auth.signOut({ scope: 'local' }); }

/** Estado de sesión inicial. `null` = hay que pedir login. */
export async function resolveUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (data.session) { await saveSyncMeta({ userId: data.session.user.id }); return data.session.user.id }
  // Sin conexión y con el access token caducado (dura 1 h), getSession devuelve session:null aunque
  // la sesión siga guardada: el refresh falla y auth-js solo te la devuelve si el token aún vale.
  // Sin este fallback, abrir la app offline una hora después del último refresco te dejaría fuera de
  // tus propios datos locales. El refresh token se recupera solo cuando vuelve la red; si estuviera
  // muerto de verdad, saltará SIGNED_OUT y ahí sí se pide login.
  if (isNetworkAuthError(error)) return (await getSyncMeta()).userId;
  return null;
}

/** Suscripción a cambios de sesión. Devuelve la función de baja. */
export function onAuthChange(cb: (userId: string | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // INITIAL_SESSION se ignora a propósito: llega con session:null en el caso offline de arriba y,
    // como se emite DESPUÉS de que resolveUserId haya resuelto, echaría al usuario al login. El
    // estado inicial lo fija resolveUserId; esto solo atiende transiciones.
    if (event === 'INITIAL_SESSION') return;
    // Nada de await supabase.auth.* aquí dentro (deadlock documentado en supabase-js); IndexedDB sí.
    if (event === 'SIGNED_OUT') saveSyncMeta({ userId: null });
    cb(session?.user.id ?? null);
  });
  return () => data.subscription.unsubscribe();
}

import { Check, CloudOff, LogOut, RefreshCw, TriangleAlert, UploadCloud } from 'lucide-react';
import { changes, needsAttention, syncCopy } from './syncCopy';
import type { SyncState } from './types';

// Ni ./sync ni ./supabase: el estado entra por props. Así se testea sin montar el motor ni el cliente
// de Supabase (que revienta al importarse sin .env.local), y renderizar el indicador dos veces —chip
// en la cabecera, nota en el aside— no duplica suscripciones ni avisos.

// Componente y no una función que devuelva el icono: asignar un componente a una variable durante el
// render lo recrea en cada cambio de estado (y remonta el svg). Sin animación en 'syncing': dura
// décimas de segundo y girarlo obligaría a gestionar prefers-reduced-motion a cambio de nada.
function SyncIcon({ state }: { state: SyncState }) {
  if (state.status === 'offline') return <CloudOff aria-hidden="true"/>;
  if (state.status === 'error' || state.status === 'auth-required') return <TriangleAlert aria-hidden="true"/>;
  if (state.status === 'syncing') return <RefreshCw aria-hidden="true"/>;
  return state.pendingOps ? <UploadCloud aria-hidden="true"/> : <Check aria-hidden="true"/>;
}

/** Versión compacta para la cabecera. Es la única visible en móvil, donde el aside no existe. */
export function SyncChip({ state }: { state: SyncState }) {
  const { label, detail } = syncCopy(state);
  // El detalle va en `title` y no en pantalla: en la cabecera solo cabe la etiqueta. No es un problema
  // de accesibilidad porque el texto visible ya nombra el elemento; el title solo amplía.
  return <span className={`sync-chip ${needsAttention(state) ? 'warn' : ''}`} title={detail || label}><SyncIcon state={state}/>{label}</span>;
}

/** Bloque del aside: estado, detalle, último error irrecuperable y salida de sesión. */
export function SyncNote({ state, onSignOut }: { state: SyncState; onSignOut: () => void }) {
  const { label, detail } = syncCopy(state);
  // Cerrar sesión no vacía el outbox: al volver a entrar con la misma cuenta se sube igual. Lo que sí
  // lo tira es entrar con otra cuenta (adoptUser en sync.ts), y eso el usuario no puede deducirlo.
  const leave = () => { if (state.pendingOps && !confirm(`Tienes ${changes(state.pendingOps)} sin sincronizar. ¿Cerrar sesión igualmente?`)) return; onSignOut() };
  return <div className="aside-note">
    <span>Sincronización</span>
    <p className={`sync-line ${needsAttention(state) ? 'warn' : ''}`}><SyncIcon state={state}/>{label}</p>
    {detail && <p>{detail}</p>}
    {/* Sin role="alert": la región aria-live de App.tsx ya anuncia este mismo error cuando aparece, y
        dos regiones vivas compitiendo se pisan los anuncios. Aquí solo queda como registro visible. */}
    {state.lastError && <p className="sync-error">{state.lastError}</p>}
    <button className="sign-out" onClick={leave}><LogOut/>Cerrar sesión</button>
  </div>;
}

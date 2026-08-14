import { Check, CloudOff, FlaskConical, LogOut, RefreshCw, TriangleAlert, UploadCloud } from 'lucide-react';
import { changes, needsAttention, syncCopy } from './syncCopy';
import type { SyncState } from './types';

// Ni ./sync ni ./supabase: el estado entra por props. Así se testea sin montar el motor ni el cliente
// de Supabase (que revienta al importarse sin .env.local), y renderizar el indicador dos veces —chip
// en la cabecera, nota en el aside— no duplica suscripciones ni avisos.

// Componente y no una función que devuelva el icono: asignar un componente a una variable durante el
// render lo recrea en cada cambio de estado (y remonta el svg). Sin animación en 'syncing': dura
// décimas de segundo y girarlo obligaría a gestionar prefers-reduced-motion a cambio de nada.
function SyncIcon({ state }: { state: SyncState }) {
  if (state.status === 'demo') return <FlaskConical aria-hidden="true"/>;
  if (state.status === 'offline') return <CloudOff aria-hidden="true"/>;
  if (state.status === 'error' || state.status === 'auth-required') return <TriangleAlert aria-hidden="true"/>;
  if (state.status === 'syncing') return <RefreshCw aria-hidden="true"/>;
  return state.pendingOps ? <UploadCloud aria-hidden="true"/> : <Check aria-hidden="true"/>;
}

/** Versión compacta para la cabecera. Es la única visible en móvil, donde el aside no existe. */
// Con `onOpen` deja de ser un adorno y pasa a ser el disclosure de la nota. Es lo que resuelve el
// agujero de móvil: por debajo de 760px el aside no existe, así que sin esto no había forma de cerrar
// sesión ni de salir de la demo, y el detalle del estado —que solo vive en el `title`— era inalcanzable
// en una pantalla táctil. El nombre accesible del botón es el propio estado ("Modo demo", "Sin
// conexión"…), que es exactamente lo que se pulsa para saber más.
export function SyncChip({ state, onOpen }: { state: SyncState; onOpen?: () => void }) {
  const { label, detail } = syncCopy(state);
  const className = `sync-chip ${needsAttention(state) ? 'warn' : ''}`;
  // El detalle va en `title` y no en pantalla: en la cabecera solo cabe la etiqueta. No es un problema
  // de accesibilidad porque el texto visible ya nombra el elemento; el title solo amplía.
  const inside = <><SyncIcon state={state}/>{label}</>;
  // `aria-haspopup="dialog"` y no `aria-expanded`: lo que abre es un diálogo modal, no una sección que
  // se despliega ahí mismo, así que el chip no tiene que llevar la cuenta de si está abierto.
  if (onOpen) return <button type="button" className={className} title={detail || label} aria-haspopup="dialog" onClick={onOpen}>{inside}</button>;
  return <span className={className} title={detail || label}>{inside}</span>;
}

/** Bloque del aside: estado, detalle, último error irrecuperable y salida de sesión. */
export function SyncNote({ state, onSignOut }: { state: SyncState; onSignOut: () => void }) {
  const { label, detail } = syncCopy(state);
  // El modo demo se deduce del propio estado y no de un prop ni de ./demo: así este componente sigue
  // dependiendo solo de lo que recibe, que es lo que permite testearlo sin montar el motor.
  const demo = state.status === 'demo';
  // Cerrar sesión no vacía el outbox: al volver a entrar con la misma cuenta se sube igual. Lo que sí
  // lo tira es entrar con otra cuenta (adoptUser en sync.ts), y eso el usuario no puede deducirlo.
  // En demo el aviso es el contrario: no hay nada pendiente (nunca se encola), pero salir sí borra.
  const leave = () => {
    if (demo) { if (confirm('Al salir se borrarán los datos de la demo. ¿Continuar?')) onSignOut(); return }
    if (state.pendingOps && !confirm(`Tienes ${changes(state.pendingOps)} sin sincronizar. ¿Cerrar sesión igualmente?`)) return;
    onSignOut();
  };
  return <div className="aside-note">
    <span>{demo ? 'Demo' : 'Sincronización'}</span>
    <p className={`sync-line ${needsAttention(state) ? 'warn' : ''}`}><SyncIcon state={state}/>{label}</p>
    {detail && <p>{detail}</p>}
    {/* Sin role="alert": la región aria-live de App.tsx ya anuncia este mismo error cuando aparece, y
        dos regiones vivas compitiendo se pisan los anuncios. Aquí solo queda como registro visible. */}
    {state.lastError && <p className="sync-error">{state.lastError}</p>}
    <button className="sign-out" onClick={leave}><LogOut/>{demo ? 'Salir de la demo' : 'Cerrar sesión'}</button>
  </div>;
}

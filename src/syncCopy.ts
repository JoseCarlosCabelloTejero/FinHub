import { formatDistanceToNow, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { SyncState } from './types';

// Módulo aparte y sin React, como calculations.ts: lo usan tanto los componentes del indicador
// (SyncStatus.tsx) como el aviso por aria-live de App.tsx, y así se testea sin renderizar nada.

export const changes = (n: number) => `${n} cambio${n === 1 ? '' : 's'}`;
const pending = (n: number) => `${changes(n)} pendiente${n === 1 ? '' : 's'}`;

/** Los estados que reclaman algo del usuario, para marcarlos con un tono más oscuro. */
// Un tono, no un color propio: verde y rojo están reservados a ingreso/gasto en toda la app.
export const needsAttention = ({ status }: SyncState) => status === 'offline' || status === 'error' || status === 'auth-required';

/** Lo que se le cuenta al usuario en cada estado del sync. */
// De más urgente a menos: no tener red ni sesión manda sobre "hay cola", porque cambia lo que el
// usuario puede hacer al respecto. El texto siempre lleva el significado completo; el icono y el tono
// son redundancia, nunca la única señal.
export function syncCopy({ status, pendingOps, lastSyncAt }: SyncState): { label: string; detail: string } {
  // Primero de todo: en demo ninguno de los demás estados puede darse, y además es lo único que el
  // visitante necesita saber de este bloque. El detalle dice dónde acaban los datos, no que "no se
  // sincroniza": lo que la persona se pregunta es si lo que escribe se guarda en algún sitio suyo.
  if (status === 'demo') return { label: 'Modo demo', detail: 'Los datos solo se guardan en este navegador. No se sube nada a la nube.' };
  if (status === 'offline') return { label: 'Sin conexión', detail: pendingOps ? `${pending(pendingOps)}. Se subirán al volver la red.` : 'Se sincronizará al volver la red.' };
  if (status === 'auth-required') return { label: 'Sesión caducada', detail: 'Vuelve a iniciar sesión para sincronizar.' };
  if (status === 'error') return { label: 'Sin sincronizar', detail: pendingOps ? `${pending(pendingOps)}. Se reintentará solo.` : 'Se reintentará solo.' };
  if (status === 'syncing') return { label: 'Sincronizando…', detail: pendingOps ? `${pending(pendingOps)}.` : '' };
  if (pendingOps) return { label: pending(pendingOps), detail: 'Se subirán en unos segundos.' };
  return { label: 'Sincronizado', detail: lastSyncAt ? `Última sincronización ${formatDistanceToNow(parseISO(lastSyncAt), { addSuffix: true, locale: es })}.` : 'Todo al día.' };
}

import { describe, expect, it } from 'vitest';
import { needsAttention, syncCopy } from './syncCopy';
import type { SyncState } from './types';

const state = (patch: Partial<SyncState> = {}): SyncState => ({ status: 'idle', pendingOps: 0, lastSyncAt: null, lastError: null, ...patch });

describe('texto del estado de sync', () => {
  it('no tener conexión manda sobre la cola pendiente', () => {
    expect(syncCopy(state({ status: 'offline', pendingOps: 3 }))).toEqual({ label: 'Sin conexión', detail: '3 cambios pendientes. Se subirán al volver la red.' });
    expect(syncCopy(state({ status: 'offline' })).detail).toBe('Se sincronizará al volver la red.');
  });

  it('la sesión caducada pide una acción concreta', () => {
    expect(syncCopy(state({ status: 'auth-required', pendingOps: 2 }))).toEqual({ label: 'Sesión caducada', detail: 'Vuelve a iniciar sesión para sincronizar.' });
  });

  it('el error deja claro que se reintenta solo', () => {
    expect(syncCopy(state({ status: 'error', pendingOps: 1 }))).toEqual({ label: 'Sin sincronizar', detail: '1 cambio pendiente. Se reintentará solo.' });
  });

  it('mientras sincroniza sin cola no hay detalle que contar', () => {
    expect(syncCopy(state({ status: 'syncing' }))).toEqual({ label: 'Sincronizando…', detail: '' });
  });

  it('cuenta los cambios pendientes en singular y en plural', () => {
    expect(syncCopy(state({ pendingOps: 1 })).label).toBe('1 cambio pendiente');
    expect(syncCopy(state({ pendingOps: 4 })).label).toBe('4 cambios pendientes');
  });

  it('el modo demo dice dónde acaban los datos y no pide atención', () => {
    expect(syncCopy(state({ status: 'demo' }))).toEqual({ label: 'Modo demo', detail: 'Los datos solo se guardan en este navegador. No se sube nada a la nube.' });
    // No es una avería: el tono de aviso está reservado a lo que la persona tiene que arreglar.
    expect(needsAttention(state({ status: 'demo' }))).toBe(false);
  });

  it('al día, con y sin sincronización previa', () => {
    expect(syncCopy(state()).detail).toBe('Todo al día.');
    const hace2min = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(syncCopy(state({ lastSyncAt: hace2min }))).toEqual({ label: 'Sincronizado', detail: 'Última sincronización hace 2 minutos.' });
  });
});

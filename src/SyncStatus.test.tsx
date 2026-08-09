import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncChip, SyncNote } from './SyncStatus';
import type { SyncState } from './types';

const state = (patch: Partial<SyncState> = {}): SyncState => ({ status: 'idle', pendingOps: 0, lastSyncAt: null, lastError: null, ...patch });

afterEach(() => vi.restoreAllMocks());

describe('indicador de sync', () => {
  it('el chip muestra la etiqueta, no solo el icono', () => {
    render(<SyncChip state={state({ status: 'offline' })}/>);
    expect(screen.getByText('Sin conexión')).toBeInTheDocument();
  });

  it('la nota deja a la vista el cambio que se descartó', () => {
    render(<SyncNote state={state({ lastError: 'Un cambio no se pudo sincronizar (23503) y se ha descartado.' })} onSignOut={vi.fn()}/>);
    expect(screen.getByText(/no se pudo sincronizar/)).toBeInTheDocument();
    // La única región aria-live es la de App.tsx: la nota no puede reclamar otra.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('avisa antes de cerrar sesión con cambios sin subir', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onSignOut = vi.fn();
    render(<SyncNote state={state({ pendingOps: 2 })} onSignOut={onSignOut}/>);
    await userEvent.setup().click(screen.getByRole('button', { name: /cerrar sesión/i }));
    expect(confirmar).toHaveBeenCalledWith('Tienes 2 cambios sin sincronizar. ¿Cerrar sesión igualmente?');
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('con la cola vacía cierra sesión sin preguntar', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSignOut = vi.fn();
    render(<SyncNote state={state()} onSignOut={onSignOut}/>);
    await userEvent.setup().click(screen.getByRole('button', { name: /cerrar sesión/i }));
    expect(confirmar).not.toHaveBeenCalled();
    expect(onSignOut).toHaveBeenCalled();
  });
});

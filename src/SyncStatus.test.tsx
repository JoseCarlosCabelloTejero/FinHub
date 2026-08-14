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

  // Sin `onOpen` sigue siendo un adorno: es como lo usa cualquier sitio que solo quiera mostrar estado,
  // y convertirlo en botón sin necesidad metería un tabstop que no lleva a ninguna parte.
  it('el chip solo es pulsable si se le da algo que abrir', async () => {
    const { rerender } = render(<SyncChip state={state()}/>);
    expect(screen.queryByRole('button')).toBeNull();
    const onOpen = vi.fn();
    rerender(<SyncChip state={state()} onOpen={onOpen}/>);
    // El nombre accesible es el propio estado: se pulsa "Sincronizado" para saber más.
    await userEvent.setup().click(screen.getByRole('button', { name: /sincronizado/i }));
    expect(onOpen).toHaveBeenCalled();
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

  it('en demo la salida se llama por su nombre y avisa de que borra', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSignOut = vi.fn();
    render(<SyncNote state={state({ status: 'demo' })} onSignOut={onSignOut}/>);
    // Sin cola pendiente, el confirm de arriba no saltaría; aquí hace falta porque salir sí borra.
    await userEvent.setup().click(screen.getByRole('button', { name: /salir de la demo/i }));
    expect(confirmar).toHaveBeenCalledWith('Al salir se borrarán los datos de la demo. ¿Continuar?');
    expect(onSignOut).toHaveBeenCalled();
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

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

  // La nota ya no decide si hay que preguntar ni con qué texto: eso vive en App.tsx, que es donde
  // está el diálogo. Aquí solo se comprueba que el botón avisa hacia arriba y cómo se llama.
  it('en demo la salida se llama por su nombre', async () => {
    const onSignOut = vi.fn();
    render(<SyncNote state={state({ status: 'demo' })} onSignOut={onSignOut}/>);
    await userEvent.setup().click(screen.getByRole('button', { name: /salir de la demo/i }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('fuera de la demo el botón cierra sesión y no pregunta por su cuenta', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    const onSignOut = vi.fn();
    render(<SyncNote state={state({ pendingOps: 2 })} onSignOut={onSignOut}/>);
    await userEvent.setup().click(screen.getByRole('button', { name: /cerrar sesión/i }));
    expect(confirmar).not.toHaveBeenCalled();
    expect(onSignOut).toHaveBeenCalled();
  });
});

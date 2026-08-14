import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './Ui';

const props = { title: 'Borrar todo', body: 'Esto no se puede deshacer.', confirmLabel: 'Borrar' };

describe('ConfirmDialog', () => {
  it('se anuncia como diálogo modal y se nombra con su título', () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()}/>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Borrar todo');
    expect(screen.getByText('Esto no se puede deshacer.')).toBeInTheDocument();
  });

  it('confirma solo cuando se pulsa el botón de la acción', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={vi.fn()}/>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Borrar' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  // Las tres salidas del patrón de modales del repo: Cancelar, Escape y clic en el backdrop.
  it('cancela con el botón, con Escape y con clic fuera', async () => {
    const onCancel = vi.fn(); const onConfirm = vi.fn();
    const { container } = render(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={onCancel}/>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.keyboard('{Escape}');
    await user.click(container.querySelector('.modal-backdrop')!);
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // El foco va al diálogo y no al botón de confirmar: dejar la acción destructiva bajo el Intro
  // convierte un teclazo en un borrado.
  it('enfoca el diálogo, no la acción destructiva', () => {
    render(<ConfirmDialog {...props} tone="danger" onConfirm={vi.fn()} onCancel={vi.fn()}/>);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('congela el scroll del fondo mientras está abierto y lo devuelve al cerrarse', () => {
    const { unmount } = render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()}/>);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

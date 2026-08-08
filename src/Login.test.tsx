import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';
import { signIn } from './supabase';

// El mock evita cargar el módulo real, que crea el cliente de Supabase al importarse y exigiría
// VITE_SUPABASE_URL/ANON_KEY: los tests tienen que pasar sin .env.local.
vi.mock('./supabase', () => ({ signIn: vi.fn() }));
const mocked = vi.mocked(signIn);

const rellenar = async () => { const user = userEvent.setup(); await user.type(screen.getByLabelText(/correo/i), 'yo@correo.com'); await user.type(screen.getByLabelText(/contraseña/i), 'secreta'); return user };

describe('pantalla de login', () => {
  beforeEach(() => { mocked.mockReset(); render(<Login/>) });

  it('no llama al servidor si falta algún campo', async () => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/correo/i), 'yo@correo.com');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(mocked).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe tu correo y tu contraseña.');
  });

  it('muestra un error genérico con credenciales incorrectas', async () => {
    mocked.mockResolvedValue('credentials');
    const user = await rellenar();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(mocked).toHaveBeenCalledWith('yo@correo.com', 'secreta');
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
  });

  it('distingue el fallo de red del de credenciales', async () => {
    mocked.mockResolvedValue('offline');
    const user = await rellenar();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión. Inténtalo cuando vuelvas a tener red.');
  });

  it('deshabilita el botón mientras se envía', async () => {
    let resolver: (value: null) => void = () => {};
    mocked.mockReturnValue(new Promise((resolve) => { resolver = resolve }));
    const user = await rellenar();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('button', { name: 'Entrando…' })).toBeDisabled();
    resolver(null);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';
import { enterDemo } from './demo';
import { signIn } from './supabase';

// El mock evita cargar el módulo real, que crea el cliente de Supabase al importarse y exigiría
// VITE_SUPABASE_URL/ANON_KEY: los tests tienen que pasar sin .env.local.
vi.mock('./supabase', () => ({ signIn: vi.fn() }));
const mocked = vi.mocked(signIn);
// enterDemo recarga la página, que jsdom no implementa. Lo que se comprueba aquí es que el botón la
// llama y que NO envía el formulario de login por el camino.
vi.mock('./demo', () => ({ enterDemo: vi.fn() }));
const demo = vi.mocked(enterDemo);

const rellenar = async () => { const user = userEvent.setup(); await user.type(screen.getByLabelText(/correo/i), 'yo@correo.com'); await user.type(screen.getByLabelText(/contraseña/i), 'secreta'); return user };

describe('pantalla de login', () => {
  beforeEach(() => { mocked.mockReset(); demo.mockReset(); render(<Login/>) });

  it('entra en la demo sin enviar el formulario de login', async () => {
    await userEvent.setup().click(screen.getByRole('button', { name: 'Probar la demo' }));
    expect(demo).toHaveBeenCalled();
    expect(mocked).not.toHaveBeenCalled();
    // Si el botón no fuera type="button" habría enviado el formulario y saldría el error de campos vacíos.
    expect(screen.queryByRole('alert')).toBeNull();
  });

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

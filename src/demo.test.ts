import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDemoFlag, consumeDemoReset, isDemo, markDemoEntry } from './demo';

// Solo las piezas puras. `enterDemo` y `leaveDemo` recargan la página y no hay nada que comprobar en
// ellas más allá de las funciones que ya se prueban aquí.
describe('marca del modo demo', () => {
  afterEach(() => { localStorage.clear(); history.replaceState({}, '', '/') });

  it('por defecto no está activa', () => expect(isDemo()).toBe(false));

  it('entrar la activa y salir la limpia', () => {
    markDemoEntry();
    expect(isDemo()).toBe(true);
    clearDemoFlag();
    expect(isDemo()).toBe(false);
  });

  it('el reseteo se consume una sola vez, para que StrictMode no siembre dos veces', () => {
    markDemoEntry();
    expect(consumeDemoReset()).toBe(true);
    expect(consumeDemoReset()).toBe(false);
    // Consumirlo no saca de la demo: recargar dentro de ella conserva lo que hayas probado.
    expect(isDemo()).toBe(true);
  });

  it('un enlace con ?demo=1 entra directo y se quita el parámetro de la URL', async () => {
    history.replaceState({}, '', '/?demo=1');
    // La rama de la URL es un efecto de módulo, así que hay que reevaluar el módulo para dispararla.
    vi.resetModules();
    const demo = await import('./demo');
    expect(demo.isDemo()).toBe(true);
    expect(demo.consumeDemoReset()).toBe(true);
    // Si el parámetro se quedara pegado, cada recarga volvería a marcar el reseteo y borraría la demo.
    expect(location.search).toBe('');
  });
});

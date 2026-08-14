// Modo demo: la app entera funcionando sin cuenta y sin tocar el servidor. Vive en su propia base de
// IndexedDB ('finhub-demo'), así que los datos de prueba no pueden mezclarse con los de quien ya haya
// usado la app en ese navegador ni acabar subidos en el próximo login (ver docs/decisions/010-modo-demo).
//
// Este módulo NO importa nada a propósito. db.ts lo importa para elegir el nombre de la base, y como
// dbPromise se abre en el import de db.ts, la marca tiene que poder leerse de forma síncrona y antes
// que cualquier otra cosa. Por eso vive en localStorage (que solo usaba el cliente de Supabase) y por
// eso entrar y salir de la demo recarga la página en vez de cambiar de base en caliente.

const FLAG = 'finhub-demo';
// Marca de "esta entrada empieza de cero". Aparte del flag porque duran cosas distintas: el flag vive
// mientras estés en la demo, esto se consume en el primer arranque. Así recargar no borra tus pruebas
// pero volver a entrar siempre da un sandbox limpio.
const RESET = 'finhub-demo-reset';

export const DEMO_DB_NAME = 'finhub-demo';

export const isDemo = () => localStorage.getItem(FLAG) === '1';

export function markDemoEntry() { localStorage.setItem(FLAG, '1'); localStorage.setItem(RESET, '1'); }
/** true una sola vez por entrada. Síncrono para que el doble montaje de StrictMode no siembre dos veces. */
export function consumeDemoReset() { const pending = localStorage.getItem(RESET) === '1'; localStorage.removeItem(RESET); return pending; }
export function clearDemoFlag() { localStorage.removeItem(FLAG); localStorage.removeItem(RESET); }

/** Entra en la demo. Recarga porque la base de IndexedDB ya está abierta con el nombre de siempre. */
export function enterDemo() { markDemoEntry(); location.reload(); }

// Un enlace con ?demo=1 entra directo, sin pasar por el login y sin recargar: esto corre antes de que
// db.ts elija el nombre de la base. El parámetro se limpia de la URL acto seguido porque si se quedara
// pegado, cada recarga volvería a marcar el reset y borraría la demo en curso.
if (new URLSearchParams(location.search).has('demo')) { markDemoEntry(); history.replaceState({}, '', location.pathname); }

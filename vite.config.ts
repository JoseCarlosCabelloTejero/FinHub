import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Vite inlinea las VITE_* en tiempo de build. Si faltan, el build pasa igual y la app muere al
// importar src/supabase.ts: pantalla en blanco con el error solo en consola. Mejor romper aquí,
// donde el mensaje se lee en el log de Vercel. `apply: 'build'` lo mantiene fuera de
// `npm run dev` y fuera de vitest, que importa este mismo fichero.
const requireSupabaseEnv = (): Plugin => ({
  name: 'finhub:require-supabase-env',
  apply: 'build',
  config(_config, { mode }) {
    // '.' en vez de process.cwd(): este fichero se type-checkea con tsconfig.node.json, que no
    // trae @types/node, y loadEnv ya resuelve la ruta contra el directorio de trabajo.
    const env = loadEnv(mode, '.', 'VITE_');
    const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter(k => !env[k]);
    if (missing.length) throw new Error(`Build abortado: falta ${missing.join(' y ')}. En local van en .env.local (ver .env.example); en Vercel, en Settings → Environment Variables.`);
    if (env.VITE_SUPABASE_URL.includes('/rest/v1')) throw new Error('Build abortado: VITE_SUPABASE_URL no lleva sufijo de ruta. Usa solo https://<ref>.supabase.co, sin /rest/v1.');
  },
});

export default defineConfig({
  plugins: [react(), requireSupabaseEnv()],
  server: { port: 5173, strictPort: true },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', globals: true },
});

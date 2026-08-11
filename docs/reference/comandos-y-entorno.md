---
tags: [type/reference]
up: "[[00-index]]"
---

# Referencia: comandos y entorno

**Fuente de verdad**: `package.json` · `vite.config.ts` · `.env.example` · `supabase/config.toml` · `.nvmrc`

## Comandos

```bash
npm run dev          # servidor de desarrollo (Vite) — puerto 5173 fijo (strictPort)
npm run build        # tsc -b && vite build  ← el type-check vive AQUÍ, no en un script aparte
npm test             # vitest run (una pasada)
npm run test:watch   # vitest en watch
npm run lint         # eslint .
npx vite preview     # sirve el build
```

⚠️ **`npm run preview` no existe** como script, aunque algún texto lo mencione: usa `npx vite preview`.

Comprobación completa antes de dar algo por terminado:

```bash
npm test && npm run lint && npm run build
```

## Node y gestor de paquetes

- **Node.js 20+** (`.nvmrc` → `20`). Con `nvm`: `nvm use`.
- **npm, no pnpm.** Mezclar los dos en `node_modules` rompe el dev server; si pasa:
  `rm -rf node_modules && npm install`. `pnpm-lock.yaml` está en `.gitignore` justo por eso.
- Las dependencias están declaradas como `"latest"` en `package.json` (salvo `jsdom` y `jest-dom`), así
  que el que fija las versiones de verdad es `package-lock.json`.

## Variables de entorno

`.env.local` (**no versionado**, ver `.env.example`). En producción viven en Vercel → [[deploy-vercel]]:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`src/supabase.ts` **lanza un error en el arranque** si falta alguna, en vez de dejar un cliente a medio
construir. **Síntoma típico: pantalla en blanco → te falta `.env.local`.** → [[supabase-auth]]

Por eso `vite.config.ts` lleva un plugin (`apply: 'build'`) que **aborta el build** si falta alguna: así el
fallo salta en el log de Vercel y no como una pantalla en blanco en el móvil.

## Supabase en local

```bash
npx supabase start     # levanta el stack en Docker
npx supabase db reset   # aplica supabase/migrations/ desde cero
npx supabase stop
```

| Servicio | URL |
|---|---|
| API | http://localhost:54321 |
| Postgres | `localhost:54322` |
| Studio | http://localhost:54323 |
| Inbucket (correos) | http://localhost:54324 |

`project_id = "FinHub"` en `config.toml`. El usuario de pruebas se crea desde Studio → Authentication →
Add user (la API de admin no pasa por `enable_signup = false`). → [[supabase-auth]]

Para el proyecto remoto, `npx supabase db push` aplica las migraciones; el `notify pgrst, 'reload schema'`
del final del fichero es necesario ahí (en `db reset` es automático). → [[postgres-schema]]

## Estructura del repo

```
src/            código (ver los módulos en 00-index)
supabase/       config.toml + migrations/
docs/           este vault
referencia.html mockup de diseño original, FUERA del build
index.html      fragmento mínimo a propósito; Vite inyecta el resto
```

- **`vite.config.ts` también configura Vitest** (jsdom + globals + setupFiles); no hay `vitest.config`.
- **Artefactos ignorados que no hay que editar**: `dist/`, `vite.config.js`/`.d.ts`, `*.tsbuildinfo`.
- `.claude/`, `.agents/` y `skills-lock.json` están ignorados: son instalación personal.
- `.vercel/` también está ignorado: es el enlace local al proyecto, lo crea la CLI. → [[deploy-vercel]]

## Flujo de trabajo

- **Rama nueva desde `main` antes de implementar cualquier cosa**, también para docs o chores. Nombre:
  `<tipo>/<descripcion-en-kebab-case>` con el mismo `<tipo>` que los commits convencionales (`feat`,
  `fix`, `docs`, `chore`, `refactor`, `test`). No se commitea directamente sobre `main`.
- **Commits convencionales**, pequeños y en español. **Nunca `Co-Authored-By`.**
- **El PR es el único camino a producción**: Vercel despliega `main` solo, y cada PR trae su preview URL.
  La Action de CI (`npm ci` + test + lint + build) es un semáforo, no una puerta. → [[deploy-vercel]]

Related: [[testing]] · [[supabase-auth]] · [[postgres-schema]] · [[qa-playbook]]

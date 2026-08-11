# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev          # servidor de desarrollo (Vite)
npm run build        # tsc -b && vite build  ← el type-check vive aquí, no en un script aparte
npm test             # vitest run (una pasada)
npm run test:watch   # vitest en watch
npm run lint         # eslint .
npx vite preview     # el README menciona "npm run preview", pero ese script NO existe en package.json
```

Un solo fichero de test: `npx vitest run src/calculations.test.ts`
Un solo caso por nombre: `npx vitest run -t 'agrupa la cola en "Otros"'`

Requiere Node.js 20+. Comprobación completa antes de dar algo por terminado: `npm test && npm run lint && npm run build`.

## Vault de documentación (`docs/`)

`docs/` es un **vault de Obsidian** con el contexto del proyecto: módulos, dominios, flujos con diagramas,
referencia del esquema y decisiones de arquitectura.

**Antes de planificar un cambio o de responder a una pregunta de arquitectura, lee la nota relevante
empezando por `docs/00-index.md`.** Es más rápido y barato que grepear `src/` y el SQL, que están muy
comentados pero son largos (`sync.ts` tiene 515 líneas; el esquema, 531).

Atajos habituales:

- Toco el sync, el LWW o el outbox → `docs/domains/sync-model.md`, luego `docs/modules/sync.md`.
- Toco el esquema, RLS o los triggers → `docs/reference/postgres-schema.md`.
- Toco cálculos, periodos o semanas → `docs/modules/calculations.md`, `docs/domains/periodos.md`.
- Toco auth o el arranque → `docs/modules/supabase-auth.md`, `docs/flows/login.md`.
- Toco colores o accesibilidad → `docs/modules/design-system.md`.

**Contrapartida obligatoria**: si un cambio altera la arquitectura, un patrón, el esquema o el flujo de
sync, **actualiza la nota afectada en el mismo PR**. Cuando una nota y el código discrepen, gana el
código: se arregla la nota.

## Arquitectura

App de finanzas personales (marca "FinHub") para **un único usuario**. Nació local-first y hoy está a
mitad de una migración consciente a Supabase (fases 1-5 hechas; **la 6, el deploy, está pendiente**).

Modelo actual: **se escribe siempre primero en local**, así que la app funciona sin conexión;
**Supabase es la fuente de verdad y además la puerta de acceso** — sin iniciar sesión no se puede usar.
IndexedDB (`finhub-finanzas`, v3) es la caché local y la cola offline. Sin telemetría ni terceros más allá
de Supabase.

Flujo de datos, de abajo arriba:

- **`src/types.ts`** — `Movement`, `Category` (con subcategorías embebidas), `Preferences`, `OutboxOp`, `SyncMeta`, `SyncState`. Fuente única de verdad del modelo.
- **`src/data.ts`** — árbol de categorías por defecto generado desde `expenseGroups` + un `slug()` que produce IDs estables (`expense-coche-gasolina`). Esos IDs son los que quedan guardados en movimientos antiguos: **cambiar un nombre en `expenseGroups` cambia el ID y huérfana datos existentes**. `EPOCH_UPDATED_AT` hace que las semillas nunca ganen un LWW.
- **`src/db.ts`** — única capa de acceso a IndexedDB, vía `idb`. `dbPromise` es un singleton a nivel de módulo (se abre al importar). `bootstrapData()` siembra las categorías por defecto solo si el store está vacío; `clearAllData()` borra y vuelve a sembrar.
- **`src/sync.ts`** — el motor de sync: sella las escrituras (monótonas), las encola en el `outbox`, las sube en orden y baja el estado del servidor mezclándolo con lo pendiente. **Las escrituras de la UI pasan por aquí (`*Synced`), no por `db.ts`.** Ver `docs/modules/sync.md` antes de tocarlo.
- **`src/supabase.ts`** — cliente singleton, login y sesión. Lanza al importarse si faltan `VITE_SUPABASE_*` (síntoma: pantalla en blanco). `src/Login.tsx` es la pantalla de acceso.
- **`src/calculations.ts`** — toda la lógica derivada, funciones puras y sin React: filtrado por periodo, `summary()`, `trendData()`, `weeklyBreakdown()`, `categoryData()`, `topCategories()`, y los formateadores `money`/`percent` (es-ES/EUR). Aquí es donde va la lógica nueva y donde viven los tests.
- **`src/Charts.tsx`** — solo presentación con recharts. Se carga con `lazy()` desde `App.tsx` para mantener recharts fuera del bundle inicial; el `Suspense` que lo envuelve es intencionado.
- **`src/SyncStatus.tsx` + `src/syncCopy.ts`** — indicador de sincronización (chip en la cabecera, nota en el aside) y su copy. `SyncStatus` recibe el estado **por props**: no importa `./sync` ni `./supabase`, para poder testearse sin montar el motor.
- **`src/App.tsx`** — gate de sesión + todo el resto de la UI: shell, `Summary`, `Weekly`, `Movements`, `MovementModal`, `Categories`.

### Patrones que hay que respetar

**Estado centralizado en `App.tsx`, sin store ni context.** El ciclo es siempre: escribir (vía `sync.ts`) → `await reload()` → `reload()` re-lee *todo* con `getAllData()` y re-renderiza. Es deliberadamente tonto y correcto para este volumen de datos; no introduzcas estado optimista ni caché sin motivo. Los hijos reciben datos y callbacks por props.

**Las lecturas van por `db.ts`, las escrituras por `sync.ts`.** Las funciones `*Synced` guardan en IndexedDB *y* encolan la subida; llamar a `saveMovement`/`saveCategory` de `db.ts` desde la UI deja el cambio sin sincronizar. Las preferencias son la única excepción (no viajan al servidor).

**Los invariantes del sync no son negociables** (sello monótono, orden causal del outbox, pull solo con la cola vacía, lápidas, `wipe_epoch` antes del push). Están explicados uno a uno en `docs/domains/sync-model.md`: **léelo antes de tocar `sync.ts`**, porque casi todo lo que parece raro ahí es consecuencia directa de uno de ellos.

**Las preferencias se guardan solas** con un efecto que observa `prefs` (clave `'main'` del store `preferences`), y el guard `if(!loading)` evita sobrescribir lo cargado en el arranque.

**Las categorías nunca se borran, se archivan** (`archived: true`). Los movimientos guardan `categoryId`/`subcategoryId` como strings sin integridad referencial, así que archivar preserva el histórico. Los selects muestran solo activas *más* la que ya tuviera el movimiento en edición (`!c.archived || c.id === form.categoryId`), y al resolver el nombre se cae a `'Sin categoría'`. Mantén ese patrón en cualquier UI nueva de categorías.

**Los tokens de diseño están duplicados a propósito**, en `:root` de `src/styles.css` y en `src/theme.ts`. Recharts recibe colores por props y no puede leer `var()`, de ahí la copia en JS. **Al tocar un color hay que cambiar ambos ficheros.**

**Semántica de color:** verde (`--income`) y rojo (`--expense`) se reservan *exclusivamente* para ingreso/gasto. Todo lo demás es la escala de grises. El donut de categorías usa `theme.ramp`, que solo distingue bien 6 escalones; por eso `CATEGORY_LIMIT = theme.ramp.length` y `topCategories()` agrupa la cola en "Otros". Si añades colores a la rampa, el límite se ajusta solo.

**Migraciones de IndexedDB:** `openDB` está en **versión 3**, con bloques para `oldVersion < 1` y `oldVersion < 3` (la v2 existió como número, sin bloque propio). Un cambio de esquema exige subir la versión *y* añadir su propio bloque guardado por `oldVersion`, sin tocar los anteriores. Antes de subirla, comprueba si hace falta: añadir un campo a `SyncMeta` no la necesita, porque `getSyncMeta()` mergea con los defaults. Detalles y trampas (el backfill sin `await`, la copia desde `cielo-finanzas`) en `docs/flows/migraciones-idb.md`.

## Convenciones

- **Estilo de código muy denso**: sentencias encadenadas en una línea, cuerpos de componente comprimidos. Es intencionado en este repo — imita el fichero que estés editando en lugar de "normalizar" el formato.
- **Español en todo lo que ve una persona** (copy de UI, mensajes de error, comentarios, nombres de tests y describes); **inglés en el código** (identificadores, tipos, nombres de fichero).
- Los comentarios existentes explican el *por qué* de decisiones no obvias (la rampa de 6 grises, el sync de tokens, el indicador de foco único). Cuando quites uno, asegúrate de que la razón ya no aplica.
- Accesibilidad ya establecida y que no conviene romper: un único indicador de foco (`:focus-visible` con `outline`), región `aria-live` para los avisos, `aria-label` en los botones-icono, `.sr-only` para cabeceras de acciones.
- Acciones destructivas confirman: borrar un movimiento pide una confirmación, "Borrar todo" pide dos.
- `src/test/setup.ts` carga `fake-indexeddb/auto` y jest-dom; los tests de `db.ts` dependen de eso y de `clearAllData()` en `beforeEach`.

## Flujo de ramas

- Antes de implementar cualquier cambio (feature, fix, doc o chore), crea una rama nueva desde `main`. No commitees directamente sobre `main`.
- Nombre de rama: `<tipo>/<descripcion-corta-en-kebab-case>`, usando el mismo `<tipo>` que ya usan los commits convencionales de este repo: `feat`, `fix`, `docs`, `chore` (y `refactor`/`test` si aplica). Ejemplos: `feat/indicador-sync`, `fix/cola-vinculacion`, `docs/actualiza-readme`, `chore/actualiza-dependencias`.
- Esta regla aplica también a Claude Code: al empezar a implementar algo no trivial en este repo, crea primero la rama correspondiente (`git checkout -b <tipo>/<descripcion>`) antes de tocar archivos.

## Notas del repo

- `referencia.html` en la raíz es el mockup de diseño original, fuera del build. Útil como referencia visual.
- `index.html` es un fragmento mínimo a propósito; Vite inyecta el resto.
- `vite.config.ts` también configura Vitest (jsdom + globals), no hay `vitest.config` aparte.
- `dist/`, `vite.config.js`/`.d.ts` y los `*.tsbuildinfo` son artefactos ignorados por git; no los edites (`tsconfig.app.tsbuildinfo` está trackeado por accidente de un commit previo).
- `docs/` es el vault de Obsidian (se abre con *Open folder as vault*). Los enlaces entre notas son wikilinks `[[nombre-de-fichero]]`, sin ruta ni extensión, así que **los nombres de nota son únicos en todo el vault**. `.obsidian/` está ignorado por git.
- `.env.local` no está versionado (ver `.env.example`). Para levantar Supabase en local: `npx supabase start` (Studio en `:54323`); detalles en `docs/reference/comandos-y-entorno.md`.

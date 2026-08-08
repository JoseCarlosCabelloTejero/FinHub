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

## Arquitectura

App local-first de finanzas personales (marca "Cielo"). **No hay backend, ni cuentas, ni red**: todo persiste en IndexedDB del navegador (`cielo-finanzas`). Cualquier propuesta que implique servidor, sync o telemetría rompe la premisa del proyecto.

Flujo de datos, de abajo arriba:

- **`src/types.ts`** — `Movement`, `Category` (con subcategorías embebidas) y `Preferences`. Fuente única de verdad del modelo.
- **`src/data.ts`** — árbol de categorías por defecto generado desde `expenseGroups` + un `slug()` que produce IDs estables (`expense-coche-gasolina`). Esos IDs son los que quedan guardados en movimientos antiguos: **cambiar un nombre en `expenseGroups` cambia el ID y huérfana datos existentes**.
- **`src/db.ts`** — única capa de acceso a IndexedDB, vía `idb`. `dbPromise` es un singleton a nivel de módulo (se abre al importar). `bootstrapData()` siembra las categorías por defecto solo si el store está vacío; `clearAllData()` borra y vuelve a sembrar.
- **`src/calculations.ts`** — toda la lógica derivada, funciones puras y sin React: filtrado por periodo, `summary()`, `trendData()`, `categoryData()`, `topCategories()`, y el formateador `money` (es-ES/EUR). Aquí es donde va la lógica nueva y donde viven los tests.
- **`src/Charts.tsx`** — solo presentación con recharts. Se carga con `lazy()` desde `App.tsx` para mantener recharts fuera del bundle inicial; el `Suspense` que lo envuelve es intencionado.
- **`src/App.tsx`** — todo el resto de la UI: shell, `Summary`, `Movements`, `MovementModal`, `Categories`.

### Patrones que hay que respetar

**Estado centralizado en `App.tsx`, sin store ni context.** El ciclo es siempre: escribir en IndexedDB → `await reload()` → `reload()` re-lee *todo* con `getAllData()` y re-renderiza. Es deliberadamente tonto y correcto para este volumen de datos; no introduzcas estado optimista ni caché sin motivo. Los hijos reciben datos y callbacks por props.

**Las preferencias se guardan solas** con un efecto que observa `prefs` (clave `'main'` del store `preferences`), y el guard `if(!loading)` evita sobrescribir lo cargado en el arranque.

**Las categorías nunca se borran, se archivan** (`archived: true`). Los movimientos guardan `categoryId`/`subcategoryId` como strings sin integridad referencial, así que archivar preserva el histórico. Los selects muestran solo activas *más* la que ya tuviera el movimiento en edición (`!c.archived || c.id === form.categoryId`), y al resolver el nombre se cae a `'Sin categoría'`. Mantén ese patrón en cualquier UI nueva de categorías.

**Los tokens de diseño están duplicados a propósito**, en `:root` de `src/styles.css` y en `src/theme.ts`. Recharts recibe colores por props y no puede leer `var()`, de ahí la copia en JS. **Al tocar un color hay que cambiar ambos ficheros.**

**Semántica de color:** verde (`--income`) y rojo (`--expense`) se reservan *exclusivamente* para ingreso/gasto. Todo lo demás es la escala de grises. El donut de categorías usa `theme.ramp`, que solo distingue bien 6 escalones; por eso `CATEGORY_LIMIT = theme.ramp.length` y `topCategories()` agrupa la cola en "Otros". Si añades colores a la rampa, el límite se ajusta solo.

**Migraciones de IndexedDB:** `openDB` está en versión 2 pero el bloque `upgrade` solo cubre `oldVersion < 1`. Un cambio de esquema exige subir la versión *y* añadir su propio bloque guardado por `oldVersion`, sin tocar los anteriores.

## Convenciones

- **Estilo de código muy denso**: sentencias encadenadas en una línea, cuerpos de componente comprimidos. Es intencionado en este repo — imita el fichero que estés editando en lugar de "normalizar" el formato.
- **Español en todo lo que ve una persona** (copy de UI, mensajes de error, comentarios, nombres de tests y describes); **inglés en el código** (identificadores, tipos, nombres de fichero).
- Los comentarios existentes explican el *por qué* de decisiones no obvias (la rampa de 6 grises, el sync de tokens, el indicador de foco único). Cuando quites uno, asegúrate de que la razón ya no aplica.
- Accesibilidad ya establecida y que no conviene romper: un único indicador de foco (`:focus-visible` con `outline`), región `aria-live` para los avisos, `aria-label` en los botones-icono, `.sr-only` para cabeceras de acciones.
- Acciones destructivas confirman: borrar un movimiento pide una confirmación, "Borrar todo" pide dos.
- `src/test/setup.ts` carga `fake-indexeddb/auto` y jest-dom; los tests de `db.ts` dependen de eso y de `clearAllData()` en `beforeEach`.

## Notas del repo

- `referencia.html` en la raíz es el mockup de diseño original, fuera del build. Útil como referencia visual.
- `index.html` es un fragmento mínimo a propósito; Vite inyecta el resto.
- `vite.config.ts` también configura Vitest (jsdom + globals), no hay `vitest.config` aparte.
- `dist/`, `vite.config.js`/`.d.ts` y los `*.tsbuildinfo` son artefactos ignorados por git; no los edites (`tsconfig.app.tsbuildinfo` está trackeado por accidente de un commit previo).

---
tags: [type/reference, area/cliente]
up: "[[00-index]]"
---

# Referencia: testing

Vitest + Testing Library, entorno **jsdom**, configurado en `vite.config.ts` (**no hay `vitest.config`
aparte**). `src/test/setup.ts` carga `fake-indexeddb/auto` y `@testing-library/jest-dom/vitest`.

## Comandos

```bash
npm test                                   # vitest run — una pasada
npm run test:watch                         # vitest en watch
npx vitest run src/calculations.test.ts    # un solo fichero
npx vitest run -t 'agrupa la cola en "Otros"'   # un solo caso por nombre
```

Los nombres de `describe`/`it` están en **español**, como el resto de lo que lee una persona.

## Mapa de ficheros

| Fichero | Qué cubre |
|---|---|
| `calculations.test.ts` | `summary`, `filterPeriod`, `topCategories`, `weekOfMonth`/`weeksInMonth`, `weeklyBreakdown` |
| `sync.test.ts` | El grande (352 líneas): funciones puras **y** el motor con Supabase mockeado |
| `syncCopy.test.ts` | El copy de cada estado del sync |
| `db.test.ts` | Persistencia, orden del outbox, `replaceLocalData`, parches de `meta` |
| `db.migration.test.ts` | Migración v2 → v3 |
| `db.rename-migration.test.ts` | Copia `cielo-finanzas` → `finhub-finanzas` |
| `db.demo.test.ts` | La demo abre `finhub-demo` y **no** hereda nada de la base del usuario |
| `demo.test.ts` | La marca del modo demo: activar, consumir el reseteo una sola vez, `?demo=1` |
| `demoData.test.ts` | El decorado: ids reales, fechas válidas, y **descuadre 0** en Patrimonio |
| `Login.test.tsx` | El formulario de login (con `signIn` mockeado) y el botón de la demo |
| `SyncStatus.test.tsx` | Chip (adorno o disclosure según `onOpen`) y nota del aside, a partir de un `SyncState` |

### Los dos ficheros de migración están aparte a propósito

`db.ts` crea `dbPromise` **en el import** (singleton de módulo), así que en `db.test.ts` la base ya
estaría abierta en v3 antes de poder sembrar una v2. Vitest aísla el registro de módulos y el
`fake-indexeddb` **por fichero**, y eso es lo que hace posible sembrar una base "vieja" y luego
`await import('./db')`. → [[migraciones-idb]]

### `sync.test.ts`: qué está mockeado y por qué

`supabase.ts` **lanza al importarse** si faltan las variables de entorno, así que ningún test puede
cargarlo de verdad. Se mockea con `vi.hoisted` (necesario porque la fábrica del mock se eleva por encima
de las declaraciones del fichero) exponiendo `rpc`, `upsert`, `delete().eq()`, `select` y `resolveUserId`.

En el bloque `motor de sync`, los fake timers fingen **solo `setTimeout`/`clearTimeout`**: así el debounce
de las escrituras nunca dispara un sync a destiempo, pero `fake-indexeddb` conserva el `setImmediate` con
el que agenda los eventos de sus transacciones (fingirlo también deja colgada cualquier operación contra
la base). Dato práctico si añades tests ahí.

Los sub-bloques: `escrituras`, `primera vinculación`, y casos de push (orden, fallo de red que deja la
cola, op irrecuperable que se descarta).

El bloque `modo demo` es el **último del fichero** y tiene su propio `beforeEach`: pone
`localStorage.setItem('finhub-demo','1')` **antes** de los imports (`db.ts` elige el nombre de la base en
el import) y lo limpia en el `afterEach`, porque `localStorage` **no** se resetea entre tests y
contaminaría a los demás bloques. Lo que comprueba es lo que de verdad importa del modo: la escritura
llega a IndexedDB, el outbox se queda vacío, y `upsert`/`select`/`rpc` no se llaman nunca.

### Componentes

`SyncStatus.tsx` recibe el estado **por props** y no importa `./sync` ni `./supabase` justamente para
poder testearlo sin montar el motor ni el cliente. Mantén esa propiedad si añades UI de sync.

## Qué NO está cubierto

- **El Postgres de verdad**: FK, RLS, triggers de LWW y de lápidas. Solo se ejercen contra un proyecto
  real. → [[postgres-schema]]
- **`initSync`** y sus disparadores (`online`, `visibilitychange`, sondeo, web locks).
- **`App.tsx`**: no hay test de la app completa ni del gate de sesión (tampoco de su rama de demo, del
  arranque que siembra el decorado, ni de los modales, `SessionSheet` incluida). Lo que sí está cubierto
  es su contenido, `SyncNote`, y que el chip llama a `onOpen`.
- **`enterDemo` / `leaveDemo`**: recargan la página, que jsdom no implementa. Lo testeable de `demo.ts`
  está separado justamente por eso.
- **Los gráficos** ([[charts]]).

Todo eso vive en [[qa-playbook]].

## Al añadir tests

1. **La lógica nueva va en [[calculations]] o en una función pura exportada de [[sync]]** y se testea
   directamente. Exportar una función solo para poder testearla es un patrón aceptado aquí (por eso
   `diffCategoryDoc`, `applyPullToLocal` o `repairDanglingRefs` son públicas).
2. Nombres de caso en español, describiendo el comportamiento, no la implementación.
3. Si tocas IndexedDB, `clearAllData()` en `beforeEach`.
4. Comprobación completa antes de dar algo por terminado:
   ```bash
   npm test && npm run lint && npm run build
   ```
   El **type-check vive en `npm run build`** (`tsc -b`), no en un script aparte.

Related: [[qa-playbook]] · [[comandos-y-entorno]] · [[calculations]] · [[sync]]

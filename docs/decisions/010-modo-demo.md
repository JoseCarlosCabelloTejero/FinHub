---
tags: [type/decision, domain/auth, domain/datos, area/cliente]
up: "[[00-index]]"
---

# ADR 010 — Modo demo: base aparte y sync apagado

**Estado**: aceptada

## Contexto

FinHub es de un solo usuario y el login es la puerta ([[006-un-solo-usuario]]): sin sesión no se monta
nada. Eso hace imposible que alguien **pruebe** la app: no hay registro y la RLS es `to authenticated`,
así que un cliente anónimo no puede escribir ni una fila ([[postgres-schema]]).

Queríamos un "Probar la demo" en el login con dos garantías duras:

1. **Ni una escritura en el Supabase de producción.**
2. **Ni un solapamiento** con los datos de quien ya haya usado la app en ese navegador.

La segunda es la que manda el diseño. Si los datos de la demo cayeran en `finhub-finanzas`, en el
siguiente login real `adoptUser()` **no borra la caché** —solo el outbox— y `firstSync()` los subiría
como si fueran tuyos. Ese fallo tenía que ser **imposible por construcción**, no evitable con cuidado.

## Decisión

**La demo vive en su propia base de IndexedDB (`finhub-demo`), el nombre se elige en el import, y
entrar o salir recarga la página.**

La marca es una clave de `localStorage` (`finhub-demo`), leída por `isDemo()` en `src/demo.ts`, un módulo
**sin imports** para que se evalúe antes que `db.ts`.

### Por qué recargar en vez de cambiar de base en caliente

`db.ts` abre `dbPromise` como efecto de import, y lo importa todo el árbol (`App.tsx`, `sync.ts`, hasta
`supabase.ts`). Cuando el primer componente de React puede leer una marca, la base ya está abierta. Las
dos salidas eran:

- Volver `dbPromise` perezoso (`getDb()`) → toca las ~20 funciones de `db.ts` y sus tests, y rompe el
  patrón que las propias pruebas de migración documentan.
- **Decidir el nombre en el import y recargar para cambiar de modo** → una línea. Y de paso la recarga
  reconstruye los otros singletons que quedarían desfasados al cambiar de base: `lastStamp`,
  `lastPullKey`, el estado del sync y el cliente de Supabase.

Se eligió la segunda. Una recarga en una transición que ocurre una vez por sesión no es un coste real.

### Los cuatro guards del sync

En orden de importancia, todos en `src/sync.ts` (detalle en [[sync]]):

1. **`enqueue()`** — el embudo por el que pasan las cinco `*Synced`. En demo la escritura local ya está
   hecha y no hay a quién subirla: no se encola ni se programa sync. Es el guard que de verdad garantiza
   el aislamiento; los otros tres son red de seguridad.
2. **`initSync()`** — no arranca el motor y fija `status: 'demo'`.
3. **`runSync()`** — sale antes que nada, porque `syncNow` es público y de ahí cuelgan el RPC del wipe
   epoch y `adoptUser`, que es destructivo.
4. **`clearAllDataSynced()`** — la única `*Synced` que llama al servidor en línea.

### La quinta red: el sello de época

Todas las semillas del decorado nacen con `EPOCH_UPDATED_AT`, igual que las categorías por defecto. Si
por cualquier vía imprevista llegaran a subir, el LWW del servidor las descartaría.

## Consecuencias

- **La demo no elimina la necesidad de un proyecto de Supabase**: `supabase.ts` sigue lanzando al
  importarse sin las `VITE_*`, y `sync.ts` lo importa estáticamente. La garantía es "no escribe", no
  "funciona sin backend". Desacoplarlo sería otro cambio.
- Hay **datos de ejemplo** (`src/demoData.ts`) porque con la base vacía las cinco pantallas abren con
  ceros y recuadros de "todavía no hay datos". Se generan relativos a hoy, y **los saldos de los cierres
  se despejan de los movimientos** para que Patrimonio no abra acusando al decorado de un descuadre.
- Cada entrada empieza de cero (marca `finhub-demo-reset`, consumida en el arranque), pero recargar
  dentro de la demo conserva lo que hayas probado. Salir borra la base demo.
- **La salida tiene que existir en móvil**, y no existía: vive en el aside, que desaparece por debajo de
  760 px. Como la demo se comparte por enlace y un enlace se abre en el teléfono, el chip de la cabecera
  pasó a abrir una hoja con la nota dentro. De paso arregla el mismo agujero para "Cerrar sesión", que lo
  tenía desde siempre. → [[ui-app]]
- "Borrar todo" en demo deja de exigir conexión y borra a vacío: **no** resiembra el decorado.
- Se entra por el botón del login o por `?demo=1`, que sirve para compartir la app por enlace.
- Un usuario con sesión activa no ve el botón. Si forzara la marca entraría en la demo sin perder nada,
  y al salir su sesión sigue intacta.
- Dos pestañas comparten `localStorage`, así que comparten modo. Es coherente con cómo ya funciona la sesión.

## Relacionadas

[[login]] · [[db]] · [[sync]] · [[sync-model]] · [[006-un-solo-usuario]] · [[003-outbox-en-indexeddb]]

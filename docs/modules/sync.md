---
tags: [type/module, domain/sync, area/cliente]
up: "[[00-index]]"
---

# Módulo: sync

El motor de sincronización: sella las escrituras, las encola, las sube en orden, baja el estado del
servidor y lo mezcla con lo que aún no se ha subido. Es el fichero más grande del proyecto (~515
líneas) y el que concentra la complejidad real.

**Fuente de verdad**: `src/sync.ts` · tests en `src/sync.test.ts` (352 líneas)
**Antes de tocarlo**: lee [[sync-model]] (los invariantes) y [[postgres-schema]] (qué hace el servidor).

## Mapa del fichero

El fichero está dividido en secciones con cabeceras de comentario. En orden:

1. **Filas del servidor** — `CategoryRow`, `SubcategoryRow`, `MovementRow` y sus mappers.
2. **Diff de un documento de categoría** — `diffCategoryDoc`.
3. **Reensamblado** — `assembleCategories`.
4. **Reparación de referencias colgantes** — `repairDanglingRefs`.
5. **Mezcla del pull con lo pendiente** — `applyPullToLocal`.
6. **Estado observable** — `subscribeSyncState` / `getSyncState`.
7. **Sellado** — `monotonicStamp` / `nextStamp`.
8. **Escrituras** — las funciones `*Synced` que llama la UI.
9. **Push** — `pushOp` / `pushOutbox`.
10. **Pull** — `fetchSnapshot` / `pullAndApply`.
11. **Primera vinculación** — `firstSync` / `uploadEverything` / `mergeWithServer`. → [[first-sync]]
12. **Ciclo** — `syncNow` / `runSync` / `initSync`.

Las secciones 1-5 y 7 son **funciones puras y exportadas justo para poder testearlas**; las 6 y 8-12
tocan IndexedDB, la red o el estado del módulo.

## Mappers de fila

`toMovementRow` / `fromMovementRow` y equivalentes traducen entre el modelo del cliente (camelCase,
subcategorías embebidas) y las filas del servidor (snake_case, normalizadas). Tres reglas:

- **Nunca se manda `user_id`**: la columna tiene `DEFAULT auth.uid()`.
- `subcategoryId: ''` (el "Sin subcategoría" del `<select>`) viaja como `null`. Es el único sitio que
  conoce el esquema del servidor, así que la traducción vive aquí.
- `amount` es `number` en los dos lados: PostgREST serializa `numeric` con `to_json`, así que llega
  como número JSON. **No hacer `parseFloat`.**

## `diffCategoryDoc(prev, next, stamp)` → `{ doc, ops }`

La pieza más sutil del módulo. La UI trabaja con la categoría **entera** (`saveCategorySynced` recibe
todo el árbol), pero en Postgres cada categoría y cada subcategoría son filas con su propio LWW.

- Si subiéramos el documento completo, "renombrar la categoría en el portátil" y "añadir una
  subcategoría en el móvil" se pisarían: ganaría el último documento entero. Por eso **solo viajan las
  filas que de verdad cambiaron**.
- Devuelve también `doc` porque IndexedDB y el servidor tienen que guardar **el mismo `updatedAt`**: si
  sellara una cosa aquí y en local se guardara otra, el LWW compararía contra un valor que no tiene
  nadie.
- Las filas sin cambios **conservan su sello anterior**, para no ganar por antigüedad falsa.
- La op de la categoría va **delante** (`unshift`) de sus subcategorías: en una categoría recién creada
  la FK exige que la fila padre exista primero.
- Una subcategoría que desaparezca de `next` se ignora: la UI archiva y nunca borra, y el servidor no
  concede `DELETE` sobre `subcategories`.

## `repairDanglingRefs(movements, categories)`

En IndexedDB `categoryId`/`subcategoryId` son strings **sin integridad referencial**; en Postgres hay
FK de verdad, que rechazarían esas filas con un `23503` — y el push trata las violaciones de
integridad como **irrecuperables**, así que se perderían movimientos reales.

La reparación crea una categoría archivada `Recuperados` **por tipo** (no una sola) porque el modal
filtra las categorías por el tipo del movimiento: con una sola de gasto, los ingresos recuperados no
se podrían ni reasignar a mano. Nace con sello de época, así que el LWW no la deja pisar nada.
Es **idempotente**.

## `applyPullToLocal(snapshot, pending)`

El snapshot del servidor con las escrituras pendientes **reproducidas encima**. Sin esto, un pull que
llegue justo después de guardar un movimiento devolvería la versión vieja y borraría de la pantalla
algo que el usuario acaba de escribir. Lo pendiente siempre gana **en local**; el servidor ya lo
recibirá y decidirá por LWW.

Caso a tener presente: una subcategoría pendiente cuya categoría padre no está en el snapshot se
**omite** (no hay dónde colgarla). La op sigue en la cola y el próximo pull la traerá ya subida.

## Sellado: `monotonicStamp` y `nextStamp`

El trigger LWW descarta lo que llegue con `updated_at <=` al guardado, así que **un reloj que se
atrase (cambio de hora, NTP) dejaría de poder escribir**. `monotonicStamp` fuerza al menos 1 ms sobre
el último sello emitido:

```ts
new Date(Math.max(now, Date.parse(last) + 1)).toISOString()
```

El último sello se **cachea en memoria** (para no leer IndexedDB en cada escritura) y se **persiste**
en `meta.lastStampAt`, porque el reloj puede atrasarse entre dos sesiones. En `nextStamp` la
asignación `lastStamp = stamp` va sin `await` de por medio a propósito: dos escrituras seguidas no
pueden mirar el mismo valor y acabar con el mismo sello, que el servidor descartaría como empate.

## Escrituras: las funciones `*Synced`

Mismo contrato que las de [[db]] para que [[ui-app]] siga siendo "escribir y recargar". **La red no
aparece por ninguna parte**: se escribe en IndexedDB, se encola, y lo encolado se sube cuando se pueda.

- `saveMovementSynced` — re-sella aunque el modal ya ponga un `updatedAt`: solo un sitio decide los
  sellos y todos son monótonos.
- `removeMovementSynced` — encola un `delete`. El servidor deja una lápida.
- `saveCategorySynced` — pasa por `diffCategoryDoc`.
- `clearAllDataSynced` — **la única que exige conexión**. → [[borrado-total]]

Después de encolar, `enqueue()` actualiza `pendingOps` y llama a `scheduleSync()` (debounce de 800 ms).

## Push

```ts
const isPermanent = (code) => code.startsWith('22') || code.startsWith('23');
```

Solo las violaciones de **dato (clase 22)** y de **integridad (clase 23)** son definitivas: reintentarlas
daría siempre el mismo error y atascarían la cola para siempre. **Todo lo demás se reintenta** —red,
5xx, un 401 con el token caducado, incluso un `42501`— porque tirar una escritura del usuario por un
fallo pasajero es mucho peor que reintentar de más. Una op descartada se registra en `lastError` y se
le cuenta al usuario.

Dos detalles:

- El upsert va **sin `.select()`** encadenado: la respuesta viene vacía y una fila descartada por el
  LWW es indistinguible de una aplicada. **El push es ciego**, y eso es lo que queremos.
- Una op solo sale de la cola **tras la confirmación del servidor**: si la app muere a mitad se
  reintenta. Todas son idempotentes (upsert por id, delete por id).

## Pull

`fetchSnapshot()` se trae las tres tablas enteras en paralelo y calcula una `key` (el JSON de las
filas). Si coincide con `lastPullKey` **no se reescribe IndexedDB ni se llama a `reload()`**: sin eso,
el sondeo de cada minuto repintaría los gráficos y remontaría la tabla sin que nada hubiera cambiado.
"Servidor vacío" se mide por **categorías**: no puede haber movimientos sin ellas. → [[pull]]

## El ciclo: `runSync`

El orden **no es negociable**:

1. Sin red → `offline`, fuera. Sin `userId` → `auth-required`, fuera.
2. `adoptUser(userId)` — ¿la caché es de otro usuario? → [[login]]
3. `adoptWipeEpoch(...)` — ¿alguien hizo "Borrar todo"? **Antes del push.** → [[borrado-total]]
4. `firstSync()` si `!meta.migratedAt` — antes del push, porque hasta que el dispositivo no se ha
   vinculado su cola no basta para dejar el servidor coherente. → [[first-sync]]
5. `pushOutbox()`. Si aborta → `error` y no se hace pull.
6. **Pull solo con la cola vacía**: aplicar el snapshot con escrituras sin subir dejaría la pantalla
   mostrando la versión vieja de algo que el usuario acaba de escribir.

`syncNow()` funde las llamadas concurrentes en una sola ejecución más un repaso (`rerun`), y `withLock`
añade un **web lock** (`navigator.locks`) para que dos pestañas del mismo navegador —que comparten
IndexedDB pero no variables de módulo— no se pisen. jsdom no trae `navigator.locks`, de ahí la
comprobación en vez de darlo por hecho.

`initSync(onChange)` registra los disparadores y devuelve la función de parada. Sin Realtime a
propósito → [[004-sin-realtime]].

## Estado observable

`subscribeSyncState(cb)` es un store externo mínimo (un `Set` de listeners) que [[ui-app]] consume con
`useSyncExternalStore`. Invoca el callback de inmediato con el estado actual. El copy de cada estado
vive en `src/syncCopy.ts` → [[design-system]].

Related: [[db]] · [[sync-model]] · [[first-sync]] · [[pull]] · [[escritura-local]] · [[postgres-schema]] · [[testing]]

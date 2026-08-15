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

1. **Filas del servidor** — `CategoryRow`, `SubcategoryRow`, `MovementRow`, `AccountRow`, `ClosingRow`
   y sus mappers.
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
- `subcategoryId: ''` y `accountId: ''` (los "Sin subcategoría" / "Sin cuenta" de los `<select>`)
  viajan como `null`, y vuelven con spread condicional para no dejar la clave puesta a vacío. Las FK
  rechazarían la cadena vacía (hay checks `<> ''` por si acaso). Es el único sitio que conoce el
  esquema del servidor, así que la traducción vive aquí.
- `amount` es `number` en los dos lados: PostgREST serializa `numeric` con `to_json`, así que llega
  como número JSON. **No hacer `parseFloat`.**
- En `ClosingRow`, ojo con la diferencia: `balance: null` es **un estado real** ("mes no revisado", va
  y vuelve tal cual), mientras que `contributed`/`note` a null son ausencia. Y como `contributed` es un
  número, el `0` es legítimo: el mapper de vuelta comprueba `null` explícitamente en vez del truthy que
  usan las notas. → [[patrimonio]]

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

## `repairDanglingRefs(movements, categories, accounts)`

En IndexedDB `categoryId`/`subcategoryId`/`accountId` son strings **sin integridad referencial**; en
Postgres hay FK de verdad, que rechazarían esas filas con un `23503` — y el push trata las violaciones
de integridad como **irrecuperables**, así que se perderían movimientos reales.

La reparación crea una categoría archivada `Recuperados` **por tipo** (no una sola) porque el modal
filtra las categorías por el tipo del movimiento: con una sola de gasto, los ingresos recuperados no
se podrían ni reasignar a mano. Nace con sello de época, así que el LWW no la deja pisar nada.
Es **idempotente**.

Con las cuentas el trato es distinto y más simple: una cuenta colgante **se limpia y el movimiento se
queda**, sin inventar ninguna cuenta de recuperación. `accountId` es opcional de verdad —"sin cuenta"
es un estado normal del modelo, no una avería—, así que no hay nada que reconstruir. Lo que no puede
pasar es perder el movimiento, que es dinero real → [[patrimonio]] §8

Ojo al conjunto de cuentas que se le pasa: en `mergeWithServer` es la **unión** de las locales y las
del snapshot. Las locales se suben en ese mismo merge y las remotas ya están arriba, así que las dos
son referenciables; pasar solo las locales limpiaría cuentas perfectamente vivas.

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
- `saveAccountSynced` / `saveClosingSynced` — upserts planos (sin diff: no llevan hijos embebidos).
  **Vaciar un cierre = `saveClosingSynced` con `balance: null`**; nunca se emite `delete`, que es lo que
  permite a [[patrimonio]] vivir sin lápidas. → [[009-la-foto-manda-cierre-mensual]]
- `clearAllDataSynced` — **la única que exige conexión**. → [[borrado-total]]

Después de encolar, `enqueue()` actualiza `pendingOps` y llama a `scheduleSync()` (debounce de 800 ms).

## Modo demo: los cuatro guards

En demo el módulo se apaga entero. Los cuatro sitios donde se comprueba `isDemo()`, en orden de importancia:

| Punto | Qué hace | Por qué ahí |
|---|---|---|
| `enqueue()` | Sale **antes** de `enqueueOutbox` | Es el embudo de las cinco `*Synced`, así que es el guard que de verdad aísla la demo. Encolar sin poder subir dejaría el outbox creciendo sin fin y el indicador diciendo "N cambios pendientes" para siempre |
| `initSync()` | Fija `status: 'demo'` y devuelve un no-op | Ni disparadores, ni sondeo, ni primera vinculación. Dentro de `initSync` y no en [[ui-app]] para que siga habiendo **un único** punto de arranque |
| `runSync()` | Sale antes incluso de mirar la red | `syncNow` es público, y de aquí cuelgan el RPC del wipe epoch y `adoptUser`, que es destructivo |
| `clearAllDataSynced()` | Borra en local y no llama al RPC | Es la única `*Synced` que se salta `enqueue` y habla con el servidor en línea |

Lo que **no** se toca: `nextStamp()` sigue sellando y escribiendo `meta.lastStampAt`, en la base demo. Es
inofensivo y preserva el invariante de que un solo sitio decide los sellos. → [[010-modo-demo]]

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

Hay **dos redes**, y conviene no confundirlas porque atacan cosas distintas:

1. **La huella (`sync_fingerprint`), en el servidor y antes de descargar.** `fetchFingerprint()` pide
   un `md5` del estado más el `wipe_epoch` en una sola petición. Si el digest coincide con el del
   último snapshot aplicado **el pull no llega a ocurrir**: el ciclo en reposo se queda en esa única
   petición. → [[011-huella-de-sincronizacion]]
2. **`lastPullKey`, en el cliente y después de descargar.** Cuando el pull sí ocurre, `fetchSnapshot()`
   calcula una `key` (el JSON de las filas); si coincide **no se reescribe IndexedDB ni se llama a
   `reload()`**, así que no se repintan los gráficos ni se remonta la tabla.

La segunda sigue haciendo falta con la primera puesta: la huella se lee **antes** del push, así que en
un ciclo que ha escrito no se puede confiar en ella y el pull se hace igual — ahí es donde
`lastPullKey` evita el repintado. Eso es exactamente lo que decide `canSkipPull(digest, aplicada,
pushedSomething)`, que es puro y está testeado.

`fetchSnapshot()` se trae las cinco tablas en paralelo, cada una con **su lista explícita de columnas**
(`MOVEMENT_COLS` y compañía, espejo de los tipos `*Row`) y no con `select('*')`: así no viaja `user_id`
en cada fila y, sobre todo, una columna nueva en el servidor deja de cambiar `lastPullKey` y de forzar
un repintado espurio en todos los dispositivos.

"Servidor vacío" se sigue midiendo por **categorías**: son la única semilla obligatoria (no existir
cuentas es un estado normal). → [[pull]]

La huella se **persiste** en `meta.lastFingerprint` y se rehidrata al principio de cada ciclo (dentro
de `adoptUser`): en una variable de módulo se perdía al recargar la página, que en una PWA es el caso
común. Se invalida en los tres sitios que invalidan la caché local — cambio de usuario, epoch de wipe
ajeno y "Borrar todo" —; olvidar uno deja la pantalla mostrando datos que ya no existen.

En `snapshotToOps` (la subida de un snapshot entero), el orden causal es **cuentas → cierres →
categorías → subcategorías → movimientos**: los cierres y los movimientos dependen de su cuenta por FK,
así que la cuenta tiene que llegar antes. Es el invariante con el test más importante de la fase 4, y
no por gusto: un `23503` en el push es irrecuperable y **descartaría el movimiento para siempre**. Un
cierre cuya cuenta no viaje en el snapshot **se omite** (el análogo barato de `repairDanglingRefs`, sin
inventar cuentas de recuperación); un movimiento, en cambio, viaja sin cuenta antes que perderse. Y en `mergeWithServer`, un cierre se sube **siempre** aunque el servidor ya tenga su id:
el id determinista `cuenta:mes` puede chocar de verdad (misma fila lógica) y ahí debe decidir el LWW,
no el cliente.

## El ciclo: `runSync`

El orden **no es negociable**:

0. En demo, fuera antes de todo lo demás (ver arriba).
1. Sin red → `offline`, fuera. Sin `userId` → `auth-required`, fuera.
2. `adoptUser(userId)` — ¿la caché es de otro usuario? Rehidrata también la huella. → [[login]]
3. `fetchFingerprint()` — la **única** petición del ciclo en reposo: trae el digest y el `wipe_epoch`
   juntos, porque se necesitan siempre a la vez. → [[011-huella-de-sincronizacion]]
4. `adoptWipeEpoch(local, remoto)` — ¿alguien hizo "Borrar todo"? **Antes del push.** Ya no hace su
   propio RPC: recibe el epoch del paso anterior. → [[borrado-total]]
5. `firstSync(digest)` si `!meta.migratedAt` — antes del push, porque hasta que el dispositivo no se ha
   vinculado su cola no basta para dejar el servidor coherente. Recibe el digest para que
   `mergeWithServer` lo apunte: sin eso el pull del final del mismo ciclo volvía a descargar las cinco
   tablas para tirarlas contra `lastPullKey`. → [[first-sync]]
6. `pushOutbox()`. Si aborta → `error` y no se hace pull. Se anota **antes** si la cola traía algo,
   porque es lo que decide si la huella del paso 3 sigue valiendo.
7. **Pull solo con la cola vacía**: aplicar el snapshot con escrituras sin subir dejaría la pantalla
   mostrando la versión vieja de algo que el usuario acaba de escribir.
8. **Y solo si `canSkipPull` dice que no**: huella distinta, o este ciclo ha subido algo. Un ciclo que
   ha escrito pulla siempre, porque el LWW del servidor puede haber descartado alguna de sus ops y dar
   la versión local por buena sería creerse una escritura que no se aplicó.
9. **Si se ha subido algo, la huella se relee antes de pullear.** La del paso 3 describe el servidor de
   *antes* del push; apuntar esa dejaba al ciclo siguiente bajándose las cinco tablas para nada (un
   pull de más por cada push). Se relee **antes** del snapshot y nunca después: una huella posterior
   taparía un cambio ocurrido entre medias. **Equivocarse aquí tiene que costar una descarga de más,
   jamás una menos.**

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

Related: [[db]] · [[sync-model]] · [[first-sync]] · [[pull]] · [[escritura-local]] · [[postgres-schema]] · [[testing]] · [[010-modo-demo]]

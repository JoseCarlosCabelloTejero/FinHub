---
tags: [type/module, domain/datos, area/cliente]
up: "[[00-index]]"
---

# Módulo: db

Única capa de acceso a IndexedDB, vía [`idb`](https://github.com/jakearchibald/idb). Nadie más abre la
base ni conoce sus stores: [[sync]] y [[ui-app]] solo llaman a las funciones de aquí.

**Fuente de verdad**: `src/db.ts` · stores en [[indexeddb-stores]]

## Lo esencial

- `dbPromise` es un **singleton a nivel de módulo**: la base se abre al importar el fichero. Dos
  instancias competirían por la misma versión y por el bloqueo de `versionchange`.
- Base `finhub-finanzas`, **versión 4**. Las migraciones y la copia desde la marca anterior están en
  [[migraciones-idb]].
- `bootstrapData()` siembra las categorías por defecto **solo si el store está vacío**. Las cuentas y
  cierres de [[patrimonio]] **no tienen semillas**.
- `clearAllData()` vacía todo y vuelve a sembrar (solo categorías). Vacía también `outbox` y `meta`:
  dejar ops encoladas tras un "Borrar todo" repoblaría el servidor recién vaciado. → [[borrado-total]]

## API

| Función | Para qué |
|---|---|
| `getAllData()` | Lo que lee `reload()` en [[ui-app]]: movimientos + categorías + cuentas + cierres |
| `saveMovement` / `removeMovement` | Escritura cruda. **La UI no las llama**: usa las `*Synced` de [[sync]] |
| `saveCategory` / `getCategory` | Idem. `getCategory` la usa `diffCategoryDoc` para comparar |
| `saveAccount` / `saveClosing` | Escritura cruda de [[patrimonio]]. Misma regla: la UI usa las `*Synced` |
| `savePreferences` / `loadPreferences` | Store `preferences`, clave `'main'` → [[preferencias]] |
| `bootstrapData` / `clearAllData` | Siembra y borrado total |
| `replaceLocalData(compute)` | Aplica un snapshot del servidor sobre la caché (ver abajo) |
| `enqueueOutbox` / `readOutbox` / `deleteOutboxOp` / `clearOutbox` | La cola de subida |
| `getSyncMeta` / `saveSyncMeta` | Bookkeeping del sync |

## Los cuatro detalles que no se pueden romper

### `replaceLocalData` declara `outbox` como `readwrite` aunque solo lo lea

Al declararlo `readwrite`, IndexedDB **bloquea cualquier encolado concurrente** hasta que la
transacción termina. Sin eso, una escritura del usuario podría caer en la ventana entre "leo lo
pendiente" y "reemplazo la caché", y se perdería.

Por lo mismo, el callback `compute` es **síncrono**: un `await` de algo ajeno a la base (una llamada de
red, por ejemplo) cerraría la transacción antes de tiempo. La mezcla de verdad
(`applyPullToLocal`) vive en [[sync]]; aquí solo está la atomicidad.

### `getSyncMeta` mergea con los defaults

```ts
return { ...DEFAULT_SYNC_META, ...(await db.get('meta', META_KEY)) };
```

Gracias a esto, **añadir un campo a `SyncMeta` no obliga a subir la versión de la base**: `meta` es un
store out-of-line con un único registro y un registro viejo se completa solo al leerlo.

### `saveSyncMeta` es read-modify-write dentro de UNA transacción

Dos parches concurrentes (por ejemplo `lastStampAt` de una escritura y `lastSyncAt` de un ciclo de
sync) se pisarían si leyeran y escribieran por separado.

### El `outbox` tiene la clave FUERA de línea

`{ autoIncrement: true }` sin `keyPath`: el `seq` **es la clave**, no un campo del valor. El orden de
las claves es el orden causal en que se hicieron las escrituras, y eso es lo que el push respeta.
`readOutbox()` empareja `getAllKeys()` con `getAll()` porque ambos devuelven en orden de clave.
→ [[003-outbox-en-indexeddb]]

## Al añadir una función aquí

Sigue el estilo denso del fichero (una línea por función) y pregúntate si la UI debe llamarla
directamente o si necesita su versión `*Synced` en [[sync]]. Regla práctica: **si el dato viaja al
servidor, la UI no puede llamar a `db.ts`**.

Related: [[sync]] · [[indexeddb-stores]] · [[migraciones-idb]] · [[ui-app]]

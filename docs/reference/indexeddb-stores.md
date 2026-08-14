---
tags: [type/reference, domain/datos, area/cliente]
up: "[[00-index]]"
---

# Referencia: stores de IndexedDB

Base **`finhub-finanzas`**, versión **4**. Nombre anterior (marca "Cielo"): `cielo-finanzas`, del que se
copia una sola vez → [[migraciones-idb]].

El modo demo usa una **base distinta con el mismo esquema**, `finhub-demo`, y ahí no se copia nada de la
marca anterior. Es el aislamiento que impide que los datos de prueba se mezclen con los tuyos o acaben
subidos → [[010-modo-demo]].

**Fuente de verdad**: `interface FinanceDB` en `src/db.ts`

## Stores

| Store | Clave | Tipo de clave | Valor | Índices |
|---|---|---|---|---|
| `movements` | `id` | in-line (`keyPath`) | `Movement` | `date`, `type` |
| `categories` | `id` | in-line (`keyPath`) | `Category` (con subcategorías embebidas) | — |
| `preferences` | `'main'` | out-of-line | `Preferences` | — |
| `outbox` | `seq` | out-of-line **autoincremental** | `OutboxOp` | — |
| `meta` | `'sync'` | out-of-line | `SyncMeta` | — |
| `accounts` | `id` | in-line (`keyPath`) | `Account` | — |
| `closings` | `id` | in-line (`keyPath`) | `Closing` | — |

### `accounts` y `closings` (v4, dominio patrimonio)

Sin índices: son 3-8 cuentas y sus cierres, todo se filtra en memoria como el resto. La clave de un
cierre es su **id determinista `${accountId}:${month}`**, que es también el grano del LWW
→ [[009-la-foto-manda-cierre-mensual]]. Nacen vacíos: **no hay semillas de patrimonio**, a diferencia
de las categorías. → [[patrimonio]]

### `movements`

Los índices `date` y `type` son de la v1 y **hoy no se usan**: `getAllData()` se trae todo y la UI filtra
en memoria. No estorban; si algún día hubiera muchos movimientos, ya están.

### `preferences` y `meta`: un único registro cada uno

Clave fija (`'main'` y `'sync'`) en vez de un saco de pares clave-valor, así quedan **tipados de verdad**.
Consecuencia útil: añadir un campo a `SyncMeta` **no** obliga a subir la versión de la base, porque
`getSyncMeta()` mergea con los defaults. → [[db]]

### `outbox`: la clave FUERA de línea

`{ autoIncrement: true }` **sin `keyPath`**: el `seq` **es la clave**, no un campo del valor. El orden de
las claves **es el orden causal** de las escrituras, y eso es lo que el push respeta.
→ [[003-outbox-en-indexeddb]]

`readOutbox()` empareja `getAllKeys()` con `getAll()` (ambos devuelven en orden de clave) y devuelve
`{ seq, op }`.

## `SyncMeta` — qué significa cada campo

```ts
interface SyncMeta {
  userId: string | null;       // usuario actual; llave del modo offline
  dataUserId: string | null;   // DE QUIÉN son los datos cacheados
  migratedAt: string | null;   // null = este dispositivo aún no se ha vinculado
  lastSyncAt: string | null;   // último ciclo completo con éxito
  wipeEpoch: number;           // epoch de "Borrar todo" conocido por este dispositivo
  lastStampAt: string | null;  // último sello emitido (para que nunca retroceda)
}
```

`userId` **≠** `dataUserId`: sin distinguirlos, un cambio de usuario en el mismo navegador sería
indetectable y mezclaría dos históricos. → [[login]]

## Qué vacía qué

| Operación | `movements` | `categories` | `preferences` | `outbox` | `meta` | `accounts` | `closings` |
|---|---|---|---|---|---|---|---|
| `clearAllData()` | ✅ vacía | ✅ vacía y **resiembra** | ✅ vacía | ✅ vacía | ✅ vacía | ✅ vacía (sin resiembra) | ✅ vacía (sin resiembra) |
| `replaceLocalData()` | ✅ sustituye | ✅ sustituye | — | lee (bloquea) | — | ✅ sustituye | ✅ sustituye |
| `clearOutbox()` | — | — | — | ✅ vacía | — | — | — |

`clearAllData()` vacía también `outbox` y `meta` porque dejar ops encoladas tras un "Borrar todo"
repoblaría el servidor recién vaciado. → [[borrado-total]]

## Cómo inspeccionarlo

DevTools → **Application** → **IndexedDB** → `finhub-finanzas`. Los dos stores interesantes al depurar un
problema de sync son **`outbox`** (¿qué hay sin subir?) y **`meta`** (¿está vinculado? ¿qué epoch tiene?).

Si aparecen **dos bases**, la segunda es la demo. Es también la comprobación de un vistazo de que el
aislamiento funciona: probar la demo no debe tocar ni una fila de `finhub-finanzas`, y su `outbox` tiene
que quedarse siempre vacío.

En tests, `fake-indexeddb/auto` desde `src/test/setup.ts` y `clearAllData()` en `beforeEach`.
→ [[testing]]

Related: [[db]] · [[migraciones-idb]] · [[postgres-schema]] · [[login]]

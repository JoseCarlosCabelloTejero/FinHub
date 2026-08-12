---
tags: [type/reference]
up: "[[00-index]]"
---

# Glosario

Vocabulario del proyecto. Buena parte solo vivía en comentarios del código.

## Dominio

- **Movimiento** (`Movement`) — un ingreso o un gasto: importe, fecha, categoría, subcategoría
  opcional, concepto y notas. → [[movimientos]]
- **Categoría / subcategoría** (`Category`, `Subcategory`) — el árbol de clasificación. En el cliente
  las subcategorías van **embebidas** dentro de la categoría; en Postgres son **filas propias**.
  → [[categorias]] · [[007-subcategorias-normalizadas-en-servidor]]
- **Archivar** — marcar `archived: true`. Sustituye al borrado para no huérfanar movimientos
  antiguos. Los selects muestran las activas *más* la que ya tuviera el movimiento en edición.
- **Periodo** — mes o año, según `prefs.periodMode`. → [[periodos]]
- **Semana 1-5** — semana *por día natural del mes*, no de calendario: 1-7 → 1, 8-14 → 2 … 29-31 → 5.
  La comparten el gráfico y la tabla semanal a propósito.
- **Recuperados** — categoría archivada que `repairDanglingRefs` crea (una por tipo) para adoptar
  movimientos cuya categoría ya no existe, y que así las FK de Postgres los acepten. → [[sync]]

## Patrimonio

> ⚠️ Vocabulario de un **diseño propuesto**, todavía sin implementar. → [[patrimonio]]

- **Cuenta** — un contenedor de dinero: corriente, broker, hipoteca, tarjeta. Declara si es **activo o
  pasivo** (de ahí el signo, que nunca se teclea), si es **de inversión** y si es **líquida**. Como las
  categorías, **se archiva, nunca se borra**.
- **Cierre** — el saldo de *una cuenta* en *un mes* (`YYYY-MM`). Es la foto manual que manda sobre los
  movimientos. **Ojo: no es lo mismo que un *snapshot*** (ver Sincronización, más abajo), que en este
  proyecto significa el estado completo del servidor.
- **Aportado** — dinero propio que entró en una cuenta ese mes. Solo se pregunta en cuentas de inversión,
  porque es lo único que permite separar el ahorro de la rentabilidad. En un pasivo significaría el
  principal amortizado.
- **Descuadre** — ahorro real (según los cierres) − ahorro contable (según los movimientos). **No es un
  error**: es la medida de lo que no registraste, y con un préstamo nunca da cero.
- **Disponible** — la suma de las cuentas marcadas como líquidas, con su signo: suma la corriente, resta
  la tarjeta, ignora el broker y la hipoteca.

## Sincronización

- **Outbox** — store de IndexedDB con las escrituras pendientes de subir. Clave autoincremental
  *fuera de línea*: **el orden de las claves ES el orden causal**. → [[003-outbox-en-indexeddb]]
- **Op** (`OutboxOp`) — una escritura pendiente: tabla, `upsert`/`delete`, id, payload ya en formato
  de fila (snake_case) y `updatedAt`.
- **Sello / stamp** — el `updatedAt` que se asigna a una escritura. Siempre **monótono por
  dispositivo**: al menos 1 ms por encima del último emitido, para que un reloj atrasado no bloquee
  las escrituras contra el trigger LWW. → `monotonicStamp` en [[sync]]
- **LWW** (*last-write-wins*) — la resolución de conflictos: el servidor descarta cualquier `UPDATE`
  cuyo `updated_at` no sea **estrictamente** mayor que el guardado. El empate se descarta, y eso es
  justo lo que hace idempotente el reintento. → [[002-lww-con-updated-at-text]]
- **Lápida / tombstone** — fila en `movement_tombstones` que registra un movimiento borrado. Impide
  que un dispositivo que estaba offline lo **resucite** con un upsert tardío. Server-only.
- **Wipe epoch** — contador por usuario que sube en cada "Borrar todo". Un dispositivo con epoch
  antiguo tira su cola en vez de repoblar lo que se acaba de vaciar. → [[borrado-total]]
- **Vinculación / first sync** — la primera sincronización de un dispositivo: decide entre subir todo
  lo local (servidor virgen) o mezclarse con lo remoto. Se marca con `meta.migratedAt`. → [[first-sync]]
- **Snapshot** — el estado completo del servidor (movimientos + categorías + subcategorías) ya
  traducido al modelo del cliente.
- **`lastPullKey`** — huella del último snapshot recibido. Si el servidor devuelve exactamente lo
  mismo, no se reescribe IndexedDB ni se repinta la pantalla. → [[pull]]
- **Semilla de época** (`EPOCH_UPDATED_AT = '1970-01-01T00:00:00.000Z'`) — el `updatedAt` con que
  nacen las categorías por defecto. Todos los dispositivos generan los mismos IDs, así que este sello
  antiquísimo garantiza que el LWW descarte una semilla y nunca pise una categoría que ya renombraste.

## Estados del sync (`SyncStatus`)

| Estado | Significado | Qué ve el usuario |
|---|---|---|
| `idle` | Al día, o con cola a punto de subir | "Sincronizado" / "N cambios pendientes" |
| `syncing` | Sincronizando ahora | "Sincronizando…" |
| `offline` | Sin red | "Sin conexión" |
| `error` | El último ciclo falló; se reintenta solo | "Sin sincronizar" |
| `auth-required` | Sin sesión válida | "Sesión caducada" |

El copy exacto vive en `src/syncCopy.ts`; los tres últimos son los que `needsAttention()` marca con
un tono más oscuro. → [[design-system]]

## Infraestructura

- **`meta`** — store de IndexedDB con un único registro (`SyncMeta`) de bookkeeping local: `userId`,
  `dataUserId`, `migratedAt`, `lastSyncAt`, `wipeEpoch`, `lastStampAt`. → [[indexeddb-stores]]
- **`dataUserId`** vs **`userId`** — `userId` es el usuario actual; `dataUserId` es **de quién son los
  datos cacheados**. Sin distinguirlos, cambiar de cuenta en el mismo navegador mezclaría dos
  históricos. → [[login]]
- **RLS** — *Row Level Security* de Postgres: cada política filtra por `auth.uid() = user_id`.
  → [[postgres-schema]]
- **Server-only** — tabla sin grants para `authenticated` y sin políticas: solo la tocan los triggers
  `SECURITY DEFINER` y el RPC de wipe. Es el caso de `movement_tombstones`.

Related: [[architecture-overview]] · [[sync-model]]

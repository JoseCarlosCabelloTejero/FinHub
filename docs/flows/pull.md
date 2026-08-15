---
tags: [type/flow, domain/sync, area/cliente]
up: "[[00-index]]"
---

# Flujo: pull y ciclo de sincronización

Cómo baja el estado del servidor a la pantalla, y cuándo.

**Fuente de verdad**: `runSync` / `pullAndApply` / `fetchSnapshot` / `initSync` en `src/sync.ts`

## El ciclo completo (`runSync`)

```mermaid
flowchart TD
    Start["syncNow()"] --> Lock{"¿ya hay uno en vuelo?"}
    Lock -->|sí| Rerun["marca rerun y espera"]
    Lock -->|no| Web["withLock — web lock entre pestañas"]
    Web --> Net{"¿navigator.onLine?"}
    Net -->|no| Off["status: offline · fin"]
    Net -->|sí| Uid{"¿resolveUserId()?"}
    Uid -->|null| Auth["status: auth-required · fin"]
    Uid -->|userId| Adopt["adoptUser — ¿la caché es de otro?"]
    Adopt --> FP["fetchFingerprint()<br/>digest + wipe_epoch, 1 petición"]
    FP --> Epoch["adoptWipeEpoch — ¿alguien borró todo?"]
    Epoch --> First{"¿migratedAt?"}
    First -->|no| FS["firstSync(digest)"]
    First -->|sí| Push
    FS --> Push["pushOutbox()"]
    Push -->|abortado| Err["status: error · SIN pull"]
    Push --> Queue{"¿queda cola?"}
    Queue -->|sí| Idle["status: idle · sin pull"]
    Queue -->|no| Skip{"canSkipPull?<br/>misma huella y nada subido"}
    Skip -->|sí| Done
    Skip -->|no| Pull["pullAndApply(digest)"]
    Pull --> Done["lastSyncAt + status: idle"]
```

**El ciclo en reposo se queda en `fetchFingerprint`**: una petición pequeña en vez de las seis de
antes (el RPC del epoch más las cinco tablas). → [[011-huella-de-sincronizacion]]

**El orden no es negociable**, y cada paso está donde está por un motivo:

- **`adoptWipeEpoch` antes del push** — si otro dispositivo hizo "Borrar todo", pushear la cola
  repoblaría lo que se acaba de vaciar. → [[borrado-total]]
- **`firstSync` antes del push** — hasta que el dispositivo no se ha vinculado, su cola no basta para
  dejar el servidor coherente: las categorías por defecto se siembran en local y **nunca pasan por la
  cola**, así que un movimiento suyo se estrellaría contra la FK. → [[first-sync]]
- **Pull solo con la cola vacía** — aplicar el snapshot con escrituras sin subir dejaría la pantalla
  mostrando la versión vieja de algo que el usuario acaba de escribir. → [[sync-model]]

## `pullAndApply`

```mermaid
sequenceDiagram
    participant S as sync.ts
    participant PG as Postgres
    participant DB as IndexedDB
    participant A as App.tsx

    S->>PG: select de las 5 tablas en paralelo, con lista explícita de columnas
    PG-->>S: filas (sin user_id: no se pide)
    S->>S: key = JSON de las filas
    alt key === lastPullKey
        Note over S: nada ha cambiado → no se toca IndexedDB ni se repinta
    else
        S->>S: assembleCategories(catRows, subRows) — reensambla lo embebido
        S->>DB: replaceLocalData(pending → applyPullToLocal(snapshot, pending))
        S->>S: lastPullKey = key
        S->>A: onRemoteChange() → reload()
    end
```

Cuatro detalles:

- **`lastPullKey`** evita repintar los gráficos y remontar la tabla cuando el snapshot descargado
  resulta idéntico. Es la segunda red: la primera, la huella, evita que se descargue siquiera.
- **El pull es completo**, no incremental: se traen las cinco tablas enteras, aunque solo con las
  columnas que la app usa. Con este volumen es lo más simple y correcto, y la huella se lleva por
  delante el caso frecuente. → [[sync-model]] · [[011-huella-de-sincronizacion]]
- **`assembleCategories`** traduce las tablas normalizadas a la forma embebida que espera el resto de la
  app. Las subcategorías sin categoría padre se caen solas (no deberían existir: hay FK con
  `ON DELETE CASCADE`, pero reensamblar es el sitio barato de no fiarse).
- **`applyPullToLocal`** reproduce encima las ops pendientes, así una escritura reciente sobrevive a la
  sustitución de la caché.

## Los cinco disparadores (`initSync`)

| Disparador | Cuándo | Por qué |
|---|---|---|
| Arranque | Al montar `Finances` | Traer lo que haya pasado desde la última vez |
| `online` | Vuelve la red | Subir la cola cuanto antes |
| `visibilitychange` | Se vuelve a la pestaña | **El momento que de verdad importa**: "abro el móvil y veo lo del portátil" |
| Sondeo cada **60 s** | Solo si la pestaña está **visible** | En segundo plano gastaría batería para nada |
| Debounce de **800 ms** | Tras cada escritura | Agrupa varias escrituras en un ciclo |

Los tres primeros son justo los que antes salían caros: cada uno se bajaba las cinco tablas enteras.
Con la huella, un disparador sobre un servidor que no ha cambiado cuesta **una petición pequeña**, que
es lo que hace que el sondeo de cada minuto deje de ser un problema en el móvil.

`initSync` devuelve la función de parada, que quita los listeners y limpia el intervalo. También hay un
listener de `offline` que solo fija el estado.

**Sin Realtime a propósito** → [[004-sin-realtime]].

## Exclusión mutua: dos capas

1. **De módulo** (`inFlight` + `rerun`) — evita que los cinco disparadores se pisen entre sí. Las
   llamadas concurrentes se funden en una ejecución más un repaso.
2. **Web lock** (`navigator.locks`, nombre `finhub-sync`) — evita lo mismo **entre pestañas** del mismo
   navegador, que comparten IndexedDB pero no variables de módulo. jsdom no trae `navigator.locks`, de
   ahí la comprobación en vez de darlo por hecho.

## Estado que ve el usuario al arrancar

`initSync` hace dos lecturas antes del primer ciclo:

- `readOutbox()` → `pendingOps`, para que el chip diga la verdad desde el primer render.
- `getSyncMeta()` → `lastSyncAt`, porque el estado en memoria arranca a `null`: sin esto, al recargar la
  página la UI diría "todo al día" sin fecha hasta terminar el primer sync (y sin red, nunca).

Related: [[sync]] · [[sync-model]] · [[first-sync]] · [[escritura-local]] · [[borrado-total]] · [[011-huella-de-sincronizacion]]

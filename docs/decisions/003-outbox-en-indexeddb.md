---
tags: [type/decision, domain/sync, area/cliente]
up: "[[00-index]]"
---

# ADR 003 — Outbox en IndexedDB: local primero, subida después

**Estado**: aceptada

## Contexto

Al migrar a Supabase había dos caminos posibles para las escrituras:

- **Servidor primero**: escribir en Postgres y refrescar desde ahí. Simple, pero **cada acción del
  usuario depende de la red**: sin conexión la app deja de funcionar, y con conexión mala cada guardado
  tarda.
- **Local primero + cola**: escribir en IndexedDB, encolar la subida y sincronizar en background.

La app ya funcionaba offline y ese comportamiento no se quería perder.

## Decisión

**Local primero, con una cola persistente** (`outbox`) en IndexedDB:

1. La UI llama a las funciones `*Synced` de [[sync]], que **escriben en IndexedDB y encolan la op**.
2. La op lleva el payload **ya en formato de fila del servidor** (snake_case).
3. Un ciclo aparte sube la cola **en orden** cuando hay red.
4. Una op **solo sale de la cola tras la confirmación del servidor**.

El store `outbox` tiene la **clave autoincremental fuera de línea**: el `seq` **es** la clave, no un campo
del valor. **El orden de las claves es el orden causal de las escrituras.**

## Por qué el orden importa tanto

Postgres tiene FK de verdad: una subcategoría exige que su categoría exista, y un movimiento exige las
dos. Si el push no respetara el orden en que ocurrieron las escrituras, una op podría llegar antes que su
dependencia y ser rechazada con un `23503` — que el push trata como **irrecuperable** y descarta. Se
perderían datos reales.

De ahí también `prependOps` en la vinculación: las ops del snapshot inicial tienen que ir **delante** de
lo que ya hubiera encolado. → [[first-sync]]

## Consecuencias

- **La red no aparece en el camino del usuario.** Guardar es instantáneo, con o sin conexión.
- La cola **sobrevive a recargas y cierres**: está en IndexedDB, no en memoria.
- **Todas las ops tienen que ser idempotentes** (upsert por id, delete por id), porque una que falle a
  mitad se reintenta. Los IDs los genera el cliente, así que repetir no duplica.
- Hay que **mostrar la cola al usuario**: de ahí `pendingOps` y el indicador de sync. Un dato "guardado"
  que aún no está arriba es un estado real que hay que comunicar. → [[design-system]]
- Adelantar ops obliga a **reescribir la cola entera** (leer, vaciar, reencolar), porque las claves son
  autoincrementales. Aceptable: pasa una vez por dispositivo.
- **Solo se hace pull con la cola vacía**, y lo pendiente se reproduce encima de cualquier snapshot
  (`applyPullToLocal`), o el pull borraría de la pantalla algo recién escrito. → [[sync-model]]
- Coste asumido: `pushOutbox` sube las ops **de una en una**, en serie. Con una cola larga (la primera
  vinculación) son muchas peticiones. Se eligió a cambio de que un corte a mitad no obligue a rehacerlo
  todo.

## Relacionadas

[[001-local-first-a-supabase]] · [[002-lww-con-updated-at-text]] · [[escritura-local]] · [[indexeddb-stores]]

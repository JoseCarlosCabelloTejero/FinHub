---
tags: [type/decision, domain/sync, area/cliente]
up: "[[00-index]]"
---

# ADR 004 — Sin Realtime: sondeo + `visibilitychange`

**Estado**: aceptada

## Contexto

Supabase ofrece **Realtime** (websocket sobre la replicación de Postgres) para recibir cambios al
instante. La alternativa es preguntar cada cierto tiempo.

La pregunta correcta no era "¿qué es más moderno?" sino **"¿cuál es el momento en que de verdad importa
ver los datos actualizados?"**. Y es este: *abro el móvil y quiero ver lo que apunté en el portátil*.

## Decisión

**Sin Realtime.** El pull se dispara con cinco eventos:

| Disparador | Cuándo |
|---|---|
| Arranque | Al montar la app |
| `online` | Vuelve la red |
| **`visibilitychange`** | Se vuelve a la pestaña ← **el que cubre el caso real** |
| Sondeo de **60 s** | Solo con la pestaña **visible** |
| Debounce de **800 ms** | Tras cada escritura |

`visibilitychange` cubre el caso importante con **latencia percibida cero**: cuando vuelves a la pestaña,
sincroniza antes de que mires. El sondeo solo cubre el caso de "tengo la app abierta y delante mientras el
otro dispositivo escribe", que en una app personal es raro.

## Por qué no Realtime

- Un websocket añade **reconexión, backoff y refresco de token** que hay que mantener.
- Habría que **publicar las tablas** en la publicación de Realtime y razonar sobre RLS en los eventos.
- Y todo eso **a cambio de unos segundos** que esta app no necesita.

## Consecuencias

- **La latencia máxima con la app abierta y visible es de 60 s**; al volver a la pestaña, inmediata.
- **El sondeo no corre en segundo plano** a propósito: gastaría batería para nada, porque al volver a la
  pestaña el propio `visibilitychange` ya sincroniza.
- Cada pull se trae **las tres tablas completas**, así que hace falta `lastPullKey` para no repintar la
  pantalla cuando el servidor devuelve exactamente lo mismo. Con Realtime llegarían deltas y esto no
  haría falta. → [[pull]]
- Si el volumen creciera mucho, el orden de las mejoras sería: **primero pull incremental** (índice
  `movements (user_id, updated_at)`), y solo después plantearse Realtime.

## Relacionadas

[[001-local-first-a-supabase]] · [[pull]] · [[sync]] · [[sync-model]]

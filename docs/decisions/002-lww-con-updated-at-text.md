---
tags: [type/decision, domain/sync, area/servidor]
up: "[[00-index]]"
---

# ADR 002 — LWW con `updated_at` como `text collate "C"`

**Estado**: aceptada

## Contexto

Con dos dispositivos escribiendo sobre las mismas filas hace falta una regla de conflicto. Con **un solo
usuario y volumen de escritura bajo**, *last-write-wins* es suficiente: no hay dos personas editando lo
mismo a la vez, solo el mismo dueño desde dos sitios.

Para que LWW funcione hay que comparar timestamps **en el cliente y en el servidor**, y que las dos
comparaciones den siempre el mismo resultado.

## Decisión

1. **Los timestamps se guardan como `text`, nunca `timestamptz`** — en el formato exacto de
   `Date.prototype.toISOString()` (`YYYY-MM-DDTHH:mm:ss.sssZ`: ancho fijo, siempre UTC, milisegundos a 3
   dígitos), con un `check` de formato por columna.
2. **`collate "C"`** en esas columnas, para que `<=` sea comparación de bytes pura e independiente del
   `lc_collate` de la base.
3. **El descarte lo hace el servidor**, en un trigger `BEFORE UPDATE` que devuelve `NULL` si
   `new.updated_at <= old.updated_at`.
4. **Empate = descarte** (`<=`, no `<`).
5. `iso_now()` produce "ahora" en ese mismo formato, para que un timestamp escrito por el servidor (las
   lápidas) sea comparable con los del cliente.

## Por qué no `timestamptz`

Sería lo "correcto" en un esquema normal, pero **rompería la equivalencia**: Postgres lo reformatearía al
devolverlo (`2026-08-08 12:00:00+00`), y en el cliente comparar strings dejaría de ser comparar fechas.
Habría que parsear en los dos lados y confiar en que el redondeo de microsegundos coincide. Guardando
texto hay **round-trip byte a byte**.

## Consecuencias

- En el cliente, comparar sellos es `a <= b` sobre strings. Simple y sin sorpresas.
- **El empate descartado es lo que hace idempotente el reintento del outbox**: una op que se reenvía tras
  un fallo de red llega con el mismo `updated_at`, se descarta, y el estado final es idéntico.
- Obliga a que **el sello nunca retroceda en un dispositivo**: si el reloj se atrasa (cambio de hora,
  NTP), todo lo que escribas se descartaría en silencio. De ahí `monotonicStamp` y `meta.lastStampAt`.
  → [[sync-model]]
- No se pueden usar funciones de fecha de Postgres sobre esas columnas sin un cast. Hoy no hace falta: no
  hay agregaciones en el servidor, todo se calcula en el cliente.
- El trigger devuelve `NULL` en vez de `OLD` para **no reescribir la fila**: nada de tupla muerta ni de
  evento inútil en el WAL.

## Relacionadas

[[001-local-first-a-supabase]] · [[003-outbox-en-indexeddb]] · [[postgres-schema]] · [[sync-model]]

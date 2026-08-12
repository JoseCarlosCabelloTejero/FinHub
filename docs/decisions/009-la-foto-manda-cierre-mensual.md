---
tags: [type/decision, domain/patrimonio, domain/sync, area/servidor, area/cliente]
up: "[[00-index]]"
---

# ADR 009 — La foto manda: cierre mensual por cuenta, sin lápidas

**Estado**: aceptada

## Contexto

El dominio patrimonio añade la dimensión de **saldo** a una app que solo registraba flujos
→ [[patrimonio]]. Toda la entrada de datos es manual, y esa restricción decide el modelo entero: un
saldo **derivado** (inicial + movimientos) exige registrar el 100 % de los movimientos para no mentir
para siempre, y eso no se mantiene tres meses.

Al llevarlo al esquema había que decidir además el **grano del conflicto** (¿el mes entero o cada
cuenta?) y la **política de borrado** (¿lápidas como los movimientos, o algo más simple?).

## Decisión

1. **La foto manda.** Cada mes se escribe el saldo real de cada cuenta (un **cierre**); los movimientos
   *explican* el cambio, no lo definen. La diferencia entre ambas fuentes es una funcionalidad (el
   "sin clasificar"), no un error.
2. **El grano del conflicto es `(cuenta, mes)`**, materializado en un **id determinista**
   `${accountId}:${month}`: dos dispositivos que cierren la misma cuenta el mismo mes convergen a la
   **misma fila** y el LWW por fila resuelve solo. El check `id = account_id || ':' || month` en
   Postgres blinda el invariante sin depender del cliente. Es el precedente de las subcategorías,
   reutilizado → [[007-subcategorias-normalizadas-en-servidor]]
3. **Un cierre se edita o se vacía; no se borra.** Vaciar = upsert con `balance: null` ("mes no
   revisado"). Las cuentas **se archivan, nunca se borran** → [[005-categorias-se-archivan]]. El
   cliente no emite `delete` para ninguna de las dos tablas y el servidor ni lo concede.

## Consecuencias

- **Este dominio no necesita lápidas** ni trigger anti-resurrección: sin borrados no hay nada que
  resucitar. Es una simplificación deliberada — queda escrita para que nadie la deshaga sin darse
  cuenta de que reabre todo el problema de las lápidas.
- `balance` es **`number | null` no opcional** en el cliente: el `null` es un estado real, no una
  ausencia. Siempre `>= 0` cuando no es null — el signo lo pone la naturaleza de la cuenta, nunca el
  dato (mismo invariante que `Movement`).
- `contributed` **no lleva check de signo**: una retirada del broker es un aportado negativo. En un
  pasivo significa "principal amortizado".
- La PK `(user_id, id)` con el id determinista hace de unique natural sobre `(cuenta, mes)`: no hace
  falta índice único aparte.
- En la cola, **la cuenta va delante de sus cierres** (FK), y delante de los movimientos: cuando la
  fase 4 escriba `movements.account_id`, el orden de `snapshotToOps` ya lo garantiza.
- En `mergeWithServer`, un cierre **se sube siempre** (a diferencia de movimientos y cuentas, cuyos
  uuid no chocan): su id determinista puede coincidir de verdad con una fila remota — misma fila
  lógica — y ahí debe decidir el LWW del servidor, no el cliente.
- `wipe_all_data()` barre también `account_closings` y `accounts`, **sin resiembra**: el dominio no
  tiene datos por defecto → [[borrado-total]]
- Coste asumido: no hay historial de "quién vació un cierre" ni undo. Con un único usuario y edición
  siempre posible hacia atrás, no compensa una tabla de lápidas propia.

## Relacionadas

[[patrimonio]] · [[sync-model]] · [[postgres-schema]] · [[002-lww-con-updated-at-text]] · [[003-outbox-en-indexeddb]]

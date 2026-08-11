---
tags: [type/decision, domain/sync]
up: "[[00-index]]"
---

# ADR 001 — De local-first puro a Supabase

**Estado**: aceptada · las seis fases implementadas; el deploy, en [[008-deploy-en-vercel]]

## Contexto

La app nació con una premisa explícita: **sin backend, sin cuentas y sin red**. Todo vivía en IndexedDB
del navegador, y cualquier propuesta que implicara servidor rompía el proyecto por definición.

El problema práctico apareció al querer usarla desde **el móvil y el portátil**: con IndexedDB por
navegador, cada dispositivo tenía su propio histórico y no había forma de reconciliarlos.

## Decisión

Romper la premisa **a propósito y de forma documentada**: Supabase (Postgres + Auth) pasa a ser la
**fuente de verdad**, e IndexedDB se queda como **caché local y cola offline**.

Se descartó explícitamente:

- **Exportar/importar JSON a mano** — resuelve el traslado, no el uso simultáneo; y se olvida.
- **Un backend propio** — coste de mantenimiento absurdo para una app de una persona.
- **CRDTs / Yjs** — la potencia no la necesita un solo usuario con volumen de escritura bajo; LWW basta.

## Consecuencias

**A favor:**

- Mismos datos en todos los dispositivos, y respaldados fuera del navegador (antes, limpiar los datos
  del navegador borraba todo el histórico).
- La app sigue funcionando **sin conexión**, porque se escribe siempre primero en local.

**En contra, asumido:**

- **Login obligatorio**: en un navegador donde nunca has entrado, sin red la app **no** se puede usar.
  → [[login]]
- Hace falta un proyecto de Supabase y sus variables de entorno para arrancar en desarrollo: si faltan,
  pantalla en blanco. → [[supabase-auth]]
- Complejidad real añadida: outbox, sellos monótonos, LWW, lápidas, epoch de borrado y el flujo de
  vinculación. Es el precio, y está concentrado en `sync.ts` + el esquema. → [[sync-model]]
- La privacidad cambia de forma: los datos ya no están solo en tu máquina. No hay telemetría ni terceros
  más allá de Supabase.

## Relacionadas

Todas las demás decisiones son consecuencia de esta: [[002-lww-con-updated-at-text]] ·
[[003-outbox-en-indexeddb]] · [[004-sin-realtime]] · [[006-un-solo-usuario]] ·
[[007-subcategorias-normalizadas-en-servidor]]

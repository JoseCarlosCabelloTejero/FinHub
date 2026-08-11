---
tags: [type/moc]
up: "[[00-index]]"
---

# FinHub — Vault de conocimiento

Contexto único del proyecto **FinHub** (finanzas personales, un solo usuario). Lee la nota relevante
**antes** de planificar un cambio o de responder a una pregunta de arquitectura: sale mucho más
barato que grepear `src/` entero y el esquema SQL.

> Las notas resumen y enlazan al código, que es la autoridad. Cuando una nota y el código
> discrepen, **gana el código** → se arregla la nota. Todo lo de aquí se verificó contra el
> código el 2026-08-11.

## 🗺️ Empieza aquí

- [[architecture-overview]] — el sistema entero en un diagrama + cómo encajan las capas.
- [[glossary]] — vocabulario del proyecto (sello monótono, lápida, wipe epoch, vinculación…).
- [[sync-model]] — el modelo de sincronización y sus invariantes. **Léelo antes de tocar `sync.ts`.**

## 🧱 Módulos (un fichero o grupo de `src/` por nota)

- [[db]] — `src/db.ts`, única capa de acceso a IndexedDB.
- [[sync]] — `src/sync.ts`, el motor de sync (outbox, push, pull, LWW). El módulo más grande.
- [[supabase-auth]] — `src/supabase.ts` + `src/Login.tsx` + **la configuración manual del dashboard**.
- [[calculations]] — `src/calculations.ts`, toda la lógica derivada, pura y testeada.
- [[ui-app]] — `src/App.tsx`, el shell y todas las pantallas.
- [[charts]] — `src/Charts.tsx`, recharts en carga diferida.
- [[design-system]] — tokens de `src/styles.css` + `src/theme.ts` y las reglas de accesibilidad.

## 🧩 Dominios (el modelo, sin implementación)

- [[movimientos]] — la entidad central: ingreso o gasto.
- [[categorias]] — categorías y subcategorías. **Nunca se borran, se archivan.**
- [[periodos]] — mes/año y las semanas 1-5 por día natural.
- [[preferencias]] — lo único que no se sincroniza, y por qué.
- [[sync-model]] — outbox, LWW, lápidas, epoch de borrado.

## 🔀 Flujos (diagramas de secuencia)

- [[escritura-local]] — guardar un movimiento: local primero, red después.
- [[first-sync]] — vinculación de un dispositivo nuevo (el flujo más delicado del proyecto).
- [[pull]] — bajar el estado del servidor y sus cinco disparadores.
- [[borrado-total]] — "Borrar todo", la única operación que exige conexión.
- [[login]] — arranque, sesión, modo offline y cambio de usuario.
- [[migraciones-idb]] — versiones de IndexedDB y la copia desde la marca anterior.

## 📚 Referencia

- [[postgres-schema]] — tablas, triggers, RLS, grants y RPCs de Supabase.
- [[indexeddb-stores]] — stores, claves e índices de la base local.
- [[testing]] — qué cubre cada fichero de test y qué no se puede testear.
- [[comandos-y-entorno]] — scripts, variables de entorno, Supabase local, trampas del repo.
- [[qa-playbook]] — lo que solo se valida a mano en el navegador.

## 🧭 Decisiones de arquitectura (ADR)

- [[001-local-first-a-supabase]] — la ruptura consciente de la premisa original.
- [[002-lww-con-updated-at-text]] — timestamps como `text collate "C"`, no `timestamptz`.
- [[003-outbox-en-indexeddb]] — escribir local primero; la clave autoincremental es el orden causal.
- [[004-sin-realtime]] — sondeo + `visibilitychange` en vez de websocket.
- [[005-categorias-se-archivan]] — sin política DELETE en RLS.
- [[006-un-solo-usuario]] — tres capas cierran el acceso.
- [[007-subcategorias-normalizadas-en-servidor]] — embebidas en cliente, filas en Postgres.

## Cómo está organizado el grafo

Cada nota lleva `tags` en el frontmatter:

- `type/*` — `moc`, `module`, `domain`, `flow`, `reference`, `decision`.
- `domain/*` — `movimientos`, `categorias`, `periodos`, `sync`, `auth`, `ui`, `datos`.
- `area/*` — `cliente` (navegador) o `servidor` (Postgres/Supabase).

Abre la vista de grafo en Obsidian y colorea por tag para ver los grupos. Para abrir el vault:
*Open folder as vault* → elige `docs/`.

## Mantenimiento

Cuando un cambio altere la arquitectura, un patrón o el esquema, actualiza la nota afectada en el
mismo PR. Una nota desactualizada es peor que no tenerla: se lee como verdad. Si detectas una
discrepancia y no puedes arreglarla, márcala en la nota con `> ⚠️ pendiente de verificar`.

# Prompt: planificar sync entre dispositivos con Supabase

Prompt para pegar en una sesión nueva de Claude Code (`/plan`) cuando se quiera abordar
la migración de persistencia de IndexedDB local a Supabase, con sync entre dispositivos.

No implementa nada por sí mismo: pide explícitamente un plan por fases antes de tocar código.

```
Quiero planificar (NO implementar todavía, usa /plan) la migración de persistencia de este
proyecto de IndexedDB local a Supabase, con sync entre dispositivos. Lee primero CLAUDE.md
completo antes de proponer nada.

CONTEXTO
- App actual: local-first, sin backend, sin cuentas, sin red — todo en IndexedDB
  (ver CLAUDE.md, sección Arquitectura). Esta migración ROMPE esa premisa a propósito;
  ya lo he decidido, no hace falta que me lo cuestiones, pero sí que el plan lo documente
  como cambio consciente de arquitectura.
- Modelo de datos actual: src/types.ts (Movement, Category con subcategorías embebidas,
  Preferences). Los movimientos referencian categoryId/subcategoryId como strings SIN
  integridad referencial (es intencionado hoy, por el archivado de categorías).
- Capa de acceso actual: src/db.ts, con idb, dbPromise singleton, bootstrapData() y
  clearAllData().

OBJETIVO
Que un mismo usuario pueda ver y editar sus movimientos/categorías/preferencias desde
varios dispositivos, sin perder la posibilidad de seguir usando la app sin conexión.

DECISIONES DE ARQUITECTURA QUE QUIERO QUE EL PLAN PROPONGA Y JUSTIFIQUE (no las asumas
sin explicarlas):
1. Estrategia de sync: propongo IndexedDB como caché/cola local + Supabase (Postgres)
   como fuente de verdad, sync en background vía Supabase Realtime o polling — evalúa
   cuál encaja mejor con el patrón actual de reload() en App.tsx antes de decidir.
2. Resolución de conflictos: propongo last-write-wins con columna updated_at (volumen
   de escritura bajo, un solo usuario). Dime si ves un caso real donde esto falla para
   este dominio.
3. Autenticación: quiero el mínimo fricción posible (magic link o similar) ya que es
   una app personal, no multiusuario. Evalúa qué ofrece Supabase Auth para esto.
4. Migración de datos existentes: los usuarios (yo) ya tenemos movimientos en IndexedDB.
   El plan tiene que incluir cómo se suben esos datos a Supabase la primera vez sin
   duplicarlos si el sync se ejecuta más de una vez.
5. Esquema Postgres: diseña las tablas a partir de src/types.ts, respetando el patrón
   de categorías archivadas (archived: true, nunca DELETE) y el hecho de que
   categoryId/subcategoryId hoy no tienen integridad referencial — decide si en Postgres
   sí quieres foreign keys (probablemente sí, es la ventaja de moverse a relacional) y
   qué implica eso para movimientos con categoría ya archivada o borrada.

RESTRICCIONES A RESPETAR (de CLAUDE.md)
- Estado centralizado en App.tsx sin store/context: mantén el patrón, adapta reload()
  en vez de introducir Redux/Zustand/etc.
- Estilo de código denso del repo, comentarios solo donde el "por qué" no sea obvio.
- Español en todo lo visible al usuario (copy, errores), inglés en identificadores/tipos.
- Accesibilidad ya establecida (focus-visible único, aria-live, aria-label, .sr-only):
  no la rompas al añadir estados de loading/sync/error.
- Sin Co-Authored-By en commits. Conventional commits, en español si el resto del
  historial lo está.

QUÉ QUIERO COMO RESULTADO DE ESTA SESIÓN DE PLANIFICACIÓN
- Un plan por fases (esquema Supabase → auth → capa de sync → UI de estado de sync/
  conflicto → migración de datos existentes → tests), cada fase como algo que pueda
  commitear por separado.
- Qué archivos nuevos y cuáles existentes toca cada fase.
- Qué tests hacen falta en src/calculations.test.ts o nuevos ficheros para la lógica
  de sync, y qué solo se puede validar con QA manual (Playwright / /qa).
- Una propuesta de cómo actualizar CLAUDE.md una vez implementado, ya que la sección
  de Arquitectura queda desactualizada en cuanto esto se merge.

No implementes nada todavía. Quiero revisar el plan y decidir fase a fase.
```

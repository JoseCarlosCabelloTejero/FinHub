---
tags: [type/decision, domain/categorias]
up: "[[00-index]]"
---

# ADR 005 — Las categorías se archivan, nunca se borran

**Estado**: aceptada · **anterior a la migración**, y la migración la respetó

## Contexto

Un movimiento de hace dos años apunta a una categoría que hoy ya no usas. Si se pudiera borrar la
categoría, pasaría una de dos cosas: o se borran los movimientos con ella (**pierdes histórico real**), o
quedan apuntando a nada (**y el resumen del pasado deja de cuadrar**).

## Decisión

Las categorías y subcategorías **no se borran**: se marcan `archived: true`. Y esa regla se llevó hasta el
servidor: **no hay política `DELETE`** para `categories` ni `subcategories` en la RLS. Ni siquiera con un
cliente manipulado se puede borrar una.

## Consecuencias

Reglas que hay que respetar en **cualquier UI nueva** de categorías:

- Los selects muestran **solo las activas más la que ya tuviera el movimiento en edición**:
  `!c.archived || c.id === form.categoryId`. Si no, editar un movimiento antiguo perdería su categoría.
- Al resolver el nombre de una categoría se cae a **`'Sin categoría'`**.
- Las filas archivadas siguen apareciendo en la vista Semanal (con la clase `archived`) si tienen gasto:
  el pie de la tabla tiene que cuadrar con el KPI de gastos.
- El botón alterna **"Archivar" / "Activar"**: es reversible, y por eso no pide confirmación.

Y en el modelo:

- Los movimientos guardan `categoryId`/`subcategoryId` como **strings sin integridad referencial en el
  cliente**. Eso es lo que hace inocuo el archivado, y es intencionado.
- En Postgres **sí** hay FK, así que un movimiento con referencia colgante (por una edición manual, o por
  datos de antes de esta regla) sería rechazado. De ahí `repairDanglingRefs` y la categoría `Recuperados`.
  → [[sync]]
- Las subcategorías que **desaparecen** de un documento de categoría se ignoran al hacer diff: la UI no
  puede quitarlas, y el servidor no concede `DELETE`.
- El único borrado real es **"Borrar todo"** (`wipe_all_data()`), que corre como owner y no pasa por RLS.
  → [[borrado-total]]

## Nota sobre los IDs

Relacionado pero distinto: los IDs de las categorías por defecto son **slugs deterministas** derivados del
nombre. Renombrar en `src/data.ts` cambia el ID y huérfana datos existentes, aunque no se haya borrado
nada. Renombra **desde la UI**, que conserva el ID. → [[categorias]]

## Relacionadas

[[categorias]] · [[movimientos]] · [[postgres-schema]] · [[007-subcategorias-normalizadas-en-servidor]]

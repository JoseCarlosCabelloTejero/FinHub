---
tags: [type/decision, domain/categorias, domain/sync, area/servidor]
up: "[[00-index]]"
---

# ADR 007 — Subcategorías: embebidas en el cliente, filas en Postgres

**Estado**: aceptada

## Contexto

En el cliente, una `Category` lleva sus subcategorías **dentro** (`subcategories: Subcategory[]`). Es la
forma que espera toda la app: la UI edita el árbol entero y `calculations.ts` lo recorre así.

Al llevarlo a Postgres había que elegir la granularidad. Con el árbol embebido en una columna `jsonb`, la
unidad de conflicto sería **el documento completo**, y eso rompe un caso perfectamente normal:

> Renombro la subcategoría "Gasolina" en el portátil. En el móvil, archivo "Multas" — otra subcategoría de
> la misma categoría. Con LWW sobre el documento entero, **uno de los dos cambios desaparece**.

## Decisión

**Normalizar en el servidor** y traducir en los bordes:

- Tabla `subcategories` con su propia PK `(user_id, id)`, su FK compuesta a `categories` y **su propio
  `updated_at`**: cada subcategoría gana o pierde el LWW por separado.
- **En el cliente siguen embebidas**. La traducción vive en `sync.ts` y solo ahí:
  - Al subir → **`diffCategoryDoc`** compara contra lo guardado y encola **solo las filas que cambiaron**.
  - Al bajar → **`assembleCategories`** reensambla el documento embebido.

## Consecuencias

- **Los dos cambios del ejemplo sobreviven.** Es la razón de ser de la decisión.
- El diff tiene que devolver **también el documento sellado** (`{ doc, ops }`): IndexedDB y el servidor
  deben guardar **el mismo `updatedAt`**, o el LWW compararía contra un valor que no tiene nadie.
- Las filas **sin cambios conservan su sello anterior**, para no ganar por antigüedad falsa.
- **El orden dentro de la cola importa**: la op de la categoría va **delante** de sus subcategorías, porque
  en una categoría recién creada la FK exige que el padre exista. → [[003-outbox-en-indexeddb]]
- `applyPullToLocal` tiene que manejar el caso de **una subcategoría pendiente cuya categoría padre no
  está en el snapshot**: se omite, y el próximo pull la traerá ya subida.
- Una subcategoría que desaparece del documento **se ignora**: la UI archiva y nunca borra, y el servidor
  no concede `DELETE` sobre `subcategories`. → [[005-categorias-se-archivan]]
- La FK de `subcategories` **incluye `user_id`**, para impedir colgar una subcategoría de la categoría de
  otro usuario aunque los ids coincidan — y con los slugs por defecto **coinciden**.
- Coste: la traducción bidireccional es código extra, y es la parte de `sync.ts` con más tests
  (`diffCategoryDoc` y `assembleCategories` tienen bloque propio). Justificado: sin ella se perderían
  cambios de forma silenciosa.

## Relacionadas

[[categorias]] · [[sync]] · [[sync-model]] · [[postgres-schema]] · [[002-lww-con-updated-at-text]]

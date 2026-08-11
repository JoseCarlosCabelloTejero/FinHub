---
tags: [type/domain, domain/categorias]
up: "[[00-index]]"
---

# Dominio: categorías y subcategorías

El árbol con el que se clasifican los [[movimientos]]. Dos niveles: categoría (de ingreso o de gasto) y
subcategorías dentro.

**Fuente de verdad**: `src/types.ts` · `src/data.ts` · tablas `categories`/`subcategories` en [[postgres-schema]]

## Modelo

```ts
interface Category {
  id: string; name: string;
  type: 'income' | 'expense';
  order: number; archived: boolean;
  updatedAt: string;
  subcategories: Subcategory[];   // embebidas en el cliente
}
interface Subcategory { id: string; name: string; archived: boolean; order: number; updatedAt: string }
```

**Embebidas en el cliente, filas propias en Postgres.** Cada subcategoría tiene su `updatedAt` y gana o
pierde el LWW por separado, así que renombrar dos subcategorías distintas en dos dispositivos ya no
colisiona. El pull las reensambla con `assembleCategories`.
→ [[007-subcategorias-normalizadas-en-servidor]]

## 🚫 Nunca se borran: se archivan

`archived: true` en vez de `DELETE`. Los movimientos guardan `categoryId`/`subcategoryId` como strings
sin integridad referencial, así que **archivar es lo que preserva el histórico**. En el servidor no hay
ni política `DELETE` para categorías. → [[005-categorias-se-archivan]]

Consecuencias que hay que respetar en cualquier UI nueva:

- Los selects muestran **solo las activas más la que ya tuviera el movimiento en edición**:
  `!c.archived || c.id === form.categoryId`. Si no, editar un movimiento antiguo perdería su categoría.
- Al resolver el nombre se cae a **`'Sin categoría'`**.
- Las filas archivadas se siguen viendo en la vista Semanal (con la clase `archived`) si tienen gasto.

## IDs estables: el aviso importante

`src/data.ts` genera el árbol por defecto desde `expenseGroups` con un `slug()`:

```
'Coche' + 'Gasolina' → 'expense-coche-gasolina'
```

Los IDs son **deterministas**, y eso tiene dos consecuencias:

- ✅ Todos los dispositivos generan los mismos IDs para las categorías por defecto, así que el árbol
  sembrado en un móvil nuevo **no duplica** el del portátil.
- ⚠️ **Cambiar un nombre en `expenseGroups` cambia el ID y huérfana los datos existentes**, porque los
  movimientos antiguos siguen apuntando al ID viejo. Si hay que renombrar una categoría por defecto,
  hazlo **desde la UI** (que conserva el ID) o asume una migración de datos.

Lo creado a mano usa `crypto.randomUUID()`.

## `EPOCH_UPDATED_AT`: las semillas nunca ganan

Las categorías por defecto nacen con `updatedAt = '1970-01-01T00:00:00.000Z'`. Como todos los
dispositivos generan los mismos IDs, un móvil recién estrenado sembraría su árbol y lo subiría; con ese
sello antiquísimo **el trigger LWW del servidor lo descarta** y nunca puede pisar una categoría que ya
hubieras renombrado. El mismo valor se usa para rellenar las categorías que ya existían en IndexedDB
antes de la v3. → [[migraciones-idb]]

En `mergeWithServer` sirve además para distinguir **"semilla intacta"** (se descarta) de **"esto lo he
tocado yo"** (se sube). → [[first-sync]]

## Operaciones (pantalla Categorías)

| Acción | Qué cambia |
|---|---|
| Crear | `crypto.randomUUID()`, `order` = nº de categorías de su tipo |
| Renombrar | Solo `name` (con `prompt()`); el ID se conserva |
| Archivar / activar | Alterna `archived`, en categoría o subcategoría |
| Reordenar | `order ± 1`, con suelo en 0 |
| Añadir subcategoría | Nueva con `order` = longitud actual |

Toda mutación pasa por `saveCategorySynced`, que **solo encola las filas que cambiaron**
(`diffCategoryDoc`). Ojo: `order ± 1` puede dejar **órdenes repetidos**; el orden final lo decide el
`sort` de la UI, que es estable pero no garantiza una secuencia sin huecos. Es una limitación conocida
y sin impacto visible.

Related: [[movimientos]] · [[sync]] · [[postgres-schema]] · [[005-categorias-se-archivan]]

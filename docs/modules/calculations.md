---
tags: [type/module, domain/periodos, area/cliente]
up: "[[00-index]]"
---

# Módulo: calculations

Toda la lógica derivada: **funciones puras, sin React y sin IndexedDB**. Es donde va la lógica nueva y
donde viven los tests.

**Fuente de verdad**: `src/calculations.ts` · tests en `src/calculations.test.ts`

## Formateadores

- `money` — `Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })`.
- `percent` — porcentaje con 2 decimales. Recibe una **fracción**, así que en la UI se pasa
  `valor / 100`.

Se importan también desde [[charts]]; no dupliques formateadores nuevos por ahí.

## Periodo

| Función | Qué devuelve |
|---|---|
| `periodBounds(date, mode)` | `{ start, end }` del mes o del año |
| `filterPeriod(items, date, mode)` | Los movimientos dentro del periodo |
| `summary(items)` | `{ income, expenses, savings, rate }` — `rate` es 0 si no hay ingresos (**nunca dividir entre cero**) |
| `weekOfMonth(date)` | Semana 1-5 **por día natural** |
| `weeksInMonth(date)` | Columnas reales del mes: 4 en un febrero de 28 días, 5 en el resto |
| `trendData(items, date, mode)` | Serie para el gráfico: 5 semanas o 12 meses |

`weekOfMonth` y `weeksInMonth` las comparten `trendData()` y `weeklyBreakdown()` **a propósito**: si
divergieran, el gráfico y la tabla contarían el mismo gasto en semanas distintas. → [[periodos]]

## `weeklyBreakdown(items, categories, date)`

El cruce gasto × semana de la vista Semanal. `items` **debe venir ya filtrado al mes**. Devuelve
`{ weeks, groups, weekTotals, total, income, percent }`, con `groups` = categorías de gasto y, dentro,
filas de subcategoría.

La regla que sostiene la vista: **el pie de la tabla tiene que cuadrar con el KPI de gastos**. De ahí
dos casos que no se pueden quitar:

- Los movimientos sin subcategoría (o con una que ya no existe) se agrupan en una fila
  **"Sin subcategoría"**, o el total de la categoría no cuadraría con la suma de sus filas.
- Los movimientos con `categoryId` que no resuelve se agrupan en **"Sin categoría"** al final, en vez
  de desaparecer.

Los porcentajes son sobre los **ingresos del mes** y valen `null` si no hay ingresos.

## `categoryData` y `topCategories`

`categoryData` suma el gasto por categoría, descarta los ceros y ordena de mayor a menor. Cada fila es
`{ categoryId, name, value }` — el `categoryId` viaja hasta el donut para poder colorear por identidad
de categoría en vez de por posición en el ranking (ver más abajo). `topCategories(data, limit = 6)`
recorta la cola agrupándola en **"Otros"**, y **conserva el total**; la fila `'Otros'` no es una
categoría real, así que lleva el `categoryId` sentinel `OTROS_ID` (`theme.ts`) en vez del de una
categoría.

El límite no es arbitrario: la rampa del donut solo distingue bien 6 tonos, y por eso [[ui-app]] pasa
`CATEGORY_LIMIT = theme.ramp.length`. Si añades colores a la rampa, el límite se ajusta solo.
`categoryColor(categoryId)` (`theme.ts`) deriva el color con un hash determinista del id: misma
categoría, mismo color siempre, sin importar su puesto en el gasto del mes. Con más de 6 categorías con
gasto en el mismo periodo, dos pueden coincidir en color — límite matemático de 6 tonos para más
categorías, no un bug. → [[design-system]]

## Al añadir lógica aquí

1. Que siga siendo **pura**: entra data, sale data. Nada de IndexedDB, red o React.
2. **Test en `calculations.test.ts`**, con nombre de caso en español.
3. Si es un cálculo que la UI ya hace inline (por ejemplo el filtrado de la tabla de movimientos, que
   hoy vive en `App.tsx`), traerlo aquí es una mejora, no un cambio de alcance gratuito.

Related: [[periodos]] · [[charts]] · [[ui-app]] · [[testing]]

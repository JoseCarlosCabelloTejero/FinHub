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

## Patrimonio: cuentas y cierres

Un cierre vive en un **mes** (`'YYYY-MM'`), no en una fecha. Nada de este bloque pasa por `filterPeriod`
ni por `periodBounds`, que trabajan con días: los helpers de mes son propios. Confundir las dos cosas es
el riesgo 4 de [[patrimonio]] → [[periodos]]

| Función | Qué devuelve |
|---|---|
| `currentMonth()` | El mes en curso como `'2026-08'` |
| `shiftMonth(month, delta)` | El mes desplazado; el salto de año lo resuelve `date-fns` (`2026-01` → `2025-12`) |
| `previousMonth(month)` | `shiftMonth(month, -1)` |
| `monthLabel(month)` | `'marzo 2026'` para la UI |
| `closingId(accountId, month)` | El id determinista `` `${accountId}:${month}` `` |
| `latestClosings(closings, before?)` | Un cierre por cuenta: el del mes más alto **con saldo**. Con `before`, solo meses estrictamente anteriores |
| `netWorth(accounts, closings)` | Σ activos − Σ pasivos |
| `available(accounts, closings)` | El "disponible mañana": solo cuentas líquidas, con su signo |
| `monthCompleteness(accounts, closings, month)` | `{ reviewed, total }` |
| `parseAmount(raw)` | El importe tecleado, o `null` si el campo está vacío |

Cuatro reglas que sostienen estas funciones:

- **El signo lo pone la naturaleza de la cuenta**, nunca quien teclea. Un saldo es siempre positivo y un
  pasivo se resta al agregarse. Así un pasivo tecleado en negativo —que dispararía el patrimonio— es
  imposible por diseño, sin una sola validación.
- **`balance: null` es "no revisado", y eso no es un saldo de 0.** `latestClosings` salta esos meses (cae
  al último que sí se revisó) y `netWorth` los cuenta como 0 en vez de arrastrar el mes anterior: un mes
  incompleto se ve incompleto.
- **`parseAmount('')` es `null`, no 0.** `Number('') === 0`, y ese cero acabaría en la serie histórica
  como un saldo real cada vez que te saltas una cuenta en el ritual. Es la trampa con test propio.
- **Quién entra lo decide el caller.** `netWorth` no filtra archivadas: el nivel actual le pasa solo las
  activas, y la serie histórica (pendiente) tendrá que incluirlas. Σ activos y Σ pasivos no necesitan
  función: son `netWorth` con la lista ya filtrada por `nature`.

`available` merece una nota: **`isLiquid` hace dos trabajos con un solo interruptor**, porque suma la
corriente y resta la tarjeta (líquida y pasivo a la vez) ignorando el broker y la hipoteca. No hace falta
un segundo atributo de "exigible a corto plazo".

## Al añadir lógica aquí

1. Que siga siendo **pura**: entra data, sale data. Nada de IndexedDB, red o React.
2. **Test en `calculations.test.ts`**, con nombre de caso en español.
3. Si es un cálculo que la UI ya hace inline (por ejemplo el filtrado de la tabla de movimientos, que
   hoy vive en `App.tsx`), traerlo aquí es una mejora, no un cambio de alcance gratuito.

Related: [[periodos]] · [[charts]] · [[ui-app]] · [[patrimonio]] · [[testing]]

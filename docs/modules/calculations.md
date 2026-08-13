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
| `closingsByMonth(closings)` | `Map<mes, Closing[]>` en un solo recorrido |
| `netWorthSeries(accounts, closings)` | La serie del gráfico: `{ month, name, value }` por mes, con `value: null` en los meses sin cierre |
| `monthDelta(accounts, closings, month)` | `{ delta, realSavings, returns, complete }`, o `null` si no hay nada que comparar |
| `investmentReturns(accounts, closings, month)` | Lo que puso el mercado en cada cuenta de inversión |
| `unclassified(accounts, closings, movements, month)` | El descuadre del mes y sus piezas, o `null` si `monthDelta` no tiene con qué comparar |
| `monthsWithoutClosing(closings, from)` | Los meses sin cierre desde `from` hacia atrás, ascendentes; `[]` si no hay histórico |

Cinco reglas que sostienen estas funciones:

- **El signo lo pone la naturaleza de la cuenta**, nunca quien teclea. Un saldo es siempre positivo y un
  pasivo se resta al agregarse. Así un pasivo tecleado en negativo —que dispararía el patrimonio— es
  imposible por diseño, sin una sola validación.
- **`balance: null` es "no revisado", y eso no es un saldo de 0.** `latestClosings` salta esos meses (cae
  al último que sí se revisó) y `netWorth` los cuenta como 0 en vez de arrastrar el mes anterior: un mes
  incompleto se ve incompleto.
- **`parseAmount('')` es `null`, no 0.** `Number('') === 0`, y ese cero acabaría en la serie histórica
  como un saldo real cada vez que te saltas una cuenta en el ritual. Es la trampa con test propio.
- **Quién entra lo decide el caller.** `netWorth` no filtra archivadas: el nivel actual le pasa solo las
  activas, y **`netWorthSeries` las quiere todas** —si no, los meses viejos perderían las cuentas que
  entonces existían y la línea daría un escalón el día que archivas una—. Σ activos y Σ pasivos no
  necesitan función: son `netWorth` con la lista ya filtrada por `nature`.
- **La identidad Δ = ahorro + rentabilidad se cumple por construcción**, no por cuidado: `realSavings` y
  `returns` son el mismo sumatorio `Σ (fin − inicio) · signo` partido en dos, según de quién fuera el
  dinero. Por eso el reparto no puede descuadrar, y por eso `monthDelta` e `investmentReturns` comparten
  la misma lista de cuentas comparables (`monthPairs`).

`available` merece una nota: **`isLiquid` hace dos trabajos con un solo interruptor**, porque suma la
corriente y resta la tarjeta (líquida y pasivo a la vez) ignorando el broker y la hipoteca. No hace falta
un segundo atributo de "exigible a corto plazo".

### La serie y el Δ: tres decisiones que no son estéticas

- **Los meses sin cierre entran como `value: null`.** Emitiendo solo los meses que existen, recharts
  uniría los extremos e **inventaría una rentabilidad que nadie ganó**; el hueco es el dato. De ahí que
  el gráfico vaya sin `connectNulls` → [[charts]]. Un mes entero vaciado (todos los saldos a `null`) es
  "sin cierre", no un patrimonio de 0. La serie va del primer al último mes **con** cierre: no se dibuja
  eje vacío por el mes en curso todavía sin cerrar.
- **`monthDelta` compara contra el mes ANTERIOR, nunca contra "el último disponible".** Comparar agosto
  con mayo llamaría rentabilidad a tres meses de ahorro. Ojo: la pista en gris del ritual **sí** usa el
  último conocido (`latestClosings(closings, month)`) — son dos semánticas distintas a propósito.
- **`complete: false` cuando una cuenta tiene saldo en exactamente uno de los dos meses.** Se queda fuera
  del reparto y hay que decirlo. La que no tiene saldo en **ninguno** de los dos (archivada hace años, o
  creada después) no participa ni ensucia el resultado: medir eso de otra forma exigiría saber cuándo
  nació y cuándo murió cada cuenta, y ese dato no existe en el modelo.

Un mes revisado a medias sí entra en la serie con lo que se revisó (`netWorth` cuenta como 0 la cuenta sin
cierre, regla de arriba). La señal de "faltan cuentas" la da el Δ, que puede calcularla sin inventarse
nada. La rentabilidad se devuelve **en euros y jamás en porcentaje** — el motivo está en la sección 5 de
[[patrimonio]].

### `unclassified`: el descuadre

```
sin clasificar = ahorro real − ahorro contable − principal amortizado de los pasivos
```

Es la primera medida de si los movimientos están completos: hasta ahora, olvidarse de 300 € de gastos
hacía que `summary()` dijera que ahorraste 300 € de más y **nada lo contradecía**. Es la funcionalidad del
módulo, no un bug → [[patrimonio]] §7

Tres decisiones que no son obvias:

- **El ahorro real se toma de `monthDelta().realSavings`, no se recalcula.** Dos cálculos paralelos de la
  misma variación acabarían divergiendo y romperían la identidad Δ = ahorro + rentabilidad. Misma razón
  por la que `monthDelta` e `investmentReturns` comparten `monthPairs`.
- **El ahorro contable es `summary(filterPeriod(movements, `${month}-01`, 'month')).savings`**, y es la
  **única unión permitida entre el mundo mes y el mundo fecha** de todo el bloque. Los movimientos viven en
  días; el cierre, en meses.
- **El aportado de un pasivo resta del lado contable, no suma al real.** En un pasivo "aportado" significa
  *principal amortizado*, y la variación del saldo ya lo cuenta: sumarlo al ahorro real lo contaría dos
  veces. Lo que corrige es el lado contable, donde la cuota entera se registró como gasto cuando una parte
  era ahorro. Con el ejemplo de la sección 6 de [[patrimonio]]: **+300 sin teclearlo, 0 con él**, y esos
  300 son exactamente el principal de la hipoteca. Sale de las mismas cuentas comparables que el Δ —no de
  filtrar los cierres del mes—, porque una cuenta que no entra en el ahorro real tampoco puede corregirlo,
  y las de inversión quedan fuera (ahí `realSavings` **ya es** el aportado).

Devuelve las piezas (`realSavings`, `accountingSavings`, `liabilityContributed`) además del total, porque
la UI explica la cifra en vez de soltarla → [[ui-app]]. Y `null`, no 0, cuando no hay mes anterior.

`monthsWithoutClosing` alimenta el aviso: camina hacia atrás desde `from` y para en el último mes cerrado.
Devuelve `[]` sin ningún cierre con saldo —sin histórico no hay racha de la que avisar, y de paso es lo que
acota el bucle—, y en orden ascendente, para que el `[0]` sea el más antiguo pendiente. Los huecos
*anteriores* al último mes cerrado no salen aquí: esos ya los enseña la serie del gráfico.

## Al añadir lógica aquí

1. Que siga siendo **pura**: entra data, sale data. Nada de IndexedDB, red o React.
2. **Test en `calculations.test.ts`**, con nombre de caso en español.
3. Si es un cálculo que la UI ya hace inline (por ejemplo el filtrado de la tabla de movimientos, que
   hoy vive en `App.tsx`), traerlo aquí es una mejora, no un cambio de alcance gratuito.

Related: [[periodos]] · [[charts]] · [[ui-app]] · [[patrimonio]] · [[testing]]

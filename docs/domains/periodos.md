---
tags: [type/domain, domain/periodos]
up: "[[00-index]]"
---

# Dominio: periodos y semanas

Todo lo que se ve en pantalla está acotado a un **periodo**: un mes o un año. Lo define
`prefs` (`periodMode` + `selectedDate`) → [[preferencias]].

**Fuente de verdad**: `src/calculations.ts` · `PeriodBar` y `Weekly` en `src/App.tsx`

## Mes o año

- `periodBounds(date, mode)` devuelve `startOfMonth/endOfMonth` o `startOfYear/endOfYear` (date-fns).
- `filterPeriod()` filtra con `isWithinInterval`, **ambos extremos incluidos**.
- La `PeriodBar` mueve `selectedDate` de mes en mes o de año en año según el modo.
- Los títulos se formatean en español con el locale `es` de date-fns.

## Las semanas 1-5 son por día natural

**No son semanas de calendario.** Se calculan sobre el día del mes:

| Días | Semana |
|---|---|
| 1-7 | 1 |
| 8-14 | 2 |
| 15-21 | 3 |
| 22-28 | 4 |
| 29-31 | 5 |

```ts
weekOfMonth = Math.min(Math.ceil(día / 7), 5)
```

- Es una decisión de producto: "la primera semana del mes" en un presupuesto personal significa "los
  primeros siete días", no "la semana ISO que cruza el mes anterior".
- `weeksInMonth()` devuelve las columnas que el mes **realmente** tiene: **4** en un febrero de 28 días,
  **5** en el resto (incluido febrero bisiesto).
- ⚠️ **`weekOfMonth` y `weeksInMonth` las comparten `trendData()` y `weeklyBreakdown()` a propósito.** Si
  divergieran, el gráfico y la tabla contarían el mismo gasto en semanas distintas. Cualquier vista
  nueva por semanas debe reutilizarlas, no reimplementarlas.

## La vista Semanal ignora `periodMode`

`Weekly` siempre filtra **por mes**, pase lo que pase con `prefs.periodMode`: navegar ahí no debe cambiar
el modo que verá el Resumen. Lo que sí se comparte es `selectedDate`, de modo que cambiar de mes en una
vista te deja en el mismo mes en la otra. Por eso `PeriodBar` acepta `modes={false}`, que oculta el
selector Mes/Año y mueve las flechas siempre de mes en mes.

## Porcentajes

En la vista Semanal, los `%` son **sobre los ingresos del mes**, no sobre el gasto total. Si no hay
ingresos registrados valen `null` y se pintan como guion: **nunca dividir entre cero**. La misma regla
está en `summary().rate`, que devuelve 0 sin ingresos.

## Tendencia

`trendData()` produce 5 puntos (`S1`…`S5`) en modo mes y 12 (`ene`…`dic`) en modo año, siempre con todos
los puntos aunque estén a cero, para que el eje no salte entre periodos.

Related: [[calculations]] · [[preferencias]] · [[movimientos]] · [[charts]]

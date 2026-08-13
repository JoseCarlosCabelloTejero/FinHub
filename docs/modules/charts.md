---
tags: [type/module, domain/ui, area/cliente]
up: "[[00-index]]"
---

# Módulo: Charts

Solo presentación, con [recharts](https://recharts.org). Cuatro gráficos: `TrendChart` (líneas),
`ExpenseChart` (donut por categoría), `WeeklyChart` (barras) y `NetWorthChart` (la evolución del
patrimonio).

**Fuente de verdad**: `src/Charts.tsx` · datos desde [[calculations]] · colores desde [[design-system]]

## Carga diferida

Se importa con `lazy()` desde [[ui-app]] para **mantener recharts fuera del bundle inicial**; el
`Suspense` que lo envuelve (con el fallback "Dibujando gráficos…") es intencionado. Hay **dos**
consumidores —`Summary` en `App.tsx` y `Level` en `Patrimonio.tsx`—, cada uno con su `lazy()` y su
`Suspense`, pero todos apuntando a este fichero: por eso `NetWorthChart` vive aquí y no en uno propio,
que sería un chunk más. Si añades un quinto gráfico, misma regla.

## Por qué los colores entran por props

**Recharts no puede leer `var()` del CSS**: recibe los colores como props de JS. De ahí que exista
`src/theme.ts` como copia de los tokens de `:root`. Cambiar un color implica tocar **los dos
ficheros**. → [[design-system]]

## Decisiones de layout que ya costaron una iteración

- **La altura vive en CSS** (`.chart-box`), no en la prop `height`, para poder bajarla en móvil y en
  landscape sin duplicar aquí los breakpoints.
- **Eje Y compacto** (`"1,8 mil €"`, `width: 46`): con los 60 px por defecto recharts se comía casi el
  20 % del ancho en un móvil de 320 px.
- **Radios del donut en %** (`innerRadius="55%"`, `outerRadius="80%"`) y leyenda sin `height` fija: en px
  el donut no encogía y los 6 nombres de categoría se salían de la caja al envolver en pantallas
  estrechas.
- El tooltip formatea con `money` de [[calculations]]: los importes se ven igual en el gráfico y en las
  tablas.

## `NetWorthChart`: el hueco es el dato

Los meses sin cierre llegan con `value: null` desde `netWorthSeries()`, y este gráfico va **sin
`connectNulls`** a propósito: uniendo los extremos, recharts dibujaría una subida suave donde no hubo
medición e **inventaría una rentabilidad que nadie ganó**. La línea se corta, y eso es información.

De ahí también que sea el único con **`dot`** (los demás van con `dot={false}`): un mes aislado entre dos
huecos no dibuja segmento, así que sin punto no se vería nada. Y sin `<Legend>`, porque hay una sola
serie. → [[patrimonio]]

## Colores

- `TrendChart` y `WeeklyChart` usan `theme.income` (verde) y `theme.expense` (rojo) — reservados a
  ingreso/gasto— y `theme.text` para la línea de ahorro.
- `NetWorthChart` va en `theme.text`: el patrimonio es **nivel, no flujo**, y el verde/rojo del dominio
  se reserva para el Δ, que sí lo es → [[design-system]]
- `ExpenseChart` usa `categoryColor(d.categoryId)` (no un índice de posición): cada `<Cell>` recibe el
  color de **su categoría**, así que se mantiene igual aunque cambie el ranking de gasto de un mes a
  otro. La rampa sigue siendo los mismos 6 tonos atenuados (azul, naranja, cian, violeta, rosa,
  mostaza — sin verde ni rojo); `'Otros'` siempre sale en `theme.muted`, nunca en un tono de la rampa.
  El `stroke: theme.surface` separa los segmentos entre sí; el `<Legend>` y el `<Tooltip>` con el
  nombre de cada categoría son el canal de apoyo para los tonos que no llegan a 3:1 de contraste sobre
  blanco. → [[design-system]]

Related: [[design-system]] · [[calculations]] · [[ui-app]]

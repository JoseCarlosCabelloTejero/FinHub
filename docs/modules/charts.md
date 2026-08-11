---
tags: [type/module, domain/ui, area/cliente]
up: "[[00-index]]"
---

# Módulo: Charts

Solo presentación, con [recharts](https://recharts.org). Tres gráficos: `TrendChart` (líneas),
`ExpenseChart` (donut por categoría) y `WeeklyChart` (barras).

**Fuente de verdad**: `src/Charts.tsx` · datos desde [[calculations]] · colores desde [[design-system]]

## Carga diferida

Se importa con `lazy()` desde [[ui-app]] para **mantener recharts fuera del bundle inicial**; el
`Suspense` que lo envuelve (con el fallback "Dibujando gráficos…") es intencionado. Si algún día
añades un cuarto gráfico, hazlo aquí dentro: sacarlo a otro fichero significaría un chunk más.

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

## Colores

- `TrendChart` y `WeeklyChart` usan `theme.income` (verde) y `theme.expense` (rojo) — reservados a
  ingreso/gasto— y `theme.text` para la línea de ahorro.
- `ExpenseChart` usa `theme.ramp[i % ramp.length]`: la rampa de 6 grises. El `stroke: theme.surface`
  separa los segmentos entre sí.

Related: [[design-system]] · [[calculations]] · [[ui-app]]

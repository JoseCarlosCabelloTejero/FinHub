---
tags: [type/module, domain/ui, area/cliente]
up: "[[00-index]]"
---

# Módulo: sistema de diseño

Tema claro minimalista: blancos, negros y grises. **Verde y rojo se reservan exclusivamente para
ingreso y gasto.**

**Fuente de verdad**: `src/styles.css` (`:root`) · `src/theme.ts` · copy de sync en `src/syncCopy.ts`

## ⚠️ Los tokens están duplicados a propósito

`:root` en `src/styles.css` **y** el objeto `theme` en `src/theme.ts`. Recharts recibe los colores como
props y no puede leer `var()`, de ahí la copia en JS.

**Al tocar un color hay que cambiar los dos ficheros.** No hay nada que lo compruebe
automáticamente.

## Tokens

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#fafafa` | Fondo de página |
| `--surface` | `#ffffff` | Cards, sidebar, modal, tabla |
| `--surface-2` | `#f5f5f5` | Pistas de segmented/type-picker, tags |
| `--line` | `#e5e5e5` | Bordes y divisores decorativos |
| `--line-strong` | `#d4d4d4` | Bordes decorativos que necesitan verse |
| `--line-control` | `#8d8d8d` | Bordes de inputs y controles (≥3:1, WCAG 1.4.11) |
| `--text` | `#0a0a0a` | Titulares e importes |
| `--text-2` | `#404040` | Texto de tabla |
| `--muted` | `#737373` | Labels y texto secundario (4.7:1 sobre blanco) |
| `--accent` / `--accent-fg` | `#0a0a0a` / `#ffffff` | Botón primario, nav activo, foco |
| `--income` | `#16794f` | Ingreso (5.4:1 sobre blanco) |
| `--expense` | `#b3261e` | Gasto (6.5:1 sobre blanco) |
| `--danger-bg` / `--danger-line` | `#fef6f5` / `#f3d4d1` | Zona de peligro |

Los contrastes están anotados en el CSS: si cambias un color, **recalcula el ratio** antes de darlo por
bueno.

## Semántica de color

- **Verde = ingreso, rojo = gasto. Nada más.** Un estado de error del sync no se pinta de rojo: usa un
  tono más oscuro de la escala de grises (`needsAttention()` en `syncCopy.ts`).
- Fuera de ingreso/gasto, el resto de la UI es la escala de grises. **Excepción única: la rampa del
  donut de categorías** (siguiente punto), que es la única superficie con color categórico —
  precisamente para no competir con el verde/rojo semántico en ningún otro sitio.
- **La rampa del donut** (`theme.ramp`) tiene 6 tonos atenuados de familias de color distintas (azul,
  naranja, cian, violeta, rosa, mostaza — ninguno verde ni rojo, para no chocar con
  ingreso/gasto), en un orden fijo que valida separación CVD par a par (incluido el par que cierra el
  círculo, último ↔ primero). No son grises: más allá de 6 tonos deja de ser distinguible con
  garantías, de ahí que `CATEGORY_LIMIT = theme.ramp.length` y que `topCategories()` agrupe la cola en
  "Otros". **Si añades colores a la rampa, el límite se ajusta solo — pero hay que re-validar el
  nuevo orden (separación CVD, contraste) antes de fijarlo.** → [[calculations]]
- **El color es por identidad de categoría, no por ranking de gasto.** `categoryColor(categoryId)`
  (`theme.ts`) deriva el tono con un hash determinista del `id` de la categoría: la misma categoría
  siempre sale con el mismo color, sea cual sea su puesto en el gasto del mes. `'Otros'` (agregado de
  la cola, no una categoría real) usa el sentinel `OTROS_ID` y siempre lleva `theme.muted`, para no
  competir por un tono de identidad. Con más de 6 categorías con gasto en el mismo periodo, dos pueden
  coincidir en color — límite matemático de tener solo 6 tonos, no un bug.
- **El nivel va en gris; el flujo, en verde y rojo.** Es el enunciado completo de la regla, extendido
  al dominio del patrimonio → [[patrimonio]]:
  - **Nivel** (el saldo: patrimonio neto, disponible, Σ activos, Σ pasivos, el saldo de cada cuenta y la
    línea del gráfico de evolución) → `tone="neutral"` / `theme.text`, **aunque el neto sea negativo**.
    Un pasivo no es un gasto, y pintarlo de rojo diría que gastaste lo que solo debes.
  - **Flujo** (ingreso, gasto, y la **variación Δ del patrimonio**) → `--income` / `--expense`. El Δ
    tiene la misma semántica de "mejora" y "empeora" que un ingreso o un gasto, así que usa su color.
    Un Δ de exactamente 0 va en gris: no es ni mejora ni empeora.
  - Esto **extiende** el enunciado de "verde = ingreso, rojo = gasto", no lo rompe: la frontera nunca fue
    ingreso/gasto contra el resto, sino **flujo contra nivel**. Lo que sigue prohibido es pintar de rojo
    algo que no es flujo (un error de sync, un pasivo, un descuadre).
- **El "sin clasificar" de F3 va en gris**, aunque sea una diferencia entre dos flujos: es un aviso, no
  una mejora ni un empeoramiento, y un número que te riñe en rojo todos los meses es un módulo que se
  abandona → [[patrimonio]]
- El color y el icono son **siempre redundancia**: el texto ya lleva el significado completo (regla que
  se ve explícita en `syncCopy.ts`).

## Accesibilidad establecida — no romper

- **Un único indicador de foco** en toda la app: `:focus-visible` con `outline`. Está marcado en el CSS
  como "no eliminar".
- **Región `aria-live="polite"`** única para los avisos, en `App.tsx`. `SyncNote` deliberadamente **no**
  lleva `role="alert"`: dos regiones vivas compitiendo se pisan los anuncios.
- **`aria-label` en los botones-icono** (editar, eliminar, subir, bajar, cerrar, periodo anterior…).
- **`.sr-only`** para cabeceras de columna de acciones y para el `<caption>` de la tabla semanal.
- Modales con `role="dialog"`, `aria-modal`, `aria-labelledby` y cierre por `Escape`. → [[ui-app]]
- Los iconos decorativos dentro de un elemento que ya tiene texto van con `aria-hidden="true"`
  (ver `SyncIcon`).

## Detalles de CSS que resuelven bugs concretos

- `html { -webkit-text-size-adjust: 100% }` — evita que iOS infle el texto al girar a landscape.
- `body { min-height: 100dvh }` — `dvh` sigue la barra de direcciones de iOS; `vh` no y corta contenido.
- `min-width: 320px` — el ancho mínimo real que se soporta.
- Breakpoint de **760 px**: por debajo desaparece el aside y aparece el nav inferior. Es la razón de que
  el chip de sync viva también en la cabecera.

## Copy de estados (`syncCopy.ts`)

Módulo aparte y sin React, como [[calculations]]: lo usan tanto los componentes del indicador como el
aviso por `aria-live`, y así se testea sin renderizar nada. El orden de los `if` va **de más urgente a
menos**: no tener red ni sesión manda sobre "hay cola", porque cambia lo que el usuario puede hacer.
La tabla de estados está en [[glossary]].

Related: [[ui-app]] · [[charts]] · [[glossary]]

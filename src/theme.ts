// Tokens de diseño para consumidores JS: recharts recibe los colores como props,
// no puede leer var() del CSS. Mantener en sync con :root en src/styles.css.
export const theme = {
  bg: '#fafafa',       // fondo de página
  surface: '#ffffff',  // fondo de la card .chart — es sobre esto que se dibuja
  line: '#e5e5e5',
  text: '#0a0a0a',
  muted: '#737373',
  income: '#16794f',
  expense: '#b3261e',
  // Rampa del donut, del mayor al menor gasto. 6 escalones bien separados:
  // en monocromo, más de 6 deja de ser distinguible — de ahí el corte con "Otros".
  ramp: ['#171717', '#404040', '#666666', '#8c8c8c', '#b3b3b3', '#d9d9d9'],
} as const;

export const CATEGORY_LIMIT = theme.ramp.length;

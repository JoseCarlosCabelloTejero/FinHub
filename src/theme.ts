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
  // Rampa del donut. 6 tonos atenuados de familias de color distintas (no grises): el
  // orden es fijo y valida separación CVD par a par, incluido el par que cierra el
  // círculo (último ↔ primero) — no reordenar sueltamente.
  ramp: ['#5f8fd0', '#d9824f', '#1f9dae', '#7a68c9', '#d1688f', '#d1a23e'],
} as const;

export const CATEGORY_LIMIT = theme.ramp.length;

// Sentinel para la fila "Otros" que agrega la cola en topCategories(): no es una
// categoría real, así que no compite por un tono de identidad (ver categoryColor).
export const OTROS_ID = 'otros';

// Color por identidad de categoría, no por posición en el ranking de gasto: mismo id,
// mismo color siempre (en cualquier dispositivo, sin persistir nada), tanto para las
// categorías por defecto (slug determinista) como para las creadas a mano (uuid).
// Con más de 6 categorías activas a la vez es matemáticamente inevitable que dos
// coincidan en color — la misma limitación que ya tenía la rampa de 6 tonos.
export function categoryColor(categoryId: string): string {
  if (categoryId === OTROS_ID) return theme.muted;
  let hash = 5381;
  for (let i = 0; i < categoryId.length; i++) hash = (hash * 33) ^ categoryId.charCodeAt(i);
  return theme.ramp[Math.abs(hash) % theme.ramp.length];
}

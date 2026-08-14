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
  // Rampa del donut. 5 tonos, una familia de color cada uno (azul, naranja tostado,
  // violeta profundo, mostaza, cian) y ninguno verde ni rojo, que están reservados a
  // ingreso/gasto. Son 5 y no más porque un donut enseña todas sus porciones a la vez:
  // el test que aplica es el de TODOS los pares, no solo el de los adyacentes, y con 6
  // tonos no lo pasa ninguna paleta. Validada —con el gris de "Otros" dentro, que también
  // es una porción— a ΔE 12,1 bajo daltonismo y 16,4 en visión normal (suelos 6 y 15).
  // Lo que la hace funcionar es que los pares de familia cercana se separan por
  // LUMINOSIDAD y no por tono: violeta profundo contra cian brillante, naranja tostado
  // contra mostaza. No reordenar ni ampliar sin volver a medir.
  ramp: ['#2a78d6', '#9a3412', '#5b21b6', '#d1a23e', '#06b6d4'],
} as const;

export const CATEGORY_LIMIT = theme.ramp.length;

// Sentinel para la fila "Otros" que agrega la cola en topCategories(): no es una
// categoría real, así que no compite por un tono de identidad (ver categoryColor).
export const OTROS_ID = 'otros';

const slot = (categoryId: string) => {
  let hash = 5381;
  for (let i = 0; i < categoryId.length; i++) hash = (hash * 33) ^ categoryId.charCodeAt(i);
  return Math.abs(hash) % theme.ramp.length;
};

// Color por identidad de categoría, no por posición en el ranking de gasto: mismo id,
// mismo color siempre (en cualquier dispositivo, sin persistir nada), tanto para las
// categorías por defecto (slug determinista) como para las creadas a mano (uuid).
export function categoryColor(categoryId: string): string {
  return categoryId === OTROS_ID ? theme.muted : theme.ramp[slot(categoryId)];
}

// La que usa el donut, y no `categoryColor` porción a porción. El hash colisiona por
// fuerza —10 categorías por defecto sobre 5 tonos— y dos porciones del mismo gráfico
// pintadas igual no se pueden leer: era el defecto real, no la paleta.
// Aquí el color de identidad pasa a ser solo la PREFERENCIA: si el tono que le toca ya
// está cogido, la categoría avanza al siguiente libre. Como se dibujan CATEGORY_LIMIT
// porciones como mucho sobre otros tantos tonos, siempre queda hueco y el resultado
// nunca repite. Una categoría solo cambia de color si otra le pisa el suyo.
// "Otros" no compite: va en gris y no gasta tono.
export function categoryPalette(categoryIds: string[]): string[] {
  const used = new Set<number>();
  return categoryIds.map(id => {
    if (id === OTROS_ID) return theme.muted;
    const preferred = slot(id);
    for (let i = 0; i < theme.ramp.length; i++) {
      const next = (preferred + i) % theme.ramp.length;
      if (!used.has(next)) { used.add(next); return theme.ramp[next] }
    }
    return theme.muted; // solo si llegan más ids que tonos; con CATEGORY_LIMIT no pasa
  });
}

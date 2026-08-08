import type { Category } from './types';

const expenseGroups: [string, string[]][] = [
  ['Fijos', ['Piso', 'Luz', 'Agua', 'Internet + Móvil', 'Suscripciones']],
  ['Alimentación', ['Supermercado', 'Comida Trabajo', 'Café']],
  ['Transporte', ['Viajes', 'Viajes Trabajo']],
  ['Deporte y bienestar', ['Nutrición', 'Gimnasio', 'Deporte', 'Barbería']],
  ['Coche', ['Gasolina', 'Mecánico', 'ITV', 'Seguro', 'Multas']],
  ['Ocio', ['Comida', 'Bebida', 'Actividades']],
  ['Salud', ['Dentista', 'Fisio']],
  ['Vida personal', ['Ropa y Calzado', 'Cursos', 'Libros', 'Viajes']],
  ['Social / Familiar', ['Regalos', 'Eventos']],
  ['Otros gastos', ['Mantenimiento', 'Caprichos', 'Imprevistos']],
];

const slug = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Los seeds nacen con un updatedAt deliberadamente antiquísimo. Todos los dispositivos generan los
// mismos ids (los slugs son estables), así que un móvil recién estrenado sembraría su árbol por
// defecto y lo subiría; con esta fecha el trigger LWW del servidor lo descarta y nunca puede pisar
// una categoría que ya hayas renombrado. Se usa también para rellenar las categorías que ya existían
// en IndexedDB antes de la v3 (ver el backfill de db.ts).
export const EPOCH_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export const defaultCategories: Category[] = [
  { id: 'income', name: 'Ingresos', type: 'income', order: 0, archived: false, updatedAt: EPOCH_UPDATED_AT, subcategories: ['Nómina', 'Otros ingresos'].map((name, order) => ({ id: `income-${slug(name)}`, name, order, archived: false, updatedAt: EPOCH_UPDATED_AT })) },
  ...expenseGroups.map(([name, children], order) => ({ id: `expense-${slug(name)}`, name, type: 'expense' as const, order, archived: false, updatedAt: EPOCH_UPDATED_AT, subcategories: children.map((child, subOrder) => ({ id: `expense-${slug(name)}-${slug(child)}`, name: child, order: subOrder, archived: false, updatedAt: EPOCH_UPDATED_AT })) })),
];

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

export const defaultCategories: Category[] = [
  { id: 'income', name: 'Ingresos', type: 'income', order: 0, archived: false, subcategories: ['Nómina', 'Otros ingresos'].map((name, order) => ({ id: `income-${slug(name)}`, name, order, archived: false })) },
  ...expenseGroups.map(([name, children], order) => ({ id: `expense-${slug(name)}`, name, type: 'expense' as const, order, archived: false, subcategories: children.map((child, subOrder) => ({ id: `expense-${slug(name)}-${slug(child)}`, name: child, order: subOrder, archived: false })) })),
];

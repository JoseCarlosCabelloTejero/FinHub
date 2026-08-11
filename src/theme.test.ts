import { describe, expect, it } from 'vitest';
import { categoryColor, OTROS_ID, theme } from './theme';

describe('categoryColor',()=>{
  it('es estable: el mismo id siempre da el mismo color',()=>{
    expect(categoryColor('expense-coche')).toBe(categoryColor('expense-coche'));
  });
  it('Otros siempre lleva el gris de texto secundario, no un tono de identidad',()=>{
    expect(categoryColor(OTROS_ID)).toBe(theme.muted);
  });
  it('cualquier categoría real devuelve un color de la rampa',()=>{
    expect(theme.ramp).toContain(categoryColor('expense-alimentacion'));
    expect(theme.ramp).toContain(categoryColor(crypto.randomUUID()));
  });
});

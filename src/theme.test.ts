import { describe, expect, it } from 'vitest';
import { CATEGORY_LIMIT, categoryColor, categoryPalette, OTROS_ID, theme } from './theme';

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

describe('categoryPalette',()=>{
  // El defecto que arregla: el hash colisiona, así que pedir el color de una en una repetía tonos.
  it('no repite color aunque el hash mande dos categorías al mismo tono',()=>{
    const ids=Array.from({length:CATEGORY_LIMIT},()=>crypto.randomUUID());
    const colors=categoryPalette(ids);
    expect(new Set(colors).size).toBe(CATEGORY_LIMIT);
  });
  it('llena la rampa entera cuando se dibuja el donut completo',()=>{
    const ids=Array.from({length:CATEGORY_LIMIT},()=>crypto.randomUUID());
    expect([...categoryPalette(ids)].sort()).toEqual([...theme.ramp].sort());
  });
  it('respeta el color de identidad mientras nadie se lo pise',()=>{
    expect(categoryPalette(['expense-coche'])).toEqual([categoryColor('expense-coche')]);
  });
  it('Otros va en gris y no gasta un tono de la rampa',()=>{
    const ids=[...Array.from({length:CATEGORY_LIMIT-1},()=>crypto.randomUUID()),OTROS_ID];
    const colors=categoryPalette(ids);
    expect(colors[colors.length-1]).toBe(theme.muted);
    expect(colors.filter(c=>(theme.ramp as readonly string[]).includes(c))).toHaveLength(CATEGORY_LIMIT-1);
  });
  it('las categorías por defecto tampoco chocan entre sí',()=>{
    const ids=['expense-fijos','expense-alimentacion','expense-transporte','expense-coche','expense-ocio'].slice(0,CATEGORY_LIMIT);
    expect(new Set(categoryPalette(ids)).size).toBe(ids.length);
  });
});

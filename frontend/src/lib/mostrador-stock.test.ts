import { describe, it, expect } from 'vitest';
import { asignadoPorProducto, diferencia } from './mostrador-stock';

describe('asignadoPorProducto', () => {
  it('indexa las filas por producto', () => {
    expect(asignadoPorProducto([{ productoId: 'a', cantidad: 7 }])).toEqual({ a: 7 });
  });

  it('un producto sin fila no aparece, y se lee como cero', () => {
    // Es lo que permite que la botonera del secundario deshabilite lo que no tiene sin
    // pedirle al backend una fila en cero por cada producto del catalogo.
    const mapa = asignadoPorProducto([{ productoId: 'a', cantidad: 7 }]);
    expect(mapa['b'] ?? 0).toBe(0);
  });

  it('sin filas devuelve un mapa vacio', () => {
    expect(asignadoPorProducto([])).toEqual({});
  });
});

describe('diferencia', () => {
  it('contar lo esperado da cero', () => {
    expect(diferencia(6, 6)).toBe(0);
  });

  it('faltante da negativo', () => {
    expect(diferencia(6, 4)).toBe(-2);
  });

  it('sobrante da positivo', () => {
    expect(diferencia(6, 8)).toBe(2);
  });
});

import { describe, it, expect } from 'vitest';
import { asignadoPorProducto, diferencia } from './mostrador-stock';

describe('asignadoPorProducto', () => {
  it('indexa las filas por producto', () => {
    expect(asignadoPorProducto([{ productoId: 'a', cantidad: 7 }])).toEqual({ a: 7 });
  });

  it('cada producto queda con su propia cantidad', () => {
    // Es lo que permite que la botonera del secundario deshabilite lo que no tiene sin
    // pedirle al backend una fila en cero por cada producto del catalogo.
    // Con una sola fila, un bug de indexado (usar la cantidad del ultimo, o indexar por la
    // clave equivocada) pasaria igual. Con dos, no.
    expect(asignadoPorProducto([
      { productoId: 'a', cantidad: 7 },
      { productoId: 'b', cantidad: 3 },
    ])).toEqual({ a: 7, b: 3 });
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

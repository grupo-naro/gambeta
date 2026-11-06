import { describe, it, expect } from 'vitest';
import { asignadoPorProducto, diferencia, productosDelMostrador } from './mostrador-stock';

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

describe('productosDelMostrador', () => {
  const productos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const asignado = [{ productoId: 'a', cantidad: 5 }, { productoId: 'b', cantidad: 0 }];

  it('el principal ve todo el catálogo', () => {
    expect(productosDelMostrador(productos, 'PRINCIPAL', [])).toEqual(productos);
  });

  it('el secundario ve solo lo que tiene asignado (más de 0)', () => {
    expect(productosDelMostrador(productos, 'SECUNDARIO', asignado)).toEqual([{ id: 'a' }]);
  });

  it('el secundario sin nada asignado no ve productos', () => {
    expect(productosDelMostrador(productos, 'SECUNDARIO', [])).toEqual([]);
  });

  it('conserva los productos pedidos aunque no tenga asignado (los de una cuenta abierta)', () => {
    expect(productosDelMostrador(productos, 'SECUNDARIO', asignado, ['c'])).toEqual([{ id: 'a' }, { id: 'c' }]);
  });
});

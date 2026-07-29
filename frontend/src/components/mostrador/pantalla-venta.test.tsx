import { describe, it, expect } from 'vitest';
import { parseEscaneo, calcularVuelto, filtrarProductos } from './pantalla-venta';

describe('parseEscaneo', () => {
  it('acumula digitos y no emite hasta el Enter', () => {
    expect(parseEscaneo('779', '0')).toEqual({ buffer: '7790', codigo: null });
  });

  it('con Enter emite el codigo y limpia el buffer', () => {
    expect(parseEscaneo('7790895', 'Enter')).toEqual({ buffer: '', codigo: '7790895' });
  });

  it('Enter con buffer vacio no emite nada', () => {
    expect(parseEscaneo('', 'Enter')).toEqual({ buffer: '', codigo: null });
  });

  it('ignora teclas que no son caracteres unicos', () => {
    expect(parseEscaneo('779', 'Shift')).toEqual({ buffer: '779', codigo: null });
  });
});

describe('calcularVuelto', () => {
  it('devuelve pagado - total', () => { expect(calcularVuelto(5000, 3000)).toBe(2000); });
  it('nunca es negativo', () => { expect(calcularVuelto(1000, 3000)).toBe(0); });
  it('trata vacío/NaN como 0', () => { expect(calcularVuelto(NaN, 3000)).toBe(0); });
});

describe('filtrarProductos', () => {
  const prods = [
    { id: '1', nombre: 'Coca Cola', precio: 1500 },
    { id: '2', nombre: 'Café', precio: 800 },
    { id: '3', nombre: 'Agua', precio: 1000 },
  ];
  it('query vacío devuelve todos', () => {
    expect(filtrarProductos(prods, '')).toHaveLength(3);
  });
  it('filtra por nombre, insensible a mayúsculas', () => {
    expect(filtrarProductos(prods, 'coca').map((p) => p.id)).toEqual(['1']);
  });
  it('ignora acentos (cafe encuentra Café)', () => {
    expect(filtrarProductos(prods, 'cafe').map((p) => p.id)).toEqual(['2']);
  });
  it('sin match devuelve vacío', () => {
    expect(filtrarProductos(prods, 'pizza')).toEqual([]);
  });
});

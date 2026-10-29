import { describe, it, expect } from 'vitest';
import { cantidadDe, ajustarCantidad, validarRendicion, etiquetaEstado } from './cuenta-reglas';

const cuenta = (total: number, lineas: { productoId: string; cantidad: number }[]) =>
  ({ total, lineas: lineas.map((l) => ({ ...l, nombre: 'x', precioUnit: 1, subtotal: l.cantidad })) });

describe('cantidadDe', () => {
  it('devuelve la cantidad de la línea del producto', () => {
    expect(cantidadDe(cuenta(5, [{ productoId: 'a', cantidad: 3 }]), 'a')).toBe(3);
  });
  it('es 0 si el producto no está en la cuenta', () => {
    expect(cantidadDe(cuenta(0, []), 'a')).toBe(0);
  });
});

describe('ajustarCantidad', () => {
  it('suma y resta', () => {
    expect(ajustarCantidad(2, 1)).toBe(3);
    expect(ajustarCantidad(2, -1)).toBe(1);
  });
  it('nunca baja de 0', () => {
    expect(ajustarCantidad(0, -1)).toBe(0);
  });
  it('nunca pasa del máximo que acepta el backend (999)', () => {
    expect(ajustarCantidad(999, 1)).toBe(999);
  });
});

describe('validarRendicion', () => {
  it('una cuenta vacía no se rinde', () => {
    expect(validarRendicion(cuenta(0, []), 'EFECTIVO', '0')).toBe('La cuenta está vacía');
  });
  it('efectivo con un monto menor al total se rechaza', () => {
    expect(validarRendicion(cuenta(7000, [{ productoId: 'a', cantidad: 1 }]), 'EFECTIVO', '5000')).toBe('El monto es menor al total');
  });
  it('efectivo con monto vacío se rechaza', () => {
    expect(validarRendicion(cuenta(7000, [{ productoId: 'a', cantidad: 1 }]), 'EFECTIVO', '')).toBe('El monto es menor al total');
  });
  it('efectivo que alcanza es válido', () => {
    expect(validarRendicion(cuenta(7000, [{ productoId: 'a', cantidad: 1 }]), 'EFECTIVO', '10000')).toBeNull();
  });
  it('transferencia es válida sin monto', () => {
    expect(validarRendicion(cuenta(7000, [{ productoId: 'a', cantidad: 1 }]), 'TRANSFERENCIA', '')).toBeNull();
  });
});

describe('etiquetaEstado', () => {
  it('traduce cada estado', () => {
    expect(etiquetaEstado('ABIERTA')).toBe('Abierta');
    expect(etiquetaEstado('RENDIDA')).toBe('Rendida');
    expect(etiquetaEstado('CANCELADA')).toBe('Cancelada');
    expect(etiquetaEstado('IMPAGA')).toBe('Impaga');
  });
});

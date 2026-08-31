import { describe, it, expect } from 'vitest';
import { stockTotal, estaBajo } from './stock-buffet';

const prod = (stock: number, asignado: number, stockMinimo: number) =>
  ({ stock, asignado, stockMinimo, activo: true }) as Parameters<typeof estaBajo>[0];

describe('stockTotal', () => {
  it('suma el general y lo que esta en el secundario', () => {
    expect(stockTotal(prod(5, 15, 6))).toBe(20);
  });

  it('sin nada asignado es el general', () => {
    expect(stockTotal(prod(5, 0, 6))).toBe(5);
  });
});

describe('estaBajo', () => {
  it('NO avisa si el total alcanza aunque el general este por debajo', () => {
    // El caso que motivó todo: 20 unidades en el complejo, 15 en el otro mostrador.
    // Avisar acá seria pedir que compres algo que ya compraste.
    expect(estaBajo(prod(5, 15, 6))).toBe(false);
  });

  it('avisa cuando el total esta en el minimo', () => {
    expect(estaBajo(prod(2, 4, 6))).toBe(true);
  });

  it('avisa cuando no queda nada en ningun lado', () => {
    expect(estaBajo(prod(0, 0, 6))).toBe(true);
  });

  it('un producto inactivo nunca avisa', () => {
    expect(estaBajo({ stock: 0, asignado: 0, stockMinimo: 6, activo: false })).toBe(false);
  });
});

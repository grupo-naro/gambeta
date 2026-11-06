import { describe, it, expect } from 'vitest';
import { stockTotal, estaBajo } from './stock-buffet';

const prod = (stock: number, asignado: number, stockMinimo: number) =>
  ({ stock, asignado, stockMinimo, activo: true }) as Parameters<typeof estaBajo>[0];

describe('stockTotal', () => {
  it('es el stock total: lo asignado al secundario ya está incluido y no se suma', () => {
    expect(stockTotal(prod(20, 15, 6))).toBe(20);
  });

  it('sin nada asignado es el mismo número', () => {
    expect(stockTotal(prod(5, 0, 6))).toBe(5);
  });
});

describe('estaBajo', () => {
  it('NO avisa si el total alcanza, aunque casi todo esté asignado al secundario', () => {
    // 20 unidades en el complejo, 15 en el cupo del otro mostrador: ya se compraron.
    expect(estaBajo(prod(20, 15, 6))).toBe(false);
  });

  it('avisa cuando el total esta en el minimo', () => {
    expect(estaBajo(prod(6, 4, 6))).toBe(true);
  });

  it('avisa cuando no queda nada en ningun lado', () => {
    expect(estaBajo(prod(0, 0, 6))).toBe(true);
  });

  it('un producto inactivo nunca avisa', () => {
    expect(estaBajo({ stock: 0, asignado: 0, stockMinimo: 6, activo: false })).toBe(false);
  });
});

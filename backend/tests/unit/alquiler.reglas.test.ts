import { describe, it, expect } from 'vitest';
import { calcularCobro, saleDelInventario } from '../../src/services/alquiler.reglas.js';

describe('calcularCobro', () => {
  it('efectivo: total por cantidad y vuelto', () => {
    expect(calcularCobro(3000, 2, 'EFECTIVO', 10000)).toEqual({ total: 6000, montoPagado: 10000, vuelto: 4000 });
  });

  it('efectivo justo: vuelto 0', () => {
    expect(calcularCobro(3000, 1, 'EFECTIVO', 3000)).toEqual({ total: 3000, montoPagado: 3000, vuelto: 0 });
  });

  it('efectivo insuficiente: regla de negocio', () => {
    expect(() => calcularCobro(3000, 1, 'EFECTIVO', 100)).toThrow(/menor al total/);
  });

  it('transferencia: paga exacto y no da vuelto', () => {
    expect(calcularCobro(3000, 2, 'TRANSFERENCIA', 0)).toEqual({ total: 6000, montoPagado: 6000, vuelto: 0 });
  });
});

describe('saleDelInventario', () => {
  it('lo devuelto vuelve al inventario', () => { expect(saleDelInventario('DEVUELTO')).toBe(false); });
  it('lo perdido no vuelve', () => { expect(saleDelInventario('PERDIDO')).toBe(true); });
  it('lo roto no vuelve', () => { expect(saleDelInventario('ROTO')).toBe(true); });
});

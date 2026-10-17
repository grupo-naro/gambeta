import { describe, it, expect } from 'vitest';
import { pagoInicialAbono, assertPagoDentroDelSaldo } from '../../src/services/turnoFijo.abono.js';
import { AppError } from '../../src/utils/errors.js';

describe('pagoInicialAbono', () => {
  it('sin abono no hay pago', () => {
    expect(pagoInicialAbono(undefined, undefined)).toBe(0);
  });
  it('con abono y sin montoPagado se asume el total (compatibilidad)', () => {
    expect(pagoInicialAbono(100000, undefined)).toBe(100000);
  });
  it('con montoPagado usa ese monto, incluso 0', () => {
    expect(pagoInicialAbono(100000, 50000)).toBe(50000);
    expect(pagoInicialAbono(100000, 0)).toBe(0);
  });
});

describe('assertPagoDentroDelSaldo', () => {
  it('acepta un pago que completa el saldo justo', () => {
    expect(() => assertPagoDentroDelSaldo(100000, 50000, 50000)).not.toThrow();
  });
  it('rechaza un pago mayor al saldo, indicando cuánto falta', () => {
    expect(() => assertPagoDentroDelSaldo(100000, 50000, 50001)).toThrow(AppError);
    expect(() => assertPagoDentroDelSaldo(100000, 50000, 50001)).toThrow('50.000');
  });
  it('rechaza pagar cuando ya está todo pago', () => {
    expect(() => assertPagoDentroDelSaldo(100000, 100000, 1)).toThrow(AppError);
  });
});

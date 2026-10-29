import { describe, it, expect } from 'vitest';
import { calcularPago } from '../../src/services/buffetStock.js';

describe('calcularPago', () => {
  it('efectivo: devuelve el monto entregado y el vuelto', () => {
    expect(calcularPago('EFECTIVO', 5000, 3000)).toEqual({ montoPagado: 5000, vuelto: 2000 });
  });

  it('efectivo: pago justo no tiene vuelto', () => {
    expect(calcularPago('EFECTIVO', 3000, 3000)).toEqual({ montoPagado: 3000, vuelto: 0 });
  });

  it('efectivo: un monto menor al total es una regla de negocio', () => {
    expect(() => calcularPago('EFECTIVO', 2000, 3000)).toThrow('El monto pagado es menor al total');
  });

  it('transferencia: paga el total exacto sin importar el monto recibido', () => {
    expect(calcularPago('TRANSFERENCIA', 0, 3000)).toEqual({ montoPagado: 3000, vuelto: 0 });
  });
});

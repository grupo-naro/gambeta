import { describe, it, expect } from 'vitest';
import { estadoPago } from '@/lib/pago';

describe('estadoPago', () => {
  it('ESPERANDO_SENA → espera', () => {
    expect(estadoPago({ estado: 'ESPERANDO_SENA', monto: 10000, pagado: 0, saldo: 10000 }))
      .toEqual({ tono: 'espera', label: 'Espera seña' });
  });
  it('saldo 0 → pagado', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 10000, pagado: 10000, saldo: 0 }))
      .toEqual({ tono: 'pagado', label: 'Pagado' });
  });
  it('pago parcial → parcial (amarillo) con saldo', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 10000, pagado: 4000, saldo: 6000 }))
      .toEqual({ tono: 'parcial', label: 'Debe $6.000' });
  });
  it('sin pagar → debe (rojo) con saldo', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 10000, pagado: 0, saldo: 10000 }))
      .toEqual({ tono: 'debe', label: 'Debe $10.000' });
  });
});

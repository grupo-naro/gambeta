import { describe, it, expect } from 'vitest';
import { estadoPago } from './pago';

describe('estadoPago', () => {
  it('reserva de socio → chip "Socio"', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 0, pagado: 0, saldo: 0, suscripcionId: 'sus_1' }))
      .toEqual({ tono: 'pagado', label: 'Socio' });
  });

  it('reserva de socio NO muestra "Debe $0"', () => {
    const r = estadoPago({ estado: 'CONFIRMADA', monto: 0, pagado: 0, saldo: 0, suscripcionId: 'sus_1' });
    expect(r.label).not.toContain('Debe');
  });

  it('esperando seña sigue igual', () => {
    expect(estadoPago({ estado: 'ESPERANDO_SENA', monto: 12000, pagado: 0, saldo: 12000 }))
      .toEqual({ tono: 'espera', label: 'Espera seña' });
  });

  it('pagada por completo sigue igual', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 12000, pagado: 12000, saldo: 0 }))
      .toEqual({ tono: 'pagado', label: 'Pagado' });
  });

  it('pago parcial sigue igual', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 12000, pagado: 5000, saldo: 7000 }).tono).toBe('parcial');
  });

  it('sin pagar sigue igual', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 12000, pagado: 0, saldo: 12000 }).tono).toBe('debe');
  });

  it('turno de fijo con abono → chip "Abono", no "Debe $0"', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 0, pagado: 0, saldo: 0, suscripcionId: null, montoLista: 30000 }))
      .toEqual({ tono: 'pagado', label: 'Abono' });
  });
});

import { describe, it, expect } from 'vitest';
import { etiquetaMes, estadoMes } from './meses-bloqueo';

describe('etiquetaMes', () => {
  it('escribe el mes como se habla', () => {
    expect(etiquetaMes('2030-05')).toBe('Mayo 2030');
    expect(etiquetaMes('2031-01')).toBe('Enero 2031');
    expect(etiquetaMes('2030-12')).toBe('Diciembre 2030');
  });
});

describe('estadoMes', () => {
  it('sin pagos debe todo', () => {
    expect(estadoMes({ mes: '2030-05', pagado: 0, saldo: 50000 })).toEqual({ texto: 'Debe $50.000', tono: 'ambar' });
  });
  it('pago parcial debe el resto', () => {
    expect(estadoMes({ mes: '2030-05', pagado: 20000, saldo: 30000 })).toEqual({ texto: 'Debe $30.000', tono: 'ambar' });
  });
  it('saldo cero es pagado', () => {
    expect(estadoMes({ mes: '2030-05', pagado: 50000, saldo: 0 })).toEqual({ texto: 'Pagado', tono: 'verde' });
  });
});

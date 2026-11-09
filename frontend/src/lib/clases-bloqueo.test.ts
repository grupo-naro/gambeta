import { describe, it, expect } from 'vitest';
import { etiquetaClase, estadoClase } from './clases-bloqueo';

describe('etiquetaClase', () => {
  it('escribe el día y la fecha como se habla', () => {
    expect(etiquetaClase('2030-05-10')).toBe('Vie 10/05');
    expect(etiquetaClase('2030-05-03')).toBe('Vie 03/05');
  });
});

describe('estadoClase', () => {
  it('liberada no se cobra', () => {
    expect(estadoClase({ fecha: '2030-05-10', liberada: true, pagado: 0, saldo: 0 })).toEqual({ texto: 'Liberada', tono: 'gris' });
  });
  it('sin pagos debe todo', () => {
    expect(estadoClase({ fecha: '2030-05-10', liberada: false, pagado: 0, saldo: 20000 })).toEqual({ texto: 'Debe $20.000', tono: 'ambar' });
  });
  it('pago parcial debe el resto', () => {
    expect(estadoClase({ fecha: '2030-05-10', liberada: false, pagado: 8000, saldo: 12000 })).toEqual({ texto: 'Debe $12.000', tono: 'ambar' });
  });
  it('saldo cero es pagado', () => {
    expect(estadoClase({ fecha: '2030-05-10', liberada: false, pagado: 20000, saldo: 0 })).toEqual({ texto: 'Pagado', tono: 'verde' });
  });
});

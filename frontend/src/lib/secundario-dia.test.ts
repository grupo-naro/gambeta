import { describe, it, expect } from 'vitest';
import { arrancoCon, detalleArranque, fechaCorta } from './secundario-dia';

describe('arrancoCon', () => {
  it('el caso del cliente: entregaron 30 y arrancó con 30', () => {
    expect(arrancoCon({ arranco: 0, entregado: 30, devuelto: 0 })).toBe(30);
  });
  it('suma lo que había quedado y resta lo devuelto', () => {
    expect(arrancoCon({ arranco: 10, entregado: 30, devuelto: 5 })).toBe(35);
  });
});

describe('detalleArranque', () => {
  it('cuenta de dónde sale el número', () => {
    expect(detalleArranque({ arranco: 10, entregado: 30, devuelto: 5 })).toBe('10 de antes + 30 entregadas − 5 devueltas');
  });
  it('sin sobrante previo arranca directo con lo entregado', () => {
    expect(detalleArranque({ arranco: 0, entregado: 30, devuelto: 0 })).toBe('30 entregadas');
  });
  it('sin movimientos no dice nada', () => {
    expect(detalleArranque({ arranco: 0, entregado: 0, devuelto: 0 })).toBe('');
  });
});

describe('fechaCorta', () => {
  it('da vuelta la fecha', () => expect(fechaCorta('2026-11-05')).toBe('05/11/2026'));
});

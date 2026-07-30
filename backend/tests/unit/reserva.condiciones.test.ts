import { describe, it, expect } from 'vitest';
import { resolverCondiciones } from '../../src/services/reserva.condiciones.js';

const base = { esContacto: false, porStaff: false, clienteConfiable: false, precio: 12000, senaPorDefecto: 6000 };

describe('resolverCondiciones (sin suscripción)', () => {
  it('cliente nuevo → ESPERANDO_SENA con la seña por defecto', () => {
    expect(resolverCondiciones(base)).toEqual({
      estado: 'ESPERANDO_SENA', monto: 12000, montoLista: null, montoSena: 6000, suscripcionId: null,
    });
  });
  it('reserva por staff → CONFIRMADA sin seña', () => {
    const r = resolverCondiciones({ ...base, porStaff: true });
    expect(r.estado).toBe('CONFIRMADA');
    expect(r.montoSena).toBeNull();
    expect(r.monto).toBe(12000);
  });
  it('cliente de confianza → CONFIRMADA sin seña', () => {
    expect(resolverCondiciones({ ...base, clienteConfiable: true }).estado).toBe('CONFIRMADA');
  });
  it('esContacto → CONFIRMADA sin seña', () => {
    expect(resolverCondiciones({ ...base, esContacto: true }).estado).toBe('CONFIRMADA');
  });
  it('respeta la seña explícita cuando queda ESPERANDO_SENA', () => {
    expect(resolverCondiciones({ ...base, montoSenaPedido: 3000 }).montoSena).toBe(3000);
  });
});

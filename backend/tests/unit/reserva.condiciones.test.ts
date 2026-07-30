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

describe('resolverCondiciones (con suscripción)', () => {
  const conSocio = { ...base, suscripcionId: 'sus_1' };

  it('socio → CONFIRMADA, monto 0, montoLista con el precio real, sin seña', () => {
    expect(resolverCondiciones(conSocio)).toEqual({
      estado: 'CONFIRMADA', monto: 0, montoLista: 12000, montoSena: null, suscripcionId: 'sus_1',
    });
  });

  it('la suscripción gana sobre el pedido explícito de seña', () => {
    expect(resolverCondiciones({ ...conSocio, montoSenaPedido: 5000 }).montoSena).toBeNull();
  });

  it('socio: montoSenaPedido explícito se ignora incluso si es 0', () => {
    expect(resolverCondiciones({ ...conSocio, montoSenaPedido: 0 }).montoSena).toBeNull();
  });

  it('socio que además es confiable sigue bonificado', () => {
    expect(resolverCondiciones({ ...conSocio, clienteConfiable: true }).monto).toBe(0);
  });

  it('socio reservando desde el panel sigue bonificado', () => {
    expect(resolverCondiciones({ ...conSocio, porStaff: true }).monto).toBe(0);
  });
});

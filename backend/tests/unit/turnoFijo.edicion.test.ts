import { describe, it, expect } from 'vitest';
import { aplicarEdicion, cambiaElHorario, type FijoEditable } from '../../src/services/turnoFijo.edicion.js';
import { AppError } from '../../src/utils/errors.js';

const actual: FijoEditable = {
  canchaId: 'c1', clienteNombre: 'Ana', whatsapp: '5491136620274', diaSemana: 3,
  horaInicio: '20:00', horaFin: '21:00',
  vigenciaDesde: '2026-11-01', vigenciaHasta: '2026-11-30', montoAbono: 100000,
};
const sinAbono: FijoEditable = { ...actual, vigenciaDesde: null, vigenciaHasta: null, montoAbono: null };

describe('aplicarEdicion', () => {
  it('sin cambios devuelve lo mismo', () => {
    expect(aplicarEdicion(actual, {}, 0)).toEqual(actual);
  });

  it('corrige el horario y deja el resto igual', () => {
    const r = aplicarEdicion(actual, { horaInicio: '20:30', horaFin: '21:30' }, 0);
    expect(r).toMatchObject({ horaInicio: '20:30', horaFin: '21:30', canchaId: 'c1', montoAbono: 100000 });
  });

  it('cambiar solo una hora se valida contra la otra que ya estaba', () => {
    expect(() => aplicarEdicion(actual, { horaInicio: '21:30' }, 0)).toThrow(AppError); // 21:30 >= 21:00
    expect(() => aplicarEdicion(actual, { horaFin: '19:00' }, 0)).toThrow(AppError);
  });

  it('un fijo que cierra a medianoche (00:00) es válido', () => {
    expect(() => aplicarEdicion(actual, { horaInicio: '23:00', horaFin: '00:00' }, 0)).not.toThrow();
  });

  it('corrige el monto del abono', () => {
    expect(aplicarEdicion(actual, { montoAbono: 120000 }, 0).montoAbono).toBe(120000);
  });

  it('el monto del abono no puede quedar por debajo de lo ya cobrado', () => {
    expect(() => aplicarEdicion(actual, { montoAbono: 40000 }, 50000)).toThrow(AppError);
    expect(() => aplicarEdicion(actual, { montoAbono: 40000 }, 50000)).toThrow('50.000');
  });

  it('el monto del abono puede igualar lo ya cobrado (queda al día)', () => {
    expect(() => aplicarEdicion(actual, { montoAbono: 50000 }, 50000)).not.toThrow();
  });

  it('corrige el período, pero no puede quedar invertido', () => {
    expect(aplicarEdicion(actual, { vigenciaHasta: '2026-12-15' }, 0).vigenciaHasta).toBe('2026-12-15');
    expect(() => aplicarEdicion(actual, { vigenciaHasta: '2026-10-31' }, 0)).toThrow(AppError); // antes del desde
    expect(() => aplicarEdicion(actual, { vigenciaDesde: '2026-12-01' }, 0)).toThrow(AppError); // después del hasta
  });

  it('un fijo sin abono no admite editar período ni monto', () => {
    expect(() => aplicarEdicion(sinAbono, { montoAbono: 1000 }, 0)).toThrow(AppError);
    expect(() => aplicarEdicion(sinAbono, { vigenciaHasta: '2026-12-31' }, 0)).toThrow(AppError);
    expect(aplicarEdicion(sinAbono, { clienteNombre: 'Beto' }, 0).clienteNombre).toBe('Beto');
  });
});

describe('cambiaElHorario', () => {
  it('detecta cambios de cancha, día u horas', () => {
    expect(cambiaElHorario(actual, { ...actual, horaFin: '21:30' })).toBe(true);
    expect(cambiaElHorario(actual, { ...actual, diaSemana: 4 })).toBe(true);
    expect(cambiaElHorario(actual, { ...actual, canchaId: 'c2' })).toBe(true);
  });
  it('no lo detecta si cambia solo el cliente, el monto o el período', () => {
    expect(cambiaElHorario(actual, { ...actual, clienteNombre: 'Beto', montoAbono: 5, vigenciaHasta: '2027-01-01' })).toBe(false);
  });
});

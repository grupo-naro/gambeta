import { describe, it, expect } from 'vitest';
import { crearBloqueoSchema } from '../../src/validators/bloqueo.schema.js';

const base = { canchaId: 'c1', motivo: 'TORNEO', horaInicio: '20:00', horaFin: '23:00' };
const parse = (body: Record<string, unknown>) => crearBloqueoSchema.parse({ body: { ...base, ...body }, query: {}, params: {} });

describe('período de un bloqueo recurrente', () => {
  const jueves = { recurrente: true, diaSemana: 4 };

  it('un recurrente sin período sigue siendo válido (los de hoy no se rompen)', () => {
    expect(() => parse(jueves)).not.toThrow();
  });
  it('acepta desde y hasta', () => {
    const r = parse({ ...jueves, vigenciaDesde: '2026-10-17', vigenciaHasta: '2026-12-12' });
    expect(r.body.vigenciaDesde).toBe('2026-10-17');
    expect(r.body.vigenciaHasta).toBe('2026-12-12');
  });
  it('acepta solo hasta, o solo desde', () => {
    expect(() => parse({ ...jueves, vigenciaHasta: '2026-12-12' })).not.toThrow();
    expect(() => parse({ ...jueves, vigenciaDesde: '2026-10-17' })).not.toThrow();
  });
  it('rechaza un período invertido', () => {
    expect(() => parse({ ...jueves, vigenciaDesde: '2026-12-12', vigenciaHasta: '2026-10-17' })).toThrow();
  });
  it('acepta desde y hasta iguales (un solo día)', () => {
    expect(() => parse({ ...jueves, vigenciaDesde: '2026-12-10', vigenciaHasta: '2026-12-10' })).not.toThrow();
  });
  it('rechaza fechas que no existen (31 de febrero)', () => {
    expect(() => parse({ ...jueves, vigenciaHasta: '2026-02-31' })).toThrow();
  });
  it('rechaza el período en un bloqueo PUNTUAL: ya tiene su fecha', () => {
    expect(() => parse({ recurrente: false, fecha: '2026-11-05', vigenciaHasta: '2026-12-12' })).toThrow();
  });
});

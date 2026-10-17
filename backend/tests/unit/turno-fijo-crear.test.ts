import { describe, it, expect } from 'vitest';
import { crearTurnoFijoSchema } from '../../src/validators/turnoFijo.schema.js';

const base = { canchaId: 'c1', clienteNombre: 'Naro', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00' };
const parse = (body: Record<string, unknown>) => crearTurnoFijoSchema.parse({ body, query: {}, params: {} });

describe('crearTurnoFijoSchema', () => {
  it('no requiere precio y normaliza el whatsapp', () => {
    const r = parse({ ...base, whatsapp: '+541136620274' });
    expect(r.body.whatsapp).toBe('5491136620274');
    expect('precio' in r.body).toBe(false);
  });
  it('rechaza si falta whatsapp', () => {
    expect(() => parse({ ...base })).toThrow();
  });
});

describe('abono en el alta de un turno fijo', () => {
  const base = { canchaId: 'c1', clienteNombre: 'Ana', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00' };
  const parse = (extra: Record<string, unknown>) =>
    crearTurnoFijoSchema.parse({ body: { ...base, ...extra }, query: {}, params: {} });

  it('sin abono sigue siendo válido (los fijos de hoy no se rompen)', () => {
    expect(() => parse({})).not.toThrow();
  });

  it('con los cuatro campos del abono es válido', () => {
    const r = parse({ vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    expect(r.body.montoAbono).toBe(120000);
  });

  it('el abono incompleto se rechaza', () => {
    expect(() => parse({ vigenciaDesde: '2026-08-01' })).toThrow();
    expect(() => parse({ montoAbono: 120000, medioAbono: 'EFECTIVO' })).toThrow();
    // Sin medio no se sabe cómo registrar el cobro.
    expect(() => parse({ vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000 })).toThrow();
  });

  it('rechaza un período invertido', () => {
    expect(() => parse({ vigenciaDesde: '2026-08-31', vigenciaHasta: '2026-08-01', montoAbono: 120000, medioAbono: 'EFECTIVO' })).toThrow();
  });
});

describe('pago parcial del abono en el alta', () => {
  const base = { canchaId: 'c1', clienteNombre: 'Ana', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00' };
  const abono = { vigenciaDesde: '2026-11-01', vigenciaHasta: '2026-11-30', montoAbono: 100000, medioAbono: 'EFECTIVO' };
  const parse = (extra: Record<string, unknown>) =>
    crearTurnoFijoSchema.parse({ body: { ...base, ...extra }, query: {}, params: {} });

  it('montoPagado es opcional: sin él se asume que pagó el total (como hasta ahora)', () => {
    expect(parse(abono).body.montoPagado).toBeUndefined();
  });
  it('acepta pagar una parte, y también 0 (todavía no pagó nada)', () => {
    expect(parse({ ...abono, montoPagado: 50000 }).body.montoPagado).toBe(50000);
    expect(parse({ ...abono, montoPagado: 0 }).body.montoPagado).toBe(0);
  });
  it('acepta pagar exactamente el total', () => {
    expect(() => parse({ ...abono, montoPagado: 100000 })).not.toThrow();
  });
  it('rechaza pagar más que el abono', () => {
    expect(() => parse({ ...abono, montoPagado: 100001 })).toThrow();
  });
  it('rechaza un monto pagado negativo', () => {
    expect(() => parse({ ...abono, montoPagado: -1 })).toThrow();
  });
  it('rechaza montoPagado sin abono: no hay qué pagar', () => {
    expect(() => parse({ montoPagado: 5000 })).toThrow();
  });
});

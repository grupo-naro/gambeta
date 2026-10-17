import { describe, it, expect } from 'vitest';
import { editarTurnoFijoSchema } from '../../src/validators/turnoFijo.schema.js';

const parse = (body: Record<string, unknown>) => editarTurnoFijoSchema.parse({ body, query: {}, params: { id: 'f1' } });

describe('editarTurnoFijoSchema', () => {
  it('acepta cambiar solo algunos campos', () => {
    expect(parse({ horaInicio: '20:30', horaFin: '21:30' }).body).toEqual({ horaInicio: '20:30', horaFin: '21:30' });
  });
  it('rechaza un body vacío: no hay nada que editar', () => {
    expect(() => parse({})).toThrow();
  });
  it('rechaza formatos inválidos', () => {
    expect(() => parse({ horaInicio: '25:00' })).toThrow();
    expect(() => parse({ vigenciaHasta: '2026-02-31' })).toThrow();
    expect(() => parse({ montoAbono: -5 })).toThrow();
    expect(() => parse({ diaSemana: 9 })).toThrow();
  });
  it('normaliza el whatsapp como el alta', () => {
    expect(parse({ whatsapp: '+541136620274' }).body.whatsapp).toBe('5491136620274');
  });
  it('no deja editar el medio de pago ni cobros (eso va por Cobros del abono)', () => {
    expect('medioAbono' in parse({ clienteNombre: 'Ana', medioAbono: 'EFECTIVO' } as any).body).toBe(false);
  });
});

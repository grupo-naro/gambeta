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

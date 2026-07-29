import { describe, it, expect } from 'vitest';
import { createReservaSchema } from '../../src/validators/reserva.schema.js';
import { crearTurnoFijoSchema } from '../../src/validators/turnoFijo.schema.js';
import { upsertClienteSchema } from '../../src/validators/cliente.schema.js';

const baseReserva = { canchaId: 'c1', nombreCliente: 'Naro', fecha: '2026-06-24', horaInicio: '20:00' };

describe('validadores: whatsapp se guarda canónico', () => {
  it('createReservaSchema normaliza el whatsapp', () => {
    const r = createReservaSchema.parse({ body: { ...baseReserva, whatsapp: '+541136620274' }, query: {}, params: {} });
    expect(r.body.whatsapp).toBe('5491136620274');
  });
  it('createReservaSchema rechaza whatsapp inválido', () => {
    expect(() => createReservaSchema.parse({ body: { ...baseReserva, whatsapp: '123' }, query: {}, params: {} })).toThrow();
  });
  it('crearTurnoFijoSchema normaliza cuando viene', () => {
    const r = crearTurnoFijoSchema.parse({ body: { canchaId: 'c1', clienteNombre: 'Naro', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 12000 }, query: {}, params: {} });
    expect(r.body.whatsapp).toBe('5491136620274');
  });
  it('crearTurnoFijoSchema ahora REQUIERE whatsapp', () => {
    expect(() => crearTurnoFijoSchema.parse({ body: { canchaId: 'c1', clienteNombre: 'Naro', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00' }, query: {}, params: {} })).toThrow();
  });
  it('upsertClienteSchema normaliza el whatsapp', () => {
    const r = upsertClienteSchema.parse({ body: { whatsapp: '+54 9 11 3662-0274', nombre: 'Naro' }, query: {}, params: {} });
    expect(r.body.whatsapp).toBe('5491136620274');
  });
});

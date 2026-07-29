import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
});
const agenda = (fecha: string) => supertest(app).get(`/agenda?fecha=${fecha}`).set('x-api-key', 'svc');

describe('GET /agenda', () => {
  it('lista fijos virtuales del día con precio de la cancha', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });
    const r = await agenda('2026-06-24'); // miércoles
    expect(r.status).toBe(200);
    expect(r.body.fijos).toHaveLength(1);
    expect(Number(r.body.fijos[0].precio)).toBe(12000);
    expect(r.body.fijos[0].turnoFijoId).toBeTruthy();
  });
  it('excluye el fijo ya materializado (no se duplica)', async () => {
    const f = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });
    await supertest(app).post(`/turnos-fijos/${f.id}/materializar`).set('x-api-key', 'svc').send({ fecha: '2026-06-24' });
    const r = await agenda('2026-06-24');
    expect(r.body.fijos).toHaveLength(0);
    expect(r.body.reservas).toHaveLength(1);
  });
  it('excluye fijo liberado (excepción) y lista bloqueos del día', async () => {
    const f = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });
    await getPrisma().turnoFijoExcepcion.create({ data: { turnoFijoId: f.id, fecha: new Date('2026-06-24T00:00:00.000Z') } });
    await getPrisma().bloqueo.create({ data: { canchaId, motivo: 'TORNEO', recurrente: false, fecha: new Date('2026-06-24T00:00:00.000Z'), horaInicio: '10:00', horaFin: '14:00', activo: true } });
    const r = await agenda('2026-06-24');
    expect(r.body.fijos).toHaveLength(0);
    expect(r.body.bloqueos).toHaveLength(1);
  });
});

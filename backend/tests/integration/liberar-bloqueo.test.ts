import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol', precioHora: 12000, jugadores: 5 } })).id;
});

const disp = (fecha: string) => supertest(app).get(`/disponibilidad?canchaId=${canchaId}&fecha=${fecha}`).set('x-api-key', 'svc');
const libre = (r: any, hora: string) => (r.body.slots || []).some((s: any) => s.horaInicio === hora);

// 2026-07-06 = LUNES (diaSemana 1). 2026-07-13 = lunes siguiente.
describe('liberar una fecha de un bloqueo recurrente la vuelve reservable ese día', () => {
  it('excepción libera el slot solo en la fecha liberada', async () => {
    const b = await getPrisma().bloqueo.create({ data: { canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' } });

    // sanity: el lunes 18:00 está bloqueado
    expect(libre(await disp('2026-07-06'), '18:00')).toBe(false);

    // liberar ese lunes
    const lib = await supertest(app).post(`/bloqueos/${b.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: '2026-07-06' });
    expect(lib.status).toBeLessThan(400);

    // ese lunes quedó libre; el lunes siguiente sigue bloqueado
    expect(libre(await disp('2026-07-06'), '18:00')).toBe(true);
    expect(libre(await disp('2026-07-13'), '18:00')).toBe(false);
  });

  it('POST es idempotente y DELETE re-bloquea la fecha', async () => {
    const b = await getPrisma().bloqueo.create({ data: { canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' } });
    await supertest(app).post(`/bloqueos/${b.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: '2026-07-06' });
    await supertest(app).post(`/bloqueos/${b.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: '2026-07-06' });
    expect(await getPrisma().bloqueoExcepcion.count({ where: { bloqueoId: b.id } })).toBe(1);

    const del = await supertest(app).delete(`/bloqueos/${b.id}/excepciones/2026-07-06`).set('authorization', `Bearer ${token}`);
    expect(del.status).toBeLessThan(400);
    expect(libre(await disp('2026-07-06'), '18:00')).toBe(false);
  });

  it('la agenda del día liberado no incluye el bloqueo', async () => {
    const b = await getPrisma().bloqueo.create({ data: { canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' } });
    await supertest(app).post(`/bloqueos/${b.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: '2026-07-06' });
    const ag = await supertest(app).get('/agenda?fecha=2026-07-06').set('x-api-key', 'svc');
    expect(ag.status).toBe(200);
    expect((ag.body.bloqueos || []).some((x: any) => x.id === b.id)).toBe(false);
  });
});

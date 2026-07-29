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
const tiene20 = (r: any) => (r.body.slots || []).some((s: any) => s.horaInicio === '20:00');

// 2026-06-24 = miércoles (diaSemana 3)
describe('liberar un fijo ya materializado cancela la reserva y libera el slot', () => {
  it('agregarExcepcion cancela la reserva materializada de esa fecha', async () => {
    const f = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });

    // materializar → reserva concreta CONFIRMADA en esa fecha
    const mat = await supertest(app).post(`/turnos-fijos/${f.id}/materializar`).set('x-api-key', 'svc').send({ fecha: '2026-06-24' });
    expect(mat.status).toBe(201);
    const resId = mat.body.id;

    // sanity: el 20:00 está ocupado por la reserva materializada
    expect(tiene20(await disp('2026-06-24'))).toBe(false);

    // liberar la fecha (excepción, panel/admin)
    const lib = await supertest(app).post(`/turnos-fijos/${f.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: '2026-06-24' });
    expect(lib.status).toBeLessThan(400);

    // la reserva materializada quedó CANCELADA
    const r = await getPrisma().reserva.findUnique({ where: { id: resId } });
    expect(r?.estado).toBe('CANCELADA');

    // el slot 20:00 quedó libre
    expect(tiene20(await disp('2026-06-24'))).toBe(true);
  });

  it('liberarPorWhatsapp (bot) también cancela la reserva materializada', async () => {
    const f = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });
    const mat = await supertest(app).post(`/turnos-fijos/${f.id}/materializar`).set('x-api-key', 'svc').send({ fecha: '2026-06-24' });
    const resId = mat.body.id;

    const lib = await supertest(app).post('/turnos-fijos/liberar').set('x-api-key', 'svc').send({ whatsapp: '5491136620274', fecha: '2026-06-24' });
    expect(lib.status).toBe(200);
    expect(lib.body.liberado).toBe(true);

    const r = await getPrisma().reserva.findUnique({ where: { id: resId } });
    expect(r?.estado).toBe('CANCELADA');
    expect(tiene20(await disp('2026-06-24'))).toBe(true);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } })).id;
  const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
  await getPrisma().reserva.create({ data: {
    canchaId, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto: 1000,
    fechaInicio: new Date('2026-06-12T22:00:00.000Z'), fechaFin: new Date('2026-06-12T23:00:00.000Z'),
  }});
});

describe('analytics', () => {
  it('ingresos sums confirmed/completed reservas', async () => {
    const res = await supertest(app).get('/analytics/ingresos').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.total)).toBe(1000);
  });
  it('canchas-top returns the cancha with its count', async () => {
    const res = await supertest(app).get('/analytics/canchas-top').set('authorization', `Bearer ${token}`);
    expect(res.body[0].canchaId).toBe(canchaId);
    expect(Number(res.body[0].reservas)).toBe(1);
  });
  it('requires admin (service key forbidden)', async () => {
    const res = await supertest(app).get('/analytics/ingresos').set('x-api-key', 'svc');
    expect(res.status).toBe(401);
  });
  it('ingresos respeta el rango', async () => {
    const dentro = await supertest(app).get('/analytics/ingresos?desde=2026-06-10&hasta=2026-06-15').set('authorization', `Bearer ${token}`);
    expect(Number(dentro.body.total)).toBe(1000);
    const fuera = await supertest(app).get('/analytics/ingresos?desde=2026-01-01&hasta=2026-01-31').set('authorization', `Bearer ${token}`);
    expect(Number(fuera.body.total)).toBe(0);
  });
  it('ingresos-por-dia agrupa por dia (TZ Argentina)', async () => {
    const r = await supertest(app).get('/analytics/ingresos-por-dia?desde=2026-06-10&hasta=2026-06-15').set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    const dia = (r.body as any[]).find((x) => x.fecha === '2026-06-12');
    expect(dia).toBeTruthy();
    expect(Number(dia.total)).toBe(1000);
  });
  it('ocupacion respeta el rango', async () => {
    const dentro = await supertest(app).get('/analytics/ocupacion?desde=2026-06-10&hasta=2026-06-15').set('authorization', `Bearer ${token}`);
    expect(dentro.body.length).toBeGreaterThan(0);
    const fuera = await supertest(app).get('/analytics/ocupacion?desde=2026-01-01&hasta=2026-01-31').set('authorization', `Bearer ${token}`);
    expect(fuera.body.length).toBe(0);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
let canchaId: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id;
});

const admin = () => signAdminToken({ adminId: 'a', email: 'a@b.com', rol: 'ADMIN' });

async function reservaHoy(monto = 10000) {
  const cl = await getPrisma().cliente.create({ data: { nombre: 'Juan', whatsapp: '+5491150000000' } });
  return getPrisma().reserva.create({
    data: {
      canchaId, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto,
      fechaInicio: new Date(), fechaFin: new Date(Date.now() + 3600000),
    },
  });
}

const desde = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const hasta = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe('GET /reservas — pagado/saldo por reserva', () => {
  it('sin cobros: pagado 0 y saldo = monto', async () => {
    const r = await reservaHoy(10000);
    const res = await supertest(app)
      .get(`/reservas?desde=${desde()}&hasta=${hasta()}`)
      .set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    const item = (res.body as any[]).find((x) => x.id === r.id);
    expect(item.pagado).toBe(0);
    expect(item.saldo).toBe(10000);
  });

  it('con cobro parcial: pagado = Σ y saldo = monto - pagado', async () => {
    const r = await reservaHoy(10000);
    await supertest(app)
      .post(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${admin()}`)
      .send({ monto: 4000, medio: 'EFECTIVO' });
    const res = await supertest(app)
      .get(`/reservas?desde=${desde()}&hasta=${hasta()}`)
      .set('authorization', `Bearer ${admin()}`);
    const item = (res.body as any[]).find((x) => x.id === r.id);
    expect(item.pagado).toBe(4000);
    expect(item.saldo).toBe(6000);
  });

  it('pagado completo: saldo 0', async () => {
    const r = await reservaHoy(10000);
    await supertest(app)
      .post(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${admin()}`)
      .send({ monto: 10000, medio: 'EFECTIVO' });
    const res = await supertest(app)
      .get(`/reservas?desde=${desde()}&hasta=${hasta()}`)
      .set('authorization', `Bearer ${admin()}`);
    const item = (res.body as any[]).find((x) => x.id === r.id);
    expect(item.pagado).toBe(10000);
    expect(item.saldo).toBe(0);
  });
});

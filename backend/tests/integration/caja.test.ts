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

const recep = () => signAdminToken({ adminId: 'r', email: 'r@r.com', rol: 'RECEPCIONISTA' });

async function nuevaReserva(monto = 10000) {
  const cl = await getPrisma().cliente.create({ data: { nombre: 'Juan', whatsapp: '+1' } });
  return getPrisma().reserva.create({
    data: {
      canchaId,
      clienteId: cl.id,
      estado: 'CONFIRMADA',
      esContacto: true,
      monto,
      fechaInicio: new Date(),
      fechaFin: new Date(Date.now() + 3600000),
    },
  });
}

describe('cobros y caja', () => {
  it('registrar cobro baja el saldo; GET cobros lo refleja', async () => {
    const r = await nuevaReserva(10000);
    const c = await supertest(app)
      .post(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${recep()}`)
      .send({ monto: 4000, medio: 'EFECTIVO' });
    expect(c.status).toBe(201);
    expect(c.body.saldo).toBe(6000);
    const list = await supertest(app)
      .get(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${recep()}`);
    expect(list.body.pagado).toBe(4000);
    expect(list.body.saldo).toBe(6000);
    expect(list.body.cobros[0].medio).toBe('EFECTIVO');
  });

  it('anular cobro sube el saldo', async () => {
    const r = await nuevaReserva(10000);
    const c = await supertest(app)
      .post(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${recep()}`)
      .send({ monto: 4000, medio: 'EFECTIVO' });
    await supertest(app)
      .delete(`/cobros/${c.body.cobro.id}`)
      .set('authorization', `Bearer ${recep()}`);
    const list = await supertest(app)
      .get(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${recep()}`);
    expect(list.body.saldo).toBe(10000);
  });

  it('caja agrega por medio y por cancha (cobros de hoy)', async () => {
    const r = await nuevaReserva(10000);
    await supertest(app)
      .post(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${recep()}`)
      .send({ monto: 4000, medio: 'EFECTIVO' });
    await supertest(app)
      .post(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${recep()}`)
      .send({ monto: 3000, medio: 'TRANSFERENCIA' });
    const res = await supertest(app)
      .get('/caja')
      .set('authorization', `Bearer ${recep()}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(7000);
    expect(res.body.porMedio.EFECTIVO).toBe(4000);
    expect(res.body.porMedio.TRANSFERENCIA).toBe(3000);
    expect(res.body.porCancha[0].total).toBe(7000);
  });

  it('aprobar seña crea un cobro de transferencia y la caja lo cuenta', async () => {
    const cl = await getPrisma().cliente.create({ data: { nombre: 'Ana', whatsapp: '+2' } });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId,
        clienteId: cl.id,
        estado: 'ESPERANDO_SENA',
        esContacto: false,
        monto: 10000,
        montoSena: 5000,
        fechaInicio: new Date(),
        fechaFin: new Date(Date.now() + 3600000),
      },
    });
    await getPrisma().pago.create({ data: { reservaId: r.id, estado: 'PENDIENTE' } });
    const ap = await supertest(app)
      .patch(`/reservas/${r.id}/aprobar-sena`)
      .set('x-api-key', 'svc')
      .send({});
    expect(ap.status).toBe(200);
    const list = await supertest(app)
      .get(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${recep()}`);
    expect(list.body.cobros.some((c: any) => c.medio === 'TRANSFERENCIA' && c.monto === 5000 && c.origen === 'SENA')).toBe(true);
    expect(list.body.saldo).toBe(5000);
  });

  it('monto inválido → 400', async () => {
    const r = await nuevaReserva();
    const res = await supertest(app)
      .post(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${recep()}`)
      .send({ monto: 0, medio: 'EFECTIVO' });
    expect(res.status).toBe(400);
  });
});

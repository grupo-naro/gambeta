import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
let canchaId: string;
let clienteId: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } })).id;
  clienteId = (await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } })).id;
});

async function crearEsperandoSena() {
  const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId,
    whatsapp: '+5491150000000',
    nombreCliente: 'Juan',
    esContacto: false,
    fecha: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    horaInicio: '18:00',
    montoSena: 500,
  });
  return res.body.id as string;
}

describe('seña lifecycle', () => {
  it('IA approval (service key) confirms and writes an audit log', async () => {
    const id = await crearEsperandoSena();
    const res = await supertest(app)
      .patch(`/reservas/${id}/aprobar-sena`)
      .set('x-api-key', 'svc')
      .send({ montoDetectado: 500, comprobanteUrl: 'https://x/img.png' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CONFIRMADA');
    const pago = await getPrisma().pago.findUnique({ where: { reservaId: id } });
    expect(pago?.estado).toBe('APROBADO');
    expect(pago?.verificadoPor).toBe('IA');
    expect(await getPrisma().auditLog.count({ where: { accion: 'APROBAR_SENA' } })).toBe(1);
  });

  it('reject cancels the reserva', async () => {
    const id = await crearEsperandoSena();
    const res = await supertest(app)
      .patch(`/reservas/${id}/rechazar-sena`)
      .set('x-api-key', 'svc')
      .send({});
    expect(res.body.estado).toBe('CANCELADA');
  });

  it('double approval -> 409 (invalid transition)', async () => {
    const id = await crearEsperandoSena();
    await supertest(app).patch(`/reservas/${id}/aprobar-sena`).set('x-api-key', 'svc').send({});
    const res = await supertest(app).patch(`/reservas/${id}/aprobar-sena`).set('x-api-key', 'svc').send({});
    expect(res.status).toBe(409);
  });

  it('reject writes a RECHAZAR_SENA audit log and marks Pago as RECHAZADO', async () => {
    const id = await crearEsperandoSena();
    const res = await supertest(app)
      .patch(`/reservas/${id}/rechazar-sena`)
      .set('x-api-key', 'svc')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');
    expect(await getPrisma().auditLog.count({ where: { accion: 'RECHAZAR_SENA' } })).toBe(1);
    const pago = await getPrisma().pago.findUnique({ where: { reservaId: id } });
    expect(pago?.estado).toBe('RECHAZADO');
  });
});

describe('vencidasSena', () => {
  it('surfaces an old ESPERANDO_SENA reserva (40m ago) but not a fresh one', async () => {
    const futureStart = new Date(Date.now() + 48 * 3600_000);
    const futureFin = new Date(futureStart.getTime() + 3600_000);

    // Old reserva: created 40 minutes ago — should appear as vencida
    const old = await getPrisma().reserva.create({
      data: {
        canchaId,
        clienteId,
        estado: 'ESPERANDO_SENA',
        esContacto: false,
        monto: 1000,
        fechaInicio: futureStart,
        fechaFin: futureFin,
        creadoEn: new Date(Date.now() - 40 * 60_000),
      },
    });

    // Fresh reserva: created now — should NOT appear as vencida
    const freshStart = new Date(Date.now() + 72 * 3600_000);
    const freshFin = new Date(freshStart.getTime() + 3600_000);
    const fresh = await getPrisma().reserva.create({
      data: {
        canchaId,
        clienteId,
        estado: 'ESPERANDO_SENA',
        esContacto: false,
        monto: 1000,
        fechaInicio: freshStart,
        fechaFin: freshFin,
      },
    });

    const res = await supertest(app).get('/reservas/vencidas-sena').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((r: any) => r.id);
    expect(ids).toContain(old.id);
    expect(ids).not.toContain(fresh.id);
  });
});

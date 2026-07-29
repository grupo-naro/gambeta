import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
let canchaId: string;
let clienteId: string;
let token: string;
let adminId: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  // Create a real AdminUser so the auditLog FK constraint is satisfied
  const admin = await getPrisma().adminUser.create({
    data: { email: 'a@b.com', nombre: 'Admin', passwordHash: await hashPassword('pw') },
  });
  adminId = admin.id;
  token = signAdminToken({ adminId, email: 'a@b.com', rol: 'ADMIN' });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } })).id;
  clienteId = (await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } })).id;
});

// helper: create a CONFIRMADA reserva N minutes from now
async function reservaEnMinutos(m: number) {
  const inicio = new Date(Date.now() + m * 60_000);
  const fin = new Date(inicio.getTime() + 3600_000);
  return getPrisma().reserva.create({
    data: { canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000, fechaInicio: inicio, fechaFin: fin },
  });
}

describe('cancelación — ventana de anticipación', () => {
  it('service principal can cancel OUTSIDE the window (e.g. 30min before)', async () => {
    const r = await reservaEnMinutos(30);
    const res = await supertest(app).patch(`/reservas/${r.id}/cancelar`).set('x-api-key', 'svc').send({});
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');
  });

  it('service principal is BLOCKED inside the window (e.g. 5min before) with 422', async () => {
    const r = await reservaEnMinutos(5);
    const res = await supertest(app).patch(`/reservas/${r.id}/cancelar`).set('x-api-key', 'svc').send({});
    expect(res.status).toBe(422);
    const after = await getPrisma().reserva.findUnique({ where: { id: r.id } });
    expect(after?.estado).toBe('CONFIRMADA'); // unchanged
  });

  it('admin can FORCE-cancel inside the window', async () => {
    const r = await reservaEnMinutos(5);
    const res = await supertest(app).patch(`/reservas/${r.id}/cancelar`).set('authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');
    expect(await getPrisma().auditLog.count({ where: { accion: 'CANCELAR_RESERVA' } })).toBe(1);
  });
});

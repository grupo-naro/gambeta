import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const admin = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

async function crearCancha() {
  return getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol5', precioHora: 12000 } });
}

describe('DELETE /canchas/:id', () => {
  it('deletes a cancha with no reservations', async () => {
    const c = await crearCancha();
    const res = await supertest(app).delete(`/canchas/${c.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await getPrisma().cancha.findUnique({ where: { id: c.id } })).toBeNull();
  });

  it('409 when the cancha has reservations', async () => {
    const c = await crearCancha();
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    const inicio = new Date(Date.now() + 72 * 3600_000);
    await getPrisma().reserva.create({
      data: { canchaId: c.id, clienteId: cliente.id, estado: 'CONFIRMADA', esContacto: true, monto: 12000, montoSena: null, fechaInicio: inicio, fechaFin: new Date(inicio.getTime() + 3600_000) },
    });
    const res = await supertest(app).delete(`/canchas/${c.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(await getPrisma().cancha.findUnique({ where: { id: c.id } })).not.toBeNull();
  });

  it('404 when the cancha does not exist', async () => {
    const res = await supertest(app).delete('/canchas/nope').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('401 without auth', async () => {
    const c = await crearCancha();
    const res = await supertest(app).delete(`/canchas/${c.id}`);
    expect(res.status).toBe(401);
  });
});

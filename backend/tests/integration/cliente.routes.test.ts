import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000, jugadores: 5 } })).id; });

const crearCliente = (whatsapp: string, nombre = 'Juan') =>
  supertest(app).post('/clientes').set('x-api-key', 'svc').send({ whatsapp, nombre });

describe('PATCH /clientes/:id (whatsapp)', () => {
  it('edita el whatsapp del cliente', async () => {
    const c = (await crearCliente('+5491150000001')).body;
    const r = await supertest(app).patch(`/clientes/${c.id}`).set('authorization', `Bearer ${token}`).send({ whatsapp: '1136620274' });
    expect(r.status).toBe(200);
    const updated = await getPrisma().cliente.findUnique({ where: { id: c.id } });
    expect(updated?.whatsapp).not.toBe('+5491150000001');
  });

  it('rechaza whatsapp duplicado con 409', async () => {
    const a = (await crearCliente('+5491150000001', 'A')).body;
    await crearCliente('+5491150000002', 'B');
    const r = await supertest(app).patch(`/clientes/${a.id}`).set('authorization', `Bearer ${token}`).send({ whatsapp: '+5491150000002' });
    expect(r.status).toBe(409);
  });
});

describe('DELETE /clientes/:id', () => {
  it('elimina un cliente sin reservas', async () => {
    const c = (await crearCliente('+5491150000003')).body;
    const r = await supertest(app).delete(`/clientes/${c.id}`).set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(await getPrisma().cliente.count({ where: { id: c.id } })).toBe(0);
  });

  it('bloquea eliminar si el cliente tiene reservas (409)', async () => {
    const fecha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId, whatsapp: '+5491150000004', nombreCliente: 'Con Reserva', esContacto: true, fecha, horaInicio: '18:00' });
    const c = (await getPrisma().cliente.findMany())[0]; // único cliente tras el reset
    const r = await supertest(app).delete(`/clientes/${c.id}`).set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(409);
    expect(await getPrisma().cliente.count({ where: { id: c.id } })).toBe(1);
  });
});

describe('clientes upsert (service key)', () => {
  it('creates then updates the same whatsapp without duplicating', async () => {
    const a = await supertest(app).post('/clientes').set('x-api-key', 'svc')
      .send({ nombre: 'Juan', whatsapp: '+5491150000000', esContacto: false });
    expect(a.status).toBe(200);

    const b = await supertest(app).post('/clientes').set('x-api-key', 'svc')
      .send({ nombre: 'Juan P', whatsapp: '+5491150000000', esContacto: true });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.esContacto).toBe(true);
  });
});

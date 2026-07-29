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

const fechaFutura = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

describe('POST /canchas genera sector y tiene turnos disponibles', () => {
  it('una cancha nueva nace con 1 sector y tiene turnos disponibles', async () => {
    const cre = await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`)
      .send({ nombre: 'Cancha Techada', tipo: 'futbol5', precioHora: 15000, jugadores: 5 });
    expect(cre.status).toBe(201);
    const id = cre.body.id;

    // La cancha nace con 1 sector (en vez de horarios)
    expect(await getPrisma().canchaSector.count({ where: { canchaId: id } })).toBe(1);

    const disp = await supertest(app).get('/disponibilidad').query({ canchaId: id, fecha: fechaFutura(7) }).set('x-api-key', 'svc');
    expect(disp.status).toBe(200);
    expect(disp.body.slots.length).toBeGreaterThan(0);
  });
});

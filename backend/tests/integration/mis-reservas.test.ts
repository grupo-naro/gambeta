import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { reservaService } from '../../src/services/reserva.service.js';

let app: any; let canchaId: string; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } })).id;
  const admin = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

const WA = '+5491150000000';
// Create a reserva for a given whatsapp at `h` hours from now (negative = past), with estado.
// NOTE: all seeds reuse the single `canchaId`, so the `reserva_no_overlap` exclusion
// constraint applies — distinct `h` offsets must be >=1h apart to avoid a 409 on insert.
async function seedReserva(whatsapp: string, h: number, estado: any = 'CONFIRMADA') {
  const cliente = await getPrisma().cliente.upsert({
    where: { whatsapp }, create: { whatsapp, nombre: 'Cli' }, update: {},
  });
  const inicio = new Date(Date.now() + h * 3600_000);
  const fin = new Date(inicio.getTime() + 3600_000);
  return getPrisma().reserva.create({
    data: { canchaId, clienteId: cliente.id, estado, esContacto: true, monto: 12000, montoSena: null, fechaInicio: inicio, fechaFin: fin },
  });
}

describe('reservaService.misReservas', () => {
  it('returns only future active reservations, ascending by fechaInicio', async () => {
    await seedReserva(WA, 72);             // future CONFIRMADA
    await seedReserva(WA, 24, 'ESPERANDO_SENA'); // future ESPERANDO_SENA (earlier)
    await seedReserva(WA, -24);            // past -> excluded
    await seedReserva(WA, 48, 'CANCELADA'); // cancelled -> excluded
    const res = await reservaService.misReservas(WA);
    expect(res.map((r: any) => r.estado)).toEqual(['ESPERANDO_SENA', 'CONFIRMADA']);
    expect((res[0] as any).cancha.nombre).toBe('C');
  });
});

describe('GET /reservas/mias', () => {
  it('200 with the client\'s future active reservations via x-api-key', async () => {
    await seedReserva(WA, 72);
    const res = await supertest(app).get('/reservas/mias').query({ whatsapp: WA }).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].cancha.nombre).toBe('C');
  });

  it('isolates by whatsapp (does not return another client\'s reservations)', async () => {
    await seedReserva(WA, 72);
    await seedReserva('+5491159999999', 96); // +96h (not +72h) so it doesn't overlap WA's slot on the same cancha
    const res = await supertest(app).get('/reservas/mias').query({ whatsapp: WA }).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('200 [] when the client has no upcoming reservations', async () => {
    await seedReserva(WA, -24); // only a past one
    const res = await supertest(app).get('/reservas/mias').query({ whatsapp: WA }).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('400 when whatsapp is missing', async () => {
    const res = await supertest(app).get('/reservas/mias').set('x-api-key', 'svc');
    expect(res.status).toBe(400);
  });

  it('200 with JWT admin (authAny accepts JWT too)', async () => {
    await seedReserva(WA, 72);
    const res = await supertest(app).get('/reservas/mias').query({ whatsapp: WA }).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

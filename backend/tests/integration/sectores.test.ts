import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('modelo de sectores', () => {
  it('el constraint anti-overlap vive en ReservaSector (dos ocupaciones del mismo sector que se solapan fallan)', async () => {
    const p = getPrisma();
    const sector = await p.sector.create({ data: { nombre: 'S1' } });
    const cancha = await p.cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
    const cli = await p.cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    const ini = new Date(Date.now() + 72 * 3600_000); const fin = new Date(ini.getTime() + 3600_000);
    const r1 = await p.reserva.create({ data: { canchaId: cancha.id, clienteId: cli.id, estado: 'CONFIRMADA', esContacto: true, monto: 12000, fechaInicio: ini, fechaFin: fin } });
    await p.reservaSector.create({ data: { reservaId: r1.id, sectorId: sector.id, estado: 'CONFIRMADA', fechaInicio: ini, fechaFin: fin } });
    const r2 = await p.reserva.create({ data: { canchaId: cancha.id, clienteId: cli.id, estado: 'CONFIRMADA', esContacto: true, monto: 12000, fechaInicio: ini, fechaFin: fin } });
    await expect(
      p.reservaSector.create({ data: { reservaId: r2.id, sectorId: sector.id, estado: 'CONFIRMADA', fechaInicio: ini, fechaFin: fin } }),
    ).rejects.toThrow();
  });
});

describe('reserva escribe ReservaSector (cancha simple)', () => {
  it('crear reserva genera ReservaSector y un segundo solape da 409', async () => {
    // crear cancha vía POST /canchas (ya crea sector)
    const c = await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 });
    const fecha = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const r1 = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: c.body.id, whatsapp: '+5491150000000', nombreCliente: 'A', esContacto: true, fecha, horaInicio: '20:00' });
    expect(r1.status).toBe(201);
    expect(await getPrisma().reservaSector.count({ where: { reservaId: r1.body.id } })).toBe(1);
    const r2 = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: c.body.id, whatsapp: '+5491150000001', nombreCliente: 'B', esContacto: true, fecha, horaInicio: '20:00' });
    expect(r2.status).toBe(409);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { configService } from '../../src/services/config.service.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
let sectorId: string;
beforeEach(async () => {
  await resetTables();
  const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } });
  canchaId = c.id;
  // Crear sector para que disponibilidad pueda consultar ReservaSector
  const s = await getPrisma().sector.create({ data: { nombre: 'S' } });
  sectorId = s.id;
  await getPrisma().canchaSector.create({ data: { canchaId, sectorId } });
  // Set global config hours to 18:00-21:00 (3 slots) — same as the old HorarioDisponible setup.
  await configService.get(); // ensure row exists
  await configService.update({ horaApertura: '18:00', horaCierre: '21:00' });
});

describe('GET /disponibilidad', () => {
  it('returns 5 slots every 30 minutes when nothing is booked', async () => {
    const res = await supertest(app).get(`/disponibilidad?canchaId=${canchaId}&fecha=2026-06-12`).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    // Granularidad de 30 minutos (Task 4): 18:00-21:00 produce 5 turnos (20:30 queda afuera
    // porque ninguna duración entra antes del cierre).
    expect(res.body.slots).toHaveLength(5);
    expect(res.body.slots[0].horaInicio).toBe('18:00');
  });

  it('excludes a booked slot', async () => {
    const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    // 19:00 ART = 22:00 UTC
    const reserva = await getPrisma().reserva.create({
      data: {
        canchaId, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto: 1000,
        fechaInicio: new Date('2026-06-12T22:00:00.000Z'),
        fechaFin: new Date('2026-06-12T23:00:00.000Z'),
      },
    });
    // Crear ReservaSector para que disponibilidad lo detecte
    await getPrisma().reservaSector.create({
      data: {
        reservaId: reserva.id, sectorId, estado: 'CONFIRMADA',
        fechaInicio: new Date('2026-06-12T22:00:00.000Z'),
        fechaFin: new Date('2026-06-12T23:00:00.000Z'),
      },
    });
    const res = await supertest(app).get(`/disponibilidad?canchaId=${canchaId}&fecha=2026-06-12`).set('x-api-key', 'svc');
    expect(res.body.slots.map((s: any) => s.horaInicio)).toEqual(['18:00', '20:00']);
  });
});

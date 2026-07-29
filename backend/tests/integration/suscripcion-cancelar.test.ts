import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { aFechaUtc } from '../../src/services/suscripcion.vigencia.js';

let app: any;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });

describe('PATCH /suscripciones/:id/cancelar', () => {
  it('cancela y deja de estar vigente', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000050' } });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    const res = await supertest(app).patch(`/suscripciones/${s.id}/cancelar`).set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');
    const { suscripcionService } = await import('../../src/services/suscripcion.service.js');
    expect(await suscripcionService.vigenteDe(c.id, '2026-08-15')).toBeNull();
  });

  it('NO recalcula las reservas ya bonificadas', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000051' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 10000, jugadores: 5 } });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: c.id, estado: 'CONFIRMADA', esContacto: false, monto: 0,
        montoLista: 10000, suscripcionId: s.id,
        fechaInicio: new Date('2026-08-20T20:00:00.000Z'), fechaFin: new Date('2026-08-20T21:00:00.000Z'),
      },
    });
    await supertest(app).patch(`/suscripciones/${s.id}/cancelar`).set('authorization', `Bearer ${admin()}`);
    const despues = await getPrisma().reserva.findUnique({ where: { id: r.id } });
    expect(Number(despues!.monto)).toBe(0);
    expect(despues!.suscripcionId).toBe(s.id);
    expect(despues!.estado).toBe('CONFIRMADA');
  });

  it('suscripcion inexistente → 404', async () => {
    const res = await supertest(app).patch('/suscripciones/no-existe/cancelar').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(404);
  });
});

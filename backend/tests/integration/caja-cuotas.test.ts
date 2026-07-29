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

describe('caja con cuotas de suscripcion', () => {
  it('separa el total por concepto y no rompe porCancha', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000060' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 10000, jugadores: 5 } });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: c.id, estado: 'CONFIRMADA', esContacto: true, monto: 10000,
        fechaInicio: new Date(), fechaFin: new Date(Date.now() + 3600000),
      },
    });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    await getPrisma().cobro.create({ data: { reservaId: r.id, monto: 10000, medio: 'EFECTIVO', origen: 'MANUAL' } });
    await getPrisma().cobro.create({ data: { suscripcionId: s.id, monto: 20000, medio: 'TRANSFERENCIA', origen: 'SUSCRIPCION' } });

    const res = await supertest(app).get('/caja').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(30000);
    expect(res.body.porConcepto.turnos).toBe(10000);
    expect(res.body.porConcepto.cuotas).toBe(20000);
    expect(res.body.porMedio.EFECTIVO).toBe(10000);
    expect(res.body.porMedio.TRANSFERENCIA).toBe(20000);
    // La cuota no tiene cancha: porCancha solo cuenta el turno.
    expect(res.body.porCancha).toHaveLength(1);
    expect(res.body.porCancha[0].total).toBe(10000);
    const cuota = res.body.cobros.find((x: any) => x.concepto === 'CUOTA');
    expect(cuota.cliente).toBe('Socio');
    expect(cuota.cancha).toBe('-');
  });
});

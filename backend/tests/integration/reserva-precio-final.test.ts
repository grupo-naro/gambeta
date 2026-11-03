import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaMontoFijo: 5000 } });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol', precioHora: 65000, jugadores: 5, senaMonto: 10000 } })).id;
});
const fut = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const crear = (extra: Record<string, unknown>, auth = true) => {
  const r = supertest(app).post('/reservas');
  return (auth ? r.set('authorization', `Bearer ${token}`) : r.set('x-api-key', 'svc'))
    .send({ canchaId, whatsapp: '+5491150000031', nombreCliente: 'Staff', fecha: fut(), horaInicio: '18:00', ...extra });
};

describe('POST /reservas — precio final editable (panel)', () => {
  it('sin montoFinal usa el precio de lista', async () => {
    const r = await crear({});
    expect(r.status).toBe(201);
    expect(Number(r.body.monto)).toBe(65000);
  });

  it('con montoFinal la reserva queda con ese precio (65 → 55)', async () => {
    const r = await crear({ montoFinal: 55000 });
    expect(r.status).toBe(201);
    expect(Number(r.body.monto)).toBe(55000);
  });

  it('cobroInicial total cobra el precio final, no el de lista', async () => {
    const r = await crear({ montoFinal: 55000, cobroInicial: 'total' });
    expect(r.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id } });
    expect(Number(cobros[0].monto)).toBe(55000);
  });

  it('se puede dejar en $0 (turno de cortesía)', async () => {
    const r = await crear({ montoFinal: 0 });
    expect(r.status).toBe(201);
    expect(Number(r.body.monto)).toBe(0);
  });

  it('montoFinal negativo es 400', async () => {
    expect((await crear({ montoFinal: -1 })).status).toBe(400);
  });

  it('el autoservicio (service key) no puede cambiar el precio: 403', async () => {
    process.env['SERVICE_API_KEY'] = 'svc';
    const r = await crear({ montoFinal: 1000 }, false);
    expect(r.status).toBe(403);
    expect(await getPrisma().reserva.count()).toBe(0);
  });
});

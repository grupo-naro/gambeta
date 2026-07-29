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
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } })).id;
});
const fut = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const crear = (extra: Record<string, unknown>) =>
  supertest(app).post('/reservas').set('authorization', `Bearer ${token}`)
    .send({ canchaId, whatsapp: '+5491150000031', nombreCliente: 'Staff', fecha: fut(), horaInicio: '18:00', ...extra });

describe('POST /reservas — montoCobro (seña editable panel)', () => {
  it('registra el cobro por el monto ingresado si es mayor al default', async () => {
    const r = await crear({ cobroInicial: 'sena', medioCobro: 'TRANSFERENCIA', montoCobro: 18000 });
    expect(r.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBe(18000);
  });

  it('rechaza con 422 si el monto es menor al default y NO crea la reserva', async () => {
    const r = await crear({ cobroInicial: 'sena', montoCobro: 5000 });
    expect(r.status).toBe(422);
    expect(await getPrisma().reserva.count()).toBe(0);
  });

  it('usa el default de la cancha si no se manda montoCobro', async () => {
    const r = await crear({ cobroInicial: 'sena' });
    expect(r.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id } });
    expect(Number(cobros[0].monto)).toBe(10000);
  });

  it('cobroInicial total registra el precio completo', async () => {
    const r = await crear({ cobroInicial: 'total' });
    expect(r.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id } });
    expect(Number(cobros[0].monto)).toBe(20000);
  });
});

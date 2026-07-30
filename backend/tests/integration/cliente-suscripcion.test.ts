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

describe('DELETE /clientes/:id con suscripciones', () => {
  it('rechaza el borrado (409)', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000070' } });
    await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    const res = await supertest(app).delete(`/clientes/${c.id}`).set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(409);
    expect(await getPrisma().cliente.count()).toBe(1);
  });

  it('un cliente sin reservas ni suscripciones se puede borrar', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Comun', whatsapp: '+5491100000071' } });
    const res = await supertest(app).delete(`/clientes/${c.id}`).set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    expect(await getPrisma().cliente.count()).toBe(0);
  });
});

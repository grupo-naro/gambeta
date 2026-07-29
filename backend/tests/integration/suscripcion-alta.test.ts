import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });
const recep = () => signAdminToken({ adminId: 'r1', email: 'r@r.com', rol: 'RECEPCIONISTA' });

async function nuevoCliente(whatsapp = '+5491100000020') {
  return getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp } });
}

describe('POST /suscripciones', () => {
  it('crea la suscripcion sin cobro cuando no se manda precio', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app)
      .post('/suscripciones')
      .set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31' });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ACTIVA');
    expect(await getPrisma().cobro.count()).toBe(0);
  });

  it('crea la suscripcion y el cobro de la cuota cuando se manda precio + medio', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app)
      .post('/suscripciones')
      .set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31', precio: 20000, medio: 'EFECTIVO' });
    expect(res.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany();
    expect(cobros).toHaveLength(1);
    expect(cobros[0].suscripcionId).toBe(res.body.id);
    expect(cobros[0].reservaId).toBeNull();
    expect(cobros[0].origen).toBe('SUSCRIPCION');
    expect(Number(cobros[0].monto)).toBe(20000);
  });

  it('rechaza precio sin medio (400)', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app)
      .post('/suscripciones')
      .set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31', precio: 20000 });
    expect(res.status).toBe(400);
  });

  it('rechaza vencimiento anterior al inicio (400)', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app)
      .post('/suscripciones')
      .set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-31', vencimiento: '2026-08-01' });
    expect(res.status).toBe(400);
  });

  it('rechaza el solapamiento con otra suscripcion activa (409)', async () => {
    const c = await nuevoCliente();
    await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31' });
    const res = await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-15', vencimiento: '2026-09-15' });
    expect(res.status).toBe(409);
  });

  it('permite un periodo consecutivo sin solape', async () => {
    const c = await nuevoCliente();
    await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31' });
    const res = await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-09-01', vencimiento: '2026-09-30' });
    expect(res.status).toBe(201);
  });

  it('cliente inexistente → 404', async () => {
    const res = await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: 'no-existe', inicio: '2026-08-01', vencimiento: '2026-08-31' });
    expect(res.status).toBe(404);
  });

  it('recepcionista no puede dar de alta socios (403)', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app).post('/suscripciones').set('authorization', `Bearer ${recep()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31' });
    expect(res.status).toBe(403);
  });

  it('sin autenticacion → 401', async () => {
    const res = await supertest(app).post('/suscripciones').send({});
    expect(res.status).toBe(401);
  });
});

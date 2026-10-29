import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let adminToken: string; let mostradorToken: string;
let canchaId: string; let cocaId: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  adminToken = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  await p.mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  mostradorToken = (await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '1111' })).body.token;
  canchaId = (await p.cancha.create({ data: { nombre: 'Cancha 1', tipo: 'padel', precioHora: 30000 } })).id;
  await p.cancha.create({ data: { nombre: 'Vieja', tipo: 'padel', precioHora: 30000, activa: false } });
  cocaId = (await p.productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 10 } })).id;
});

// authMostrador exige el token que emite /pin/verificar además de la x-buffet-key.
const m = (r: any) => r.set('x-buffet-key', KEY).set('x-mostrador', mostradorToken);
const abrir = async () => (await m(supertest(app).post('/buffet/cuentas')).send({ canchaId })).body;

describe('rutas de cuentas del mostrador', () => {
  it('GET /buffet/canchas lista solo las canchas de pádel activas (no fútbol ni inactivas)', async () => {
    await getPrisma().cancha.create({ data: { nombre: 'Fútbol 5', tipo: 'futbol5', precioHora: 30000 } });
    const r = await m(supertest(app).get('/buffet/canchas'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ id: canchaId, nombre: 'Cancha 1' }]);
  });

  it('POST /buffet/cuentas abre (201) y un segundo intento en la misma cancha es 409', async () => {
    const a = await m(supertest(app).post('/buffet/cuentas')).send({ canchaId });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ canchaId, estado: 'ABIERTA', lineas: [], total: 0 });
    const b = await m(supertest(app).post('/buffet/cuentas')).send({ canchaId });
    expect(b.status).toBe(409);
  });

  it('GET /buffet/cuentas y /buffet/cuentas/:id devuelven la cuenta', async () => {
    const c = await abrir();
    const lista = await m(supertest(app).get('/buffet/cuentas'));
    expect(lista.body.map((x: any) => x.id)).toEqual([c.id]);
    const uno = await m(supertest(app).get(`/buffet/cuentas/${c.id}`));
    expect(uno.status).toBe(200);
    expect(uno.body.id).toBe(c.id);
  });

  it('PUT .../lineas/:productoId fija la cantidad y devuelve la cuenta con el total', async () => {
    const c = await abrir();
    const r = await m(supertest(app).put(`/buffet/cuentas/${c.id}/lineas/${cocaId}`)).send({ cantidad: 3 });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(6000);
    expect(r.body.lineas[0]).toMatchObject({ productoId: cocaId, cantidad: 3 });
  });

  it.each([[-1], [1.5], [100000], ['abc']])('PUT con cantidad %s se rechaza con 400', async (cantidad) => {
    const c = await abrir();
    const r = await m(supertest(app).put(`/buffet/cuentas/${c.id}/lineas/${cocaId}`)).send({ cantidad });
    expect(r.status).toBe(400);
  });

  it('rendir cobra y devuelve ticket, total y vuelto', async () => {
    await m(supertest(app).post('/buffet/caja/abrir'));
    const c = await abrir();
    await m(supertest(app).put(`/buffet/cuentas/${c.id}/lineas/${cocaId}`)).send({ cantidad: 2 });
    const r = await m(supertest(app).post(`/buffet/cuentas/${c.id}/rendir`)).send({ medioPago: 'EFECTIVO', montoPagado: 5000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 4000, vuelto: 1000 });
    expect(r.body.cuenta.estado).toBe('RENDIDA');
  });

  it('rendir con un medio de pago inválido es 400', async () => {
    const c = await abrir();
    const r = await m(supertest(app).post(`/buffet/cuentas/${c.id}/rendir`)).send({ medioPago: 'TARJETA', montoPagado: 1 });
    expect(r.status).toBe(400);
  });

  it('cancelar devuelve la cuenta cancelada', async () => {
    const c = await abrir();
    const r = await m(supertest(app).post(`/buffet/cuentas/${c.id}/cancelar`));
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('CANCELADA');
  });

  it('impaga devuelve la cuenta impaga', async () => {
    await m(supertest(app).post('/buffet/caja/abrir'));
    const c = await abrir();
    const r = await m(supertest(app).post(`/buffet/cuentas/${c.id}/impaga`));
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('IMPAGA');
  });

  it('sin x-mostrador es 401', async () => {
    const r = await supertest(app).get('/buffet/cuentas').set('x-buffet-key', KEY);
    expect(r.status).toBe(401);
  });
});

describe('lista de cuentas del admin', () => {
  it('el JWT de admin ve las cuentas de todos los mostradores y filtra por estado', async () => {
    const c = await abrir();
    const todas = await supertest(app).get('/buffet/admin/cuentas').set('authorization', `Bearer ${adminToken}`);
    expect(todas.status).toBe(200);
    expect(todas.body.map((x: any) => x.id)).toEqual([c.id]);
    const rendidas = await supertest(app).get('/buffet/admin/cuentas?estado=RENDIDA').set('authorization', `Bearer ${adminToken}`);
    expect(rendidas.body).toEqual([]);
  });

  it('el token de mostrador no sirve en la ruta de admin', async () => {
    const r = await m(supertest(app).get('/buffet/admin/cuentas'));
    expect(r.status).toBe(401);
  });

  it('un estado inválido es 400', async () => {
    const r = await supertest(app).get('/buffet/admin/cuentas?estado=XYZ').set('authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(400);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let token: string; let adminId: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  // AuditLog tiene FK a AdminUser: hay que sembrar un admin real.
  const admin = await getPrisma().adminUser.create({
    data: { email: 'admin@test.com', passwordHash: 'x', nombre: 'Admin', rol: 'ADMIN' },
  });
  adminId = admin.id;
  token = signAdminToken({ adminId, email: admin.email, rol: 'ADMIN' });
});

const auth = (r: any) => r.set('authorization', `Bearer ${token}`);

describe('buffet: catalogo de productos', () => {
  it('la buffet-key NO abre las rutas de admin', async () => {
    const r = await supertest(app).get('/buffet/productos').set('x-buffet-key', KEY);
    expect(r.status).toBe(401);
  });

  it('crea un producto con codigo de barras y lo lista', async () => {
    const c = await auth(supertest(app).post('/buffet/productos'))
      .send({ nombre: 'Coca 500', codigoBarra: '7790895000997', precio: 1500, stock: 10, stockMinimo: 3 });
    expect(c.status).toBe(201);
    expect(c.body.precio).toBe(1500);

    const l = await auth(supertest(app).get('/buffet/productos'));
    expect(l.status).toBe(200);
    expect(l.body).toHaveLength(1);
    expect(l.body[0].codigoBarra).toBe('7790895000997');
  });

  it('crea un preparado sin codigo de barras, en la botonera', async () => {
    const c = await auth(supertest(app).post('/buffet/productos'))
      .send({ nombre: 'Pancho', precio: 2500, enBotonera: true, orden: 1 });
    expect(c.status).toBe(201);
    expect(c.body.codigoBarra).toBeNull();
  });

  it('dos preparados sin codigo no colisionan (muchos NULL en columna unica)', async () => {
    await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Pancho', precio: 2500 });
    const b = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Sanguche', precio: 3000 });
    expect(b.status).toBe(201);
  });

  it('rechaza un codigo de barras duplicado con 409', async () => {
    await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Coca', codigoBarra: '111', precio: 1500 });
    const b = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Otra', codigoBarra: '111', precio: 1600 });
    expect(b.status).toBe(409);
  });

  it('PATCH cambia el precio', async () => {
    const c = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Coca', precio: 1500 });
    const u = await auth(supertest(app).patch(`/buffet/productos/${c.body.id}`)).send({ precio: 1800 });
    expect(u.status).toBe(200);
    expect(u.body.precio).toBe(1800);
  });

  it('reponer suma stock y deja rastro en el AuditLog', async () => {
    const c = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Coca', precio: 1500, stock: 2 });
    const r = await auth(supertest(app).post(`/buffet/productos/${c.body.id}/reponer`)).send({ cantidad: 12 });
    expect(r.status).toBe(200);
    expect(r.body.stock).toBe(14);

    const logs = await getPrisma().auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].entidad).toBe('ProductoBuffet');
  });

  it('reponer con cantidad 0 o negativa es 400', async () => {
    const c = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Coca', precio: 1500 });
    const r = await auth(supertest(app).post(`/buffet/productos/${c.body.id}/reponer`)).send({ cantidad: 0 });
    expect(r.status).toBe(400);

    const r2 = await auth(supertest(app).post(`/buffet/productos/${c.body.id}/reponer`)).send({ cantidad: -5 });
    expect(r2.status).toBe(400);
  });

  it('reponer un producto inexistente es 404', async () => {
    const r = await auth(supertest(app).post('/buffet/productos/noexiste/reponer')).send({ cantidad: 5 });
    expect(r.status).toBe(404);
  });

  it('un RECEPCIONISTA recibe 403 al crear un producto; un ADMIN sigue pudiendo (2xx)', async () => {
    const recepToken = signAdminToken({ adminId, email: 'r@b.com', rol: 'RECEPCIONISTA' });
    const r = await supertest(app).post('/buffet/productos').set('authorization', `Bearer ${recepToken}`)
      .send({ nombre: 'Coca', precio: 1500 });
    expect(r.status).toBe(403);

    const ok = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Coca', precio: 1500 });
    expect(ok.status).toBe(201);
  });
});

describe('buffet: productos activos (mostrador)', () => {
  // authMostrador exige el token que emite /pin/verificar además de la x-buffet-key.
  const mostrador = (r: any, token: string) => r.set('x-buffet-key', KEY).set('x-mostrador', token);

  async function tokenPrincipal(): Promise<string> {
    await getPrisma().mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
    const login = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '1111' });
    return login.body.token;
  }

  it('devuelve solo activos, ordenados por nombre, con {id,nombre,precio}', async () => {
    const p = getPrisma();
    await p.productoBuffet.create({ data: { nombre: 'Pancho', precio: '2500', stock: 5, activo: true } });
    await p.productoBuffet.create({ data: { nombre: 'Agua', precio: '1000', stock: 5, activo: true } });
    await p.productoBuffet.create({ data: { nombre: 'Viejo', precio: '100', stock: 0, activo: false } });

    const token = await tokenPrincipal();
    const r = await mostrador(supertest(app).get('/buffet/productos/activos'), token);
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.nombre)).toEqual(['Agua', 'Pancho']);
    expect(r.body[0]).toEqual({ id: expect.any(String), nombre: 'Agua', precio: 1000 });
  });

  it('sin buffet-key devuelve 401', async () => {
    const r = await supertest(app).get('/buffet/productos/activos');
    expect(r.status).toBe(401);
  });

  it('con buffet-key pero sin token de mostrador devuelve 401', async () => {
    const r = await supertest(app).get('/buffet/productos/activos').set('x-buffet-key', KEY);
    expect(r.status).toBe(401);
  });
});

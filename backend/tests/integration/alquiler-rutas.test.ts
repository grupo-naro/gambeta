import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { hashPassword } from '../../src/utils/password.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let tokenPrincipal: string; let tokenSecundario: string; let jwtAdmin: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

const login = (pin: string) => supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin });

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  await p.mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  await p.mostrador.update({ where: { id: 'mostrador-secundario' }, data: { pinHash: await hashPassword('2222') } });
  // Solo logueamos el principal acá: el secundario se loguea únicamente en el test que lo
  // necesita, para no gastar el cupo del loginLimiter (10/15min) con logins que la mayoría
  // de los tests ni usa — con los dos en cada beforeEach, 7 tests dan 14 llamadas y lo superan.
  tokenPrincipal = (await login('1111')).body.token;

  // El admin tiene que existir de verdad: el AuditLog tiene FK a AdminUser y `auditService`
  // traga sus errores, así que con un id inventado el log simplemente no se escribiría y el
  // test de auditoría pasaría a ser mentira.
  const admin = await p.adminUser.create({
    data: { nombre: 'Admin', email: 'admin@test.com', passwordHash: await hashPassword('secreta123'), rol: 'ADMIN' },
  });
  jwtAdmin = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

const comoMostrador = (r: any, token: string) => r.set('x-buffet-key', KEY).set('x-mostrador', token);
const comoAdmin = (r: any) => r.set('Authorization', `Bearer ${jwtAdmin}`);

describe('rutas de alquileres', () => {
  it('el admin crea un artículo y el mostrador lo ve en la botonera', async () => {
    const creado = await comoAdmin(supertest(app).post('/alquileres/articulos'))
      .send({ nombre: 'Raqueta', precio: 3000, stock: 4 });
    expect(creado.status).toBe(201);
    expect(creado.body.disponible).toBe(4);

    const botonera = await comoMostrador(supertest(app).get('/alquileres/botonera'), tokenPrincipal);
    expect(botonera.status).toBe(200);
    expect(botonera.body).toHaveLength(1);
  });

  it('el flujo completo: entregar y devolver', async () => {
    const art = await comoAdmin(supertest(app).post('/alquileres/articulos')).send({ nombre: 'Raqueta', precio: 3000, stock: 4 });
    await comoMostrador(supertest(app).post('/buffet/caja/abrir'), tokenPrincipal);

    const entrega = await comoMostrador(supertest(app).post('/alquileres/entregas'), tokenPrincipal)
      .send({ uid: 'u1', articuloId: art.body.id, cantidad: 1, quienRetira: 'Juan', garantia: 'DNI', medioPago: 'EFECTIVO', montoPagado: 5000 });
    expect(entrega.status).toBe(201);
    expect(entrega.body.vuelto).toBe(2000);

    const afuera = await comoMostrador(supertest(app).get('/alquileres/afuera'), tokenPrincipal);
    expect(afuera.body).toHaveLength(1);
    expect(afuera.body[0].garantia).toBe('DNI');

    const cierre = await comoMostrador(supertest(app).post(`/alquileres/${entrega.body.alquiler.id}/cerrar`), tokenPrincipal)
      .send({ estado: 'DEVUELTO' });
    expect(cierre.status).toBe(200);
    expect(cierre.body.estado).toBe('DEVUELTO');
    expect((await comoMostrador(supertest(app).get('/alquileres/afuera'), tokenPrincipal)).body).toHaveLength(0);
  });

  it('el secundario no llega a ninguna ruta de alquileres', async () => {
    tokenSecundario = (await login('2222')).body.token;
    expect((await comoMostrador(supertest(app).get('/alquileres/botonera'), tokenSecundario)).status).toBe(403);
    expect((await comoMostrador(supertest(app).get('/alquileres/afuera'), tokenSecundario)).status).toBe(403);
  });

  it('sin token de mostrador no se entrega', async () => {
    const r = await supertest(app).post('/alquileres/entregas').set('x-buffet-key', KEY)
      .send({ uid: 'u1', articuloId: 'x', cantidad: 1, quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 0 });
    expect(r.status).toBe(401);
  });

  it('el recepcionista no puede tocar el catálogo', async () => {
    const recep = signAdminToken({ adminId: 'recep-1', email: 'recep@test.com', rol: 'RECEPCIONISTA' });
    const r = await supertest(app).post('/alquileres/articulos').set('Authorization', `Bearer ${recep}`)
      .send({ nombre: 'Raqueta', precio: 3000 });
    expect(r.status).toBe(403);
  });

  it('el ajuste de stock queda auditado', async () => {
    const art = await comoAdmin(supertest(app).post('/alquileres/articulos')).send({ nombre: 'Raqueta', precio: 3000, stock: 4 });
    const r = await comoAdmin(supertest(app).post(`/alquileres/articulos/${art.body.id}/reponer`)).send({ cantidad: 3 });
    expect(r.status).toBe(200);
    expect(r.body.stock).toBe(7);
    const logs = await getPrisma().auditLog.findMany({ where: { entidad: 'ArticuloAlquiler' } });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('un estado inválido al cerrar no pasa la validación', async () => {
    const r = await comoMostrador(supertest(app).post('/alquileres/xyz/cerrar'), tokenPrincipal).send({ estado: 'PERDIDA' });
    expect(r.status).toBe(400);
  });
});

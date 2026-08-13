import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let token: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const comoAdmin = (r: any) => r.set('authorization', `Bearer ${token}`);

describe('GET /buffet/mostradores', () => {
  it('lista los dos mostradores con su tipo y si tienen PIN', async () => {
    const r = await comoAdmin(supertest(app).get('/buffet/mostradores'));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);

    const principal = r.body.find((m: any) => m.tipo === 'PRINCIPAL');
    expect(principal).toMatchObject({ id: 'mostrador-principal', activo: true, tienePin: false });
    expect(principal.nombre).toBeTruthy();
  });

  it('tienePin se vuelve true cuando el admin le carga el PIN', async () => {
    await comoAdmin(supertest(app).put('/buffet/pin')).send({ pin: '4321', mostradorId: 'mostrador-secundario' });

    const r = await comoAdmin(supertest(app).get('/buffet/mostradores'));
    const sec = r.body.find((m: any) => m.id === 'mostrador-secundario');
    expect(sec.tienePin).toBe(true);
  });

  it('NUNCA devuelve el hash del PIN', async () => {
    // Es el punto entero de exponer `tienePin` en vez del campo crudo: el panel necesita
    // saber si falta cargarlo, y para eso no hace falta filtrar el hash al browser.
    await comoAdmin(supertest(app).put('/buffet/pin')).send({ pin: '4321', mostradorId: 'mostrador-principal' });

    const r = await comoAdmin(supertest(app).get('/buffet/mostradores'));
    expect(JSON.stringify(r.body)).not.toContain('$2');
    for (const m of r.body) expect(m).not.toHaveProperty('pinHash');
  });

  it('sin JWT de admin no se puede listar', async () => {
    const r = await supertest(app).get('/buffet/mostradores').set('x-buffet-key', KEY);
    expect(r.status).toBe(401);
  });
});

describe('PATCH /buffet/mostradores/:id', () => {
  it('desactivar un mostrador le corta el acceso al instante', async () => {
    // Es la única palanca de revocación que existe: el token del mostrador no vence.
    await comoAdmin(supertest(app).put('/buffet/pin')).send({ pin: '4321', mostradorId: 'mostrador-principal' });
    const login = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '4321' });
    const tokenMostrador = login.body.token;

    const antes = await supertest(app).get('/buffet/caja/actual')
      .set('x-buffet-key', KEY).set('x-mostrador', tokenMostrador);
    expect(antes.status).toBe(200);

    const off = await comoAdmin(supertest(app).patch('/buffet/mostradores/mostrador-principal')).send({ activo: false });
    expect(off.status).toBe(200);
    expect(off.body.activo).toBe(false);

    const despues = await supertest(app).get('/buffet/caja/actual')
      .set('x-buffet-key', KEY).set('x-mostrador', tokenMostrador);
    expect(despues.status).toBe(401);
  });

  it('reactivar lo devuelve a operar', async () => {
    await comoAdmin(supertest(app).patch('/buffet/mostradores/mostrador-principal')).send({ activo: false });
    const on = await comoAdmin(supertest(app).patch('/buffet/mostradores/mostrador-principal')).send({ activo: true });
    expect(on.body.activo).toBe(true);

    const m = await getPrisma().mostrador.findUniqueOrThrow({ where: { id: 'mostrador-principal' } });
    expect(m.activo).toBe(true);
  });

  it('un mostrador que no existe da 404', async () => {
    const r = await comoAdmin(supertest(app).patch('/buffet/mostradores/no-existe')).send({ activo: false });
    expect(r.status).toBe(404);
  });

  it('un body sin `activo` se rechaza', async () => {
    const r = await comoAdmin(supertest(app).patch('/buffet/mostradores/mostrador-principal')).send({});
    expect(r.status).toBe(400);
  });

  it('sin JWT de admin no se puede desactivar', async () => {
    const r = await supertest(app).patch('/buffet/mostradores/mostrador-principal')
      .set('x-buffet-key', KEY).send({ activo: false });
    expect(r.status).toBe(401);
  });
});

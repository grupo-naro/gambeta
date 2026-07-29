import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let adminToken: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  adminToken = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('buffet: auth del mostrador', () => {
  it('sin x-buffet-key devuelve 401', async () => {
    const r = await supertest(app).get('/buffet/productos/botonera');
    expect(r.status).toBe(401);
  });

  it('con x-buffet-key incorrecta devuelve 401', async () => {
    const r = await supertest(app).get('/buffet/productos/botonera').set('x-buffet-key', 'otra-cosa');
    expect(r.status).toBe(401);
  });

  it('el JWT de admin NO abre las rutas del mostrador', async () => {
    const r = await supertest(app).get('/buffet/productos/botonera').set('authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(401);
  });

  it('con la key correcta devuelve la botonera, solo activos y en orden', async () => {
    const p = getPrisma();
    await p.productoBuffet.createMany({ data: [
      { nombre: 'Sanguche', precio: '3000', enBotonera: true, orden: 2, activo: true },
      { nombre: 'Pancho', precio: '2500', enBotonera: true, orden: 1, activo: true },
      { nombre: 'Agua caliente', precio: '1000', enBotonera: true, orden: 3, activo: false },
      { nombre: 'Coca 500', codigoBarra: '7790895000997', precio: '1500', enBotonera: false, orden: 0, activo: true },
    ] });
    const r = await supertest(app).get('/buffet/productos/botonera').set('x-buffet-key', KEY);
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.nombre)).toEqual(['Pancho', 'Sanguche']);
    expect(r.body[0].precio).toBe(2500); // number, no string: los Decimal se mapean con Number()
  });
});

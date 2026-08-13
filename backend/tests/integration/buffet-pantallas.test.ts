import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { hashPassword } from '../../src/utils/password.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  await getPrisma().mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  await getPrisma().mostrador.update({ where: { id: 'mostrador-secundario' }, data: { pinHash: await hashPassword('2222') } });
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 20 } })).id;
});

/** Loguea un puesto por PIN y devuelve su token de `x-mostrador`. */
async function tokenDe(pin: string): Promise<string> {
  const r = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin });
  return r.body.token;
}
const comoMostrador = (r: any, token: string) => r.set('x-buffet-key', KEY).set('x-mostrador', token);

describe('stock que ven las pantallas', () => {
  it('los productos activos traen el stock general', async () => {
    const t = await tokenDe('1111');
    const r = await comoMostrador(supertest(app).get('/buffet/productos/activos'), t);
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ nombre: 'Coca', stock: 20 });
  });

  it('sin query, stock-asignado devuelve el del que llama', async () => {
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), principal)
      .send({ items: [{ productoId, cantidad: 7 }] });

    const secundario = await tokenDe('2222');
    const r = await comoMostrador(supertest(app).get('/buffet/stock-asignado'), secundario);
    expect(r.body).toEqual([{ productoId, cantidad: 7 }]);
  });

  it('el principal puede pedir el asignado del secundario', async () => {
    // Es lo que hace la pantalla de entrega para mostrar "cuanto ya le di".
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), principal)
      .send({ items: [{ productoId, cantidad: 7 }] });

    const r = await comoMostrador(
      supertest(app).get('/buffet/stock-asignado?mostradorId=mostrador-secundario'), principal,
    );
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ productoId, cantidad: 7 }]);
  });

  it('el secundario NO puede espiar el asignado de otro puesto', async () => {
    const secundario = await tokenDe('2222');
    const r = await comoMostrador(
      supertest(app).get('/buffet/stock-asignado?mostradorId=mostrador-principal'), secundario,
    );
    expect(r.status).toBe(403);
  });

  it('pedir explicitamente el propio si esta permitido', async () => {
    const secundario = await tokenDe('2222');
    const r = await comoMostrador(
      supertest(app).get('/buffet/stock-asignado?mostradorId=mostrador-secundario'), secundario,
    );
    expect(r.status).toBe(200);
  });
});

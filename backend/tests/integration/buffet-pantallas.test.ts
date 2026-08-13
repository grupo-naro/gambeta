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

describe('cajas que esperan conteo', () => {
  /** Entrega 10, el secundario abre, vende `vendidas` y cierra. Devuelve el id de la caja. */
  async function turnoDelSecundario(vendidas: number): Promise<string> {
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), principal)
      .send({ items: [{ productoId, cantidad: 10 }] });

    const secundario = await tokenDe('2222');
    const caja = await comoMostrador(supertest(app).post('/buffet/caja/abrir'), secundario);
    if (vendidas > 0) {
      await comoMostrador(supertest(app).post('/buffet/cobrar'), secundario).send({
        uid: `uid-${Date.now()}-${Math.random()}`, medioPago: 'EFECTIVO', montoPagado: 999999,
        items: [{ productoId, cantidad: vendidas }],
      });
    }
    await comoMostrador(supertest(app).post('/buffet/caja/cerrar'), secundario);
    return caja.body.id;
  }

  it('lista la caja cerrada del secundario, con su total', async () => {
    const cajaId = await turnoDelSecundario(3);
    const principal = await tokenDe('1111');

    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), principal);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].cajaId).toBe(cajaId);
    expect(r.body[0].mostradorNombre).toBeTruthy();
    expect(r.body[0].totalMonto).toBe(6000);
    expect(r.body[0].cerradaEn).toBeTruthy();
  });

  it('deja de listarla una vez conciliada', async () => {
    const cajaId = await turnoDelSecundario(3);
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post(`/buffet/cajas/${cajaId}/conciliacion`), principal)
      .send({ conteos: [{ productoId, contado: 7 }] });

    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), principal);
    expect(r.body).toHaveLength(0);
  });

  it('no lista cajas todavia abiertas', async () => {
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), principal)
      .send({ items: [{ productoId, cantidad: 10 }] });
    const secundario = await tokenDe('2222');
    await comoMostrador(supertest(app).post('/buffet/caja/abrir'), secundario);

    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), principal);
    expect(r.body).toHaveLength(0);
  });

  it('NO lista las cajas del propio principal', async () => {
    // Conciliar una caja del principal falla siempre: esas unidades ya salieron del general al
    // venderlas, asi que el conteo inventaria stock. Ofrecerla seria ofrecer un boton roto.
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/caja/abrir'), principal);
    await comoMostrador(supertest(app).post('/buffet/cobrar'), principal).send({
      uid: 'uid-del-principal', medioPago: 'EFECTIVO', montoPagado: 999999,
      items: [{ productoId, cantidad: 2 }],
    });
    await comoMostrador(supertest(app).post('/buffet/caja/cerrar'), principal);

    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), principal);
    expect(r.body).toHaveLength(0);
  });

  it('el secundario no puede ver los pendientes', async () => {
    const secundario = await tokenDe('2222');
    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), secundario);
    expect(r.status).toBe(403);
  });
});

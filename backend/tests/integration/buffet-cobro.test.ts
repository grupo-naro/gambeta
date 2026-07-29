import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any;
beforeAll(async () => { process.env.BUFFET_API_KEY = KEY; await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);
const mostrador = (r: any) => r.set('x-buffet-key', KEY);

async function sembrar() {
  const p = getPrisma();
  const coca = await p.productoBuffet.create({ data: { nombre: 'Coca 500', codigoBarra: '779089', precio: '1500', stock: 10 } });
  const pancho = await p.productoBuffet.create({ data: { nombre: 'Pancho', precio: '2500', stock: 5, enBotonera: true } });
  return { coca, pancho };
}

describe('buffet: cobrar', () => {
  it('sin caja abierta devuelve 409', async () => {
    const { coca } = await sembrar();
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'EFECTIVO', montoPagado: 2000, items: [{ productoId: coca.id, cantidad: 1 }] });
    expect(r.status).toBe(409);
  });

  it('efectivo: calcula total y vuelto, descuenta stock por cantidad', async () => {
    const { coca } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'EFECTIVO', montoPagado: 5000, items: [{ productoId: coca.id, cantidad: 2 }] });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3000);
    expect(r.body.vuelto).toBe(2000);
    expect(r.body.caja.totalEfectivo).toBe(3000);
    const p = await getPrisma().productoBuffet.findUnique({ where: { id: coca.id } });
    expect(p!.stock).toBe(8);
  });

  it('efectivo con monto menor al total falla y no registra', async () => {
    const { coca } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'EFECTIVO', montoPagado: 1000, items: [{ productoId: coca.id, cantidad: 1 }] });
    expect(r.status).toBe(422);
    expect(await getPrisma().ticketBuffet.count()).toBe(0);
  });

  it('transferencia: montoPagado = total, vuelto 0', async () => {
    const { pancho } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'TRANSFERENCIA', montoPagado: 0, items: [{ productoId: pancho.id, cantidad: 1 }] });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2500);
    expect(r.body.vuelto).toBe(0);
    expect(r.body.caja.totalTransferencia).toBe(2500);
  });

  it('el mismo uid dos veces NO duplica ni re-descuenta', async () => {
    const { coca } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const body = { uid: 'mismo', medioPago: 'EFECTIVO', montoPagado: 1500, items: [{ productoId: coca.id, cantidad: 1 }] };
    await mostrador(supertest(app).post('/buffet/cobrar')).send(body);
    const r2 = await mostrador(supertest(app).post('/buffet/cobrar')).send(body);
    expect(r2.status).toBe(200);
    expect(await getPrisma().ticketBuffet.count()).toBe(1);
    const p = await getPrisma().productoBuffet.findUnique({ where: { id: coca.id } });
    expect(p!.stock).toBe(9);
  });

  it('producto inexistente en items da 404 y no registra', async () => {
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'TRANSFERENCIA', montoPagado: 0, items: [{ productoId: 'no-existe', cantidad: 1 }] });
    expect(r.status).toBe(404);
    expect(await getPrisma().ticketBuffet.count()).toBe(0);
  });

  it('GET /buffet/producto resuelve por código de barra', async () => {
    const { coca } = await sembrar();
    const r = await mostrador(supertest(app).get('/buffet/producto?codigoBarra=779089'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: coca.id, nombre: 'Coca 500', precio: 1500 });
    const no = await mostrador(supertest(app).get('/buffet/producto?codigoBarra=zzz'));
    expect(no.status).toBe(404);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let token: string; let mostradorToken: string;
beforeAll(async () => { process.env.BUFFET_API_KEY = KEY; await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  await getPrisma().mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  const login = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '1111' });
  mostradorToken = login.body.token;
});
// authMostrador exige el token que emite /pin/verificar además de la x-buffet-key.
const mostrador = (r: any) => r.set('x-buffet-key', KEY).set('x-mostrador', mostradorToken);

async function sembrar() {
  const p = getPrisma();
  const coca = await p.productoBuffet.create({ data: { nombre: 'Coca', codigoBarra: '111', precio: '1500', stock: 10 } });
  const pancho = await p.productoBuffet.create({ data: { nombre: 'Pancho', precio: '2500', stock: 5, enBotonera: true } });
  return { coca, pancho };
}

describe('buffet: cerrar y cierres', () => {
  it('cerrar separa efectivo y transferencia y agrega por producto', async () => {
    const { coca, pancho } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 't1', medioPago: 'EFECTIVO', montoPagado: 3000, items: [{ productoId: coca.id, cantidad: 2 }] });
    await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 't2', medioPago: 'TRANSFERENCIA', montoPagado: 0, items: [{ productoId: pancho.id, cantidad: 1 }] });

    const cierre = await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    expect(cierre.status).toBe(200);
    expect(cierre.body.totalMonto).toBe(5500);
    expect(cierre.body.totalEfectivo).toBe(3000);
    expect(cierre.body.totalTransferencia).toBe(2500);
    expect(cierre.body.totalUnidades).toBe(3);
    const cocaLinea = cierre.body.porProducto.find((l: any) => l.nombre === 'Coca');
    expect(cocaLinea.unidades).toBe(2);
    expect(cocaLinea.monto).toBe(3000);
  });

  it('cerrar sin caja abierta devuelve 409', async () => {
    const r = await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    expect(r.status).toBe(409);
  });

  it('admin ve los cierres con el desglose por medio', async () => {
    const { coca } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 't1', medioPago: 'EFECTIVO', montoPagado: 1500, items: [{ productoId: coca.id, cantidad: 1 }] });
    await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    const r = await supertest(app).get('/buffet/cajas').set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body[0].totalEfectivo).toBe(1500);
    expect(r.body[0].totalTransferencia).toBe(0);
  });
});

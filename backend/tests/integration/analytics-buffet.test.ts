import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let recepToken: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const a = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: a.id, email: a.email, rol: 'ADMIN' });
  const r = await getPrisma().adminUser.create({ data: { email: 'r@b.com', nombre: 'Recep', passwordHash: 'x', rol: 'RECEPCIONISTA' } });
  recepToken = signAdminToken({ adminId: r.id, email: r.email, rol: 'RECEPCIONISTA' });
});

const auth = (r: supertest.Test, t = token) => r.set('authorization', `Bearer ${t}`);
let uidN = 0;

async function producto(nombre: string, precio: number) {
  return getPrisma().productoBuffet.create({ data: { nombre, precio, stock: 100 } });
}
async function caja(mostradorId: string) {
  return getPrisma().cajaBuffet.create({ data: { mostradorId } });
}
/** Un ticket con sus líneas [producto, cantidad] a una hora UTC dada. */
async function ticket(cajaId: string, creadoEn: string, medio: 'EFECTIVO' | 'TRANSFERENCIA', lineas: Array<[{ id: string; precio: unknown }, number]>) {
  const total = lineas.reduce((s, [p, n]) => s + Number(p.precio) * n, 0);
  return getPrisma().ticketBuffet.create({
    data: {
      uid: `t-${++uidN}`, cajaId, total, medioPago: medio, montoPagado: total, vuelto: 0, creadoEn: new Date(creadoEn),
      lineas: { create: lineas.map(([p, n]) => ({ productoId: p.id, precioUnit: Number(p.precio), cantidad: n, creadoEn: new Date(creadoEn) })) },
    },
  });
}
const get = (q = 'desde=2030-05-10&hasta=2030-05-11', t = token) => auth(supertest(app).get(`/analytics/buffet?${q}`), t);

describe('analytics del buffet, por mostrador', () => {
  it('sin ventas devuelve ceros y los dos mostradores', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.total).toMatchObject({ monto: 0, tickets: 0, unidades: 0, ticketPromedio: 0, alquileres: 0 });
    expect(res.body.mostradores.map((m: any) => m.tipo)).toEqual(['PRINCIPAL', 'SECUNDARIO']);
    expect(res.body.mostradores[0]).toMatchObject({ monto: 0, tickets: 0, topProductos: [] });
    expect(res.body.total.masVendido).toBeNull();
  });

  it('separa lo vendido en cada mostrador y suma el total', async () => {
    const coca = await producto('Coca', 2000);
    const agua = await producto('Agua', 1000);
    const cp = await caja('mostrador-principal');
    const cs = await caja('mostrador-secundario');
    await ticket(cp.id, '2030-05-10T22:00:00Z', 'EFECTIVO', [[coca, 2], [agua, 1]]); // 5000
    await ticket(cp.id, '2030-05-10T23:00:00Z', 'TRANSFERENCIA', [[coca, 1]]); // 2000
    await ticket(cs.id, '2030-05-10T22:30:00Z', 'EFECTIVO', [[agua, 3]]); // 3000
    const res = await get();
    const [p, s] = res.body.mostradores;
    expect(p).toMatchObject({ tipo: 'PRINCIPAL', monto: 7000, tickets: 2, unidades: 4, ticketPromedio: 3500 });
    expect(s).toMatchObject({ tipo: 'SECUNDARIO', monto: 3000, tickets: 1, unidades: 3, ticketPromedio: 3000 });
    expect(res.body.total).toMatchObject({ monto: 10000, tickets: 3, unidades: 7 });
    expect(res.body.total.ticketPromedio).toBeCloseTo(10000 / 3, 1);
  });

  it('reparte por medio de pago en cada mostrador', async () => {
    const coca = await producto('Coca', 2000);
    const cp = await caja('mostrador-principal');
    await ticket(cp.id, '2030-05-10T22:00:00Z', 'EFECTIVO', [[coca, 2]]);
    await ticket(cp.id, '2030-05-10T23:00:00Z', 'TRANSFERENCIA', [[coca, 1]]);
    const res = await get();
    expect(res.body.mostradores[0].porMedio).toEqual({ EFECTIVO: 4000, TRANSFERENCIA: 2000 });
    expect(res.body.mostradores[1].porMedio).toEqual({ EFECTIVO: 0, TRANSFERENCIA: 0 });
    expect(res.body.total.porMedio).toEqual({ EFECTIVO: 4000, TRANSFERENCIA: 2000 });
  });

  it('top de productos por mostrador, ordenado por unidades y limitado a 5', async () => {
    const prods = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F'].map((n) => producto(n, 1000)));
    const cp = await caja('mostrador-principal');
    for (let i = 0; i < prods.length; i++) await ticket(cp.id, '2030-05-10T22:00:00Z', 'EFECTIVO', [[prods[i], i + 1]]);
    const res = await get();
    const top = res.body.mostradores[0].topProductos;
    expect(top).toHaveLength(5);
    expect(top[0]).toMatchObject({ nombre: 'F', unidades: 6, monto: 6000 });
    expect(top.map((t: any) => t.nombre)).toEqual(['F', 'E', 'D', 'C', 'B']);
  });

  it('desglose por día en hora argentina: todos los días del rango, el más nuevo primero', async () => {
    const coca = await producto('Coca', 2000);
    const agua = await producto('Agua', 1000);
    const cp = await caja('mostrador-principal');
    const cs = await caja('mostrador-secundario');
    await ticket(cp.id, '2030-05-10T22:00:00Z', 'EFECTIVO', [[coca, 1]]); // 10/05 19:00
    await ticket(cs.id, '2030-05-11T01:00:00Z', 'TRANSFERENCIA', [[agua, 3]]); // 10/05 22:00 (aún es el 10 en Argentina)
    await ticket(cp.id, '2030-05-11T15:00:00Z', 'EFECTIVO', [[coca, 2]]); // 11/05 12:00
    const res = await get('desde=2030-05-09&hasta=2030-05-11');
    expect(res.body.dias.map((d: any) => d.fecha)).toEqual(['2030-05-11', '2030-05-10', '2030-05-09']);
    const [d11, d10, d09] = res.body.dias;
    expect(d11).toMatchObject({ unidades: 2, efectivo: 4000, transferencia: 0, total: 4000 });
    expect(d10).toMatchObject({ unidades: 4, efectivo: 2000, transferencia: 3000, total: 5000 });
    // un día sin ventas igual aparece, en cero
    expect(d09).toMatchObject({ unidades: 0, efectivo: 0, transferencia: 0, total: 0, productos: [] });
    // cada día separa lo de cada mostrador y sus productos
    expect(d10.mostradores).toEqual({ PRINCIPAL: { unidades: 1, total: 2000 }, SECUNDARIO: { unidades: 3, total: 3000 } });
    expect(d10.productos).toEqual([{ nombre: 'Agua', unidades: 3, monto: 3000 }, { nombre: 'Coca', unidades: 1, monto: 2000 }]);
  });

  it('el más vendido del período, sumando los dos mostradores', async () => {
    const coca = await producto('Coca', 2000);
    const agua = await producto('Agua', 1000);
    const cp = await caja('mostrador-principal');
    const cs = await caja('mostrador-secundario');
    await ticket(cp.id, '2030-05-10T22:00:00Z', 'EFECTIVO', [[coca, 2], [agua, 1]]);
    await ticket(cs.id, '2030-05-10T23:00:00Z', 'EFECTIVO', [[agua, 4]]);
    const res = await get();
    expect(res.body.total.masVendido).toEqual({ nombre: 'Agua', unidades: 5 });
  });

  it('respeta el período: lo de afuera no cuenta', async () => {
    const coca = await producto('Coca', 2000);
    const cp = await caja('mostrador-principal');
    await ticket(cp.id, '2030-05-09T15:00:00Z', 'EFECTIVO', [[coca, 1]]); // antes
    await ticket(cp.id, '2030-05-10T15:00:00Z', 'EFECTIVO', [[coca, 1]]); // dentro
    await ticket(cp.id, '2030-05-13T15:00:00Z', 'EFECTIVO', [[coca, 1]]); // después
    const res = await get('desde=2030-05-10&hasta=2030-05-11');
    expect(res.body.total.monto).toBe(2000);
  });

  it('los alquileres van aparte de las ventas', async () => {
    const coca = await producto('Coca', 2000);
    const cp = await caja('mostrador-principal');
    await ticket(cp.id, '2030-05-10T22:00:00Z', 'EFECTIVO', [[coca, 1]]);
    const art = await getPrisma().articuloAlquiler.create({ data: { nombre: 'Pechera', precio: 500, stock: 10 } });
    await getPrisma().alquiler.create({
      data: { uid: 'al-1', cajaId: cp.id, articuloId: art.id, cantidad: 2, quienRetira: 'Juan', precioUnit: 500, total: 1000, medioPago: 'EFECTIVO', montoPagado: 1000, vuelto: 0, entregadoEn: new Date('2030-05-10T23:00:00Z') },
    });
    const res = await get();
    expect(res.body.mostradores[0]).toMatchObject({ monto: 2000, alquileres: 1000 });
    expect(res.body.total).toMatchObject({ monto: 2000, alquileres: 1000 });
  });

  it('solo el admin: la recepcionista y sin sesión no entran', async () => {
    expect((await get('desde=2030-05-10&hasta=2030-05-11', recepToken)).status).toBe(403);
    expect((await supertest(app).get('/analytics/buffet')).status).toBe(401);
  });
});

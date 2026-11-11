import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetSecundarioService } from '../../src/services/buffetSecundario.service.js';
import { buffetProductoService } from '../../src/services/buffetProducto.service.js';
import { buffetCuentaService } from '../../src/services/buffetCuenta.service.js';
import { alquilerService } from '../../src/services/alquiler.service.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
let adminToken: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  adminToken = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);

const PRI = 'mostrador-principal';
const SEC = 'mostrador-secundario';
const TER = 'mostrador-tercero';

// El mismo producto en los dos catálogos: la "Coca 2 L" del general a 10.000 y la del tercero a 15.000.
let general: string;
let delTercero: string;
beforeEach(async () => {
  await resetTables();
  general = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca 2 L', precio: 10000, stock: 50 } })).id;
  delTercero = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca 2 L', precio: 15000, stock: 20, mostradorId: TER } })).id;
});

const stockDe = async (id: string) => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id } })).stock;
const vender = (mostradorId: string, productoId: string, cantidad: number, uid: string) =>
  buffetCajaService.cobrar({ mostradorId, uid, medioPago: 'EFECTIVO', montoPagado: 999999, items: [{ productoId, cantidad }] });
const key = (r: any) => r.set('x-buffet-key', process.env.BUFFET_API_KEY!);
const tokenDe = async (id: string, pin: string) => {
  await getPrisma().mostrador.update({ where: { id }, data: { pinHash: await hashPassword(pin) } });
  return (await key(supertest(app).post('/buffet/pin/verificar')).send({ pin })).body.token as string;
};
const comoAdmin = (r: any) => r.set('authorization', `Bearer ${adminToken}`);

describe('el mostrador tercero existe', () => {
  it('la base lo trae con su PIN vacío', async () => {
    const t = await getPrisma().mostrador.findUniqueOrThrow({ where: { id: TER } });
    expect(t).toMatchObject({ tipo: 'TERCERO', activo: true, pinHash: '' });
  });

  it('su PIN lo identifica como tercero', async () => {
    await getPrisma().mostrador.update({ where: { id: TER }, data: { pinHash: await hashPassword('3333') } });
    const r = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '3333' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tipo: 'TERCERO', nombre: 'Tercero' });
  });

  it('no se puede repetir el PIN de otro mostrador', async () => {
    await getPrisma().mostrador.update({ where: { id: SEC }, data: { pinHash: await hashPassword('2222') } });
    const { buffetPinService } = await import('../../src/services/buffetPin.service.js');
    await expect(buffetPinService.setear(TER, '2222')).rejects.toThrow(/ya está en uso/);
  });
});

describe('catálogo propio del tercero', () => {
  it('puede tener un producto con el mismo nombre y otro precio que el del principal', async () => {
    const p = await buffetProductoService.crear({ nombre: 'Coca 2 L', precio: 17000, mostradorId: TER });
    expect(p.precio).toBe(17000);
    expect(await getPrisma().productoBuffet.count({ where: { nombre: 'Coca 2 L' } })).toBe(3);
  });

  it('el mismo código de barras puede estar en el general y en el tercero, pero no repetido dentro de uno', async () => {
    await buffetProductoService.crear({ nombre: 'Fanta', precio: 1, codigoBarra: '7790001' });
    await buffetProductoService.crear({ nombre: 'Fanta', precio: 2, codigoBarra: '7790001', mostradorId: TER });
    await expect(buffetProductoService.crear({ nombre: 'Otra', precio: 3, codigoBarra: '7790001' })).rejects.toThrow(/código de barras/);
    await expect(buffetProductoService.crear({ nombre: 'Otra', precio: 3, codigoBarra: '7790001', mostradorId: TER })).rejects.toThrow(/código de barras/);
  });

  it('no se puede crear un producto "propio" del principal o del secundario', async () => {
    await expect(buffetProductoService.crear({ nombre: 'X', precio: 1, mostradorId: SEC })).rejects.toThrow();
  });

  it('el listado del admin separa los catálogos', async () => {
    expect((await buffetProductoService.list()).map((p) => p.id)).toEqual([general]);
    expect((await buffetProductoService.list(TER)).map((p) => p.id)).toEqual([delTercero]);
  });

  it('cada mostrador ve solo los productos de su catálogo', async () => {
    expect((await buffetProductoService.listActivos(TER)).map((p) => p.id)).toEqual([delTercero]);
    expect((await buffetProductoService.listActivos(PRI)).map((p) => p.id)).toEqual([general]);
    expect((await buffetProductoService.listActivos(SEC)).map((p) => p.id)).toEqual([general]);
    // en el tercero, `stock` es el suyo (no hay cupo)
    expect((await buffetProductoService.listActivos(TER))[0]).toMatchObject({ precio: 15000, stock: 20 });
  });

  it('la botonera también se separa', async () => {
    await getPrisma().productoBuffet.updateMany({ data: { enBotonera: true } });
    expect((await buffetProductoService.listBotonera(TER)).map((p) => p.id)).toEqual([delTercero]);
    expect((await buffetProductoService.listBotonera(PRI)).map((p) => p.id)).toEqual([general]);
  });

  it('el código de barras se busca en el catálogo del mostrador', async () => {
    await getPrisma().productoBuffet.update({ where: { id: general }, data: { codigoBarra: '111' } });
    await getPrisma().productoBuffet.update({ where: { id: delTercero }, data: { codigoBarra: '111' } });
    expect((await buffetProductoService.porCodigo('111', TER))?.precio).toBe(15000);
    expect((await buffetProductoService.porCodigo('111', PRI))?.precio).toBe(10000);
  });

  it('reponer y ajustar mueven el stock del producto del tercero y nada más', async () => {
    await buffetProductoService.reponer(delTercero, 5, 'admin');
    expect(await stockDe(delTercero)).toBe(25);
    await buffetProductoService.ajustarStock(delTercero, 12, undefined, 'admin');
    expect(await stockDe(delTercero)).toBe(12);
    expect(await stockDe(general)).toBe(50);
  });

  it('el producto no puede cambiar de catálogo al actualizarlo', async () => {
    await buffetProductoService.actualizar(delTercero, { mostradorId: null, precio: 16000 });
    const p = await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: delTercero } });
    expect(p.mostradorId).toBe(TER);
    expect(Number(p.precio)).toBe(16000);
  });
});

describe('ventas del tercero', () => {
  it('vende a su precio y baja solo su stock, no el del principal', async () => {
    await buffetCajaService.abrir(TER);
    const r = await vender(TER, delTercero, 4, 'u1');
    expect(r.total).toBe(60000);
    expect(await stockDe(delTercero)).toBe(16);
    expect(await stockDe(general)).toBe(50);
  });

  it('no puede vender un producto del catálogo general', async () => {
    await buffetCajaService.abrir(TER);
    await expect(vender(TER, general, 1, 'u2')).rejects.toThrow();
    expect(await stockDe(general)).toBe(50);
  });

  it('el principal y el secundario no pueden vender un producto del tercero', async () => {
    await buffetCajaService.abrir(PRI);
    await expect(vender(PRI, delTercero, 1, 'u3')).rejects.toThrow();
    await buffetCajaService.abrir(SEC);
    await expect(vender(SEC, delTercero, 1, 'u4')).rejects.toThrow();
    expect(await stockDe(delTercero)).toBe(20);
  });

  it('no necesita cupo asignado por el principal', async () => {
    await buffetCajaService.abrir(TER);
    await expect(vender(TER, delTercero, 1, 'u5')).resolves.toBeTruthy();
    expect(await getPrisma().stockMostrador.count({ where: { mostradorId: TER } })).toBe(0);
  });

  it('su caja es independiente de la del secundario', async () => {
    await buffetCajaService.abrir(SEC);
    await expect(buffetCajaService.abrir(TER)).resolves.toBeTruthy();
  });

  it('no maneja alquileres', async () => {
    await buffetCajaService.abrir(TER);
    const art = await getPrisma().articuloAlquiler.create({ data: { nombre: 'Pelota', precio: 1000, stock: 5 } });
    await expect(alquilerService.entregar({
      uid: 'a1', mostradorId: TER, articuloId: art.id, cantidad: 1, quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 1000,
    } as any)).rejects.toThrow(/mostrador principal/);
  });

  it('las cuentas por cancha del tercero también usan su catálogo', async () => {
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'Cancha 1', tipo: 'padel', precioHora: 30000 } });
    const cuenta = await buffetCuentaService.abrir(TER, cancha.id);
    await buffetCuentaService.fijarCantidad(TER, cuenta.id, delTercero, 2);
    expect(await stockDe(delTercero)).toBe(18);
    await expect(buffetCuentaService.fijarCantidad(TER, cuenta.id, general, 1)).rejects.toThrow();
    expect(await stockDe(general)).toBe(50);
  });
});

describe('el tercero ya no recibe del principal', () => {
  it('no es un destino de entregas ni de devoluciones', async () => {
    await expect(buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId: general, cantidad: 1 }] }))
      .rejects.toThrow(/propio/i);
    await expect(buffetEntregaService.devolver({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId: general, cantidad: 1 }] }))
      .rejects.toThrow(/propio/i);
  });

  it('sin puestoId sigue entregando al secundario', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, items: [{ productoId: general, cantidad: 4 }] });
    expect((await getPrisma().stockMostrador.findUniqueOrThrow({ where: { mostradorId_productoId: { mostradorId: SEC, productoId: general } } })).cantidad).toBe(4);
  });

  it('al secundario no se le puede entregar un producto del tercero', async () => {
    await expect(buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: SEC, items: [{ productoId: delTercero, cantidad: 1 }] }))
      .rejects.toThrow();
  });

  it('el principal no es un destino válido y solo el principal entrega', async () => {
    await expect(buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: PRI, items: [{ productoId: general, cantidad: 1 }] })).rejects.toThrow(/principal/i);
    await expect(buffetEntregaService.entregar({ desdeMostradorId: TER, puestoId: SEC, items: [{ productoId: general, cantidad: 1 }] })).rejects.toThrow(/principal/i);
  });
});

describe('por HTTP', () => {
  it('el tercero ve su catálogo y cobra a su precio', async () => {
    const token = await tokenDe(TER, '3333');
    const l = await key(supertest(app).get('/buffet/productos/activos')).set('x-mostrador', token);
    expect(l.body.map((p: any) => p.id)).toEqual([delTercero]);
    await key(supertest(app).post('/buffet/caja/abrir')).set('x-mostrador', token);
    const r = await key(supertest(app).post('/buffet/cobrar')).set('x-mostrador', token)
      .send({ uid: 'h1', medioPago: 'EFECTIVO', montoPagado: 30000, items: [{ productoId: delTercero, cantidad: 2 }] });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(30000);
  });

  it('el admin crea un producto del tercero y lo lista aparte', async () => {
    const c = await comoAdmin(supertest(app).post('/buffet/productos')).send({ nombre: 'Agua', precio: 3000, stock: 10, mostradorId: TER });
    expect(c.status).toBe(201);
    expect(c.body.mostradorId).toBe(TER);
    const t = await comoAdmin(supertest(app).get(`/buffet/productos?mostradorId=${TER}`));
    expect(t.body.map((p: any) => p.nombre).sort()).toEqual(['Agua', 'Coca 2 L']);
    const g = await comoAdmin(supertest(app).get('/buffet/productos'));
    expect(g.body.map((p: any) => p.nombre)).toEqual(['Coca 2 L']);
  });

  it('un producto del tercero no se puede crear para otro mostrador por la API', async () => {
    const c = await comoAdmin(supertest(app).post('/buffet/productos')).send({ nombre: 'Agua', precio: 3000, mostradorId: SEC });
    expect(c.status).toBe(400);
  });
});

describe('resumen diario del tercero', () => {
  it('muestra lo que vendió y lo que le queda, sin mezclar al secundario', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: SEC, items: [{ productoId: general, cantidad: 20 }] });
    await buffetCajaService.abrir(TER);
    await vender(TER, delTercero, 3, 'u9');
    const [hoy] = await buffetSecundarioService.resumenDiario({ dias: 3, desde: '2000-01-01', mostradorId: TER });
    expect(hoy.lineas.map((l) => l.productoId)).toEqual([delTercero]);
    expect(hoy.totales).toMatchObject({ entregado: 0, vendido: 3, quedo: 17 });
    const [hoySec] = await buffetSecundarioService.resumenDiario({ dias: 3, desde: '2000-01-01' });
    expect(hoySec.totales).toMatchObject({ entregado: 20, vendido: 0, quedo: 20 });
  });
});

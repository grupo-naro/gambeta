import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { buffetCuentaService } from '../../src/services/buffetCuenta.service.js';
import { buffetSecundarioService } from '../../src/services/buffetSecundario.service.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

let productoId: string;
let canchaId: string;
beforeEach(async () => {
  await resetTables();
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 100 } })).id;
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha de 6', tipo: 'futbol', precioHora: 50000, jugadores: 6 } })).id;
});

const SEC = 'mostrador-secundario';
const PRI = 'mostrador-principal';
const DESDE = '2000-01-01'; // sin tope: el tope real solo existe para no mostrar días del modelo viejo
const entregar = (cantidad: number) => buffetEntregaService.entregar({ desdeMostradorId: PRI, items: [{ productoId, cantidad }] });
const vender = (cantidad: number, uid: string) =>
  buffetCajaService.cobrar({ mostradorId: SEC, uid, medioPago: 'EFECTIVO', montoPagado: 999999, items: [{ productoId, cantidad }] });
const linea = (dia: any) => dia.lineas.find((l: any) => l.productoId === productoId);

/** Mueve a "ayer" todo lo que hoy se registró: entregas, devoluciones y ventas. */
async function moverAAyer() {
  const ayer = new Date(Date.now() - 24 * 3600 * 1000);
  await getPrisma().entregaMostrador.updateMany({ data: { creadaEn: ayer } });
  await getPrisma().ventaBuffet.updateMany({ data: { creadoEn: ayer } });
}

describe('resumen diario del secundario', () => {
  it('el caso del cliente: arrancó con 30, vendió 20, sobraron 10', async () => {
    await entregar(30);
    await buffetCajaService.abrir(SEC);
    await vender(20, 'u1');
    await buffetCajaService.cerrar(SEC);

    const [hoy] = await buffetSecundarioService.resumenDiario({ dias: 7, desde: DESDE });
    expect(linea(hoy)).toMatchObject({ arranco: 0, entregado: 30, devuelto: 0, vendido: 20, quedo: 10 });
    expect(hoy.totales).toMatchObject({ entregado: 30, vendido: 20, quedo: 10 });
  });

  it('lo que sobra de un día es con lo que arranca el siguiente', async () => {
    await entregar(30);
    await buffetCajaService.abrir(SEC);
    await vender(20, 'u1');
    await buffetCajaService.cerrar(SEC);
    await moverAAyer();
    await entregar(30);

    const [hoy, ayer] = await buffetSecundarioService.resumenDiario({ dias: 7, desde: DESDE });
    expect(linea(ayer)).toMatchObject({ arranco: 0, entregado: 30, vendido: 20, quedo: 10 });
    expect(linea(hoy)).toMatchObject({ arranco: 10, entregado: 30, vendido: 0, quedo: 40 });
  });

  it('cuenta las devoluciones', async () => {
    await entregar(30);
    await buffetEntregaService.devolver({ desdeMostradorId: PRI, items: [{ productoId, cantidad: 5 }] });
    const [hoy] = await buffetSecundarioService.resumenDiario({ dias: 7, desde: DESDE });
    expect(linea(hoy)).toMatchObject({ arranco: 0, entregado: 30, devuelto: 5, vendido: 0, quedo: 25 });
  });

  it('las cuentas por cancha (rendidas, impagas y abiertas) cuentan como vendido una sola vez', async () => {
    await entregar(30);
    await buffetCajaService.abrir(SEC);
    // Rendida: 3. Impaga: 2. Abierta: 1.
    const a = await buffetCuentaService.abrir(SEC, canchaId);
    await buffetCuentaService.fijarCantidad(SEC, a.id, productoId, 3);
    await buffetCuentaService.rendir({ mostradorId: SEC, cuentaId: a.id, medioPago: 'EFECTIVO', montoPagado: 999999 });
    const b = await buffetCuentaService.abrir(SEC, canchaId);
    await buffetCuentaService.fijarCantidad(SEC, b.id, productoId, 2);
    await buffetCuentaService.darPorImpaga(SEC, b.id);
    const c = await buffetCuentaService.abrir(SEC, canchaId);
    await buffetCuentaService.fijarCantidad(SEC, c.id, productoId, 1);

    const [hoy] = await buffetSecundarioService.resumenDiario({ dias: 7, desde: DESDE });
    expect(linea(hoy)).toMatchObject({ entregado: 30, vendido: 6, quedo: 24 });
  });

  it('una cuenta cancelada no cuenta (se devolvió el stock)', async () => {
    await entregar(30);
    await buffetCajaService.abrir(SEC);
    const a = await buffetCuentaService.abrir(SEC, canchaId);
    await buffetCuentaService.fijarCantidad(SEC, a.id, productoId, 4);
    await buffetCuentaService.cancelar(SEC, a.id);
    const [hoy] = await buffetSecundarioService.resumenDiario({ dias: 7, desde: DESDE });
    expect(linea(hoy)).toMatchObject({ vendido: 0, quedo: 30 });
  });

  it('las ventas del mostrador principal no cuentan', async () => {
    await buffetCajaService.abrir(PRI);
    await buffetCajaService.cobrar({ mostradorId: PRI, uid: 'up', medioPago: 'EFECTIVO', montoPagado: 999999, items: [{ productoId, cantidad: 5 }] });
    const [hoy] = await buffetSecundarioService.resumenDiario({ dias: 7, desde: DESDE });
    expect(hoy.lineas).toHaveLength(0);
  });

  it('no muestra días anteriores al tope', async () => {
    const dias = await buffetSecundarioService.resumenDiario({ dias: 30, desde: '2999-01-01' });
    expect(dias).toHaveLength(0);
  });

  it('por HTTP: el admin lo ve y un recepcionista recibe 403', async () => {
    const admin = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'A', passwordHash: 'x', rol: 'ADMIN' } });
    const tok = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
    const ok = await supertest(app).get('/buffet/secundario/diario').set('authorization', `Bearer ${tok}`);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);

    const recep = signAdminToken({ adminId: admin.id, email: 'r@b.com', rol: 'RECEPCIONISTA' });
    const no = await supertest(app).get('/buffet/secundario/diario').set('authorization', `Bearer ${recep}`);
    expect(no.status).toBe(403);
  });
});

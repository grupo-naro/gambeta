import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetCuentaService } from '../../src/services/buffetCuenta.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { buffetConciliacionService } from '../../src/services/buffetConciliacion.service.js';
import { AppError } from '../../src/utils/errors.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

const PRINCIPAL = 'mostrador-principal';
const SECUNDARIO = 'mostrador-secundario';
let canchaId: string; let futbolId: string; let cocaId: string; let panchoId: string;

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  canchaId = (await p.cancha.create({ data: { nombre: 'Cancha 1', tipo: 'padel', precioHora: 30000 } })).id;
  // El secundario abre cuentas en las canchas de fútbol; el principal, en las de pádel.
  futbolId = (await p.cancha.create({ data: { nombre: 'Cancha de 6', tipo: 'futbol', precioHora: 50000, jugadores: 6 } })).id;
  cocaId = (await p.productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 20 } })).id;
  panchoId = (await p.productoBuffet.create({ data: { nombre: 'Pancho', precio: 3000, stock: 20 } })).id;
});

const stock = async (id: string) => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id } })).stock;
const fallaCon = async (fn: () => Promise<unknown>, status: number) => {
  const e = await fn().then(() => null, (x) => x);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).status).toBe(status);
};
/** Cuenta abierta con 2 Coca (4000) y 1 Pancho (3000) = 7000. */
async function cuentaCargada(mostradorId = PRINCIPAL) {
  const c = await buffetCuentaService.abrir(mostradorId, canchaId);
  await buffetCuentaService.fijarCantidad(mostradorId, c.id, cocaId, 2);
  await buffetCuentaService.fijarCantidad(mostradorId, c.id, panchoId, 1);
  return c;
}

describe('rendir una cuenta', () => {
  it('efectivo: crea el ticket con los precios de las líneas, calcula el vuelto y NO vuelve a descontar stock', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    const c = await cuentaCargada();
    expect(await stock(cocaId)).toBe(18);

    const r = await buffetCuentaService.rendir({ mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'EFECTIVO', montoPagado: 10000 });

    expect(r).toMatchObject({ total: 7000, vuelto: 3000 });
    expect(r.cuenta.estado).toBe('RENDIDA');
    expect(await stock(cocaId)).toBe(18);
    expect(await stock(panchoId)).toBe(19);
    const ticket = await getPrisma().ticketBuffet.findUniqueOrThrow({ where: { id: r.ticketId }, include: { lineas: true } });
    expect(ticket.uid).toBe(`cuenta-${c.id}`);
    expect(Number(ticket.total)).toBe(7000);
    expect(ticket.lineas.map((l) => [l.productoId, Number(l.precioUnit), l.cantidad]).sort()).toEqual(
      [[cocaId, 2000, 2], [panchoId, 3000, 1]].sort(),
    );
    const caja = await buffetCajaService.actual(PRINCIPAL);
    expect(caja!.totalMonto).toBe(7000);
    expect(caja!.totalEfectivo).toBe(7000);
  });

  it('transferencia cobra el total exacto', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    const c = await cuentaCargada();
    const r = await buffetCuentaService.rendir({ mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'TRANSFERENCIA', montoPagado: 0 });
    expect(r).toMatchObject({ total: 7000, vuelto: 0 });
    expect((await buffetCajaService.actual(PRINCIPAL))!.totalTransferencia).toBe(7000);
  });

  it('rendir dos veces devuelve el mismo ticket y deja uno solo', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    const c = await cuentaCargada();
    const entrada = { mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'EFECTIVO' as const, montoPagado: 7000 };
    const a = await buffetCuentaService.rendir(entrada);
    const b = await buffetCuentaService.rendir(entrada);
    expect(b.ticketId).toBe(a.ticketId);
    expect(await getPrisma().ticketBuffet.count()).toBe(1);
  });

  it('dos rendiciones simultáneas dejan un solo ticket', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    const c = await cuentaCargada();
    const entrada = { mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'EFECTIVO' as const, montoPagado: 7000 };
    const [a, b] = await Promise.all([buffetCuentaService.rendir(entrada), buffetCuentaService.rendir(entrada)]);
    expect(a.ticketId).toBe(b.ticketId);
    expect(await getPrisma().ticketBuffet.count()).toBe(1);
  });

  it('con la caja cerrada es un conflicto, la cuenta sigue abierta y el stock no cambia', async () => {
    const c = await cuentaCargada();
    await fallaCon(() => buffetCuentaService.rendir({ mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'EFECTIVO', montoPagado: 7000 }), 409);
    expect((await buffetCuentaService.detalle(PRINCIPAL, c.id)).estado).toBe('ABIERTA');
    expect(await stock(cocaId)).toBe(18);
  });

  it('una cuenta vacía no se puede rendir', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await fallaCon(() => buffetCuentaService.rendir({ mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'EFECTIVO', montoPagado: 0 }), 422);
  });

  it('efectivo con un monto menor al total se rechaza y la cuenta sigue abierta', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    const c = await cuentaCargada();
    await fallaCon(() => buffetCuentaService.rendir({ mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'EFECTIVO', montoPagado: 5000 }), 422);
    expect((await buffetCuentaService.detalle(PRINCIPAL, c.id)).estado).toBe('ABIERTA');
    expect(await getPrisma().ticketBuffet.count()).toBe(0);
  });

  it('rinde aunque el producto se haya desactivado o cambiado de precio después de cargarlo', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    const c = await cuentaCargada();
    await getPrisma().productoBuffet.update({ where: { id: cocaId }, data: { activo: false, precio: 9999 } });
    const r = await buffetCuentaService.rendir({ mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'TRANSFERENCIA', montoPagado: 0 });
    expect(r.total).toBe(7000);
  });

  it('una cuenta ya rendida no admite más consumos ni cancelación', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    const c = await cuentaCargada();
    await buffetCuentaService.rendir({ mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'EFECTIVO', montoPagado: 7000 });
    await fallaCon(() => buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 5), 409);
    await fallaCon(() => buffetCuentaService.cancelar(PRINCIPAL, c.id), 409);
  });

  it('otro mostrador no puede rendir la cuenta', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    await buffetCajaService.abrir(SECUNDARIO);
    const c = await cuentaCargada();
    await fallaCon(() => buffetCuentaService.rendir({ mostradorId: SECUNDARIO, cuentaId: c.id, medioPago: 'EFECTIVO', montoPagado: 7000 }), 404);
  });
});

describe('cuentas y cierre de caja', () => {
  it('no deja cerrar la caja con una cuenta abierta y dice cuántas hay', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    await cuentaCargada();
    const e = await buffetCajaService.cerrar(PRINCIPAL).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(409);
    expect(e.message).toMatch(/1 cuenta/);
    expect((await buffetCajaService.actual(PRINCIPAL))).not.toBeNull();
  });

  it('después de rendir la cuenta, la caja se cierra', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    const c = await cuentaCargada();
    await buffetCuentaService.rendir({ mostradorId: PRINCIPAL, cuentaId: c.id, medioPago: 'EFECTIVO', montoPagado: 7000 });
    const cierre = await buffetCajaService.cerrar(PRINCIPAL);
    expect(cierre.totalMonto).toBe(7000);
  });

  it('las cuentas de otro mostrador no frenan el cierre', async () => {
    await buffetCajaService.abrir(PRINCIPAL);
    await buffetCajaService.abrir(SECUNDARIO);
    await buffetEntregaService.entregar({ desdeMostradorId: PRINCIPAL, items: [{ productoId: cocaId, cantidad: 5 }] });
    const c = await buffetCuentaService.abrir(SECUNDARIO, futbolId);
    await buffetCuentaService.fijarCantidad(SECUNDARIO, c.id, cocaId, 1);
    await buffetCajaService.cerrar(PRINCIPAL);
  });

  it('una cuenta impaga queda descontada del cupo del secundario y del total', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRINCIPAL, items: [{ productoId: cocaId, cantidad: 10 }] });
    const totalAntes = (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: cocaId } })).stock;
    await buffetCajaService.abrir(SECUNDARIO);
    const c = await buffetCuentaService.abrir(SECUNDARIO, futbolId);
    await buffetCuentaService.fijarCantidad(SECUNDARIO, c.id, cocaId, 2);
    await buffetCuentaService.darPorImpaga(SECUNDARIO, c.id);
    await buffetCajaService.cerrar(SECUNDARIO);

    const asig = await getPrisma().stockMostrador.findUniqueOrThrow({ where: { mostradorId_productoId: { mostradorId: SECUNDARIO, productoId: cocaId } } });
    expect(asig.cantidad).toBe(8);
    expect((await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: cocaId } })).stock).toBe(totalAntes - 2);
  });
});

describe('abrir una cuenta con una reserva en curso', () => {
  it('queda vinculada y muestra el cliente y el horario', async () => {
    const p = getPrisma();
    const cliente = await p.cliente.create({ data: { nombre: 'Martín', whatsapp: '5491100000001' } });
    await p.reserva.create({
      data: {
        canchaId, clienteId: cliente.id, estado: 'CONFIRMADA', esContacto: false, monto: 30000,
        fechaInicio: new Date(Date.now() - 30 * 60000), fechaFin: new Date(Date.now() + 30 * 60000),
      },
    });
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    expect(c.reserva?.clienteNombre).toBe('Martín');
    expect(c.reserva?.horaInicio).toMatch(/^\d{2}:\d{2}$/);
  });
});

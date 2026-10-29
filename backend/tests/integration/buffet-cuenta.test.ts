import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetCuentaService } from '../../src/services/buffetCuenta.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { AppError } from '../../src/utils/errors.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

const PRINCIPAL = 'mostrador-principal';
const SECUNDARIO = 'mostrador-secundario';
let canchaId: string; let cancha2Id: string; let cocaId: string; let panchoId: string;

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  canchaId = (await p.cancha.create({ data: { nombre: 'Cancha 1', tipo: 'futbol5', precioHora: 30000 } })).id;
  cancha2Id = (await p.cancha.create({ data: { nombre: 'Cancha 2', tipo: 'futbol5', precioHora: 30000 } })).id;
  cocaId = (await p.productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 10 } })).id;
  panchoId = (await p.productoBuffet.create({ data: { nombre: 'Pancho', precio: 3000, stock: 10 } })).id;
});

const stock = async (id: string) => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id } })).stock;
const asignado = async (id: string) =>
  (await getPrisma().stockMostrador.findUnique({ where: { mostradorId_productoId: { mostradorId: SECUNDARIO, productoId: id } } }))?.cantidad ?? 0;
const fallaCon = async (fn: () => Promise<unknown>, status: number) => {
  const e = await fn().then(() => null, (x) => x);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).status).toBe(status);
};

describe('cuentas por cancha: abrir', () => {
  it('abre una cuenta vacía a nombre de la cancha', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    expect(c).toMatchObject({ canchaId, canchaNombre: 'Cancha 1', estado: 'ABIERTA', total: 0, lineas: [], reserva: null });
  });

  it('una segunda cuenta abierta en la misma cancha es un conflicto', async () => {
    await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await fallaCon(() => buffetCuentaService.abrir(PRINCIPAL, canchaId), 409);
  });

  it('otra cancha puede tener su propia cuenta', async () => {
    await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.abrir(PRINCIPAL, cancha2Id);
    expect(await buffetCuentaService.listarAbiertas(PRINCIPAL)).toHaveLength(2);
  });

  it('una cancha que no existe es 404', async () => {
    await fallaCon(() => buffetCuentaService.abrir(PRINCIPAL, 'no-existe'), 404);
  });
});

describe('cuentas por cancha: consumos y stock', () => {
  it('fijar cantidad descuenta el stock en el momento y calcula el total', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    const r = await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 3);
    expect(r.lineas).toEqual([{ productoId: cocaId, nombre: 'Coca', cantidad: 3, precioUnit: 2000, subtotal: 6000 }]);
    expect(r.total).toBe(6000);
    expect(await stock(cocaId)).toBe(7);
  });

  it('bajar la cantidad devuelve la diferencia al stock', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 3);
    const r = await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 1);
    expect(r.lineas[0].cantidad).toBe(1);
    expect(await stock(cocaId)).toBe(9);
  });

  it('fijar la misma cantidad dos veces no descuenta dos veces', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 2);
    await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 2);
    expect(await stock(cocaId)).toBe(8);
  });

  it('fijar 0 quita la línea y devuelve todo el stock', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 4);
    const r = await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 0);
    expect(r.lineas).toEqual([]);
    expect(await stock(cocaId)).toBe(10);
  });

  it('el precio de la línea queda congelado aunque el producto cambie de precio', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 1);
    await getPrisma().productoBuffet.update({ where: { id: cocaId }, data: { precio: 5000 } });
    const r = await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 2);
    expect(r.lineas[0].precioUnit).toBe(2000);
    expect(r.total).toBe(4000);
  });

  it('el secundario sin stock asignado no puede sumar y la cuenta queda igual', async () => {
    await buffetCajaService.abrir(SECUNDARIO);
    const c = await buffetCuentaService.abrir(SECUNDARIO, canchaId);
    await fallaCon(() => buffetCuentaService.fijarCantidad(SECUNDARIO, c.id, cocaId, 1), 422);
    expect((await buffetCuentaService.detalle(SECUNDARIO, c.id)).lineas).toEqual([]);
    expect(await stock(cocaId)).toBe(10);
  });

  it('el secundario descuenta de lo asignado y no del stock general', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRINCIPAL, items: [{ productoId: cocaId, cantidad: 5 }] });
    const generalAntes = await stock(cocaId);
    const c = await buffetCuentaService.abrir(SECUNDARIO, canchaId);
    await buffetCuentaService.fijarCantidad(SECUNDARIO, c.id, cocaId, 2);
    expect(await asignado(cocaId)).toBe(3);
    expect(await stock(cocaId)).toBe(generalAntes);
  });

  it('una cantidad negativa se rechaza', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await fallaCon(() => buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, -1), 400);
  });

  it('un mostrador no ve ni toca la cuenta de otro', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await fallaCon(() => buffetCuentaService.detalle(SECUNDARIO, c.id), 404);
    await fallaCon(() => buffetCuentaService.fijarCantidad(SECUNDARIO, c.id, cocaId, 1), 404);
  });
});

describe('cuentas por cancha: cancelar e impaga', () => {
  it('cancelar devuelve todo el stock y no crea ticket', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 3);
    await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, panchoId, 2);
    const r = await buffetCuentaService.cancelar(PRINCIPAL, c.id);
    expect(r.estado).toBe('CANCELADA');
    expect(await stock(cocaId)).toBe(10);
    expect(await stock(panchoId)).toBe(10);
    expect(await getPrisma().ticketBuffet.count()).toBe(0);
  });

  it('cancelar dos veces devuelve la cuenta sin error ni doble devolución', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 3);
    await buffetCuentaService.cancelar(PRINCIPAL, c.id);
    const r = await buffetCuentaService.cancelar(PRINCIPAL, c.id);
    expect(r.estado).toBe('CANCELADA');
    expect(await stock(cocaId)).toBe(10);
  });

  it('una cuenta cancelada ya no admite consumos', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.cancelar(PRINCIPAL, c.id);
    await fallaCon(() => buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 1), 409);
  });

  it('después de cancelar, la cancha puede abrir una cuenta nueva', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.cancelar(PRINCIPAL, c.id);
    await buffetCuentaService.abrir(PRINCIPAL, canchaId);
  });

  it('dar por impaga deja el stock descontado, guarda el total y la caja, y no crea ticket', async () => {
    const caja = await buffetCajaService.abrir(PRINCIPAL);
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await buffetCuentaService.fijarCantidad(PRINCIPAL, c.id, cocaId, 2);
    const r = await buffetCuentaService.darPorImpaga(PRINCIPAL, c.id);
    expect(r).toMatchObject({ estado: 'IMPAGA', total: 4000 });
    expect(await stock(cocaId)).toBe(8);
    expect(await getPrisma().ticketBuffet.count()).toBe(0);
    const fila = await getPrisma().cuentaBuffet.findUniqueOrThrow({ where: { id: c.id } });
    expect(fila.cajaId).toBe(caja.id);
  });

  it('dar por impaga sin caja abierta es un conflicto y la cuenta sigue abierta', async () => {
    const c = await buffetCuentaService.abrir(PRINCIPAL, canchaId);
    await fallaCon(() => buffetCuentaService.darPorImpaga(PRINCIPAL, c.id), 409);
    expect((await buffetCuentaService.detalle(PRINCIPAL, c.id)).estado).toBe('ABIERTA');
  });
});

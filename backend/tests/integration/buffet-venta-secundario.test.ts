import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { AppError } from '../../src/utils/errors.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 20 } })).id;
});

const general = async () => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;
const asignado = async () =>
  (await getPrisma().stockMostrador.findUnique({
    where: { mostradorId_productoId: { mostradorId: 'mostrador-secundario', productoId } },
  }))?.cantidad ?? 0;

const vender = (mostradorId: string, uid: string, cantidad: number) =>
  buffetCajaService.cobrar({ mostradorId, uid, medioPago: 'EFECTIVO', montoPagado: 999999, items: [{ productoId, cantidad }] });

describe('venta del secundario', () => {
  it('descuenta del asignado y NO del general', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
    await buffetCajaService.abrir('mostrador-secundario');
    const generalAntes = await general(); // 10

    await vender('mostrador-secundario', 'uid-1', 3);

    expect(await asignado()).toBe(7);
    // Esas 3 unidades ya habían salido del general al entregarlas: descontarlas otra vez
    // sería contarlas dos veces.
    expect(await general()).toBe(generalAntes);
  });

  it('vender sin stock asignado se rechaza y dice qué falta', async () => {
    await buffetCajaService.abrir('mostrador-secundario');
    await expect(vender('mostrador-secundario', 'uid-2', 1)).rejects.toThrow(/Coca/);
  });

  it('vender más de lo asignado se rechaza', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 2 }] });
    await buffetCajaService.abrir('mostrador-secundario');
    await expect(vender('mostrador-secundario', 'uid-3', 3)).rejects.toThrow();
    expect(await asignado()).toBe(2);
  });

  it('el principal sigue descontando del general, como siempre', async () => {
    await buffetCajaService.abrir('mostrador-principal');
    await vender('mostrador-principal', 'uid-4', 5);
    expect(await general()).toBe(15);
    expect(await asignado()).toBe(0);
  });

  it('dos ventas simultáneas del mismo producto no dejan el asignado en negativo', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 3 }] });
    await buffetCajaService.abrir('mostrador-secundario');
    // La restricción CHECK de la base es la garantía: una de las dos tiene que fallar.
    const r = await Promise.allSettled([
      vender('mostrador-secundario', 'uid-5', 2),
      vender('mostrador-secundario', 'uid-6', 2),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await asignado()).toBe(1);
    // No alcanza con que una de las dos falle: tiene que fallar de forma prolija (el mismo
    // BusinessRule que el pre-chequeo), sea cual sea quién ganó la carrera — el pre-chequeo en
    // código o el CHECK de la base. Si esto devolviera un 500 crudo, el cajero vería
    // "Error interno" en vez de un motivo de negocio.
    const rechazada = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rechazada.reason.message).toMatch(/Coca/);
  });

  it('un uid ya usado por OTRO mostrador no reutiliza su ticket ni devuelve su caja', async () => {
    // El uid es único a nivel global. Si el secundario mandara el mismo uid que ya usó el
    // principal, el atajo de idempotencia (pensado para reintentos del mismo cliente) no puede
    // devolver el estado de caja del principal: rompería el aislamiento entre mostradores.
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 5 }] });
    await buffetCajaService.abrir('mostrador-principal');
    await buffetCajaService.abrir('mostrador-secundario');

    await vender('mostrador-principal', 'uid-compartido', 1);
    await expect(vender('mostrador-secundario', 'uid-compartido', 1)).rejects.toThrow();

    // La venta del secundario no se aplicó: ni tocó su asignado ni quedó ticket suyo.
    expect(await asignado()).toBe(5);
    const s = await buffetCajaService.actual('mostrador-secundario');
    expect(s!.totalUnidades).toBe(0);
  });

  it('dos cobros concurrentes con el mismo uid en mostradores distintos: el perdedor da Conflict, no la caja ajena', async () => {
    // Variante concurrente del test de arriba ("un uid ya usado por OTRO mostrador..."), que
    // cubre el chequeo secuencial de las líneas ~104-110 de buffetCaja.service.ts pero no la
    // rama de la carrera: si los dos `cobrar()` mandan el mismo uid a la vez, ambos pueden ver
    // `null` en el findUnique inicial y entrar los dos a la transacción. El que pierde el índice
    // único cae en el catch de P2002 -- que hasta este fix devolvía sin más el ticket y la caja
    // del OTRO mostrador (¡200 OK con datos ajenos!) en vez de rechazar la venta.
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
    await buffetCajaService.abrir('mostrador-principal');
    await buffetCajaService.abrir('mostrador-secundario');

    const [r1, r2] = await Promise.allSettled([
      vender('mostrador-principal', 'uid-carrera', 1),
      vender('mostrador-secundario', 'uid-carrera', 1),
    ]);

    const exitosas = [r1, r2].filter((r) => r.status === 'fulfilled');
    const rechazadas = [r1, r2].filter((r) => r.status === 'rejected');
    expect(exitosas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);

    const err = (rechazadas[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(409);
    expect((err as AppError).message).toMatch(/otro mostrador/);
  });

  it('cada mostrador ve su propia caja', async () => {
    await buffetCajaService.abrir('mostrador-principal');
    await buffetCajaService.abrir('mostrador-secundario');
    await vender('mostrador-principal', 'uid-7', 1);
    const p = await buffetCajaService.actual('mostrador-principal');
    const s = await buffetCajaService.actual('mostrador-secundario');
    expect(p!.totalUnidades).toBe(1);
    expect(s!.totalUnidades).toBe(0);
  });
});

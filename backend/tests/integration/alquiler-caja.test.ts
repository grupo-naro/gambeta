import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { alquilerService } from '../../src/services/alquiler.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';

const PRINCIPAL = 'mostrador-principal';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function escenario() {
  const p = getPrisma();
  const art = await p.articuloAlquiler.create({ data: { nombre: 'Raqueta', precio: '3000', stock: 5 } });
  const coca = await p.productoBuffet.create({ data: { nombre: 'Coca', precio: '1500', stock: 10 } });
  await buffetCajaService.abrir(PRINCIPAL);
  return { art, coca };
}

describe('alquileres en la caja del mostrador', () => {
  it('el alquiler suma al total y al total de alquileres, no a las unidades', async () => {
    const { art, coca } = await escenario();
    await buffetCajaService.cobrar({
      mostradorId: PRINCIPAL, uid: 't1', medioPago: 'EFECTIVO', montoPagado: 1500,
      items: [{ productoId: coca.id, cantidad: 1 }],
    });
    await alquilerService.entregar({
      mostradorId: PRINCIPAL, uid: 'a1', articuloId: art.id, cantidad: 1,
      quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 3000,
    });

    const caja = await buffetCajaService.actual(PRINCIPAL);
    expect(caja!.totalAlquileres).toBe(3000);
    expect(caja!.totalMonto).toBe(4500);
    expect(caja!.totalEfectivo).toBe(4500);
    // Cuenta productos de buffet: la conciliación del secundario depende de esto.
    expect(caja!.totalUnidades).toBe(1);
  });

  it('separa efectivo de transferencia', async () => {
    const { art } = await escenario();
    await alquilerService.entregar({
      mostradorId: PRINCIPAL, uid: 'a1', articuloId: art.id, cantidad: 1,
      quienRetira: 'Juan', medioPago: 'TRANSFERENCIA', montoPagado: 0,
    });
    const caja = await buffetCajaService.actual(PRINCIPAL);
    expect(caja!.totalTransferencia).toBe(3000);
    expect(caja!.totalEfectivo).toBe(0);
  });

  it('un alquiler devuelto sigue contando: la plata se cobró igual', async () => {
    const { art } = await escenario();
    const r = await alquilerService.entregar({
      mostradorId: PRINCIPAL, uid: 'a1', articuloId: art.id, cantidad: 1,
      quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 3000,
    });
    await alquilerService.cerrar(r.alquiler.id, 'DEVUELTO');
    const caja = await buffetCajaService.actual(PRINCIPAL);
    expect(caja!.totalAlquileres).toBe(3000);
  });

  it('el cierre persiste el total de alquileres y lo desglosa por artículo', async () => {
    const { art } = await escenario();
    await alquilerService.entregar({
      mostradorId: PRINCIPAL, uid: 'a1', articuloId: art.id, cantidad: 2,
      quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 6000,
    });
    const cierre = await buffetCajaService.cerrar(PRINCIPAL);
    expect(cierre.totalAlquileres).toBe(6000);
    expect(cierre.totalMonto).toBe(6000);
    expect(cierre.porArticulo).toEqual([{ articuloId: art.id, nombre: 'Raqueta', unidades: 2, monto: 6000 }]);

    const fila = await getPrisma().cajaBuffet.findFirstOrThrow({ where: { mostradorId: PRINCIPAL } });
    expect(Number(fila.totalAlquileres)).toBe(6000);
    // El totalMonto guardado sigue siendo el del buffet: no se le cambia el sentido.
    expect(Number(fila.totalMonto)).toBe(0);
  });

  it('una caja sin alquileres reporta 0, no null', async () => {
    await escenario();
    const caja = await buffetCajaService.actual(PRINCIPAL);
    expect(caja!.totalAlquileres).toBe(0);
  });
});

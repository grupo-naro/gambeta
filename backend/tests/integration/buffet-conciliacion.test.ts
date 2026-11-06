import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { buffetConciliacionService } from '../../src/services/buffetConciliacion.service.js';

beforeAll(async () => { await setupTestDb(); });
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 100 } })).id;
});

const general = async () => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;
const asignado = async () =>
  (await getPrisma().stockMostrador.findUnique({ where: { mostradorId_productoId: { mostradorId: 'mostrador-secundario', productoId } } }))?.cantidad ?? 0;

// Se entregan 40, se venden 30 y se cierra la caja del secundario.
async function turno(): Promise<string> {
  await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 40 }] });
  const caja = await buffetCajaService.abrir('mostrador-secundario');
  await buffetCajaService.cobrar({ mostradorId: 'mostrador-secundario', uid: 'uid-c', medioPago: 'EFECTIVO', montoPagado: 999999, items: [{ productoId, cantidad: 30 }] });
  await buffetCajaService.cerrar('mostrador-secundario');
  return caja.id;
}

describe('cierre del secundario sin conteo', () => {
  it('cerrar la caja no devuelve ni borra nada: lo que sobró sigue asignado', async () => {
    await turno();
    expect(await asignado()).toBe(10);
    expect(await general()).toBe(70);
  });

  it('no hay cierres pendientes de conteo', async () => {
    await turno();
    expect(await buffetConciliacionService.pendientes()).toEqual([]);
  });

  it('conciliar está apagado: el conteo de cierre ya no se usa', async () => {
    const cajaId = await turno();
    await expect(
      buffetConciliacionService.conciliar({ cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 10 }] }),
    ).rejects.toThrow(/ya no se usa/);
    expect(await asignado()).toBe(10);
    expect(await general()).toBe(70);
  });

  it('el cierre del secundario informa cuánto vendió', async () => {
    await turno();
    const cierres = await buffetCajaService.listCierres('mostrador-secundario');
    expect(cierres).toHaveLength(1);
    expect(cierres[0].porProducto[0]).toMatchObject({ unidades: 30, monto: 60000 });
  });
});

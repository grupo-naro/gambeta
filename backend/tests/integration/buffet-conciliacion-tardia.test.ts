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
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 40 } })).id;
});

const general = async () => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;
const asignado = async () =>
  (await getPrisma().stockMostrador.findUnique({ where: { mostradorId_productoId: { mostradorId: 'mostrador-secundario', productoId } } }))?.cantidad ?? 0;

// Ayer: se entregaron 10, se vendieron 4 y se cerró la caja del secundario SIN conciliar.
async function ayer(): Promise<string> {
  await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
  const caja = await buffetCajaService.abrir('mostrador-secundario');
  await buffetCajaService.cobrar({ mostradorId: 'mostrador-secundario', uid: 'u1', medioPago: 'EFECTIVO', montoPagado: 99999, items: [{ productoId, cantidad: 4 }] });
  await buffetCajaService.cerrar('mostrador-secundario');
  return caja.id;
}

describe('conciliar un cierre viejo con una entrega posterior', () => {
  it('la entrega hecha DESPUÉS del cierre no se mezcla con ese cierre ni se borra del asignado', async () => {
    const cajaViejaId = await ayer();
    // Hoy el principal "separa" mercadería nueva para el secundario (todavía no abrió su caja).
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
    expect(await asignado()).toBe(16); // 6 sobrantes de ayer + 10 de hoy

    const lineas = await buffetConciliacionService.pendiente(cajaViejaId);
    // El cierre de ayer solo conoce lo de ayer: entregó 10, vendió 4.
    expect(lineas[0]).toMatchObject({ entregado: 10, vendido: 4, esperado: 6 });

    await buffetConciliacionService.conciliar({ cajaId: cajaViejaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 6 }] });
    // Los 10 de hoy siguen asignados al secundario; los 6 contados vuelven al general.
    expect(await asignado()).toBe(10);
    expect(await general()).toBe(40 - 10 - 10 + 6);
  });
});

describe('cierres pendientes', () => {
  it('un cierre sin entregas ni ventas no aparece como pendiente (no hay nada que contar)', async () => {
    await buffetCajaService.abrir('mostrador-secundario');
    await buffetCajaService.cerrar('mostrador-secundario');
    expect(await buffetConciliacionService.pendientes()).toHaveLength(0);
  });

  it('un cierre con mercadería para contar sí aparece', async () => {
    await ayer();
    expect(await buffetConciliacionService.pendientes()).toHaveLength(1);
  });

  it('una entrega posterior no hace reaparecer un cierre vacío ya existente', async () => {
    await buffetCajaService.abrir('mostrador-secundario');
    await buffetCajaService.cerrar('mostrador-secundario');
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
    expect(await buffetConciliacionService.pendientes()).toHaveLength(0);
  });
});

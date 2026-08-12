import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { buffetConciliacionService } from '../../src/services/buffetConciliacion.service.js';

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

/**
 * Entrega 10, vende `vendidas`, y cierra la caja del secundario. Devuelve el id de la caja.
 *
 * Ojo al orden: la entrega ocurre ANTES de abrir la caja, que es como pasa en la vida real
 * (el principal deja la mercadería y después el otro abre). Si el "entregado" se calculara por
 * rango de fechas contra la apertura, esta entrega quedaría afuera y todos estos tests darían
 * entregado 0.
 */
async function turnoDelSecundario(vendidas: number): Promise<string> {
  await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
  const caja = await buffetCajaService.abrir('mostrador-secundario');
  if (vendidas > 0) {
    await buffetCajaService.cobrar({
      mostradorId: 'mostrador-secundario', uid: 'uid-conc', medioPago: 'EFECTIVO',
      montoPagado: 999999, items: [{ productoId, cantidad: vendidas }],
    });
  }
  await buffetCajaService.cerrar('mostrador-secundario');
  return caja.id;
}

describe('conciliación del cierre', () => {
  it('calcula esperado = entregado - vendido', async () => {
    const cajaId = await turnoDelSecundario(4);
    const lineas = await buffetConciliacionService.pendiente(cajaId);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({ entregado: 10, vendido: 4, esperado: 6 });
  });

  it('sin faltante: la diferencia es cero y vuelven 6 al general', async () => {
    const cajaId = await turnoDelSecundario(4);
    const generalAntes = await general(); // 10
    const r = await buffetConciliacionService.conciliar({
      cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 6 }],
    });
    expect(r.lineas[0].diferencia).toBe(0);
    expect(await general()).toBe(generalAntes + 6);
    expect(await asignado()).toBe(0);
  });

  it('CON faltante: vuelve lo CONTADO, no lo esperado', async () => {
    // El corazón del diseño. Se esperaban 6 y hay 4: faltan 2. Si volvieran las 6, el stock
    // general del complejo empezaría a mentir un poco más cada día.
    const cajaId = await turnoDelSecundario(4);
    const generalAntes = await general(); // 10
    const r = await buffetConciliacionService.conciliar({
      cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 4 }],
    });
    expect(r.lineas[0].diferencia).toBe(-2);
    expect(await general()).toBe(generalAntes + 4);
    expect(await asignado()).toBe(0);
  });

  it('contar de más se permite y se muestra como diferencia positiva', async () => {
    const cajaId = await turnoDelSecundario(4);
    const generalAntes = await general();
    const r = await buffetConciliacionService.conciliar({
      cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 8 }],
    });
    expect(r.lineas[0].diferencia).toBe(2);
    expect(await general()).toBe(generalAntes + 8);
  });

  it('el secundario NO puede conciliar su propia caja', async () => {
    const cajaId = await turnoDelSecundario(4);
    await expect(
      buffetConciliacionService.conciliar({ cajaId, porMostradorId: 'mostrador-secundario', conteos: [{ productoId, contado: 6 }] }),
    ).rejects.toThrow();
  });

  it('no se puede conciliar una caja todavía abierta', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
    const caja = await buffetCajaService.abrir('mostrador-secundario');
    await expect(
      buffetConciliacionService.conciliar({ cajaId: caja.id, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 10 }] }),
    ).rejects.toThrow();
  });

  it('conciliar dos veces la misma caja se rechaza', async () => {
    const cajaId = await turnoDelSecundario(4);
    await buffetConciliacionService.conciliar({ cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 6 }] });
    await expect(
      buffetConciliacionService.conciliar({ cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 6 }] }),
    ).rejects.toThrow();
    // Y el stock no se devolvió dos veces.
    expect(await general()).toBe(16);
  });

  it('cuenta también la entrega hecha en medio del turno', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
    const caja = await buffetCajaService.abrir('mostrador-secundario');
    // Se le acabó a mitad de turno y el principal le repone.
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 5 }] });
    await buffetCajaService.cerrar('mostrador-secundario');

    const lineas = await buffetConciliacionService.pendiente(caja.id);
    expect(lineas[0]).toMatchObject({ entregado: 15, vendido: 0, esperado: 15 });
  });

  it('las entregas de un cierre no se cuentan en el siguiente', async () => {
    const primera = await turnoDelSecundario(4);
    await buffetConciliacionService.conciliar({ cajaId: primera, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 6 }] });

    // Segundo turno: solo se le entregan 3.
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 3 }] });
    const segunda = await buffetCajaService.abrir('mostrador-secundario');
    await buffetCajaService.cerrar('mostrador-secundario');

    const lineas = await buffetConciliacionService.pendiente(segunda.id);
    expect(lineas[0]).toMatchObject({ entregado: 3, vendido: 0, esperado: 3 });
  });

  it('el faltante queda guardado, no solo mostrado', async () => {
    const cajaId = await turnoDelSecundario(4);
    await buffetConciliacionService.conciliar({ cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 4 }] });
    const filas = await getPrisma().conteoCierreLinea.findMany({ where: { cajaId } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entregado: 10, vendido: 4, esperado: 6, contado: 4, diferencia: -2 });
  });
});

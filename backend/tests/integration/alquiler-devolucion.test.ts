import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { alquilerService } from '../../src/services/alquiler.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';

const PRINCIPAL = 'mostrador-principal';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function prestar(cantidad = 1, stock = 5, uid = 'u1') {
  const art = await getPrisma().articuloAlquiler.create({ data: { nombre: 'Raqueta', precio: '3000', stock } });
  await buffetCajaService.abrir(PRINCIPAL);
  const r = await alquilerService.entregar({
    mostradorId: PRINCIPAL, uid, articuloId: art.id, cantidad,
    quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 100000,
  });
  return { art, alquiler: r.alquiler };
}

describe('alquileres: devolución', () => {
  it('devuelto libera el disponible sin tocar el stock', async () => {
    const { art, alquiler } = await prestar(2);
    const cerrado = await alquilerService.cerrar(alquiler.id, 'DEVUELTO');
    expect(cerrado.estado).toBe('DEVUELTO');
    expect(cerrado.cerradoEn).not.toBeNull();
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.prestado).toBe(0);
    expect(a.stock).toBe(5);
  });

  it('perdido saca la unidad del inventario', async () => {
    const { art, alquiler } = await prestar(2);
    await alquilerService.cerrar(alquiler.id, 'PERDIDO');
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.prestado).toBe(0);
    expect(a.stock).toBe(3);
  });

  it('roto saca la unidad del inventario', async () => {
    const { art, alquiler } = await prestar(1);
    await alquilerService.cerrar(alquiler.id, 'ROTO');
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.stock).toBe(4);
  });

  it('cerrar dos veces no descuenta dos veces', async () => {
    const { art, alquiler } = await prestar(1);
    await alquilerService.cerrar(alquiler.id, 'PERDIDO');
    await expect(alquilerService.cerrar(alquiler.id, 'PERDIDO')).rejects.toMatchObject({ status: 422 });
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.stock).toBe(4);
    expect(a.prestado).toBe(0);
  });

  it('dos cierres simultáneos solo cuentan una vez', async () => {
    const { art, alquiler } = await prestar(1);
    const dos = await Promise.allSettled([
      alquilerService.cerrar(alquiler.id, 'DEVUELTO'),
      alquilerService.cerrar(alquiler.id, 'DEVUELTO'),
    ]);
    expect(dos.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.prestado).toBe(0);
  });

  it('cerrar un id inexistente da 404', async () => {
    await expect(alquilerService.cerrar('no-existe', 'DEVUELTO')).rejects.toMatchObject({ status: 404 });
  });

  it('afuera trae solo lo que sigue prestado', async () => {
    const { alquiler } = await prestar(1, 5, 'u1');
    expect(await alquilerService.afuera()).toHaveLength(1);
    await alquilerService.cerrar(alquiler.id, 'DEVUELTO');
    expect(await alquilerService.afuera()).toHaveLength(0);
  });

  it('el historial filtra por estado', async () => {
    const { alquiler } = await prestar(1, 5, 'u1');
    await alquilerService.cerrar(alquiler.id, 'ROTO');
    expect(await alquilerService.historial({ estado: 'ROTO' })).toHaveLength(1);
    expect(await alquilerService.historial({ estado: 'DEVUELTO' })).toHaveLength(0);
    expect(await alquilerService.historial({})).toHaveLength(1);
  });

  it('el historial incluye el día `hasta` completo', async () => {
    await prestar(1, 5, 'u1');
    const hoy = new Date().toISOString().slice(0, 10);
    expect(await alquilerService.historial({ desde: hoy, hasta: hoy })).toHaveLength(1);
  });
});

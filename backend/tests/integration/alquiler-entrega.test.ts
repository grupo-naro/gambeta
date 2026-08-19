import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { alquilerService } from '../../src/services/alquiler.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';

const PRINCIPAL = 'mostrador-principal';
const SECUNDARIO = 'mostrador-secundario';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function raqueta(stock = 5) {
  return getPrisma().articuloAlquiler.create({ data: { nombre: 'Raqueta', precio: '3000', stock } });
}

const base = (articuloId: string) => ({
  mostradorId: PRINCIPAL, uid: 'u1', articuloId, cantidad: 1,
  quienRetira: 'Juan', medioPago: 'EFECTIVO' as const, montoPagado: 5000,
});

describe('alquileres: entregar', () => {
  it('sin caja abierta da 409', async () => {
    const a = await raqueta();
    await expect(alquilerService.entregar(base(a.id))).rejects.toMatchObject({ status: 409 });
  });

  it('efectivo: calcula total y vuelto, y aumenta prestado', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(PRINCIPAL);
    const r = await alquilerService.entregar({ ...base(a.id), cantidad: 2, montoPagado: 10000 });
    expect(r.alquiler.total).toBe(6000);
    expect(r.vuelto).toBe(4000);
    expect(r.alquiler.estado).toBe('ENTREGADO');
    expect(r.alquiler.articuloNombre).toBe('Raqueta');
    const art = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(art.prestado).toBe(2);
    expect(art.stock).toBe(5);
  });

  it('transferencia: no da vuelto', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(PRINCIPAL);
    const r = await alquilerService.entregar({ ...base(a.id), medioPago: 'TRANSFERENCIA', montoPagado: 0 });
    expect(r.alquiler.total).toBe(3000);
    expect(r.vuelto).toBe(0);
  });

  it('efectivo con monto menor al total falla y no presta nada', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(PRINCIPAL);
    await expect(alquilerService.entregar({ ...base(a.id), montoPagado: 100 })).rejects.toMatchObject({ status: 422 });
    expect(await getPrisma().alquiler.count()).toBe(0);
    const art = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(art.prestado).toBe(0);
  });

  it('no se puede entregar más de lo disponible', async () => {
    const a = await raqueta(2);
    await buffetCajaService.abrir(PRINCIPAL);
    await expect(alquilerService.entregar({ ...base(a.id), cantidad: 3, montoPagado: 20000 }))
      .rejects.toMatchObject({ status: 422 });
    expect(await getPrisma().alquiler.count()).toBe(0);
  });

  it('el mismo uid dos veces no duplica ni vuelve a prestar', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(PRINCIPAL);
    const primera = await alquilerService.entregar(base(a.id));
    const segunda = await alquilerService.entregar(base(a.id));
    expect(segunda.alquiler.id).toBe(primera.alquiler.id);
    expect(segunda.vuelto).toBe(2000);
    expect(await getPrisma().alquiler.count()).toBe(1);
    const art = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(art.prestado).toBe(1);
  });

  it('el mostrador secundario no puede alquilar', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(SECUNDARIO);
    await expect(alquilerService.entregar({ ...base(a.id), mostradorId: SECUNDARIO }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('un artículo dado de baja no se puede alquilar', async () => {
    const a = await raqueta();
    await getPrisma().articuloAlquiler.update({ where: { id: a.id }, data: { activo: false } });
    await buffetCajaService.abrir(PRINCIPAL);
    await expect(alquilerService.entregar(base(a.id))).rejects.toMatchObject({ status: 404 });
  });

  it('dos entregas simultáneas del último no prestan de más', async () => {
    const a = await raqueta(1);
    await buffetCajaService.abrir(PRINCIPAL);
    const dos = await Promise.allSettled([
      alquilerService.entregar({ ...base(a.id), uid: 'a' }),
      alquilerService.entregar({ ...base(a.id), uid: 'b' }),
    ]);
    expect(dos.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const perdedor = dos.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    // La carrera la puede ganar el pre-chequeo o el CHECK de la base: en los dos casos es una
    // regla de negocio (422), nunca un 500.
    expect(perdedor.reason).toMatchObject({ status: 422 });
    const art = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(art.prestado).toBe(1);
  });
});

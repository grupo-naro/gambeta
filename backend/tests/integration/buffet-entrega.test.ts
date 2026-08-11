import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 20 } })).id;
});

const asignado = async () =>
  (await getPrisma().stockMostrador.findUnique({
    where: { mostradorId_productoId: { mostradorId: 'mostrador-secundario', productoId } },
  }))?.cantidad ?? 0;

const general = async () =>
  (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;

describe('entrega del principal al secundario', () => {
  it('mueve el stock: baja el general y sube el asignado', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 12 }] });
    expect(await general()).toBe(8);
    expect(await asignado()).toBe(12);
  });

  it('no inventa unidades: dos entregas suman', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 5 }] });
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 3 }] });
    expect(await general()).toBe(12);
    expect(await asignado()).toBe(8);
    // El total sigue siendo 20: nada se creó ni se perdió.
    expect((await general()) + (await asignado())).toBe(20);
  });

  it('no se puede entregar más de lo que hay en el general', async () => {
    await expect(
      buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 21 }] }),
    ).rejects.toThrow();
    expect(await general()).toBe(20);
    expect(await asignado()).toBe(0);
  });

  it('queda registrado quién y qué', async () => {
    const { entregaId } = await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 4 }] });
    const e = await getPrisma().entregaMostrador.findUniqueOrThrow({ where: { id: entregaId }, include: { lineas: true } });
    expect(e.mostradorId).toBe('mostrador-secundario');
    expect(e.lineas).toHaveLength(1);
    expect(e.lineas[0].cantidad).toBe(4);
  });

  it('una entrega con varias líneas es todo o nada', async () => {
    const otro = await getPrisma().productoBuffet.create({ data: { nombre: 'Agua', precio: 1000, stock: 2 } });
    await expect(
      buffetEntregaService.entregar({
        desdeMostradorId: 'mostrador-principal',
        items: [{ productoId, cantidad: 5 }, { productoId: otro.id, cantidad: 99 }],
      }),
    ).rejects.toThrow();
    // La primera línea NO se aplicó: si se aplicara, quedaría stock movido por una entrega
    // que el operador vio fallar.
    expect(await general()).toBe(20);
    expect(await asignado()).toBe(0);
  });

  it('cantidad cero o negativa se rechaza', async () => {
    await expect(
      buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 0 }] }),
    ).rejects.toThrow();
  });
});

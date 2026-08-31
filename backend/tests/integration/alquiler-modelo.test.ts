import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('modelo de alquileres', () => {
  it('la base rechaza prestado mayor al stock', async () => {
    const p = getPrisma();
    const a = await p.articuloAlquiler.create({ data: { nombre: 'Raqueta', precio: '3000', stock: 2 } });
    await expect(
      p.articuloAlquiler.update({ where: { id: a.id }, data: { prestado: 3 } }),
    ).rejects.toThrow();
  });

  it('la base rechaza prestado negativo', async () => {
    const p = getPrisma();
    const a = await p.articuloAlquiler.create({ data: { nombre: 'Pelota', precio: '1000', stock: 5 } });
    await expect(
      p.articuloAlquiler.update({ where: { id: a.id }, data: { prestado: -1 } }),
    ).rejects.toThrow();
  });

  it('permite prestar todo el stock', async () => {
    const p = getPrisma();
    const a = await p.articuloAlquiler.create({ data: { nombre: 'Pechera', precio: '500', stock: 4 } });
    const upd = await p.articuloAlquiler.update({ where: { id: a.id }, data: { prestado: 4 } });
    expect(upd.prestado).toBe(4);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('mostradores', () => {
  it('existen el principal y el secundario', async () => {
    const ms = await getPrisma().mostrador.findMany({ orderBy: { tipo: 'asc' } });
    expect(ms.map((m) => m.tipo)).toEqual(['PRINCIPAL', 'SECUNDARIO']);
  });

  it('no se puede crear un tercer mostrador del mismo tipo', async () => {
    await expect(
      getPrisma().mostrador.create({ data: { nombre: 'Otro', tipo: 'PRINCIPAL' } }),
    ).rejects.toThrow();
  });

  it('cada mostrador puede tener su propia caja abierta a la vez', async () => {
    const p = await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } });
    const s = await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-secundario' } });
    expect(p.estado).toBe('ABIERTA');
    expect(s.estado).toBe('ABIERTA');
  });

  it('un mismo mostrador NO puede tener dos cajas abiertas', async () => {
    // La garantía es del índice único parcial, no del código: el servicio hace
    // "buscar o crear" y sin esta restricción una carrera abriría dos cajas.
    await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } });
    await expect(
      getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } }),
    ).rejects.toThrow();
  });

  it('cerrar una libera el lugar para abrir otra en el mismo mostrador', async () => {
    const c = await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } });
    await getPrisma().cajaBuffet.update({ where: { id: c.id }, data: { estado: 'CERRADA', cerradaEn: new Date() } });
    const nueva = await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } });
    expect(nueva.id).not.toBe(c.id);
  });
});

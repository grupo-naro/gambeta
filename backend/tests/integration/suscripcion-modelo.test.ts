import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('modelo Suscripcion', () => {
  it('se crea con estado ACTIVA por defecto y fechas de tipo date', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Ana', whatsapp: '+5491100000001' } });
    const s = await getPrisma().suscripcion.create({
      data: {
        clienteId: cliente.id,
        inicio: new Date('2026-08-01T00:00:00.000Z'),
        vencimiento: new Date('2026-08-31T00:00:00.000Z'),
      },
    });
    expect(s.estado).toBe('ACTIVA');
    expect(s.inicio.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(s.vencimiento.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(s.precio).toBeNull();
  });

  it('resetTables borra suscripciones sin violar la FK con Cliente', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Beto', whatsapp: '+5491100000002' } });
    await getPrisma().suscripcion.create({
      data: { clienteId: cliente.id, inicio: new Date('2026-08-01T00:00:00.000Z'), vencimiento: new Date('2026-08-31T00:00:00.000Z') },
    });
    await resetTables();
    expect(await getPrisma().suscripcion.count()).toBe(0);
    expect(await getPrisma().cliente.count()).toBe(0);
  });
});

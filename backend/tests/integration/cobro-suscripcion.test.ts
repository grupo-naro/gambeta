import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function nuevaSuscripcion() {
  const cliente = await getPrisma().cliente.create({ data: { nombre: 'Eze', whatsapp: '+5491100000005' } });
  return getPrisma().suscripcion.create({
    data: { clienteId: cliente.id, inicio: new Date('2026-08-01T00:00:00.000Z'), vencimiento: new Date('2026-08-31T00:00:00.000Z') },
  });
}

describe('Cobro con destino suscripcion', () => {
  it('acepta un cobro de cuota sin reserva', async () => {
    const s = await nuevaSuscripcion();
    const c = await getPrisma().cobro.create({
      data: { suscripcionId: s.id, monto: 20000, medio: 'EFECTIVO', origen: 'SUSCRIPCION' },
    });
    expect(c.reservaId).toBeNull();
    expect(c.suscripcionId).toBe(s.id);
    expect(c.origen).toBe('SUSCRIPCION');
  });

  it('rechaza un cobro sin reserva ni suscripcion', async () => {
    await expect(
      getPrisma().cobro.create({ data: { monto: 1000, medio: 'EFECTIVO' } }),
    ).rejects.toThrow(/cobro_destino_unico/);
  });

  it('rechaza un cobro con reserva Y suscripcion a la vez', async () => {
    const s = await nuevaSuscripcion();
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C3', tipo: 'f5', precioHora: 1000, jugadores: 5 } });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: s.clienteId, estado: 'CONFIRMADA', esContacto: false, monto: 1000,
        fechaInicio: new Date('2026-08-12T20:00:00.000Z'), fechaFin: new Date('2026-08-12T21:00:00.000Z'),
      },
    });
    await expect(
      getPrisma().cobro.create({ data: { reservaId: r.id, suscripcionId: s.id, monto: 1000, medio: 'EFECTIVO' } }),
    ).rejects.toThrow(/cobro_destino_unico/);
  });
});

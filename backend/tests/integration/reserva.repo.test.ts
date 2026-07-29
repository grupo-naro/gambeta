import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { reservaRepo } from '../../src/repositories/reserva.repo.js';

let canchaId: string; let clienteId: string;
beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } });
  const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
  canchaId = c.id; clienteId = cl.id;
});

const slot = (h: number) => ({
  fechaInicio: new Date(`2026-06-12T${String(h).padStart(2, '0')}:00:00.000Z`),
  fechaFin: new Date(`2026-06-12T${String(h + 1).padStart(2, '0')}:00:00.000Z`),
});

describe('reservaRepo.create', () => {
  it('allows two non-overlapping reservas', async () => {
    await reservaRepo.create({ canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000, ...slot(10) });
    await reservaRepo.create({ canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000, ...slot(11) });
    expect(await getPrisma().reserva.count()).toBe(2);
  });

  it('rejects an overlapping reserva with 409', async () => {
    await reservaRepo.create({ canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000, ...slot(10) });
    await expect(
      reservaRepo.create({ canchaId, clienteId, estado: 'ESPERANDO_SENA', esContacto: false, monto: 1000, ...slot(10) }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('allows reusing a slot once the prior reserva is CANCELADA', async () => {
    const r = await reservaRepo.create({ canchaId, clienteId, estado: 'ESPERANDO_SENA', esContacto: false, monto: 1000, ...slot(10) });
    // Use reservaRepo.updateEstado so ReservaSector.estado is also updated
    await reservaRepo.updateEstado(r.id, 'CANCELADA');
    await reservaRepo.create({ canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000, ...slot(10) });
    expect(await getPrisma().reserva.count({ where: { estado: 'CONFIRMADA' } })).toBe(1);
  });
});

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

  it('una reserva puede apuntar a una suscripcion y guardar montoLista', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Caro', whatsapp: '+5491100000003' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 12000, jugadores: 5 } });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: cliente.id, inicio: new Date('2026-08-01T00:00:00.000Z'), vencimiento: new Date('2026-08-31T00:00:00.000Z') },
    });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id,
        clienteId: cliente.id,
        estado: 'CONFIRMADA',
        esContacto: false,
        monto: 0,
        montoLista: 12000,
        suscripcionId: s.id,
        fechaInicio: new Date('2026-08-10T20:00:00.000Z'),
        fechaFin: new Date('2026-08-10T21:00:00.000Z'),
      },
    });
    expect(r.suscripcionId).toBe(s.id);
    expect(Number(r.monto)).toBe(0);
    expect(Number(r.montoLista)).toBe(12000);
  });

  it('una reserva normal deja suscripcionId y montoLista en null', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Dani', whatsapp: '+5491100000004' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C2', tipo: 'f5', precioHora: 12000, jugadores: 5 } });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: cliente.id, estado: 'CONFIRMADA', esContacto: false, monto: 12000,
        fechaInicio: new Date('2026-08-11T20:00:00.000Z'), fechaFin: new Date('2026-08-11T21:00:00.000Z'),
      },
    });
    expect(r.suscripcionId).toBeNull();
    expect(r.montoLista).toBeNull();
  });
});

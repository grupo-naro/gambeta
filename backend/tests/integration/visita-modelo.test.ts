import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('modelo Visita', () => {
  it('guarda una visita con etiqueta, tipo y referer', async () => {
    const v = await getPrisma().visita.create({
      data: { etiqueta: 'ig-bio', tipo: 'REDES', sesionId: 's1', visitanteId: 'v1', referer: 'https://instagram.com/' },
    });
    expect(v.tipo).toBe('REDES');
    expect(v.etiqueta).toBe('ig-bio');
  });

  it('la visita directa no tiene etiqueta', async () => {
    const v = await getPrisma().visita.create({
      data: { etiqueta: null, tipo: 'DIRECTO', sesionId: 's2', visitanteId: 'v2', referer: null },
    });
    expect(v.etiqueta).toBeNull();
  });

  it('sesionId es único: una sesión es una visita', async () => {
    await getPrisma().visita.create({ data: { tipo: 'QR', etiqueta: 'qr-entrada', sesionId: 'dup', visitanteId: 'v3' } });
    await expect(
      getPrisma().visita.create({ data: { tipo: 'QR', etiqueta: 'qr-entrada', sesionId: 'dup', visitanteId: 'v3' } }),
    ).rejects.toThrow();
  });

  it('Reserva puede guardar el origen, y queda en null si no vino de ningún link', async () => {
    const p = getPrisma();
    const cancha = await p.cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } });
    const cliente = await p.cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    const base = {
      canchaId: cancha.id, clienteId: cliente.id, estado: 'CONFIRMADA' as const, esContacto: false, monto: 1000,
      fechaInicio: new Date('2026-06-12T22:00:00.000Z'), fechaFin: new Date('2026-06-12T23:00:00.000Z'),
    };
    const conOrigen = await p.reserva.create({ data: { ...base, origenEtiqueta: 'whatsapp', origenTipo: 'WHATSAPP' } });
    expect(conOrigen.origenTipo).toBe('WHATSAPP');
    const sinOrigen = await p.reserva.create({
      data: { ...base, fechaInicio: new Date('2026-06-12T23:00:00.000Z'), fechaFin: new Date('2026-06-13T00:00:00.000Z') },
    });
    expect(sinOrigen.origenEtiqueta).toBeNull();
    expect(sinOrigen.origenTipo).toBeNull();
  });
});

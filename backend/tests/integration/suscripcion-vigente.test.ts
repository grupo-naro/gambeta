import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { suscripcionService } from '../../src/services/suscripcion.service.js';
import { aFechaUtc } from '../../src/services/suscripcion.vigencia.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function cliente(whatsapp = '+5491100000010') {
  return getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp } });
}
async function suscripcion(clienteId: string, inicio: string, vencimiento: string, estado: 'ACTIVA' | 'CANCELADA' = 'ACTIVA') {
  return getPrisma().suscripcion.create({
    data: { clienteId, inicio: aFechaUtc(inicio), vencimiento: aFechaUtc(vencimiento), estado },
  });
}

describe('suscripcionService.vigenteDe', () => {
  it('devuelve la suscripcion cuando la fecha esta dentro del periodo', async () => {
    const c = await cliente();
    const s = await suscripcion(c.id, '2026-08-01', '2026-08-31');
    expect((await suscripcionService.vigenteDe(c.id, '2026-08-15'))?.id).toBe(s.id);
  });

  it('el ultimo dia de vigencia todavia cuenta', async () => {
    const c = await cliente();
    const s = await suscripcion(c.id, '2026-08-01', '2026-08-31');
    expect((await suscripcionService.vigenteDe(c.id, '2026-08-31'))?.id).toBe(s.id);
  });

  it('el dia posterior al vencimiento ya no cuenta', async () => {
    const c = await cliente();
    await suscripcion(c.id, '2026-08-01', '2026-08-31');
    expect(await suscripcionService.vigenteDe(c.id, '2026-09-01')).toBeNull();
  });

  it('ignora las canceladas', async () => {
    const c = await cliente();
    await suscripcion(c.id, '2026-08-01', '2026-08-31', 'CANCELADA');
    expect(await suscripcionService.vigenteDe(c.id, '2026-08-15')).toBeNull();
  });

  it('sin suscripciones devuelve null', async () => {
    const c = await cliente();
    expect(await suscripcionService.vigenteDe(c.id, '2026-08-15')).toBeNull();
  });

  it('si hubiera dos que cubren la fecha, toma la de mayor vencimiento (determinista)', async () => {
    const c = await cliente();
    await suscripcion(c.id, '2026-08-01', '2026-08-31');
    const larga = await suscripcion(c.id, '2026-08-01', '2026-09-30');
    expect((await suscripcionService.vigenteDe(c.id, '2026-08-15'))?.id).toBe(larga.id);
  });

  it('no mezcla clientes', async () => {
    const a = await cliente('+5491100000011');
    const b = await cliente('+5491100000012');
    await suscripcion(a.id, '2026-08-01', '2026-08-31');
    expect(await suscripcionService.vigenteDe(b.id, '2026-08-15')).toBeNull();
  });
});

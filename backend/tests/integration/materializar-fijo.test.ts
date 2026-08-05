import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { aFechaUtc, hoyEnTz, sumarUnMes } from '../../src/services/suscripcion.vigencia.js';
import { SOCIOS_HABILITADO } from '../../src/config/features.js';

const TZ = 'America/Argentina/Buenos_Aires';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
});

// 2026-06-24 es MIÉRCOLES (diaSemana 3, 0=Dom).
async function fijoMiercoles(over: Record<string, unknown> = {}) {
  return getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true, ...over } });
}
const materializar = (id: string, body: Record<string, unknown>) =>
  supertest(app).post(`/turnos-fijos/${id}/materializar`).set('x-api-key', 'svc').send(body);

describe('POST /turnos-fijos/:id/materializar', () => {
  it('persiste turnoFijoId en la reserva creada', async () => {
    const f = await fijoMiercoles();
    const r = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r.status).toBe(201);
    expect(r.body.turnoFijoId).toBe(f.id);
  });
  it('crea la reserva con precio de la cancha, CONFIRMADA, y es idempotente', async () => {
    const f = await fijoMiercoles();
    const r1 = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r1.status).toBe(201);
    expect(r1.body.estado).toBe('CONFIRMADA');
    expect(Number(r1.body.monto)).toBe(12000); // precioHora de la cancha
    const r2 = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r2.body.id).toBe(r1.body.id); // idempotente
    const n = await getPrisma().reserva.count({ where: { turnoFijoId: f.id } });
    expect(n).toBe(1);
  });
  it('upsert del cliente por whatsapp del fijo', async () => {
    const f = await fijoMiercoles();
    await materializar(f.id, { fecha: '2026-06-24' });
    const cli = await getPrisma().cliente.findUnique({ where: { whatsapp: '5491136620274' } });
    expect(cli?.nombre).toBe('Naro');
  });
  it('rechaza si hay excepción (liberado) en esa fecha', async () => {
    const f = await fijoMiercoles();
    await getPrisma().turnoFijoExcepcion.create({ data: { turnoFijoId: f.id, fecha: new Date('2026-06-24T00:00:00.000Z') } });
    const r = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r.status).toBe(422);
  });
  it('rechaza si la fecha no cae en el día del fijo', async () => {
    const f = await fijoMiercoles();
    const r = await materializar(f.id, { fecha: '2026-06-25' }); // jueves
    expect(r.status).toBe(422);
  });

  // Socios apagado: ver src/config/features.ts. Los otros casos de este archivo siguen activos.
  it.skipIf(!SOCIOS_HABILITADO)('socio con turno fijo: la reserva materializada queda bonificada', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Naro', whatsapp: '5491136620274' } });
    const hoy = hoyEnTz(TZ);
    const sus = await getPrisma().suscripcion.create({
      data: { clienteId: cliente.id, inicio: aFechaUtc(hoy), vencimiento: aFechaUtc(sumarUnMes(hoy)) },
    });
    const f = await fijoMiercoles();
    const r = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('CONFIRMADA');
    expect(Number(r.body.monto)).toBe(0);
    expect(Number(r.body.montoLista)).toBe(12000);
    expect(r.body.suscripcionId).toBe(sus.id);
  });

  it('no socio con turno fijo: sigue cobrando el precio completo', async () => {
    const f = await fijoMiercoles();
    const r = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('CONFIRMADA');
    expect(Number(r.body.monto)).toBe(12000);
    expect(r.body.montoLista).toBeNull();
    expect(r.body.suscripcionId).toBeNull();
  });

  // El spec pedía explícitamente cubrir la cadena real materializar → hhmmAMin(horaFin) -
  // hhmmAMin(horaInicio) → monto, no solo el test unitario de precioDeRango: es el cálculo
  // que mueve plata en producción para los turnos fijos de más de una hora.
  it('un turno fijo de dos horas cobra el monto de dos horas, no de una', async () => {
    const f = await fijoMiercoles({ horaInicio: '20:00', horaFin: '22:00' });
    const r = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r.status).toBe(201);
    expect(Number(r.body.monto)).toBe(24000); // 2 horas a precioHora=12000
  });
});

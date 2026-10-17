import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { ocupacionService } from '../../src/services/ocupacion.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const a = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: a.id, email: a.email, rol: 'ADMIN' });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } })).id;
});

// 2026-12-10 y 2026-12-17 son jueves (diaSemana 4); 2026-12-12 es sábado.
const JUEVES_DENTRO = '2026-12-10';
const JUEVES_FUERA = '2026-12-17';

const crear = (extra: Record<string, unknown> = {}) =>
  supertest(app).post('/bloqueos').set('authorization', `Bearer ${token}`)
    .send({ canchaId, motivo: 'TORNEO', recurrente: true, diaSemana: 4, horaInicio: '20:00', horaFin: '22:00', ...extra });

describe('período de un bloqueo recurrente', () => {
  it('se crea con desde/hasta y el listado los devuelve como YYYY-MM-DD', async () => {
    const res = await crear({ vigenciaDesde: '2026-10-17', vigenciaHasta: '2026-12-12' });
    expect(res.status).toBe(201);
    const lista = await supertest(app).get('/bloqueos').set('authorization', `Bearer ${token}`);
    expect(lista.body[0]).toMatchObject({ vigenciaDesde: '2026-10-17', vigenciaHasta: '2026-12-12' });
  });

  it('un bloqueo recurrente sin período sigue funcionando como antes', async () => {
    expect((await crear()).status).toBe(201);
    const rangos = await ocupacionService.rangosPlantilla(canchaId, JUEVES_FUERA);
    expect(rangos.some((r) => r.tipo === 'bloqueo')).toBe(true);
  });

  it('bloquea dentro del período y libera el horario después del "hasta"', async () => {
    await crear({ vigenciaDesde: '2026-10-17', vigenciaHasta: '2026-12-12' });
    expect((await ocupacionService.rangosPlantilla(canchaId, JUEVES_DENTRO)).some((r) => r.tipo === 'bloqueo')).toBe(true);
    expect((await ocupacionService.rangosPlantilla(canchaId, JUEVES_FUERA)).some((r) => r.tipo === 'bloqueo')).toBe(false);
  });

  it('no bloquea antes del "desde"', async () => {
    await crear({ vigenciaDesde: '2026-12-15' });
    expect((await ocupacionService.rangosPlantilla(canchaId, JUEVES_DENTRO)).some((r) => r.tipo === 'bloqueo')).toBe(false);
    expect((await ocupacionService.rangosPlantilla(canchaId, JUEVES_FUERA)).some((r) => r.tipo === 'bloqueo')).toBe(true);
  });

  it('la agenda del día respeta el período', async () => {
    await crear({ vigenciaHasta: '2026-12-12' });
    const dentro = await supertest(app).get(`/agenda?fecha=${JUEVES_DENTRO}`).set('authorization', `Bearer ${token}`);
    const fuera = await supertest(app).get(`/agenda?fecha=${JUEVES_FUERA}`).set('authorization', `Bearer ${token}`);
    expect(dentro.body.bloqueos).toHaveLength(1);
    expect(fuera.body.bloqueos).toHaveLength(0);
  });

  it('una reserva se puede tomar en el horario después del período', async () => {
    await crear({ vigenciaHasta: '2026-12-12' });
    const body = (fecha: string) => ({ canchaId, whatsapp: '+5491150000000', nombreCliente: 'Juan', esContacto: false, fecha, horaInicio: '20:00', montoSena: 500 });
    const fuera = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body(JUEVES_FUERA));
    expect(fuera.status).toBe(201);
    const dentro = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body(JUEVES_DENTRO));
    expect(dentro.status).toBe(409);
  });

  it('crear el bloqueo no choca con una reserva que cae FUERA de su período', async () => {
    const reserva = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`)
      .send({ canchaId, whatsapp: '+5491150000000', nombreCliente: 'Juan', esContacto: false, fecha: JUEVES_FUERA, horaInicio: '20:00', montoSena: 500 });
    expect(reserva.status).toBe(201);
    // El torneo termina el 12/12: la reserva del 17/12 no es un choque.
    expect((await crear({ vigenciaHasta: '2026-12-12' })).status).toBe(201);
  });

  it('crearlo SÍ choca con una reserva que cae DENTRO del período', async () => {
    await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`)
      .send({ canchaId, whatsapp: '+5491150000000', nombreCliente: 'Juan', esContacto: false, fecha: JUEVES_DENTRO, horaInicio: '20:00', montoSena: 500 });
    expect((await crear({ vigenciaHasta: '2026-12-12' })).status).toBe(409);
  });

  it('dos bloqueos recurrentes en el mismo horario con períodos que no se solapan conviven', async () => {
    expect((await crear({ vigenciaDesde: '2026-10-01', vigenciaHasta: '2026-12-12' })).status).toBe(201);
    expect((await crear({ vigenciaDesde: '2026-12-13', vigenciaHasta: '2027-01-31' })).status).toBe(201);
  });

  it('con períodos que se solapan da 409', async () => {
    await crear({ vigenciaDesde: '2026-10-01', vigenciaHasta: '2026-12-12' });
    expect((await crear({ vigenciaDesde: '2026-12-01', vigenciaHasta: '2027-01-31' })).status).toBe(409);
  });

  it('rechaza un período invertido y el período en un bloqueo puntual (400)', async () => {
    expect((await crear({ vigenciaDesde: '2026-12-12', vigenciaHasta: '2026-10-17' })).status).toBe(400);
    const puntual = await supertest(app).post('/bloqueos').set('authorization', `Bearer ${token}`)
      .send({ canchaId, motivo: 'TORNEO', recurrente: false, fecha: JUEVES_DENTRO, horaInicio: '20:00', horaFin: '22:00', vigenciaHasta: '2026-12-12' });
    expect(puntual.status).toBe(400);
  });
});

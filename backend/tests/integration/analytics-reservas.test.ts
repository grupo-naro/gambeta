import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
let futbolId: string; let padelId: string; let clienteId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  futbolId = (await getPrisma().cancha.create({ data: { nombre: 'F5', tipo: 'futbol', precioHora: 1000 } })).id;
  padelId = (await getPrisma().cancha.create({ data: { nombre: 'P1', tipo: 'padel', precioHora: 1000 } })).id;
  clienteId = (await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } })).id;
});

let hora = 0;
// Cada reserva en una hora distinta del 2026-06-12 (jornada de la tarde en Argentina).
const reserva = (canchaId: string, estado: string, extra: Record<string, unknown> = {}) => {
  hora += 1;
  const ini = new Date(Date.UTC(2026, 5, 12, 12 + hora, 0, 0));
  return getPrisma().reserva.create({ data: {
    canchaId, clienteId, estado: estado as any, esContacto: true, monto: 1000,
    fechaInicio: ini, fechaFin: new Date(ini.getTime() + 3600000), ...extra,
  } });
};
const resumen = () => supertest(app).get('/analytics/reservas?desde=2026-06-12&hasta=2026-06-12').set('authorization', `Bearer ${token}`);

describe('GET /analytics/reservas', () => {
  it('cuenta solo las confirmadas y completadas como reservas reales', async () => {
    await reserva(futbolId, 'CONFIRMADA');
    await reserva(padelId, 'COMPLETADA');
    await reserva(padelId, 'CANCELADA');
    await reserva(futbolId, 'ESPERANDO_SENA');
    const r = await resumen();
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
  });

  it('informa las canceladas y las que esperan seña aparte', async () => {
    await reserva(padelId, 'CANCELADA');
    await reserva(padelId, 'CANCELADA');
    await reserva(futbolId, 'ESPERANDO_SENA');
    const r = await resumen();
    expect(r.body.canceladas).toBe(2);
    expect(r.body.esperandoSena).toBe(1);
    expect(r.body.total).toBe(0);
  });

  it('separa fútbol y pádel', async () => {
    await reserva(futbolId, 'CONFIRMADA');
    await reserva(futbolId, 'COMPLETADA');
    await reserva(padelId, 'CONFIRMADA');
    const r = await resumen();
    expect(r.body.porDeporte).toEqual({ futbol: 2, padel: 1 });
  });

  it('separa abonos (turno fijo), socios y sueltas', async () => {
    const fijo = await getPrisma().turnoFijo.create({ data: { canchaId: padelId, clienteNombre: 'A', diaSemana: 5, horaInicio: '20:00', horaFin: '21:00' } });
    const susc = await getPrisma().suscripcion.create({ data: { clienteId, inicio: new Date('2026-06-01'), vencimiento: new Date('2026-06-30') } });
    await reserva(padelId, 'CONFIRMADA', { turnoFijoId: fijo.id });
    await reserva(futbolId, 'CONFIRMADA', { suscripcionId: susc.id });
    await reserva(futbolId, 'COMPLETADA');
    await reserva(padelId, 'CONFIRMADA');
    const r = await resumen();
    expect(r.body.porOrigen).toEqual({ sueltas: 2, abonos: 1, socios: 1 });
    expect(r.body.total).toBe(4);
  });

  it('una reserva fuera del período no cuenta', async () => {
    await getPrisma().reserva.create({ data: {
      canchaId: futbolId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000,
      fechaInicio: new Date('2026-05-01T20:00:00.000Z'), fechaFin: new Date('2026-05-01T21:00:00.000Z'),
    } });
    expect((await resumen()).body.total).toBe(0);
  });

  it('sin token es 401 y un recepcionista recibe 403', async () => {
    expect((await supertest(app).get('/analytics/reservas')).status).toBe(401);
    const recep = signAdminToken({ adminId: 'x', email: 'r@b.com', rol: 'RECEPCIONISTA' });
    expect((await supertest(app).get('/analytics/reservas').set('authorization', `Bearer ${recep}`)).status).toBe(403);
  });
});

// --- Solo cuenta lo que ya se usó: el turno terminó. Los abonos se suman a medida que pasan. ---
import { analyticsService } from '../../src/services/analytics.service.js';
import { dayWindowUtc } from '../../src/utils/tz.js';

const TZ = 'America/Argentina/Buenos_Aires';
// Semana del lunes 08/06 al domingo 14/06 de 2026; "ahora" es el sábado 13 al mediodía.
const SEMANA = { desdeYmd: '2026-06-08', hastaYmd: '2026-06-14' };
const AHORA = new Date('2026-06-13T15:00:00.000Z');
const consultar = (ahora: Date = AHORA, rango = SEMANA) =>
  analyticsService.reservas(dayWindowUtc(rango.desdeYmd, TZ).start, dayWindowUtc(rango.hastaYmd, TZ).end, { ...rango, ahora });
const turno = (canchaId: string, estado: string, inicioIso: string, extra: Record<string, unknown> = {}) => {
  const ini = new Date(inicioIso);
  return getPrisma().reserva.create({ data: {
    canchaId, clienteId, estado: estado as any, esContacto: true, monto: 1000,
    fechaInicio: ini, fechaFin: new Date(ini.getTime() + 3600000), ...extra,
  } });
};
// El viernes 12/06 20:00-21:00 en Argentina (UTC-3).
const fijoViernes = (canchaId: string, extra: Record<string, unknown> = {}) =>
  getPrisma().turnoFijo.create({ data: {
    canchaId, clienteNombre: 'Ana', diaSemana: 5, horaInicio: '20:00', horaFin: '21:00',
    creadoEn: new Date('2026-06-01T12:00:00.000Z'), ...extra,
  } });

describe('reservas: solo las que ya se usaron', () => {
  it('una confirmada cuyo turno todavía no terminó es "próxima" y no cuenta', async () => {
    await turno(futbolId, 'CONFIRMADA', '2026-06-12T22:00:00.000Z'); // ya terminó
    await turno(futbolId, 'CONFIRMADA', '2026-06-13T20:00:00.000Z'); // hoy a la tarde: falta
    const r = await consultar();
    expect(r.total).toBe(1);
    expect(r.proximas).toBe(1);
  });

  it('el turno cuenta recién cuando termina, no cuando empieza', async () => {
    await turno(padelId, 'CONFIRMADA', '2026-06-13T14:30:00.000Z'); // 14:30 a 15:30 UTC
    expect((await consultar(new Date('2026-06-13T15:00:00.000Z'))).total).toBe(0); // empezó pero no terminó
    expect((await consultar(new Date('2026-06-13T15:30:00.000Z'))).total).toBe(1); // terminó
  });

  it('un abono que nadie cobró se cuenta cuando pasa (no hace falta que exista la reserva)', async () => {
    await fijoViernes(padelId);
    const r = await consultar();
    expect(r.total).toBe(1);
    expect(r.porOrigen.abonos).toBe(1);
    expect(r.porDeporte.padel).toBe(1);
  });

  it('un abono cuyo turno todavía no pasó no se cuenta', async () => {
    await fijoViernes(padelId);
    expect((await consultar(new Date('2026-06-12T23:30:00.000Z'))).total).toBe(0); // viernes 20:30 AR: sigue en juego
  });

  it('un abono ya cobrado (con reserva) se cuenta una sola vez', async () => {
    const fijo = await fijoViernes(padelId);
    await turno(padelId, 'CONFIRMADA', '2026-06-12T23:00:00.000Z', { turnoFijoId: fijo.id }); // 20:00 AR
    const r = await consultar();
    expect(r.total).toBe(1);
    expect(r.porOrigen.abonos).toBe(1);
  });

  it('una fecha liberada del abono (excepción) no se cuenta', async () => {
    const fijo = await fijoViernes(padelId);
    await getPrisma().turnoFijoExcepcion.create({ data: { turnoFijoId: fijo.id, fecha: new Date('2026-06-12T00:00:00.000Z') } });
    expect((await consultar()).total).toBe(0);
  });

  it('un abono cuya reserva se canceló no se cuenta como usado', async () => {
    const fijo = await fijoViernes(padelId);
    await turno(padelId, 'CANCELADA', '2026-06-12T23:00:00.000Z', { turnoFijoId: fijo.id });
    const r = await consultar();
    expect(r.total).toBe(0);
    expect(r.canceladas).toBe(1);
  });

  it('un abono no cuenta las fechas anteriores a que se cargó (sin período)', async () => {
    await fijoViernes(padelId, { creadoEn: new Date('2026-06-13T10:00:00.000Z') }); // se cargó el sábado
    expect((await consultar()).total).toBe(0);
  });

  it('con período propio, cuenta desde el inicio del período aunque se haya cargado después', async () => {
    await fijoViernes(padelId, { creadoEn: new Date('2026-06-13T10:00:00.000Z'), vigenciaDesde: new Date('2026-06-01T00:00:00.000Z') });
    expect((await consultar()).total).toBe(1);
  });

  it('un abono fuera de su período no cuenta', async () => {
    await fijoViernes(padelId, { vigenciaHasta: new Date('2026-06-05T00:00:00.000Z') });
    expect((await consultar()).total).toBe(0);
  });

  it('un abono inactivo no cuenta', async () => {
    await fijoViernes(padelId, { activo: false });
    expect((await consultar()).total).toBe(0);
  });

  it('cuenta cada semana del período (dos viernes = 2 abonos)', async () => {
    await fijoViernes(padelId, { creadoEn: new Date('2026-05-01T12:00:00.000Z') });
    const r = await consultar(new Date('2026-06-20T15:00:00.000Z'), { desdeYmd: '2026-06-01', hastaYmd: '2026-06-14' });
    expect(r.porOrigen.abonos).toBe(2); // 05/06 y 12/06
  });
});

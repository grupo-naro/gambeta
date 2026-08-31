import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hoyEnTz, sumarDias } from '../../src/utils/tz.js';

const TZ = 'America/Argentina/Buenos_Aires';
let app: any;
let canchaId: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
  canchaId = c.id;
});

const body = (fecha: string) => ({
  canchaId, whatsapp: '+5491150000000', nombreCliente: 'Juan',
  esContacto: false, fecha, horaInicio: '18:00', montoSena: 500,
});

const token = () => signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });

describe('anticipación máxima', () => {
  // Congelado a un mediodía fijo, lejos de las 22:00-24:00 ART: la ventana es una FECHA de
  // calendario, y una implementación que corte por milisegundos (`Date.now() + N días`) solo se
  // delata si "ahora" cae antes de la hora del turno límite. Sin congelar, correr la suite de
  // noche (22:00-24:00 ART) esconde el bug en vez de reventarlo. Solo se fakea `Date`: el resto
  // de los timers queda real para no colgar supertest/Postgres.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-26T15:00:00.000Z')); // 12:00 en America/Argentina/Buenos_Aires
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('el público puede reservar el último día de la ventana', async () => {
    const ultimo = sumarDias(hoyEnTz(TZ), 7);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(ultimo));
    expect(res.status).toBe(201);
  });

  it('el público NO puede reservar un día después de la ventana', async () => {
    const limite = sumarDias(hoyEnTz(TZ), 7);
    const pasado = sumarDias(hoyEnTz(TZ), 8);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(pasado));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('solo se puede reservar hasta');
    // El mensaje tiene que nombrar la FECHA límite, no una cantidad de días: un texto como
    // "...hasta 7 días" pasaría el toContain de arriba pero es justo la formulación prohibida.
    const [, mes, dia] = limite.split('-');
    expect(res.body.error.message).toContain(`${dia}/${mes}`);
  });

  it('el staff SÍ puede reservar fuera de la ventana', async () => {
    const lejos = sumarDias(hoyEnTz(TZ), 30);
    const res = await supertest(app).post('/reservas').set('authorization', `Bearer ${token()}`).send(body(lejos));
    expect(res.status).toBe(201);
  });

  it('la ventana se mueve con la configuración, no está hardcodeada', async () => {
    await supertest(app).patch('/config').set('authorization', `Bearer ${token()}`).send({ diasAnticipacionMax: 20 });
    const dia15 = sumarDias(hoyEnTz(TZ), 15);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(dia15));
    expect(res.status).toBe(201);
  });

  it('una ventana más chica que el default también achica lo que se puede reservar', async () => {
    // Complementa el caso de arriba: ese solo prueba que la ventana crece con la config.
    // Una implementación con Math.max(7, cfg.diasAnticipacionMax) pasaría ese test igual,
    // porque nunca deja la ventana por debajo del default. Achicarla a 2 y pedir +5 lo delata.
    await supertest(app).patch('/config').set('authorization', `Bearer ${token()}`).send({ diasAnticipacionMax: 2 });
    const dia5 = sumarDias(hoyEnTz(TZ), 5);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(dia5));
    expect(res.status).toBe(422);
  });

  it('el último día de la ventana vale entero, hasta el último turno de la noche', async () => {
    // El bug que rompería una implementación por milisegundos: a las 20:00 de hoy, un corte
    // hecho con Date.now() + 7 días caería a las 20:00 del día 7 y rechazaría este turno.
    const ultimo = sumarDias(hoyEnTz(TZ), 7);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ ...body(ultimo), horaInicio: '22:00' });
    expect(res.status).toBe(201);
  });
});

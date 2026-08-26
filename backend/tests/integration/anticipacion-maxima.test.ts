import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
  it('el público puede reservar el último día de la ventana', async () => {
    const ultimo = sumarDias(hoyEnTz(TZ), 7);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(ultimo));
    expect(res.status).toBe(201);
  });

  it('el público NO puede reservar un día después de la ventana', async () => {
    const pasado = sumarDias(hoyEnTz(TZ), 8);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(pasado));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('solo se puede reservar hasta');
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

  it('el último día de la ventana vale entero, hasta el último turno de la noche', async () => {
    // El bug que rompería una implementación por milisegundos: a las 20:00 de hoy, un corte
    // hecho con Date.now() + 7 días caería a las 20:00 del día 7 y rechazaría este turno.
    const ultimo = sumarDias(hoyEnTz(TZ), 7);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ ...body(ultimo), horaInicio: '22:00' });
    expect(res.status).toBe(201);
  });
});

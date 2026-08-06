import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

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
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } })).id;
});

// Fecha RELATIVA: `crear()` rechaza reservas en el pasado con 422, así que una fecha
// hardcodeada rompe estos tests en cuanto queda atrás.
const manana = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const body = (over: Partial<any> = {}) => ({
  canchaId,
  whatsapp: '+5491150000000',
  nombreCliente: 'Juan',
  esContacto: false,
  fecha: manana(),
  horaInicio: '18:00',
  ...over,
});

/** Crea una reserva que queda en ESPERANDO_SENA y devuelve su id. */
async function crearEsperandoSena(over: Partial<any> = {}): Promise<string> {
  const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(over));
  expect(res.status).toBe(201);
  expect(res.body.estado).toBe('ESPERANDO_SENA');
  return res.body.id;
}

/**
 * Envejece la reserva más allá de cualquier SENA_TIMEOUT_MINUTOS razonable.
 * `vencidasSena()` filtra por `creadoEn`, que Prisma setea solo al insertar.
 */
async function envejecer(id: string, horas = 24): Promise<void> {
  await getPrisma().reserva.update({
    where: { id },
    data: { creadoEn: new Date(Date.now() - horas * 3600000) },
  });
}

describe('rechazarSena es condicional', () => {
  it('cancela la reserva y libera el horario para otra reserva', async () => {
    const id = await crearEsperandoSena();

    const rechazo = await supertest(app).patch(`/reservas/${id}/rechazar-sena`).set('x-api-key', 'svc');
    expect(rechazo.status).toBe(200);
    expect(rechazo.body.estado).toBe('CANCELADA');

    // La prueba de fondo: que el horario quedó libre. Se verifica reservando de nuevo el
    // mismo slot — si los ReservaSector siguieran ocupados, la restricción de exclusión
    // de Postgres devolvería 409.
    const otra = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body());
    expect(otra.status).toBe(201);
  });

  it('no toca una reserva ya CONFIRMADA: responde 409', async () => {
    const id = await crearEsperandoSena();
    await getPrisma().reserva.update({ where: { id }, data: { estado: 'CONFIRMADA' } });
    await getPrisma().reservaSector.updateMany({ where: { reservaId: id }, data: { estado: 'CONFIRMADA' } });

    const rechazo = await supertest(app).patch(`/reservas/${id}/rechazar-sena`).set('x-api-key', 'svc');
    expect(rechazo.status).toBe(409);

    const despues = await getPrisma().reserva.findUniqueOrThrow({ where: { id } });
    expect(despues.estado).toBe('CONFIRMADA');
  });

  it('rechazar dos veces la misma reserva no rompe: la segunda es 409', async () => {
    const id = await crearEsperandoSena();
    expect((await supertest(app).patch(`/reservas/${id}/rechazar-sena`).set('x-api-key', 'svc')).status).toBe(200);
    expect((await supertest(app).patch(`/reservas/${id}/rechazar-sena`).set('x-api-key', 'svc')).status).toBe(409);
  });
});

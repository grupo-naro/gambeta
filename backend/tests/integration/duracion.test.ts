import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

// Fecha futura fija para que "no se puede reservar en el pasado" nunca interfiera.
const fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

async function crearCancha() {
  return getPrisma().cancha.create({ data: { nombre: 'Pádel 1', tipo: 'padel', precioHora: 30000, precioHoraPico: 36000 } });
}

function reservar(canchaId: string, horaInicio: string, duracionMin?: number) {
  const body: Record<string, unknown> = { canchaId, fecha, horaInicio, whatsapp: '5491133334444', nombreCliente: 'Test', esContacto: true };
  if (duracionMin != null) body.duracionMin = duracionMin;
  return supertest(app).post('/reservas').set('x-api-key', 'svc').send(body);
}

describe('duración variable', () => {
  it('sin duracionMin reserva una hora, como antes', async () => {
    const c = await crearCancha();
    const res = await reservar(c.id, '17:00');
    expect(res.status).toBe(201);
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    expect(r!.fechaFin.getTime() - r!.fechaInicio.getTime()).toBe(60 * 60 * 1000);
  });

  it('duracionMin=120 crea una reserva de dos horas', async () => {
    const c = await crearCancha();
    const res = await reservar(c.id, '17:00', 120);
    expect(res.status).toBe(201);
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    expect(r!.fechaFin.getTime() - r!.fechaInicio.getTime()).toBe(120 * 60 * 1000);
  });

  it('una duración fuera de {60,90,120} se rechaza con 400', async () => {
    const c = await crearCancha();
    expect((await reservar(c.id, '17:00', 45)).status).toBe(400);
    expect((await reservar(c.id, '17:00', 180)).status).toBe(400);
  });

  it('un solapamiento parcial de 30 minutos se rechaza con 409', async () => {
    const c = await crearCancha();
    expect((await reservar(c.id, '17:00', 120)).status).toBe(201); // 17:00-19:00
    // 18:30-19:30 pisa la última media hora: lo tiene que atajar la restricción de exclusión.
    expect((await reservar(c.id, '18:30', 60)).status).toBe(409);
  });

  it('una reserva que termina después del cierre se rechaza con 422', async () => {
    const c = await crearCancha();
    // El cierre por defecto de la config es 23:00 en semana y 00:00 el finde.
    const { configService } = await import('../../src/services/config.service.js');
    await configService.get();
    await configService.update({ horaApertura: '08:00', horaCierre: '23:00', horaAperturaFinde: '08:00', horaCierreFinde: '23:00' });
    expect((await reservar(c.id, '22:00', 60)).status).toBe(201);  // termina 23:00, justo en el cierre
    expect((await reservar(c.id, '22:30', 120)).status).toBe(422); // terminaría 00:30
  });
});

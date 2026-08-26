import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hoyEnTz, sumarDias } from '../../src/utils/tz.js';

const TZ = 'America/Argentina/Buenos_Aires';
let app: any; let canchaId: string; let clienteId: string; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } })).id;
  clienteId = (await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } })).id;
  // Real admin so the audit log FK (adminId -> AdminUser) holds on override.
  const admin = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

// Direct CONFIRMADA reserva starting `h` hours from now (for window/estado tests).
async function reservaEnHoras(h: number, estado: any = 'CONFIRMADA') {
  const inicio = new Date(Date.now() + h * 3600_000);
  const fin = new Date(inicio.getTime() + 3600_000);
  return getPrisma().reserva.create({
    data: { canchaId, clienteId, estado, esContacto: true, monto: 12000, montoSena: null, fechaInicio: inicio, fechaFin: fin },
  });
}
const fechaFutura = (daysAhead: number) => new Date(Date.now() + daysAhead * 86400_000).toISOString().slice(0, 10);
// Create a CONFIRMADA reserva via the API (consistent AR-tz -> UTC) for a given local fecha/hora.
async function crearAPI(fecha: string, horaInicio: string) {
  const res = await supertest(app).post('/reservas').set('x-api-key', 'svc')
    .send({ canchaId, whatsapp: '+5491150000000', nombreCliente: 'Cli', esContacto: true, fecha, horaInicio });
  return res.body;
}

describe('PATCH /reservas/:id/reprogramar', () => {
  it('moves a CONFIRMADA reserva to a free slot, keeping estado', async () => {
    const r = await reservaEnHoras(72);
    const fecha = fechaFutura(4);
    const res = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('x-api-key', 'svc').send({ fecha, horaInicio: '20:00' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(new Date(res.body.fechaInicio).getTime()).not.toBe(r.fechaInicio.getTime());
  });

  it('409 when the new slot is taken', async () => {
    const fecha = fechaFutura(5);
    await crearAPI(fecha, '21:00'); // occupies 21:00
    const a = await crearAPI(fecha, '20:00');
    const res = await supertest(app).patch(`/reservas/${a.id}/reprogramar`).set('x-api-key', 'svc').send({ fecha, horaInicio: '21:00' });
    expect(res.status).toBe(409);
  });

  it('422 dentro de la ventana de reprogramacion (2h) para service, 200 para admin', async () => {
    const r = await reservaEnHoras(1); // dentro de la ventana de 2h
    const body = { fecha: fechaFutura(3), horaInicio: '20:00' };
    const svc = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('x-api-key', 'svc').send(body);
    expect(svc.status).toBe(422);
    const adm = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('authorization', `Bearer ${token}`).send(body);
    expect(adm.status).toBe(200);
  });

  it('permite reprogramar fuera de la ventana de 2h (ej. 3h antes) sin admin', async () => {
    const r = await reservaEnHoras(3); // fuera de la ventana de 2h (con la vieja de 12h habria dado 422)
    const res = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('x-api-key', 'svc').send({ fecha: fechaFutura(3), horaInicio: '20:00' });
    expect(res.status).toBe(200);
  });

  it('mueve la reserva a otra cancha libre (mismo horario), conservando estado', async () => {
    const fecha = fechaFutura(6);
    const r = await crearAPI(fecha, '20:00');
    const canchaB = (await getPrisma().cancha.create({ data: { nombre: 'B', tipo: 'f5', precioHora: 12000 } })).id;
    const res = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('x-api-key', 'svc').send({ fecha, horaInicio: '20:00', canchaId: canchaB });
    expect(res.status).toBe(200);
    expect(res.body.canchaId).toBe(canchaB);
    expect(res.body.estado).toBe('CONFIRMADA');
  });

  it('409 al mover a una cancha ocupada en ese horario', async () => {
    const fecha = fechaFutura(7);
    const r = await crearAPI(fecha, '20:00');
    const canchaB = (await getPrisma().cancha.create({ data: { nombre: 'B2', tipo: 'f5', precioHora: 12000 } })).id;
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: canchaB, whatsapp: '+5491150009999', nombreCliente: 'Otro', esContacto: true, fecha, horaInicio: '20:00' });
    const res = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('x-api-key', 'svc').send({ fecha, horaInicio: '20:00', canchaId: canchaB });
    expect(res.status).toBe(409);
  });

  it('409 when reservation is CANCELADA', async () => {
    const r = await reservaEnHoras(72, 'CANCELADA');
    const res = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('x-api-key', 'svc').send({ fecha: fechaFutura(4), horaInicio: '20:00' });
    expect(res.status).toBe(409);
  });

  it('422 when new time is in the past', async () => {
    const r = await reservaEnHoras(72);
    const res = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('x-api-key', 'svc').send({ fecha: '2020-01-01', horaInicio: '20:00' });
    expect(res.status).toBe(422);
  });

  it('la reprogramación respeta la ventana de anticipación: 422 para el bot con clave de servicio, 200 para admin', async () => {
    // Sin este chequeo, reprogramar es una puerta trasera a la ventana de `crear`: se crea una
    // reserva cercana y después se la reprograma lejos. authAny deja pasar `x-api-key`, así que
    // el bot de n8n tiene que quedar tan limitado como el público.
    const r = await reservaEnHoras(72);
    const lejos = sumarDias(hoyEnTz(TZ), 30);
    const svc = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('x-api-key', 'svc').send({ fecha: lejos, horaInicio: '20:00' });
    expect(svc.status).toBe(422);
    const adm = await supertest(app).patch(`/reservas/${r.id}/reprogramar`).set('authorization', `Bearer ${token}`).send({ fecha: lejos, horaInicio: '20:00' });
    expect(adm.status).toBe(200);
  });
});

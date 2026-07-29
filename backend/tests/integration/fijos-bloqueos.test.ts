import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { dayOfWeekInTz } from '../../src/utils/tz.js';

let app: any;
let token: string;

function proximoDia(dow: number) {
  for (let i = 1; i <= 14; i++) {
    const f = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
    if (dayOfWeekInTz(f, 'America/Argentina/Buenos_Aires') === dow) return f;
  }
  throw new Error('no day');
}

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const admin = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

describe('B1: modelos TurnoFijo / Bloqueo', () => {
  it('crea un turno fijo en la DB', async () => {
    const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
    const f = await getPrisma().turnoFijo.create({ data: { canchaId: c.id, clienteNombre: 'Juan', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', precio: 12000 } });
    expect(f.id).toBeTruthy();
  });
});

describe('B2: ocupacionService', () => {
  it('rangosPlantilla incluye el fijo el dia que toca y lo excluye con excepcion', async () => {
    const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 })).body;
    await getPrisma().turnoFijo.create({ data: { canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', precio: 12000 } });
    const { ocupacionService } = await import('../../src/services/ocupacion.service.js');
    const martes = proximoDia(2);
    const lunes = proximoDia(1);
    expect((await ocupacionService.rangosPlantilla(c.id, martes)).length).toBe(1);
    expect((await ocupacionService.rangosPlantilla(c.id, lunes)).length).toBe(0);
  });

  it('rangosPlantilla excluye el fijo cuando hay excepcion para esa fecha', async () => {
    const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 })).body;
    const fijo = await getPrisma().turnoFijo.create({ data: { canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', precio: 12000 } });
    const martes = proximoDia(2);
    await getPrisma().turnoFijoExcepcion.create({ data: { turnoFijoId: fijo.id, fecha: new Date(martes + 'T00:00:00.000Z') } });
    const { ocupacionService } = await import('../../src/services/ocupacion.service.js');
    expect((await ocupacionService.rangosPlantilla(c.id, martes)).length).toBe(0);
  });
});

describe('B3: disponibilidad resta fijos/bloqueos + reserva.crear valida', () => {
  it('disponibilidad esconde el slot del fijo y reservarlo da 409', async () => {
    const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 })).body;
    await getPrisma().turnoFijo.create({ data: { canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', precio: 12000 } });
    const martes = proximoDia(2);
    const disp = await supertest(app).get('/disponibilidad').query({ canchaId: c.id, fecha: martes }).set('x-api-key', 'svc');
    expect(disp.body.slots.map((s: any) => s.horaInicio)).not.toContain('20:00');
    const r = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: c.id, whatsapp: '+5491150000000', nombreCliente: 'A', esContacto: true, fecha: martes, horaInicio: '20:00' });
    expect(r.status).toBe(409);
  });
});

describe('B4: turnos fijos service + endpoints', () => {
  it('crear un fijo que pisa un alquiler futuro da 409', async () => {
    const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 })).body;
    const martes = proximoDia(2);
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: c.id, whatsapp: '+5491150000000', nombreCliente: 'A', esContacto: true, fecha: martes, horaInicio: '20:00' });
    const r = await supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`).send({ canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', whatsapp: '5491150000000' });
    expect(r.status).toBe(409);
  });

  it('una excepcion libera el slot ese dia', async () => {
    const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 })).body;
    const f = (await supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`).send({ canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', whatsapp: '5491150000000' })).body;
    const martes = proximoDia(2);
    await supertest(app).post(`/turnos-fijos/${f.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: martes });
    const disp = await supertest(app).get('/disponibilidad').query({ canchaId: c.id, fecha: martes }).set('x-api-key', 'svc');
    expect(disp.body.slots.map((s: any) => s.horaInicio)).toContain('20:00');
  });
});

describe('B5: bloqueos service + endpoints', () => {
  it('bloqueo puntual esconde el slot solo esa fecha', async () => {
    const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 })).body;
    const dia = proximoDia(3); // un miércoles cualquiera
    await supertest(app).post('/bloqueos').set('authorization', `Bearer ${token}`).send({ canchaId: c.id, motivo: 'MANTENIMIENTO', recurrente: false, fecha: dia, horaInicio: '18:00', horaFin: '19:00' });
    const disp = await supertest(app).get('/disponibilidad').query({ canchaId: c.id, fecha: dia }).set('x-api-key', 'svc');
    expect(disp.body.slots.map((s: any) => s.horaInicio)).not.toContain('18:00');
  });
  it('bloqueo recurrente esconde el slot ese dia de semana y lo deja libre otro dia', async () => {
    const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 })).body;
    await supertest(app).post('/bloqueos').set('authorization', `Bearer ${token}`).send({ canchaId: c.id, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 2, horaInicio: '18:00', horaFin: '19:00' });
    const dM = await supertest(app).get('/disponibilidad').query({ canchaId: c.id, fecha: proximoDia(2) }).set('x-api-key', 'svc');
    const dL = await supertest(app).get('/disponibilidad').query({ canchaId: c.id, fecha: proximoDia(1) }).set('x-api-key', 'svc');
    expect(dM.body.slots.map((s: any) => s.horaInicio)).not.toContain('18:00');
    expect(dL.body.slots.map((s: any) => s.horaInicio)).toContain('18:00');
  });
});

describe('B6: sectores + reprogramar (review)', () => {
  it('un fijo en la entera bloquea las partes (sectores)', async () => {
    const cs = (await supertest(app).post('/canchas/divisible').set('authorization', `Bearer ${token}`).send({ nombre: 'Cancha 4', partes: 3, precioEntera: 30000, precioParte: 12000, jugadoresEntera: 5, jugadoresParte: 5 })).body;
    const entera = cs.find((c: any) => c.esEntera); const parte = cs.find((c: any) => !c.esEntera);
    await supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`).send({ canchaId: entera.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', whatsapp: '5491150000000' });
    const disp = await supertest(app).get('/disponibilidad').query({ canchaId: parte.id, fecha: proximoDia(2) }).set('x-api-key', 'svc');
    expect(disp.body.slots.map((s: any) => s.horaInicio)).not.toContain('20:00');
  });
  it('no se puede reprogramar a un slot tomado por un fijo (409)', async () => {
    const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 })).body;
    await supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`).send({ canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', whatsapp: '5491150000000' });
    const r = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: c.id, whatsapp: '+5491150000000', nombreCliente: 'A', esContacto: true, fecha: proximoDia(3), horaInicio: '18:00' });
    const rep = await supertest(app).patch(`/reservas/${r.body.id}/reprogramar`).set('authorization', `Bearer ${token}`).send({ fecha: proximoDia(2), horaInicio: '20:00' });
    expect(rep.status).toBe(409);
  });
});

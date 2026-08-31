import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { configService } from '../../src/services/config.service.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
let token: string;

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

describe('configService', () => {
  it('crea la fila default si no existe y la devuelve', async () => {
    const c = await configService.get();
    expect(c.id).toBe('default');
    expect(c.horaApertura).toMatch(/^\d{2}:\d{2}$/);
    expect(c.horaCierre).toMatch(/^\d{2}:\d{2}$/);
  });
  it('update modifica y persiste', async () => {
    await configService.get();
    await configService.update({ alias: 'nuevo.alias', horaApertura: '09:00' });
    const c = await configService.get();
    expect(c.alias).toBe('nuevo.alias');
    expect(c.horaApertura).toBe('09:00');
  });
});

describe('GET/PATCH /config', () => {
  it('GET /config devuelve la config (authAny)', async () => {
    const res = await supertest(app).get('/config').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('default');
  });
  it('PATCH /config actualiza con JWT admin', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ alias: 'gambeteando.mp', horaApertura: '09:00', horaCierre: '23:00' });
    expect(res.status).toBe(200);
    expect(res.body.alias).toBe('gambeteando.mp');
  });
  it('ni GET ni PATCH /config filtran el buffetPinHash', async () => {
    // buffetPinService.setear ya no escribe Configuracion.buffetPinHash (el PIN vive en
    // Mostrador.pinHash); esa columna sigue existiendo como rollback natural de la migración
    // que la mudó, así que la sembramos directo para que haya algo que filtrar de verdad.
    await configService.get();
    await getPrisma().configuracion.update({ where: { id: 'default' }, data: { buffetPinHash: 'hash-de-prueba' } });

    const get = await supertest(app).get('/config').set('x-api-key', 'svc');
    expect(get.status).toBe(200);
    expect(get.body).not.toHaveProperty('buffetPinHash');

    const patch = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ alias: 'gambeteando.pin-test' });
    expect(patch.status).toBe(200);
    expect(patch.body).not.toHaveProperty('buffetPinHash');
  });
  it('PATCH /config 400 con HH:MM inválido', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ horaApertura: '9am' });
    expect(res.status).toBe(400);
  });
  it('PATCH /config 400 si apertura >= cierre', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ horaApertura: '23:00', horaCierre: '09:00' });
    expect(res.status).toBe(400);
  });
  it('PATCH /config 401 sin auth', async () => {
    const res = await supertest(app).patch('/config').send({ alias: 'x' });
    expect(res.status).toBe(401);
  });
  it('PATCH /config 422 si un cambio parcial deja apertura >= cierre', async () => {
    // default 16:00-23:00; bajar solo el cierre a 10:00 deja apertura(16:00) >= cierre(10:00)
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ horaCierre: '10:00' });
    expect(res.status).toBe(422);
  });
  it('PATCH /config 400 con hora imposible (25:99)', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ horaApertura: '25:99' });
    expect(res.status).toBe(400);
  });
  it('acepta horario de semana y finde con cierre 00:00', async () => {
    const r = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ horaApertura: '09:00', horaCierre: '00:00', horaAperturaFinde: '16:00', horaCierreFinde: '00:00' });
    expect(r.status).toBe(200);
    expect(r.body.horaAperturaFinde).toBe('16:00');
    expect(r.body.horaCierreFinde).toBe('00:00');
    expect(r.body.horaCierre).toBe('00:00');
  });
  it('rechaza semana con apertura posterior al cierre', async () => {
    const r = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ horaApertura: '22:00', horaCierre: '20:00' });
    expect(r.status).toBe(400);
  });
  it('rechaza finde con apertura posterior al cierre', async () => {
    const r = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ horaAperturaFinde: '20:00', horaCierreFinde: '18:00' });
    expect(r.status).toBe(400);
  });
  it('diasAnticipacionMax arranca en 7 y se puede cambiar por PATCH', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const get = await supertest(app).get('/config').set('authorization', `Bearer ${token}`);
    expect(get.body.diasAnticipacionMax).toBe(7);

    const patch = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ diasAnticipacionMax: 14 });
    expect(patch.status).toBe(200);
    expect(patch.body.diasAnticipacionMax).toBe(14);
  });

  it('diasAnticipacionMax rechaza 0 y valores no enteros', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    expect((await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ diasAnticipacionMax: 0 })).status).toBe(400);
    expect((await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ diasAnticipacionMax: 2.5 })).status).toBe(400);
  });
});

describe('senaService desde DB', () => {
  it('monto fijo desde config', async () => {
    const { senaService } = await import('../../src/services/sena.service.js');
    await configService.get();
    await configService.update({ senaModo: 'FIJO', senaMontoFijo: 7000 });
    expect(await senaService.montoParaPrecio(12000)).toBe(7000);
  });
  it('ignora senaModo=PORCENTAJE y sigue usando el monto fijo (porcentaje anulado)', async () => {
    const { senaService } = await import('../../src/services/sena.service.js');
    await configService.get();
    await configService.update({ senaModo: 'PORCENTAJE', senaPorcentaje: 50, senaMontoFijo: 5000 });
    expect(await senaService.montoParaPrecio(12000)).toBe(5000);
  });
  it('datosPago refleja alias de la config', async () => {
    const { senaService } = await import('../../src/services/sena.service.js');
    await configService.get();
    await configService.update({ alias: 'pago.gambeteando', cbu: '000', titular: 'Nahuel' });
    const dp = await senaService.datosPago();
    expect(dp.alias).toBe('pago.gambeteando');
  });
});

describe('disponibilidad usa horario global', () => {
  it('genera slots dentro de la apertura-cierre de la config', async () => {
    await configService.get();
    // Fijamos también el horario de finde igual al de semana: este test verifica la lógica
    // apertura-cierre en sí, no la distinción semana/finde (cubierta en disponibilidad-tamano.test.ts).
    await configService.update({ horaApertura: '09:00', horaCierre: '12:00', horaAperturaFinde: '09:00', horaCierreFinde: '12:00' });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
    const { disponibilidadService } = await import('../../src/services/disponibilidad.service.js');
    const fecha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const r = await disponibilidadService.listar(cancha.id, fecha);
    // Granularidad de 30 minutos (Task 4): el rango 09:00-12:00 produce turnos cada media
    // hora; 11:30 queda afuera porque ninguna duración (mínimo 60') entra antes del cierre.
    expect(r.slots.map((s) => s.horaInicio)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });
});

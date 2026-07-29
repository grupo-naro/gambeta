import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { configService } from '../../src/services/config.service.js';
import { dayOfWeekInTz } from '../../src/utils/tz.js';

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
  // precioHora > monto fijo global de seña (5000 en tests) para que "cobroInicial=sena" siga siendo un cobro parcial (< precio).
  const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
  canchaId = c.id;
});

const body = (over: Partial<any> = {}) => ({
  canchaId,
  whatsapp: '+5491150000000',
  nombreCliente: 'Juan',
  esContacto: false,
  fecha: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  horaInicio: '18:00',
  montoSena: 500,
  ...over,
});

describe('POST /reservas', () => {
  it('new client -> ESPERANDO_SENA and creates the client', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body());
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(await getPrisma().cliente.count()).toBe(1);
  });

  it('known contact -> CONFIRMADA', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true }));
    expect(res.body.estado).toBe('CONFIRMADA');
  });

  it('reserva creada por staff (JWT) -> CONFIRMADA sin seña, aunque el cliente sea nuevo', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const res = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body());
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(res.body.montoSena ?? null).toBeNull();
  });

  it('staff (JWT) con cobroInicial=total -> registra cobro por el precio completo', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const res = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body({ cobroInicial: 'total', medioCobro: 'EFECTIVO' }));
    expect(res.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: res.body.id } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBe(Number(res.body.monto)); // precio completo
  });

  it('staff (JWT) con cobroInicial=sena -> registra un cobro parcial (>0 y < precio)', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const res = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body({ cobroInicial: 'sena' }));
    expect(res.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: res.body.id } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBeGreaterThan(0);
    expect(Number(cobros[0].monto)).toBeLessThanOrEqual(Number(res.body.monto));
  });

  it('sin cobroInicial -> no registra cobro', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const res = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body());
    expect(res.status).toBe(201);
    expect(await getPrisma().cobro.count({ where: { reservaId: res.body.id } })).toBe(0);
  });

  it('bot (x-api-key) con cobroInicial=total -> NO registra cobro (solo staff)', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ cobroInicial: 'total' }));
    expect(res.status).toBe(201);
    expect(await getPrisma().cobro.count({ where: { reservaId: res.body.id } })).toBe(0);
  });

  it('overlap -> 409', async () => {
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true }));
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body());
    expect(res.status).toBe(409);
  });

  it('past date -> 422', async () => {
    const res = await supertest(app)
      .post('/reservas')
      .set('x-api-key', 'svc')
      .send(body({ fecha: '2020-01-01' }));
    expect(res.status).toBe(422);
  });
});

describe('POST /reservas — precio por hora pico', () => {
  it('aplica el precio pico cuando la hora cae en la franja', async () => {
    await configService.update({ picoDesde: '19:00', picoHasta: '23:00', picoFindeDesde: '', picoFindeHasta: '' });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'P', tipo: 'f5', precioHora: 1000, jugadores: 5, precioHoraPico: 3000 } });
    // un día de semana futuro (no sábado/domingo) a las 20:00 → pico
    let fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    while (true) {
      const wd = dayOfWeekInTz(fecha, process.env.TZ_NEGOCIO || 'America/Argentina/Buenos_Aires');
      if (wd !== 0 && wd !== 6) break;
      fecha = new Date(new Date(fecha + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
    }
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send({ canchaId: cancha.id, whatsapp: '+5491150000099', nombreCliente: 'Pico', esContacto: false, fecha, horaInicio: '20:00' });
    expect(res.status).toBe(201);
    expect(Number(res.body.monto)).toBe(3000);
  });

  it('aplica el precio base fuera de la franja', async () => {
    await configService.update({ picoDesde: '19:00', picoHasta: '23:00' });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'P2', tipo: 'f5', precioHora: 1000, jugadores: 5, precioHoraPico: 3000 } });
    let fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    while (true) {
      const wd = dayOfWeekInTz(fecha, process.env.TZ_NEGOCIO || 'America/Argentina/Buenos_Aires');
      if (wd !== 0 && wd !== 6) break;
      fecha = new Date(new Date(fecha + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
    }
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send({ canchaId: cancha.id, whatsapp: '+5491150000098', nombreCliente: 'Base', esContacto: false, fecha, horaInicio: '17:00' });
    expect(res.status).toBe(201);
    expect(Number(res.body.monto)).toBe(1000);
  });
});

describe('GET /reservas — filtro por rango', () => {
  it('devuelve reservas dentro del rango y excluye las de afuera', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    // dentro: dentro de 3 días; fuera: dentro de 30 días
    const dentro = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const fuera = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true, fecha: dentro, horaInicio: '18:00' }));
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true, fecha: fuera, horaInicio: '18:00' }));
    const desde = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const res = await supertest(app).get(`/reservas?desde=${desde}&hasta=${hasta}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const fechas = (res.body as any[]).map((r) => r.fechaInicio.slice(0, 10));
    expect(fechas).toContain(dentro);
    expect(fechas).not.toContain(fuera);
  });

  it('combina rango con estado', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const dentro = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    // una CONFIRMADA (contacto) y una ESPERANDO_SENA (no contacto)
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true, fecha: dentro, horaInicio: '18:00' }));
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: false, fecha: dentro, horaInicio: '19:00', montoSena: 500 }));
    const desde = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const res = await supertest(app).get(`/reservas?desde=${desde}&hasta=${hasta}&estado=CONFIRMADA`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body as any[]).every((r) => r.estado === 'CONFIRMADA')).toBe(true);
    expect((res.body as any[]).length).toBe(1);
  });
});

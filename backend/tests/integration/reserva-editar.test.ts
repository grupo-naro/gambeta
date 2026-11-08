import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaMontoFijo: 5000 } });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'F5', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } })).id;
});

const fut = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const auth = (r: supertest.Test, t = token) => r.set('authorization', `Bearer ${t}`);
let n = 0;
const crear = (horaInicio: string, extra: Record<string, unknown> = {}) => {
  n += 1;
  return auth(supertest(app).post('/reservas')).send({ canchaId, whatsapp: `+54911500001${String(n).padStart(2, '0')}`, nombreCliente: 'Cli' + n, fecha: fut(), horaInicio, ...extra });
};
const editar = (id: string, body: Record<string, unknown>, t = token) => auth(supertest(app).patch(`/reservas/${id}/editar`), t).send(body);
const dur = (r: any) => (new Date(r.fechaFin).getTime() - new Date(r.fechaInicio).getTime()) / 60000;

describe('PATCH /reservas/:id/editar', () => {
  it('alargar de 1 h a 1½ h: cambia la hora de fin y recalcula el precio', async () => {
    const r = await crear('18:00');
    expect(Number(r.body.monto)).toBe(20000);
    const e = await editar(r.body.id, { duracionMin: 90 });
    expect(e.status).toBe(200);
    expect(dur(e.body)).toBe(90);
    expect(Number(e.body.monto)).toBe(30000);
  });

  it('acortar de 1 h a 30 min', async () => {
    const r = await crear('18:00');
    const e = await editar(r.body.id, { duracionMin: 30 });
    expect(e.status).toBe(200);
    expect(dur(e.body)).toBe(30);
    expect(Number(e.body.monto)).toBe(10000);
  });

  it('cambiar solo el monto no toca el horario', async () => {
    const r = await crear('18:00');
    const e = await editar(r.body.id, { monto: 25000 });
    expect(e.status).toBe(200);
    expect(Number(e.body.monto)).toBe(25000);
    expect(dur(e.body)).toBe(60);
  });

  it('duración y monto a la vez: gana el monto que se indicó', async () => {
    const r = await crear('18:00');
    const e = await editar(r.body.id, { duracionMin: 90, monto: 28000 });
    expect(e.status).toBe(200);
    expect(dur(e.body)).toBe(90);
    expect(Number(e.body.monto)).toBe(28000);
  });

  it('lo ya cobrado no se toca y el saldo se recalcula', async () => {
    const r = await crear('18:00', { cobroInicial: 'total', medioCobro: 'EFECTIVO' });
    await editar(r.body.id, { duracionMin: 90 });
    const cobros = await auth(supertest(app).get(`/reservas/${r.body.id}/cobros`));
    expect(cobros.body.pagado).toBe(20000);
    expect(cobros.body.monto).toBe(30000);
    expect(cobros.body.saldo).toBe(10000);
  });

  it('el monto no puede quedar por debajo de lo ya cobrado (422)', async () => {
    const r = await crear('18:00', { cobroInicial: 'total', medioCobro: 'EFECTIVO' });
    const mal = await editar(r.body.id, { monto: 15000 });
    expect(mal.status).toBe(422);
    expect(mal.body.error.message).toMatch(/cobrado/i);
    expect((await editar(r.body.id, { monto: 20000 })).status).toBe(200);
  });

  it('no deja alargar contra otra reserva que sigue a continuación (409) y no cambia nada', async () => {
    const a = await crear('18:00');
    await crear('19:00');
    const e = await editar(a.body.id, { duracionMin: 90 });
    expect(e.status).toBe(409);
    const db = await getPrisma().reserva.findUnique({ where: { id: a.body.id } });
    expect(dur(db)).toBe(60);
    expect(Number(db!.monto)).toBe(20000);
  });

  it('no deja alargar contra un bloqueo (409)', async () => {
    const a = await crear('18:00');
    const fecha = fut();
    await auth(supertest(app).post('/bloqueos')).send({ canchaId, motivo: 'OTRO', recurrente: false, fecha, horaInicio: '19:00', horaFin: '20:00' });
    expect((await editar(a.body.id, { duracionMin: 90 })).status).toBe(409);
  });

  it('se puede poner y sacar una nota', async () => {
    const r = await crear('18:00');
    expect((await editar(r.body.id, { notas: 'Clase de pádel' })).body.notas).toBe('Clase de pádel');
    expect((await editar(r.body.id, { notas: '' })).body.notas).toBeNull();
  });

  it('una reserva cancelada no se edita', async () => {
    const r = await crear('18:00');
    await getPrisma().reserva.update({ where: { id: r.body.id }, data: { estado: 'CANCELADA' } });
    expect((await editar(r.body.id, { monto: 1000 })).status).toBe(409);
  });

  it('un turno que ya pasó se puede editar (monto y nota)', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+5491150009999' } });
    const ini = new Date(Date.now() - 26 * 3600000);
    const r = await getPrisma().reserva.create({ data: {
      canchaId, clienteId: cliente.id, estado: 'CONFIRMADA', esContacto: true, monto: 20000,
      fechaInicio: ini, fechaFin: new Date(ini.getTime() + 3600000),
    } });
    const e = await editar(r.id, { duracionMin: 90, monto: 30000, notas: 'Se quedaron media hora más' });
    expect(e.status).toBe(200);
    expect(dur(e.body)).toBe(90);
    expect(Number(e.body.monto)).toBe(30000);
  });

  it('un turno que viene de un turno fijo solo admite nota (el monto y la duración se editan en el fijo)', async () => {
    const fijo = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Ana', diaSemana: 5, horaInicio: '20:00', horaFin: '21:00' } });
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Ana', whatsapp: '+5491150008888' } });
    const ini = new Date(Date.now() + 3 * 86400000);
    const r = await getPrisma().reserva.create({ data: {
      canchaId, clienteId: cliente.id, estado: 'CONFIRMADA', esContacto: true, monto: 0, turnoFijoId: fijo.id,
      fechaInicio: ini, fechaFin: new Date(ini.getTime() + 3600000),
    } });
    expect((await editar(r.id, { monto: 5000 })).status).toBe(422);
    expect((await editar(r.id, { duracionMin: 90 })).status).toBe(422);
    expect((await editar(r.id, { notas: 'trae pelotas' })).status).toBe(200);
  });

  it('la duración tiene que ser múltiplo de 30 entre 30 y 240 (400)', async () => {
    const r = await crear('18:00');
    for (const d of [0, 15, 45, 250, -30]) expect((await editar(r.body.id, { duracionMin: d })).status).toBe(400);
    expect((await editar(r.body.id, { duracionMin: 240 })).status).toBe(200);
  });

  it('el monto no puede ser negativo (400) y hace falta mandar algo (400)', async () => {
    const r = await crear('18:00');
    expect((await editar(r.body.id, { monto: -1 })).status).toBe(400);
    expect((await editar(r.body.id, {})).status).toBe(400);
  });

  it('un recepcionista también puede editar; sin sesión o con la clave de servicio, no (401)', async () => {
    const r = await crear('18:00');
    const recep = signAdminToken({ adminId: 'r', email: 'r@b.com', rol: 'RECEPCIONISTA' });
    expect((await editar(r.body.id, { monto: 22000 }, recep)).status).toBe(200);
    expect((await supertest(app).patch(`/reservas/${r.body.id}/editar`).send({ monto: 1 })).status).toBe(401);
    expect((await supertest(app).patch(`/reservas/${r.body.id}/editar`).set('x-api-key', 'svc').send({ monto: 1 })).status).toBe(401);
  });

  it('reserva inexistente: 404', async () => {
    expect((await editar('noexiste', { monto: 1000 })).status).toBe(404);
  });

  it('el precio sugerido para otra duración sale de la tarifa de la cancha', async () => {
    const r = await crear('18:00');
    const s = await auth(supertest(app).get(`/reservas/${r.body.id}/precio-sugerido?duracionMin=90`));
    expect(s.status).toBe(200);
    expect(s.body.monto).toBe(30000);
  });
});

describe('seña al crear con un precio propio (clases, precio especial)', () => {
  it('con precio final menor a la seña de la cancha, la seña por defecto es ese precio y se puede crear', async () => {
    const r = await crear('18:00', { montoFinal: 6000, cobroInicial: 'sena', medioCobro: 'EFECTIVO' });
    expect(r.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id } });
    expect(Number(cobros[0].monto)).toBe(6000);
  });

  it('con precio propio, la seña puede ser menor a la mínima de la cancha', async () => {
    const r = await crear('18:00', { montoFinal: 8000, cobroInicial: 'sena', medioCobro: 'EFECTIVO', montoCobro: 2000 });
    expect(r.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id } });
    expect(Number(cobros[0].monto)).toBe(2000);
  });

  it('la seña no puede superar el precio propio (422) y no crea la reserva', async () => {
    const r = await crear('18:00', { montoFinal: 8000, cobroInicial: 'sena', montoCobro: 9000 });
    expect(r.status).toBe(422);
    expect(await getPrisma().reserva.count()).toBe(0);
  });

  it('sin precio propio se mantiene el mínimo de la cancha', async () => {
    const r = await crear('18:00', { cobroInicial: 'sena', montoCobro: 2000 });
    expect(r.status).toBe(422);
  });
});

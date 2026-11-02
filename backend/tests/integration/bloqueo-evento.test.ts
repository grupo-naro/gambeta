import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let adminId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const a = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  adminId = a.id;
  token = signAdminToken({ adminId: a.id, email: a.email, rol: 'ADMIN' });
});

const crearCancha = () => getPrisma().cancha.create({ data: { nombre: 'Fútbol 1', tipo: 'futbol', precioHora: 30000 } });
const auth = (r: supertest.Test) => r.set('authorization', `Bearer ${token}`);

function altaEvento(canchaId: string, extra: Record<string, unknown> = {}) {
  return auth(supertest(app).post('/bloqueos')).send({
    canchaId, motivo: 'OTRO', recurrente: false, fecha: '2030-05-10', horaInicio: '15:00', horaFin: '18:00', nota: 'Cumple de Nahuel', ...extra,
  });
}

describe('bloqueos de evento con plata', () => {
  it('sin valor se comporta como siempre: no genera cobros', async () => {
    const c = await crearCancha();
    const res = await altaEvento(c.id);
    expect(res.status).toBe(201);
    expect(await getPrisma().cobro.count()).toBe(0);
  });

  it('con valor y seña registra el cobro en caja con origen EVENTO', async () => {
    const c = await crearCancha();
    const res = await altaEvento(c.id, { valor: 50000, montoPagado: 25000, medioPago: 'EFECTIVO' });
    expect(res.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { bloqueoId: res.body.id } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBe(25000);
    expect(cobros[0].origen).toBe('EVENTO');
    expect(cobros[0].registradoPorId).toBe(adminId);
  });

  it('la seña no puede superar el valor', async () => {
    const c = await crearCancha();
    const res = await altaEvento(c.id, { valor: 50000, montoPagado: 60000, medioPago: 'EFECTIVO' });
    expect(res.status).toBe(400);
  });

  it('valor solo en bloqueos puntuales', async () => {
    const c = await crearCancha();
    const res = await altaEvento(c.id, { recurrente: true, diaSemana: 3, fecha: undefined, valor: 50000 });
    expect(res.status).toBe(400);
  });

  it('la lista informa pagado y saldo', async () => {
    const c = await crearCancha();
    await altaEvento(c.id, { valor: 50000, montoPagado: 25000, medioPago: 'TRANSFERENCIA' });
    const res = await auth(supertest(app).get('/bloqueos'));
    expect(res.status).toBe(200);
    expect(Number(res.body[0].valor)).toBe(50000);
    expect(res.body[0].pagado).toBe(25000);
    expect(res.body[0].saldo).toBe(25000);
  });

  it('el día del evento se cobra el resto y no se puede pasar del saldo', async () => {
    const c = await crearCancha();
    const b = await altaEvento(c.id, { valor: 50000, montoPagado: 25000, medioPago: 'EFECTIVO' });
    const pasado = await auth(supertest(app).post(`/bloqueos/${b.body.id}/cobros`)).send({ monto: 30000, medio: 'EFECTIVO' });
    expect(pasado.status).toBe(422);
    const ok = await auth(supertest(app).post(`/bloqueos/${b.body.id}/cobros`)).send({ monto: 25000, medio: 'TRANSFERENCIA' });
    expect(ok.status).toBe(201);
    expect(ok.body.pagado).toBe(50000);
    expect(ok.body.saldo).toBe(0);
    const lista = await auth(supertest(app).get(`/bloqueos/${b.body.id}/cobros`));
    expect(lista.body.cobros).toHaveLength(2);
    expect(lista.body.saldo).toBe(0);
  });

  it('cobrar en un bloqueo sin valor es 422', async () => {
    const c = await crearCancha();
    const b = await altaEvento(c.id);
    const res = await auth(supertest(app).post(`/bloqueos/${b.body.id}/cobros`)).send({ monto: 100, medio: 'EFECTIVO' });
    expect(res.status).toBe(422);
  });

  it('la caja del día cuenta los cobros como eventos', async () => {
    const c = await crearCancha();
    await altaEvento(c.id, { valor: 50000, montoPagado: 25000, medioPago: 'EFECTIVO' });
    const hoy = new Date().toISOString().slice(0, 10);
    const res = await auth(supertest(app).get(`/caja?desde=${hoy}&hasta=${hoy}`));
    expect(res.status).toBe(200);
    expect(res.body.porConcepto.eventos).toBe(25000);
    expect(res.body.cobros[0].concepto).toBe('EVENTO');
    expect(res.body.cobros[0].cliente).toBe('Cumple de Nahuel');
  });

  it('al eliminar el bloqueo los cobros se conservan en la caja', async () => {
    const c = await crearCancha();
    const b = await altaEvento(c.id, { valor: 50000, montoPagado: 25000, medioPago: 'EFECTIVO' });
    const del = await auth(supertest(app).delete(`/bloqueos/${b.body.id}`));
    expect(del.status).toBe(200);
    const cobros = await getPrisma().cobro.findMany();
    expect(cobros).toHaveLength(1);
    expect(cobros[0].bloqueoId).toBeNull();
    expect(cobros[0].origen).toBe('EVENTO');
  });
});

describe('editar bloqueos', () => {
  const patch = (id: string, body: Record<string, unknown>) => auth(supertest(app).patch(`/bloqueos/${id}`)).send(body);

  it('edita nota y horario', async () => {
    const c = await crearCancha();
    const b = await altaEvento(c.id);
    const r = await patch(b.body.id, { nota: 'Cumple de Ana', horaInicio: '16:00', horaFin: '19:00' });
    expect(r.status).toBe(200);
    const db = await getPrisma().bloqueo.findUnique({ where: { id: b.body.id } });
    expect(db?.nota).toBe('Cumple de Ana');
    expect(db?.horaInicio).toBe('16:00');
    expect(db?.horaFin).toBe('19:00');
  });

  it('le pone precio a un bloqueo ya creado y después se cobra', async () => {
    const c = await crearCancha();
    const b = await altaEvento(c.id);
    expect((await patch(b.body.id, { valor: 40000 })).status).toBe(200);
    const lista = await auth(supertest(app).get('/bloqueos'));
    expect(lista.body[0].valor).toBe(40000);
    expect(lista.body[0].saldo).toBe(40000);
    const cobro = await auth(supertest(app).post(`/bloqueos/${b.body.id}/cobros`)).send({ monto: 10000, medio: 'EFECTIVO' });
    expect(cobro.status).toBe(201);
    expect(cobro.body.saldo).toBe(30000);
  });

  it('el valor no puede quedar por debajo de lo ya cobrado', async () => {
    const c = await crearCancha();
    const b = await altaEvento(c.id, { valor: 50000, montoPagado: 25000, medioPago: 'EFECTIVO' });
    expect((await patch(b.body.id, { valor: 20000 })).status).toBe(422);
    expect((await patch(b.body.id, { valor: 25000 })).status).toBe(200);
  });

  it('no se puede quitar el valor si ya hay cobros', async () => {
    const c = await crearCancha();
    const b = await altaEvento(c.id, { valor: 50000, montoPagado: 25000, medioPago: 'EFECTIVO' });
    expect((await patch(b.body.id, { valor: null })).status).toBe(422);
  });

  it('se puede quitar el valor si no hay cobros', async () => {
    const c = await crearCancha();
    const b = await altaEvento(c.id, { valor: 50000 });
    expect((await patch(b.body.id, { valor: null })).status).toBe(200);
    expect((await getPrisma().bloqueo.findUnique({ where: { id: b.body.id } }))?.valor).toBeNull();
  });

  it('valor solo en bloqueos de una fecha', async () => {
    const c = await crearCancha();
    const r = await altaEvento(c.id, { recurrente: true, diaSemana: 3, fecha: undefined });
    expect((await patch(r.body.id, { valor: 1000 })).status).toBe(422);
  });

  it('mover a un horario ocupado por otro bloqueo es 409; solaparse consigo mismo no', async () => {
    const c = await crearCancha();
    const a = await altaEvento(c.id, { horaInicio: '17:00', horaFin: '19:00' });
    const seg = await altaEvento(c.id, { horaInicio: '20:00', horaFin: '22:00' }); expect(seg.status).toBe(201);
    expect((await patch(a.body.id, { horaInicio: '17:30', horaFin: '19:30' })).status).toBe(200);
    expect((await patch(a.body.id, { horaFin: '21:00' })).status).toBe(409);
  });

  it('los cobros siguen al bloqueo cuando se edita', async () => {
    const c = await crearCancha();
    const b = await altaEvento(c.id, { valor: 50000, montoPagado: 25000, medioPago: 'EFECTIVO' });
    await patch(b.body.id, { fecha: '2030-05-11' });
    expect(await getPrisma().cobro.count({ where: { bloqueoId: b.body.id } })).toBe(1);
  });

  it('404 si no existe y 400 si no hay nada para editar', async () => {
    expect((await patch('nope', { nota: 'x' })).status).toBe(404);
    const c = await crearCancha();
    const b = await altaEvento(c.id);
    expect((await patch(b.body.id, {})).status).toBe(400);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const a = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: a.id, email: a.email, rol: 'ADMIN' });
});

const crearCancha = () => getPrisma().cancha.create({ data: { nombre: 'Fútbol 1', tipo: 'futbol', precioHora: 30000 } });
const auth = (r: supertest.Test) => r.set('authorization', `Bearer ${token}`);

// 2030-05-10 es viernes (diaSemana 5): los viernes de mayo son 03, 10, 17, 24, 31.
function altaEntrenamiento(canchaId: string, extra: Record<string, unknown> = {}) {
  return auth(supertest(app).post('/bloqueos')).send({
    canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 5, horaInicio: '19:00', horaFin: '20:00',
    nota: 'Academia', vigenciaDesde: '2030-05-01', vigenciaHasta: '2030-05-31', valor: 20000, ...extra,
  });
}
const cobrar = (id: string, body: Record<string, unknown>) => auth(supertest(app).post(`/bloqueos/${id}/cobros`)).send(body);

describe('entrenamiento recurrente con valor por clase', () => {
  it('se puede crear con valor (lo que sale cada clase)', async () => {
    const c = await crearCancha();
    const res = await altaEntrenamiento(c.id);
    expect(res.status).toBe(201);
    expect(Number(res.body.valor)).toBe(20000);
  });

  it('el valor en un recurrente que no es entrenamiento se rechaza', async () => {
    const c = await crearCancha();
    expect((await altaEntrenamiento(c.id, { motivo: 'TORNEO' })).status).toBe(400);
    expect((await altaEntrenamiento(c.id, { motivo: 'OTRO' })).status).toBe(400);
  });

  it('no se puede cobrar una seña al crear un recurrente (no hay fecha)', async () => {
    const c = await crearCancha();
    expect((await altaEntrenamiento(c.id, { montoPagado: 5000, medioPago: 'EFECTIVO' })).status).toBe(400);
  });

  it('la lista muestra el valor por clase y no un saldo global', async () => {
    const c = await crearCancha();
    await altaEntrenamiento(c.id);
    const res = await auth(supertest(app).get('/bloqueos'));
    expect(res.body[0].valor).toBe(20000);
    expect(res.body[0].pagado).toBeNull();
    expect(res.body[0].saldo).toBeNull();
  });

  it('lista las clases del período con lo cobrado de cada una', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { fecha: '2030-05-10', monto: 8000, medio: 'EFECTIVO' });
    const res = await auth(supertest(app).get(`/bloqueos/${b.body.id}/clases?desde=2030-05-01&hasta=2030-05-31`));
    expect(res.status).toBe(200);
    expect(res.body.valor).toBe(20000);
    expect(res.body.clases.map((x: any) => x.fecha)).toEqual(['2030-05-03', '2030-05-10', '2030-05-17', '2030-05-24', '2030-05-31']);
    const diez = res.body.clases.find((x: any) => x.fecha === '2030-05-10');
    expect(diez.pagado).toBe(8000);
    expect(diez.saldo).toBe(12000);
    expect(res.body.clases.find((x: any) => x.fecha === '2030-05-03').saldo).toBe(20000);
  });

  it('respeta el período y marca las fechas liberadas', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id, { vigenciaDesde: '2030-05-08', vigenciaHasta: '2030-05-20' });
    await auth(supertest(app).post(`/bloqueos/${b.body.id}/excepciones`)).send({ fecha: '2030-05-17' });
    const res = await auth(supertest(app).get(`/bloqueos/${b.body.id}/clases?desde=2030-05-01&hasta=2030-05-31`));
    expect(res.body.clases.map((x: any) => [x.fecha, x.liberada])).toEqual([['2030-05-10', false], ['2030-05-17', true]]);
  });

  it('cobra por fecha: cada clase tiene su propio saldo', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    const r1 = await cobrar(b.body.id, { fecha: '2030-05-10', monto: 20000, medio: 'TRANSFERENCIA' });
    expect(r1.status).toBe(201);
    expect(r1.body.pagado).toBe(20000);
    expect(r1.body.saldo).toBe(0);
    // la clase siguiente sigue debiendo todo
    const r2 = await cobrar(b.body.id, { fecha: '2030-05-17', monto: 5000, medio: 'EFECTIVO' });
    expect(r2.body.saldo).toBe(15000);
    const lista = await auth(supertest(app).get(`/bloqueos/${b.body.id}/cobros?fecha=2030-05-17`));
    expect(lista.body.pagado).toBe(5000);
    expect(lista.body.saldo).toBe(15000);
    expect(lista.body.cobros).toHaveLength(1);
  });

  it('el cobro no puede superar el saldo de ESA clase', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { fecha: '2030-05-10', monto: 15000, medio: 'EFECTIVO' });
    expect((await cobrar(b.body.id, { fecha: '2030-05-10', monto: 6000, medio: 'EFECTIVO' })).status).toBe(422);
    expect((await cobrar(b.body.id, { fecha: '2030-05-10', monto: 5000, medio: 'EFECTIVO' })).status).toBe(201);
  });

  it('en un recurrente la fecha es obligatoria y tiene que ser una clase real', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    expect((await cobrar(b.body.id, { monto: 1000, medio: 'EFECTIVO' })).status).toBe(422);
    // sábado: no es el día del entrenamiento
    expect((await cobrar(b.body.id, { fecha: '2030-05-11', monto: 1000, medio: 'EFECTIVO' })).status).toBe(422);
    // viernes fuera del período
    expect((await cobrar(b.body.id, { fecha: '2030-06-07', monto: 1000, medio: 'EFECTIVO' })).status).toBe(422);
    // viernes liberado
    await auth(supertest(app).post(`/bloqueos/${b.body.id}/excepciones`)).send({ fecha: '2030-05-17' });
    expect((await cobrar(b.body.id, { fecha: '2030-05-17', monto: 1000, medio: 'EFECTIVO' })).status).toBe(422);
  });

  it('el cobro queda en la caja como evento, atado a su fecha', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { fecha: '2030-05-10', monto: 20000, medio: 'EFECTIVO' });
    const cobro = await getPrisma().cobro.findFirstOrThrow({ where: { bloqueoId: b.body.id } });
    expect(cobro.origen).toBe('EVENTO');
    expect(cobro.bloqueoFecha?.toISOString().slice(0, 10)).toBe('2030-05-10');
  });

  it('editar el valor por clase: no puede quedar debajo de lo cobrado en una clase', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { fecha: '2030-05-10', monto: 18000, medio: 'EFECTIVO' });
    const bajo = await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: 15000 });
    expect(bajo.status).toBe(422);
    const ok = await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: 25000 });
    expect(ok.status).toBe(200);
    expect(Number(ok.body.valor)).toBe(25000);
  });

  it('se puede poner valor a un entrenamiento recurrente ya creado, y sacarlo si no tiene cobros', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id, { valor: undefined });
    expect(b.body.valor).toBeNull();
    const ponerlo = await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: 20000 });
    expect(ponerlo.status).toBe(200);
    const sacarlo = await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: null });
    expect(sacarlo.status).toBe(200);
    expect(sacarlo.body.valor).toBeNull();
  });

  it('no se puede sacar el valor si ya hay cobros', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { fecha: '2030-05-10', monto: 1000, medio: 'EFECTIVO' });
    expect((await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: null })).status).toBe(422);
  });

  it('un recurrente que no es entrenamiento no admite valor al editar', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id, { motivo: 'MANTENIMIENTO', valor: undefined });
    expect((await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: 5000 })).status).toBe(422);
  });

  it('un evento puntual sigue funcionando igual (sin fecha en el cobro)', async () => {
    const c = await crearCancha();
    const p = await auth(supertest(app).post('/bloqueos')).send({
      canchaId: c.id, motivo: 'OTRO', recurrente: false, fecha: '2030-05-10', horaInicio: '15:00', horaFin: '18:00', valor: 50000,
    });
    const ok = await cobrar(p.body.id, { monto: 20000, medio: 'EFECTIVO' });
    expect(ok.status).toBe(201);
    expect(ok.body.saldo).toBe(30000);
  });

  it('401 sin sesión', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    expect((await supertest(app).get(`/bloqueos/${b.body.id}/clases`)).status).toBe(401);
  });
});

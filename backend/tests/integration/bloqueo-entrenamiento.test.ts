import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hoyEnTz } from '../../src/utils/tz.js';

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

// Entrenamiento los viernes, de mayo a julio de 2030, con $50.000 por mes.
function altaEntrenamiento(canchaId: string, extra: Record<string, unknown> = {}) {
  return auth(supertest(app).post('/bloqueos')).send({
    canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 5, horaInicio: '19:00', horaFin: '20:00',
    nota: 'Academia', vigenciaDesde: '2030-05-15', vigenciaHasta: '2030-07-10', valor: 50000, ...extra,
  });
}
const cobrar = (id: string, body: Record<string, unknown>) => auth(supertest(app).post(`/bloqueos/${id}/cobros`)).send(body);

describe('entrenamiento recurrente con valor mensual', () => {
  it('se puede crear con valor (lo que sale por mes)', async () => {
    const c = await crearCancha();
    const res = await altaEntrenamiento(c.id);
    expect(res.status).toBe(201);
    expect(Number(res.body.valor)).toBe(50000);
  });

  it('el valor en un recurrente que no es entrenamiento se rechaza', async () => {
    const c = await crearCancha();
    expect((await altaEntrenamiento(c.id, { motivo: 'TORNEO' })).status).toBe(400);
    expect((await altaEntrenamiento(c.id, { motivo: 'OTRO' })).status).toBe(400);
  });

  it('no se puede cobrar una seña al crear un recurrente (no hay mes elegido)', async () => {
    const c = await crearCancha();
    expect((await altaEntrenamiento(c.id, { montoPagado: 5000, medioPago: 'EFECTIVO' })).status).toBe(400);
  });

  it('la lista muestra el valor mensual y no un saldo global', async () => {
    const c = await crearCancha();
    await altaEntrenamiento(c.id);
    const res = await auth(supertest(app).get('/bloqueos'));
    expect(res.body[0].valor).toBe(50000);
    expect(res.body[0].pagado).toBeNull();
    expect(res.body[0].saldo).toBeNull();
  });

  it('lista los meses del período con lo cobrado de cada uno', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { mes: '2030-06', monto: 20000, medio: 'EFECTIVO' });
    const res = await auth(supertest(app).get(`/bloqueos/${b.body.id}/meses?desde=2030-03&hasta=2030-10`));
    expect(res.status).toBe(200);
    expect(res.body.valor).toBe(50000);
    // el período va del 15/05 al 10/07: marzo, abril, agosto, setiembre y octubre quedan fuera
    expect(res.body.meses.map((x: any) => x.mes)).toEqual(['2030-05', '2030-06', '2030-07']);
    const junio = res.body.meses.find((x: any) => x.mes === '2030-06');
    expect(junio.pagado).toBe(20000);
    expect(junio.saldo).toBe(30000);
    expect(res.body.meses.find((x: any) => x.mes === '2030-05').saldo).toBe(50000);
  });

  it('cobra por mes: cada mes tiene su propio saldo', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    const r1 = await cobrar(b.body.id, { mes: '2030-06', monto: 50000, medio: 'TRANSFERENCIA' });
    expect(r1.status).toBe(201);
    expect(r1.body.pagado).toBe(50000);
    expect(r1.body.saldo).toBe(0);
    // el mes siguiente sigue debiendo todo
    const r2 = await cobrar(b.body.id, { mes: '2030-07', monto: 10000, medio: 'EFECTIVO' });
    expect(r2.body.saldo).toBe(40000);
    const lista = await auth(supertest(app).get(`/bloqueos/${b.body.id}/cobros?mes=2030-07`));
    expect(lista.body.pagado).toBe(10000);
    expect(lista.body.saldo).toBe(40000);
    expect(lista.body.cobros).toHaveLength(1);
  });

  it('el cobro no puede superar el saldo de ESE mes', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { mes: '2030-06', monto: 40000, medio: 'EFECTIVO' });
    expect((await cobrar(b.body.id, { mes: '2030-06', monto: 20000, medio: 'EFECTIVO' })).status).toBe(422);
    expect((await cobrar(b.body.id, { mes: '2030-06', monto: 10000, medio: 'EFECTIVO' })).status).toBe(201);
  });

  it('en un recurrente el mes es obligatorio y tiene que ser del período', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    expect((await cobrar(b.body.id, { monto: 1000, medio: 'EFECTIVO' })).status).toBe(422);
    // antes de que empiece y después de que termine
    expect((await cobrar(b.body.id, { mes: '2030-04', monto: 1000, medio: 'EFECTIVO' })).status).toBe(422);
    expect((await cobrar(b.body.id, { mes: '2030-08', monto: 1000, medio: 'EFECTIVO' })).status).toBe(422);
    // formato inválido
    expect((await cobrar(b.body.id, { mes: '2030-13', monto: 1000, medio: 'EFECTIVO' })).status).toBe(400);
    expect((await cobrar(b.body.id, { mes: '2030-06-10', monto: 1000, medio: 'EFECTIVO' })).status).toBe(400);
  });

  it('un período sin límite acepta cualquier mes', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id, { vigenciaDesde: undefined, vigenciaHasta: undefined });
    expect((await cobrar(b.body.id, { mes: '2031-01', monto: 1000, medio: 'EFECTIVO' })).status).toBe(201);
  });

  it('el cobro queda en la caja como Academia (no como evento), atado a su mes', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { mes: '2030-06', monto: 50000, medio: 'EFECTIVO' });
    const cobro = await getPrisma().cobro.findFirstOrThrow({ where: { bloqueoId: b.body.id } });
    expect(cobro.origen).toBe('ACADEMIA');
    expect(cobro.bloqueoMes?.toISOString().slice(0, 10)).toBe('2030-06-01');
  });

  it('en la caja Academia va aparte de los eventos', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { mes: '2030-06', monto: 50000, medio: 'TRANSFERENCIA' });
    const cumple = await auth(supertest(app).post('/bloqueos')).send({ canchaId: c.id, motivo: 'OTRO', recurrente: false, fecha: '2030-05-10', horaInicio: '15:00', horaFin: '18:00', nota: 'Cumple', valor: 20000, montoPagado: 20000, medioPago: 'EFECTIVO' });
    expect(cumple.status).toBe(201);
    const hoy = hoyEnTz('America/Argentina/Buenos_Aires');
    const res = await auth(supertest(app).get(`/caja?desde=${hoy}&hasta=${hoy}`));
    expect(res.body.porConcepto.academia).toBe(50000);
    expect(res.body.porConcepto.eventos).toBe(20000);
    expect(res.body.total).toBe(70000);
    const conceptos = res.body.cobros.map((x: any) => x.concepto).sort();
    expect(conceptos).toEqual(['ACADEMIA', 'EVENTO']);
    expect(res.body.cobros.find((x: any) => x.concepto === 'ACADEMIA').cliente).toBe('Academia');
  });

  it('si se elimina el entrenamiento, sus cobros siguen en la caja como Academia', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { mes: '2030-06', monto: 50000, medio: 'EFECTIVO' });
    expect((await auth(supertest(app).delete(`/bloqueos/${b.body.id}`))).status).toBe(200);
    const cobro = await getPrisma().cobro.findFirstOrThrow();
    expect(cobro.bloqueoId).toBeNull();
    expect(cobro.origen).toBe('ACADEMIA');
    const hoy = hoyEnTz('America/Argentina/Buenos_Aires');
    const res = await auth(supertest(app).get(`/caja?desde=${hoy}&hasta=${hoy}`));
    expect(res.body.porConcepto.academia).toBe(50000);
    expect(res.body.porConcepto.eventos).toBe(0);
  });

  it('editar el valor mensual: no puede quedar debajo de lo cobrado en un mes', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { mes: '2030-06', monto: 45000, medio: 'EFECTIVO' });
    const bajo = await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: 40000 });
    expect(bajo.status).toBe(422);
    const ok = await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: 60000 });
    expect(ok.status).toBe(200);
    expect(Number(ok.body.valor)).toBe(60000);
  });

  it('se puede poner valor a un entrenamiento recurrente ya creado, y sacarlo si no tiene cobros', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id, { valor: undefined });
    expect(b.body.valor).toBeNull();
    const ponerlo = await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: 50000 });
    expect(ponerlo.status).toBe(200);
    const sacarlo = await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: null });
    expect(sacarlo.status).toBe(200);
    expect(sacarlo.body.valor).toBeNull();
  });

  it('no se puede sacar el valor si ya hay cobros', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, { mes: '2030-06', monto: 1000, medio: 'EFECTIVO' });
    expect((await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: null })).status).toBe(422);
  });

  it('un recurrente que no es entrenamiento no admite valor al editar', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id, { motivo: 'MANTENIMIENTO', valor: undefined });
    expect((await auth(supertest(app).patch(`/bloqueos/${b.body.id}`)).send({ valor: 5000 })).status).toBe(422);
  });

  it('un evento puntual sigue funcionando igual (sin mes en el cobro)', async () => {
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
    expect((await supertest(app).get(`/bloqueos/${b.body.id}/meses`)).status).toBe(401);
  });
});

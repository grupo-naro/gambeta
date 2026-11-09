import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hoyEnTz } from '../../src/utils/tz.js';

let app: any; let token: string; let recepToken: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const a = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: a.id, email: a.email, rol: 'ADMIN' });
  const r = await getPrisma().adminUser.create({ data: { email: 'r@b.com', nombre: 'Recep', passwordHash: 'x', rol: 'RECEPCIONISTA' } });
  recepToken = signAdminToken({ adminId: r.id, email: r.email, rol: 'RECEPCIONISTA' });
});

const TZ = 'America/Argentina/Buenos_Aires';
const auth = (r: supertest.Test, t = token) => r.set('authorization', `Bearer ${t}`);
const crearCancha = (nombre = 'Fútbol 1') => getPrisma().cancha.create({ data: { nombre, tipo: 'futbol', precioHora: 30000 } });
const hoy = () => hoyEnTz(TZ);
/** 'YYYY-MM' del mes que está `atras` meses antes del actual. */
function mesAtras(atras: number): string {
  const [y, m] = hoy().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - atras, 1)).toISOString().slice(0, 7);
}
const get = (q = `desde=${hoy()}&hasta=${hoy()}`, t = token) => auth(supertest(app).get(`/analytics/academia?${q}`), t);

/** Entrenamiento recurrente de los viernes que arrancó hace 2 meses, con $50.000 por mes. */
function altaEntrenamiento(canchaId: string, extra: Record<string, unknown> = {}) {
  return auth(supertest(app).post('/bloqueos')).send({
    canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 5, horaInicio: '19:00', horaFin: '20:00',
    nota: 'Academia fútbol', vigenciaDesde: mesAtras(2) + '-01', valor: 50000, ...extra,
  });
}
const cobrar = (id: string, mes: string, monto: number, medio: 'EFECTIVO' | 'TRANSFERENCIA' = 'EFECTIVO') =>
  auth(supertest(app).post(`/bloqueos/${id}/cobros`)).send({ mes, monto, medio });

describe('analytics de la academia', () => {
  it('sin entrenamientos devuelve ceros', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.total).toEqual({ cobrado: 0, porMedio: { EFECTIVO: 0, TRANSFERENCIA: 0 }, debe: 0, entrenamientos: 0 });
    expect(res.body.entrenamientos).toEqual([]);
  });

  it('cobrado del período por medio de pago, y lo que se debe', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, mesAtras(2), 50000, 'TRANSFERENCIA'); // mes pago completo
    await cobrar(b.body.id, mesAtras(1), 20000, 'EFECTIVO'); // parcial: debe 30.000
    // el mes actual no se pagó: debe 50.000
    const res = await get();
    expect(res.body.total).toEqual({ cobrado: 70000, porMedio: { EFECTIVO: 20000, TRANSFERENCIA: 50000 }, debe: 80000, entrenamientos: 1 });
    expect(res.body.entrenamientos[0]).toMatchObject({
      id: b.body.id, nombre: 'Academia fútbol', cancha: 'Fútbol 1', diaSemana: 5, horaInicio: '19:00', horaFin: '20:00',
      valor: 50000, cobrado: 70000, debe: 80000, mesesConDeuda: 2,
    });
  });

  it('el cobrado respeta el período (por la fecha en que se cobró)', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, mesAtras(1), 50000);
    const res = await get('desde=2030-01-01&hasta=2030-01-31');
    expect(res.body.total.cobrado).toBe(0);
    // la deuda no depende del período elegido: es lo que se debe hoy
    expect(res.body.total.debe).toBe(100000); // mes -2 y mes actual sin pagar
  });

  it('un mes futuro todavía no es deuda: un entrenamiento que arranca más adelante no debe nada', async () => {
    const c = await crearCancha();
    await altaEntrenamiento(c.id, { vigenciaDesde: '2999-01-01' });
    const res = await get();
    expect(res.body.total.debe).toBe(0);
    expect(res.body.entrenamientos[0]).toMatchObject({ debe: 0, mesesConDeuda: 0 });
  });

  it('un entrenamiento que ya terminó solo debe los meses de su período', async () => {
    const c = await crearCancha();
    // período de hace 3 meses a hace 2 meses: 2 meses, ninguno pago
    await altaEntrenamiento(c.id, { vigenciaDesde: mesAtras(3) + '-01', vigenciaHasta: mesAtras(2) + '-20' });
    const res = await get();
    expect(res.body.entrenamientos[0]).toMatchObject({ debe: 100000, mesesConDeuda: 2 });
  });

  it('sin fecha de inicio cuenta desde el mes en que se creó', async () => {
    const c = await crearCancha();
    await altaEntrenamiento(c.id, { vigenciaDesde: undefined });
    const res = await get();
    expect(res.body.entrenamientos[0]).toMatchObject({ debe: 50000, mesesConDeuda: 1 }); // solo el mes actual
  });

  it('solo cuentan los entrenamientos recurrentes con valor', async () => {
    const c = await crearCancha();
    await altaEntrenamiento(c.id, { valor: undefined }); // sin valor
    await auth(supertest(app).post('/bloqueos')).send({ canchaId: c.id, motivo: 'MANTENIMIENTO', recurrente: true, diaSemana: 2, horaInicio: '10:00', horaFin: '11:00' });
    await auth(supertest(app).post('/bloqueos')).send({ canchaId: c.id, motivo: 'OTRO', recurrente: false, fecha: '2030-05-10', horaInicio: '15:00', horaFin: '18:00', valor: 20000, montoPagado: 20000, medioPago: 'EFECTIVO' });
    const res = await get();
    expect(res.body.total).toEqual({ cobrado: 0, porMedio: { EFECTIVO: 0, TRANSFERENCIA: 0 }, debe: 0, entrenamientos: 0 });
  });

  it('lo cobrado de un entrenamiento eliminado sigue sumando al total', async () => {
    const c = await crearCancha();
    const b = await altaEntrenamiento(c.id);
    await cobrar(b.body.id, mesAtras(1), 50000);
    await auth(supertest(app).delete(`/bloqueos/${b.body.id}`));
    const res = await get();
    expect(res.body.total.cobrado).toBe(50000);
    expect(res.body.entrenamientos).toEqual([]);
  });

  it('varios entrenamientos, cada uno con lo suyo', async () => {
    const c1 = await crearCancha('Fútbol 1');
    const c2 = await crearCancha('Pádel 1');
    const a = await altaEntrenamiento(c1.id, { nota: 'Escuelita' });
    const b = await altaEntrenamiento(c2.id, { nota: 'Clases pádel', diaSemana: 3, valor: 30000 });
    await cobrar(a.body.id, mesAtras(0), 50000);
    await cobrar(b.body.id, mesAtras(0), 10000);
    const res = await get();
    const porNombre = Object.fromEntries(res.body.entrenamientos.map((e: any) => [e.nombre, e]));
    expect(porNombre['Escuelita']).toMatchObject({ cobrado: 50000, debe: 100000 });
    expect(porNombre['Clases pádel']).toMatchObject({ cobrado: 10000, debe: 80000 });
    expect(res.body.total.entrenamientos).toBe(2);
    expect(res.body.total.cobrado).toBe(60000);
  });

  it('solo el admin: la recepcionista y sin sesión no entran', async () => {
    expect((await get(undefined, recepToken)).status).toBe(403);
    expect((await supertest(app).get('/analytics/academia')).status).toBe(401);
  });
});

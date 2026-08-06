import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let adminId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  // El alta de fijos es authJwt (staff): admin real en la DB para poder afirmar registradoPorId
  // sin violar la FK de Cobro (un adminId inventado la rompería, no cae a null como cobro.service).
  const a = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  adminId = a.id;
  token = signAdminToken({ adminId: a.id, email: a.email, rol: 'ADMIN' });
});

// 2026-08-05 es miércoles (diaSemana 3).
const MIERCOLES = '2026-08-05';

const crearCancha = () => getPrisma().cancha.create({ data: { nombre: 'Pádel 1', tipo: 'padel', precioHora: 30000 } });

function altaFijo(canchaId: string, abono?: { vigenciaDesde: string; vigenciaHasta: string; montoAbono: number; medioAbono: string }) {
  return supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`)
    .send({ canchaId, clienteNombre: 'Ana', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', ...abono });
}

describe('abono en turnos fijos', () => {
  it('el alta con abono registra el cobro en caja', async () => {
    const c = await crearCancha();
    const res = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    expect(res.status).toBe(201);

    const cobros = await getPrisma().cobro.findMany({ where: { turnoFijoId: res.body.id } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBe(120000);
    expect(cobros[0].origen).toBe('ABONO');
    expect(cobros[0].medio).toBe('EFECTIVO');
    // La caja necesita saber quién registró el cobro, no solo que existe.
    expect(cobros[0].registradoPorId).toBe(adminId);
  });

  it('el alta sin abono no registra ningún cobro', async () => {
    const c = await crearCancha();
    const res = await altaFijo(c.id);
    expect(res.status).toBe(201);
    expect(await getPrisma().cobro.count({ where: { turnoFijoId: res.body.id } })).toBe(0);
  });

  it('un turno del fijo con abono se materializa en $0, con el precio real en montoLista', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const res = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    expect(res.status).toBe(201);
    expect(Number(res.body.monto)).toBe(0);
    expect(Number(res.body.montoLista)).toBe(30000);
  });

  it('con el abono VENCIDO el turno igual se materializa en $0 (el aviso es el único control)', async () => {
    const c = await crearCancha();
    // El período terminó en julio; el turno es de agosto.
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const res = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    expect(res.status).toBe(201);
    expect(Number(res.body.monto)).toBe(0);
  });

  it('REGRESIÓN: un fijo sin abono sigue cobrando el precio de la cancha', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id);
    const res = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    expect(res.status).toBe(201);
    expect(Number(res.body.monto)).toBe(30000);
  });
});

describe('el backend expone el dato para el aviso', () => {
  it('el listado de fijos incluye el período y el monto del abono', async () => {
    const c = await crearCancha();
    await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    // GET /turnos-fijos es authJwt (panel), no authAny: se usa el token admin del beforeEach.
    const res = await supertest(app).get('/turnos-fijos').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const f = res.body[0];
    expect(f.vigenciaDesde).toBe('2026-08-01');
    expect(f.vigenciaHasta).toBe('2026-08-31');
    expect(Number(f.montoAbono)).toBe(120000);
  });

  it('la agenda informa hasta cuándo está paga la reserva de un fijo con abono', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    const res = await supertest(app).get(`/agenda?fecha=${MIERCOLES}`).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    // El panel compara este dato con la fecha que está mirando para decidir si avisa.
    const item = res.body.reservas.find((r: any) => r.turnoFijoId === fijo.body.id);
    expect(item.abonoHasta).toBe('2026-07-31');
  });

  it('la agenda expone el período y conAbono en el fijo sin materializar (antes de cobrarlo)', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    // No se materializa: el fijo tiene que aparecer en la colección `fijos`, no en `reservas`.
    const res = await supertest(app).get(`/agenda?fecha=${MIERCOLES}`).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    const item = res.body.fijos.find((f: any) => f.turnoFijoId === fijo.body.id);
    expect(item).toBeTruthy();
    expect(item.abonoHasta).toBe('2026-07-31');
    expect(item.conAbono).toBe(true);
  });

  it('un fijo sin abono expone conAbono false y abonoHasta null en la agenda', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id);
    const res = await supertest(app).get(`/agenda?fecha=${MIERCOLES}`).set('x-api-key', 'svc');
    const item = res.body.fijos.find((f: any) => f.turnoFijoId === fijo.body.id);
    expect(item.conAbono).toBe(false);
    expect(item.abonoHasta).toBeNull();
  });
});

describe('renovación de un fijo con abono', () => {
  it('borrar un fijo con abono cobrado da 422 (BusinessRule), no 500', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const res = await supertest(app).delete(`/turnos-fijos/${fijo.body.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/desactiv/i);
    // No lo borró.
    expect(await getPrisma().turnoFijo.findUnique({ where: { id: fijo.body.id } })).not.toBeNull();
  });

  it('borrar un fijo SIN abono sigue funcionando (regresión)', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id);
    const res = await supertest(app).delete(`/turnos-fijos/${fijo.body.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await getPrisma().turnoFijo.findUnique({ where: { id: fijo.body.id } })).toBeNull();
  });

  it('POST /turnos-fijos/:id/desactivar exige JWT (no relaja auth)', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const sinAuth = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/desactivar`);
    expect(sinAuth.status).toBe(401);
    const conApiKey = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/desactivar`).set('x-api-key', 'svc');
    expect(conApiKey.status).toBe(401);
  });

  it('desactivar pone activo:false y libera el horario para dar de alta el reemplazo', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const des = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/desactivar`).set('authorization', `Bearer ${token}`);
    expect(des.status).toBe(200);
    expect(des.body).toEqual({ ok: true });
    const guardado = await getPrisma().turnoFijo.findUnique({ where: { id: fijo.body.id } });
    expect(guardado?.activo).toBe(false);

    // Renovación: dar de alta el reemplazo en el MISMO horario ya no choca (409).
    const nuevo = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 130000, medioAbono: 'EFECTIVO' });
    expect(nuevo.status).toBe(201);
  });

  it('sin desactivar, el mismo horario sigue chocando con 409 (regresión)', async () => {
    const c = await crearCancha();
    await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const otro = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 130000, medioAbono: 'EFECTIVO' });
    expect(otro.status).toBe(409);
  });
});

describe('validación de las fechas y el monto del abono', () => {
  it('rechaza una vigenciaHasta que no existe como fecha real (31 de febrero)', async () => {
    const c = await crearCancha();
    const res = await altaFijo(c.id, { vigenciaDesde: '2026-02-01', vigenciaHasta: '2026-02-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    expect(res.status).toBe(400);
  });

  it('rechaza una vigenciaDesde que no existe como fecha real (30 de febrero)', async () => {
    const c = await crearCancha();
    const res = await altaFijo(c.id, { vigenciaDesde: '2026-02-30', vigenciaHasta: '2026-03-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    expect(res.status).toBe(400);
  });

  it('acepta una fecha bisiesta real (2028-02-29)', async () => {
    const c = await crearCancha();
    const res = await altaFijo(c.id, { vigenciaDesde: '2028-02-01', vigenciaHasta: '2028-02-29', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    expect(res.status).toBe(201);
  });

  it('rechaza un montoAbono que desborda numeric(10,2)', async () => {
    const c = await crearCancha();
    const res = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 100000000, medioAbono: 'EFECTIVO' });
    expect(res.status).toBe(400);
  });

  it('acepta el montoAbono en el límite de numeric(10,2)', async () => {
    const c = await crearCancha();
    const res = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 99999999.99, medioAbono: 'EFECTIVO' });
    expect(res.status).toBe(201);
  });
});

describe('el alta con abono sobrevive a un admin borrado', () => {
  it('si el admin del JWT ya no existe, el fijo y el cobro se crean con registradoPorId null', async () => {
    const c = await crearCancha();
    // Token firmado con un adminId que no existe en la DB (el admin fue borrado después de emitir el JWT).
    const tokenFantasma = signAdminToken({ adminId: 'admin-borrado-xyz', email: 'x@x.com', rol: 'ADMIN' });
    const res = await supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${tokenFantasma}`)
      .send({ canchaId: c.id, clienteNombre: 'Ana', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    expect(res.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { turnoFijoId: res.body.id } });
    expect(cobros).toHaveLength(1);
    expect(cobros[0].registradoPorId).toBeNull();
  });
});

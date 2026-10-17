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

  it('con el período VENCIDO el fijo ya no se materializa: pasado el "hasta" no existe', async () => {
    const c = await crearCancha();
    // El período terminó en julio; el turno es de agosto.
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const res = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/vigente|período/i);
    expect(await getPrisma().reserva.count({ where: { turnoFijoId: fijo.body.id } })).toBe(0);
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
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    const res = await supertest(app).get(`/agenda?fecha=${MIERCOLES}`).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    // El panel compara este dato con la fecha que está mirando para decidir si avisa.
    const item = res.body.reservas.find((r: any) => r.turnoFijoId === fijo.body.id);
    expect(item.abonoHasta).toBe('2026-08-31');
  });

  it('la agenda expone el período y conAbono en el fijo sin materializar (antes de cobrarlo)', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    // No se materializa: el fijo tiene que aparecer en la colección `fijos`, no en `reservas`.
    const res = await supertest(app).get(`/agenda?fecha=${MIERCOLES}`).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    const item = res.body.fijos.find((f: any) => f.turnoFijoId === fijo.body.id);
    expect(item).toBeTruthy();
    expect(item.abonoHasta).toBe('2026-08-31');
    expect(item.conAbono).toBe(true);
  });

  it('pasado el "hasta" el fijo ya no figura en la agenda; el último día del período sí', async () => {
    const c = await crearCancha();
    // Período 17/07 → 05/08 (MIERCOLES es 2026-08-05, el último día) y el miércoles siguiente ya no.
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-17', vigenciaHasta: MIERCOLES, montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const ultimo = await supertest(app).get(`/agenda?fecha=${MIERCOLES}`).set('x-api-key', 'svc');
    expect(ultimo.body.fijos.some((f: any) => f.turnoFijoId === fijo.body.id)).toBe(true);
    const siguiente = await supertest(app).get('/agenda?fecha=2026-08-12').set('x-api-key', 'svc');
    expect(siguiente.body.fijos.some((f: any) => f.turnoFijoId === fijo.body.id)).toBe(false);
  });

  it('pasado el "hasta" el horario queda libre en la grilla pública', async () => {
    const c = await crearCancha();
    await altaFijo(c.id, { vigenciaDesde: '2026-07-17', vigenciaHasta: MIERCOLES, montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const { ocupacionService } = await import('../../src/services/ocupacion.service.js');
    const dentro = await ocupacionService.rangosPlantilla(c.id, MIERCOLES);
    const fuera = await ocupacionService.rangosPlantilla(c.id, '2026-08-12');
    expect(dentro.some((r) => r.tipo === 'fijo')).toBe(true);
    expect(fuera.some((r) => r.tipo === 'fijo')).toBe(false);
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
  it('borrar un fijo con abono cobrado se puede y conserva el cobro en la caja como abono', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const res = await supertest(app).delete(`/turnos-fijos/${fijo.body.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await getPrisma().turnoFijo.findUnique({ where: { id: fijo.body.id } })).toBeNull();

    // El cobro sigue ahí: sin destino, pero marcado como ABONO.
    const cobros = await getPrisma().cobro.findMany();
    expect(cobros).toHaveLength(1);
    expect(cobros[0].turnoFijoId).toBeNull();
    expect(cobros[0].origen).toBe('ABONO');
    expect(Number(cobros[0].monto)).toBe(120000);

    // Y la caja lo sigue contando como abono (no como turno).
    const caja = await supertest(app).get('/caja').set('authorization', `Bearer ${token}`);
    expect(caja.status).toBe(200);
    expect(caja.body.total).toBe(120000);
    expect(caja.body.porConcepto.abonos).toBe(120000);
    expect(caja.body.porConcepto.turnos).toBe(0);
    expect(caja.body.cobros[0].concepto).toBe('ABONO');
  });

  it('borrar un fijo con abono no borra las reservas ya materializadas: quedan sueltas', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const mat = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    expect(mat.status).toBe(201);
    const res = await supertest(app).delete(`/turnos-fijos/${fijo.body.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const reserva = await getPrisma().reserva.findUnique({ where: { id: mat.body.id } });
    expect(reserva).not.toBeNull();
    expect(reserva!.turnoFijoId).toBeNull();
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

  it('con períodos que se solapan, el mismo horario sigue chocando con 409 (regresión)', async () => {
    const c = await crearCancha();
    await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const otro = await altaFijo(c.id, { vigenciaDesde: '2026-07-15', vigenciaHasta: '2026-08-15', montoAbono: 130000, medioAbono: 'EFECTIVO' });
    expect(otro.status).toBe(409);
  });

  it('renovar sin desactivar: el período siguiente en el mismo horario no choca', async () => {
    const c = await crearCancha();
    await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const renovacion = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 130000, medioAbono: 'EFECTIVO' });
    expect(renovacion.status).toBe(201);
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

describe('pago parcial del abono', () => {
  const ABONO = { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 100000, medioAbono: 'EFECTIVO' };
  const altaConPago = (canchaId: string, montoPagado?: number) =>
    supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`)
      .send({ canchaId, clienteNombre: 'Ana', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', ...ABONO, ...(montoPagado != null ? { montoPagado } : {}) });
  const cobrosDe = (id: string) => supertest(app).get(`/turnos-fijos/${id}/cobros`).set('authorization', `Bearer ${token}`);
  const pagar = (id: string, monto: number, medio = 'TRANSFERENCIA') =>
    supertest(app).post(`/turnos-fijos/${id}/cobros`).set('authorization', `Bearer ${token}`).send({ monto, medio });

  it('sin montoPagado se cobra el total, como siempre (compatibilidad)', async () => {
    const c = await crearCancha();
    const res = await altaConPago(c.id);
    expect(res.status).toBe(201);
    const r = await cobrosDe(res.body.id);
    expect(r.body).toMatchObject({ monto: 100000, pagado: 100000, saldo: 0 });
  });

  it('con montoPagado menor registra solo esa parte y queda saldo', async () => {
    const c = await crearCancha();
    const res = await altaConPago(c.id, 50000);
    expect(res.status).toBe(201);
    const r = await cobrosDe(res.body.id);
    expect(r.body).toMatchObject({ monto: 100000, pagado: 50000, saldo: 50000 });
    expect(r.body.cobros).toHaveLength(1);
  });

  it('con montoPagado 0 no crea ningún cobro y el saldo es el total', async () => {
    const c = await crearCancha();
    const res = await altaConPago(c.id, 0);
    expect(res.status).toBe(201);
    expect(await getPrisma().cobro.count({ where: { turnoFijoId: res.body.id } })).toBe(0);
    const r = await cobrosDe(res.body.id);
    expect(r.body).toMatchObject({ monto: 100000, pagado: 0, saldo: 100000 });
  });

  it('rechaza un montoPagado mayor al abono (400 por validación)', async () => {
    const c = await crearCancha();
    const res = await altaConPago(c.id, 100001);
    expect(res.status).toBe(400);
    expect(await getPrisma().turnoFijo.count()).toBe(0);
  });

  it('se puede pagar el resto después, en una o más cuotas, y todo cuenta como abono en caja', async () => {
    const c = await crearCancha();
    const fijo = await altaConPago(c.id, 40000);
    const p1 = await pagar(fijo.body.id, 30000);
    expect(p1.status).toBe(201);
    expect(p1.body).toMatchObject({ pagado: 70000, saldo: 30000 });
    const p2 = await pagar(fijo.body.id, 30000, 'EFECTIVO');
    expect(p2.status).toBe(201);
    expect(p2.body).toMatchObject({ pagado: 100000, saldo: 0 });

    const caja = await supertest(app).get('/caja').set('authorization', `Bearer ${token}`);
    expect(caja.body.total).toBe(100000);
    expect(caja.body.porConcepto.abonos).toBe(100000);
    expect(caja.body.porConcepto.turnos).toBe(0);
  });

  it('un pago que supera el saldo da 422 y no registra nada', async () => {
    const c = await crearCancha();
    const fijo = await altaConPago(c.id, 60000);
    const res = await pagar(fijo.body.id, 40001);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/saldo|faltan/i);
    expect(await getPrisma().cobro.count({ where: { turnoFijoId: fijo.body.id } })).toBe(1);
  });

  it('con el abono ya pago por completo no deja cobrar más', async () => {
    const c = await crearCancha();
    const fijo = await altaConPago(c.id);
    const res = await pagar(fijo.body.id, 1);
    expect(res.status).toBe(422);
  });

  it('un fijo sin abono no admite cobros', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id);
    const res = await pagar(fijo.body.id, 1000);
    expect(res.status).toBe(422);
  });

  it('el listado de fijos informa cuánto se cobró del abono', async () => {
    const c = await crearCancha();
    await altaConPago(c.id, 25000);
    const res = await supertest(app).get('/turnos-fijos').set('authorization', `Bearer ${token}`);
    expect(res.body[0]).toMatchObject({ montoAbono: 100000, abonoPagado: 25000 });
  });

  it('cobrar el abono exige JWT de staff (no se abre a la clave de servicio)', async () => {
    const c = await crearCancha();
    const fijo = await altaConPago(c.id, 10000);
    const conApiKey = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/cobros`).set('x-api-key', 'svc').send({ monto: 1000, medio: 'EFECTIVO' });
    expect(conApiKey.status).toBe(401);
  });

  it('anular un pago del abono (DELETE /cobros/:id) vuelve a sumar al saldo', async () => {
    const c = await crearCancha();
    const fijo = await altaConPago(c.id, 50000);
    const cobro = (await cobrosDe(fijo.body.id)).body.cobros[0];
    const del = await supertest(app).delete(`/cobros/${cobro.id}`).set('authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    const r = await cobrosDe(fijo.body.id);
    expect(r.body).toMatchObject({ pagado: 0, saldo: 100000 });
  });
});

describe('editar un turno fijo', () => {
  const ABONO = { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 100000, medioAbono: 'EFECTIVO' };
  const alta = (canchaId: string, extra: Record<string, unknown> = {}) =>
    supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`)
      .send({ canchaId, clienteNombre: 'Ana', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', ...extra });
  const editar = (id: string, body: Record<string, unknown>) =>
    supertest(app).patch(`/turnos-fijos/${id}`).set('authorization', `Bearer ${token}`).send(body);

  // Primer miércoles que cae a más de 10 días de hoy: futuro seguro, sin depender de la fecha actual.
  async function miercolesFuturo() {
    const { hoyEnTz, sumarDias, dayOfWeekInTz } = await import('../../src/utils/tz.js');
    const tz = 'America/Argentina/Buenos_Aires';
    let f = sumarDias(hoyEnTz(tz), 10);
    while (dayOfWeekInTz(f, tz) !== 3) f = sumarDias(f, 1);
    return f;
  }

  it('corrige el horario sin eliminar y rehacer el fijo', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id);
    const res = await editar(fijo.body.id, { horaInicio: '20:30', horaFin: '21:30' });
    expect(res.status).toBe(200);
    const guardado = await getPrisma().turnoFijo.findUnique({ where: { id: fijo.body.id } });
    expect(guardado).toMatchObject({ horaInicio: '20:30', horaFin: '21:30' });
    // Sigue siendo el mismo fijo: mismo id, un solo registro.
    expect(await getPrisma().turnoFijo.count()).toBe(1);
  });

  it('mover el horario del fijo no choca consigo mismo', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id);
    // 20:30-21:30 se solapa con su propio 20:00-21:00 original.
    expect((await editar(fijo.body.id, { horaInicio: '20:30', horaFin: '21:30' })).status).toBe(200);
  });

  it('un horario que pisa a OTRO fijo da 409 y no cambia nada', async () => {
    const c = await crearCancha();
    const a = await alta(c.id);
    await alta(c.id, { horaInicio: '22:00', horaFin: '23:00' });
    const res = await editar(a.body.id, { horaFin: '22:30' });
    expect(res.status).toBe(409);
    expect((await getPrisma().turnoFijo.findUnique({ where: { id: a.body.id } }))!.horaFin).toBe('21:00');
  });

  it('corrige el monto del abono sin tocar lo ya cobrado', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id, { ...ABONO, montoPagado: 40000 });
    const res = await editar(fijo.body.id, { montoAbono: 120000 });
    expect(res.status).toBe(200);
    const cobros = await supertest(app).get(`/turnos-fijos/${fijo.body.id}/cobros`).set('authorization', `Bearer ${token}`);
    expect(cobros.body).toMatchObject({ monto: 120000, pagado: 40000, saldo: 80000 });
  });

  it('el monto del abono puede bajar por debajo de lo ya cobrado (error del recepcionista): saldo 0 y aviso', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id, { ...ABONO, montoPagado: 60000 });
    const res = await editar(fijo.body.id, { montoAbono: 50000 });
    expect(res.status).toBe(200);
    expect(res.body.cobradoDeMas).toBe(10000);
    expect(Number((await getPrisma().turnoFijo.findUnique({ where: { id: fijo.body.id } }))!.montoAbono)).toBe(50000);
    const cobros = await supertest(app).get(`/turnos-fijos/${fijo.body.id}/cobros`).set('authorization', `Bearer ${token}`);
    expect(cobros.body).toMatchObject({ monto: 50000, pagado: 60000, saldo: 0 });
    // El cobro NO se tocó: se corrige anulándolo desde "Cobros del abono".
    expect(await getPrisma().cobro.count({ where: { turnoFijoId: fijo.body.id } })).toBe(1);
  });

  it('un monto igual o mayor a lo cobrado no informa excedente', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id, { ...ABONO, montoPagado: 60000 });
    const res = await editar(fijo.body.id, { montoAbono: 60000 });
    expect(res.status).toBe(200);
    expect(res.body.cobradoDeMas).toBe(0);
  });

  it('un fijo sin abono no admite editar monto (422)', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id);
    expect((await editar(fijo.body.id, { montoAbono: 5000 })).status).toBe(422);
  });

  it('un body vacío o inválido da 400, y un fijo inexistente 404', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id);
    expect((await editar(fijo.body.id, {})).status).toBe(400);
    expect((await editar(fijo.body.id, { horaInicio: '25:00' })).status).toBe(400);
    expect((await editar('no-existe', { clienteNombre: 'X' })).status).toBe(404);
  });

  it('editar exige JWT de staff', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id);
    const res = await supertest(app).patch(`/turnos-fijos/${fijo.body.id}`).set('x-api-key', 'svc').send({ clienteNombre: 'X' });
    expect(res.status).toBe(401);
  });

  it('al cambiar el horario se cancelan los turnos futuros ya materializados (sin cobros)', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id);
    const fecha = await miercolesFuturo();
    const mat = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('authorization', `Bearer ${token}`).send({ fecha });
    expect(mat.status).toBe(201);

    const res = await editar(fijo.body.id, { horaInicio: '19:00', horaFin: '20:00' });
    expect(res.status).toBe(200);
    expect(res.body.turnosCancelados).toBe(1);
    expect((await getPrisma().reserva.findUnique({ where: { id: mat.body.id } }))!.estado).toBe('CANCELADA');
  });

  it('si un turno futuro materializado ya tiene cobros, rechaza el cambio de horario (422)', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id);
    const fecha = await miercolesFuturo();
    const mat = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('authorization', `Bearer ${token}`).send({ fecha });
    await getPrisma().cobro.create({ data: { reservaId: mat.body.id, monto: 1000, medio: 'EFECTIVO', origen: 'MANUAL' } });

    const res = await editar(fijo.body.id, { horaInicio: '19:00', horaFin: '20:00' });
    expect(res.status).toBe(422);
    expect((await getPrisma().turnoFijo.findUnique({ where: { id: fijo.body.id } }))!.horaInicio).toBe('20:00');
    expect((await getPrisma().reserva.findUnique({ where: { id: mat.body.id } }))!.estado).not.toBe('CANCELADA');
  });

  it('cambiar solo el cliente no toca los turnos materializados', async () => {
    const c = await crearCancha();
    const fijo = await alta(c.id);
    const fecha = await miercolesFuturo();
    const mat = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('authorization', `Bearer ${token}`).send({ fecha });
    const res = await editar(fijo.body.id, { clienteNombre: 'Beto' });
    expect(res.status).toBe(200);
    expect(res.body.turnosCancelados).toBe(0);
    expect((await getPrisma().reserva.findUnique({ where: { id: mat.body.id } }))!.estado).not.toBe('CANCELADA');
  });
});

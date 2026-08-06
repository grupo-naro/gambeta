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

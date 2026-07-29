import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { aFechaUtc, hoyEnTz, diaSiguiente, sumarUnMes } from '../../src/services/suscripcion.vigencia.js';

let app: any;
const TZ = 'America/Argentina/Buenos_Aires';

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });

async function socioCon(inicio: string, vencimiento: string, whatsapp = '+5491100000040') {
  const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp } });
  const s = await getPrisma().suscripcion.create({ data: { clienteId: c.id, inicio: aFechaUtc(inicio), vencimiento: aFechaUtc(vencimiento) } });
  return { cliente: c, suscripcion: s };
}

describe('POST /suscripciones/:id/renovar', () => {
  it('renovacion anticipada: crea una fila nueva que arranca al dia siguiente del vencimiento', async () => {
    const hoy = hoyEnTz(TZ);
    const vence = sumarUnMes(hoy); // vencimiento futuro → renovación anticipada
    const { suscripcion } = await socioCon('2026-01-01', vence);
    const res = await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`)
      .set('authorization', `Bearer ${admin()}`).send({});
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(suscripcion.id);
    expect(res.body.inicio.slice(0, 10)).toBe(diaSiguiente(vence));
    expect(await getPrisma().suscripcion.count()).toBe(2);
  });

  it('renovacion tardia: arranca hoy, no regala dias retroactivos', async () => {
    const hoy = hoyEnTz(TZ);
    const { suscripcion } = await socioCon('2026-01-01', '2026-01-31');
    const res = await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`)
      .set('authorization', `Bearer ${admin()}`).send({});
    expect(res.status).toBe(201);
    expect(res.body.inicio.slice(0, 10)).toBe(hoy);
    expect(res.body.vencimiento.slice(0, 10)).toBe(sumarUnMes(hoy));
  });

  it('registra el cobro de la cuota si se manda precio + medio', async () => {
    const { suscripcion } = await socioCon('2026-01-01', '2026-01-31');
    const res = await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`)
      .set('authorization', `Bearer ${admin()}`).send({ precio: 25000, medio: 'TRANSFERENCIA' });
    const cobros = await getPrisma().cobro.findMany();
    expect(cobros).toHaveLength(1);
    expect(cobros[0].suscripcionId).toBe(res.body.id);
    expect(Number(cobros[0].monto)).toBe(25000);
  });

  it('la suscripcion vieja no se modifica', async () => {
    const { suscripcion } = await socioCon('2026-01-01', '2026-01-31');
    await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`).set('authorization', `Bearer ${admin()}`).send({});
    const vieja = await getPrisma().suscripcion.findUnique({ where: { id: suscripcion.id } });
    expect(vieja!.vencimiento.toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(vieja!.estado).toBe('ACTIVA');
  });

  it('se puede renovar una cancelada (arranca desde hoy)', async () => {
    const { suscripcion } = await socioCon('2026-01-01', '2026-01-31');
    await getPrisma().suscripcion.update({ where: { id: suscripcion.id }, data: { estado: 'CANCELADA' } });
    const res = await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`)
      .set('authorization', `Bearer ${admin()}`).send({});
    expect(res.status).toBe(201);
  });

  it('suscripcion inexistente → 404', async () => {
    const res = await supertest(app).post('/suscripciones/no-existe/renovar')
      .set('authorization', `Bearer ${admin()}`).send({});
    expect(res.status).toBe(404);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any; let token: string; let canchaId: string; let clienteId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  // Create a real AdminUser so the auditLog FK constraint is satisfied (ver reserva.cancelar.test.ts)
  const admin = await getPrisma().adminUser.create({
    data: { email: 'a@b.com', nombre: 'Admin', passwordHash: await hashPassword('pw') },
  });
  token = signAdminToken({ adminId: admin.id, email: 'a@b.com', rol: 'ADMIN' });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol', precioHora: 12000, jugadores: 5 } })).id;
  clienteId = (await getPrisma().cliente.create({ data: { whatsapp: '5491100000000', nombre: 'Test', nombreConfirmado: true } })).id;
});

async function reservaEn(minutos: number) {
  const ini = new Date(Date.now() + minutos * 60000);
  const fin = new Date(ini.getTime() + 60 * 60000);
  return getPrisma().reserva.create({ data: { canchaId, clienteId, fechaInicio: ini, fechaFin: fin, estado: 'CONFIRMADA', esContacto: false, monto: 12000 } });
}
const cancelarSvc = (id: string) => supertest(app).patch(`/reservas/${id}/cancelar`).set('x-api-key', 'svc');
const cancelarAdmin = (id: string) => supertest(app).patch(`/reservas/${id}/cancelar`).set('authorization', `Bearer ${token}`);

describe('cancelación: se permite hasta 10 minutos antes del turno', () => {
  it('cliente (servicio) cancela un turno a +30 min → OK', async () => {
    const r = await reservaEn(30);
    const res = await cancelarSvc(r.id);
    expect(res.status).toBeLessThan(400);
    expect((await getPrisma().reserva.findUnique({ where: { id: r.id } }))?.estado).toBe('CANCELADA');
  });
  it('cliente (servicio) NO puede cancelar un turno a +5 min → 422', async () => {
    const r = await reservaEn(5);
    const res = await cancelarSvc(r.id);
    expect(res.status).toBe(422);
    expect((await getPrisma().reserva.findUnique({ where: { id: r.id } }))?.estado).toBe('CONFIRMADA');
  });
  it('admin cancela igual a +5 min (bypass) → OK', async () => {
    const r = await reservaEn(5);
    const res = await cancelarAdmin(r.id);
    expect(res.status).toBeLessThan(400);
    expect((await getPrisma().reserva.findUnique({ where: { id: r.id } }))?.estado).toBe('CANCELADA');
  });
});

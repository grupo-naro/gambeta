import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { mercadoPagoService } from '../../src/services/mercadoPago.service.js';
import { logger } from '../../src/utils/logger.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaMontoFijo: 5000 } });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 1', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } })).id;
});
const svc = (r: any) => r.set('x-api-key', 'svc');
const fut = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const crearEsperandoSena = (whatsapp: string) =>
  svc(supertest(app).post('/reservas')).send({ canchaId, whatsapp, nombreCliente: 'Nuevo', esContacto: false, fecha: fut(), horaInicio: '18:00' });
const notif = (dataId: string) =>
  supertest(app).post(`/webhooks/mercadopago?data.id=${dataId}&type=payment`).set('x-signature', 'ts=1,v1=deadbeef').set('x-request-id', 'req-1');

describe('webhook: pagos rechazados', () => {
  it('un pago rechazado por riesgo queda en el log con su motivo y no toca la reserva', async () => {
    const r = await crearEsperandoSena('5491150000090');
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(true);
    vi.spyOn(mercadoPagoService, 'obtenerPago').mockResolvedValue({
      id: 'pago-r1', status: 'rejected', statusDetail: 'cc_rejected_high_risk', externalReference: r.body.id, montoAprobado: 10000,
    });
    const warn = vi.spyOn(logger, 'warn');

    const res = await notif('pago-r1');
    expect(res.status).toBe(200);
    expect((await getPrisma().reserva.findUnique({ where: { id: r.body.id } }))!.estado).toBe('ESPERANDO_SENA');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: r.body.id, mpPaymentId: 'pago-r1', status: 'rejected', statusDetail: 'cc_rejected_high_risk' }),
      expect.stringContaining('no aprobado'),
    );
  });
});

describe('GET /pagos/reserva/:id (para que el sitio ofrezca transferencia si MP rechaza)', () => {
  it('devuelve el estado, la seña y cuándo vence, sin datos personales', async () => {
    const r = await crearEsperandoSena('5491150000091');
    const res = await svc(supertest(app).get(`/pagos/reserva/${r.body.id}`));
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(res.body.montoSena).toBe(10000);
    expect(res.body.canchaNombre).toBe('Cancha 1');
    expect(new Date(res.body.fechaInicio).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(res.body.venceEn).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(res.body)).not.toMatch(/5491150000091|Nuevo/);
  });

  it('una reserva que ya no espera seña informa su estado actual', async () => {
    const r = await crearEsperandoSena('5491150000092');
    await getPrisma().reserva.update({ where: { id: r.body.id }, data: { estado: 'CANCELADA' } });
    const res = await svc(supertest(app).get(`/pagos/reserva/${r.body.id}`));
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');
  });

  it('una reserva inexistente es 404 y sin clave es 401', async () => {
    expect((await svc(supertest(app).get('/pagos/reserva/noexiste'))).status).toBe(404);
    expect((await supertest(app).get('/pagos/reserva/noexiste')).status).toBe(401);
  });
});

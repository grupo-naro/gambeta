import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { mercadoPagoService } from '../../src/services/mercadoPago.service.js';
import { evolutionService } from '../../src/services/evolution.service.js';

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
const fut = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const crearEsperandoSena = (whatsapp: string) =>
  svc(supertest(app).post('/reservas')).send({ canchaId, whatsapp, nombreCliente: 'Nuevo', esContacto: false, fecha: fut(), horaInicio: '18:00' });

const notif = (dataId: string) =>
  supertest(app).post(`/webhooks/mercadopago?data.id=${dataId}&type=payment`).set('x-signature', 'ts=1,v1=deadbeef').set('x-request-id', 'req-1');

describe('POST /webhooks/mercadopago', () => {
  it('firma inválida devuelve 401 y no toca la reserva', async () => {
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(false);
    const r = await crearEsperandoSena('5491150000080');
    const res = await notif('pago-1');
    expect(res.status).toBe(401);
    const reserva = await getPrisma().reserva.findUnique({ where: { id: r.body.id } });
    expect(reserva!.estado).toBe('ESPERANDO_SENA');
  });

  it('pago aprobado confirma la reserva, guarda mpPaymentId y avisa por WhatsApp', async () => {
    const r = await crearEsperandoSena('5491150000081');
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(true);
    vi.spyOn(mercadoPagoService, 'obtenerPago').mockResolvedValue({ id: 'pago-2', status: 'approved', externalReference: r.body.id, montoAprobado: 5000 });
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);

    const res = await notif('pago-2');
    expect(res.status).toBe(200);

    const reserva = await getPrisma().reserva.findUnique({ where: { id: r.body.id } });
    expect(reserva!.estado).toBe('CONFIRMADA');
    const pago = await getPrisma().pago.findUnique({ where: { reservaId: r.body.id } });
    expect(pago!.mpPaymentId).toBe('pago-2');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('pago no aprobado (pending) no cambia la reserva', async () => {
    const r = await crearEsperandoSena('5491150000082');
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(true);
    vi.spyOn(mercadoPagoService, 'obtenerPago').mockResolvedValue({ id: 'pago-3', status: 'pending', externalReference: r.body.id, montoAprobado: 5000 });

    const res = await notif('pago-3');
    expect(res.status).toBe(200);
    const reserva = await getPrisma().reserva.findUnique({ where: { id: r.body.id } });
    expect(reserva!.estado).toBe('ESPERANDO_SENA');
  });

  it('reintento de un pago ya procesado (reserva ya CONFIRMADA) es idempotente', async () => {
    const r = await crearEsperandoSena('5491150000083');
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(true);
    vi.spyOn(mercadoPagoService, 'obtenerPago').mockResolvedValue({ id: 'pago-4', status: 'approved', externalReference: r.body.id, montoAprobado: 5000 });
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);

    const primero = await notif('pago-4');
    expect(primero.status).toBe(200);
    const segundo = await notif('pago-4');
    expect(segundo.status).toBe(200);

    expect(spy).toHaveBeenCalledTimes(1); // no se reprocesó ni se avisó dos veces
  });

  it('dos entregas del webhook EN PARALELO para el mismo pago no duplican el cobro ni el aviso', async () => {
    const r = await crearEsperandoSena('5491150000084');
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(true);
    vi.spyOn(mercadoPagoService, 'obtenerPago').mockResolvedValue({ id: 'pago-5', status: 'approved', externalReference: r.body.id, montoAprobado: 5000 });
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);

    const [a, b] = await Promise.all([notif('pago-5'), notif('pago-5')]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);

    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id, origen: 'SENA' } });
    expect(cobros).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

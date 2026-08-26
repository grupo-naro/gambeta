import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { mercadoPagoService } from '../../src/services/mercadoPago.service.js';

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
const crearEsperandoSena = () =>
  svc(supertest(app).post('/reservas')).send({ canchaId, whatsapp: '5491150000070', nombreCliente: 'Nuevo', esContacto: false, fecha: fut(), horaInicio: '18:00' });

describe('POST /pagos/mercadopago/preferencia', () => {
  it('crea la preferencia y guarda el mpPreferenceId', async () => {
    vi.spyOn(mercadoPagoService, 'crearPreferencia').mockResolvedValue({ preferenceId: 'pref-1', checkoutUrl: 'https://sandbox.mercadopago.com.ar/checkout/x' });
    const r = await crearEsperandoSena();
    expect(r.body.estado).toBe('ESPERANDO_SENA');

    const res = await svc(supertest(app).post('/pagos/mercadopago/preferencia')).send({ reservaId: r.body.id });
    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toBe('https://sandbox.mercadopago.com.ar/checkout/x');

    const pago = await getPrisma().pago.findUnique({ where: { reservaId: r.body.id } });
    expect(pago!.mpPreferenceId).toBe('pref-1');
  });

  it('reserva inexistente devuelve 404', async () => {
    const res = await svc(supertest(app).post('/pagos/mercadopago/preferencia')).send({ reservaId: 'no-existe' });
    expect(res.status).toBe(404);
  });

  it('reserva que no está ESPERANDO_SENA devuelve 409', async () => {
    const r = await crearEsperandoSena();
    await getPrisma().reserva.update({ where: { id: r.body.id }, data: { estado: 'CONFIRMADA' } });
    const res = await svc(supertest(app).post('/pagos/mercadopago/preferencia')).send({ reservaId: r.body.id });
    expect(res.status).toBe(409);
  });
});

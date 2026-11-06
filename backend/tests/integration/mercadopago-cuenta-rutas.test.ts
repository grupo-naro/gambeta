import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import { randomBytes } from 'node:crypto';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { mercadoPagoService } from '../../src/services/mercadoPago.service.js';

let app: any;
let tokenAdmin: string;

beforeAll(async () => {
  process.env.MP_CLIENT_ID = 'app-123';
  process.env.MP_CLIENT_SECRET = 'secreto-app';
  process.env.PANEL_PUBLIC_URL = 'https://panel.test';
  // Sin cuenta vinculada, crearPreferencia() tiene que fallar por falta de CUENTA, no por
  // faltarle estas dos: si no están seteadas, requerida() corta antes y el test de abajo
  // ("...falla con un mensaje claro") vería el mensaje equivocado.
  process.env.RESERVAS_PUBLIC_URL = 'https://reservas.test';
  process.env.BACKEND_PUBLIC_URL = 'https://api.test';
  // Requerida por src/utils/cripto.ts (getEnv().MP_ENCRYPTION_KEY) para poder insertar una
  // cuenta vinculada de prueba con cuentaVinculada(). Mismo patrón que mercadopago-oauth.test.ts.
  process.env.MP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTables();
  const admin = await getPrisma().adminUser.create({
    data: { email: 'admin@test.com', passwordHash: 'x', nombre: 'Admin', rol: 'ADMIN' },
  });
  tokenAdmin = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

/** Inserta una cuenta ya vinculada y sana (no caída) que vence dentro de `dias`. Mismo patrón
 * que `cuentaVinculada()` en mercadopago-oauth.test.ts. */
async function cuentaVinculada(dias: number) {
  const { cifrar } = await import('../../src/utils/cripto.js');
  await getPrisma().mercadoPagoCuenta.create({
    data: {
      id: 'default',
      accessToken: cifrar('APP_USR-token-del-vendedor'),
      refreshToken: cifrar('TG-refresh-del-vendedor'),
      venceEn: new Date(Date.now() + dias * 86400000),
      mpUserId: '987654321',
      apodo: 'COMPLEJO',
    },
  });
}

/** Sustituye fetch para las llamadas del SDK de Mercado Pago (que lo usa por debajo, ver
 * node_modules/mercadopago/dist/utils/restClient) a `/checkout/preferences/` y
 * `/v1/payments/:id`. Ningún test puede pegarle a Mercado Pago de verdad. */
function mockFetchMp() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
    const u = String(url);
    if (u.includes('/checkout/preferences')) {
      return { ok: true, status: 201, headers: new Headers(), json: async () => ({ id: 'pref-x', init_point: 'https://mp.test/checkout/x' }) } as Response;
    }
    if (u.includes('/v1/payments/')) {
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ id: 'pago-x', status: 'approved', external_reference: 'r1', transaction_amount: 5000 }) } as Response;
    }
    throw new Error('fetch inesperado en el test: ' + u);
  });
}

describe('rutas de la cuenta de Mercado Pago', () => {
  it('el estado sin cuenta dice que no está vinculada', async () => {
    const res = await supertest(app).get('/pagos/mercadopago/cuenta').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.vinculada).toBe(false);
  });

  it('vincular devuelve la URL de autorización', async () => {
    const res = await supertest(app).post('/pagos/mercadopago/vincular').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('auth.mercadopago.com');
    expect(res.body.url).toContain('offline_access');
  });

  it('sin JWT de admin no se puede tocar nada', async () => {
    // Ojo: la service key NO alcanza. Vincular una cuenta redirige plata.
    expect((await supertest(app).get('/pagos/mercadopago/cuenta').set('x-api-key', 'svc')).status).toBe(401);
    expect((await supertest(app).post('/pagos/mercadopago/vincular').set('x-api-key', 'svc')).status).toBe(401);
    expect((await supertest(app).post('/pagos/mercadopago/callback').set('x-api-key', 'svc').send({ code: 'x', state: 'y' })).status).toBe(401);
    expect((await supertest(app).delete('/pagos/mercadopago/cuenta').set('x-api-key', 'svc')).status).toBe(401);
  });

  it('un admin RECEPCIONISTA no puede tocar la cuenta de Mercado Pago (requiere ADMIN)', async () => {
    // Sin este caso, sacar requireRole('ADMIN') de las cuatro rutas dejaría la suite en verde.
    const recep = await getPrisma().adminUser.create({
      data: { email: 'recep@test.com', passwordHash: 'x', nombre: 'Recep', rol: 'RECEPCIONISTA' },
    });
    const tokenRecep = signAdminToken({ adminId: recep.id, email: recep.email, rol: 'RECEPCIONISTA' });
    expect((await supertest(app).get('/pagos/mercadopago/cuenta').set('Authorization', `Bearer ${tokenRecep}`)).status).toBe(403);
    expect((await supertest(app).post('/pagos/mercadopago/vincular').set('Authorization', `Bearer ${tokenRecep}`)).status).toBe(403);
    expect((await supertest(app).post('/pagos/mercadopago/callback').set('Authorization', `Bearer ${tokenRecep}`).send({ code: 'x', state: 'y' })).status).toBe(403);
    expect((await supertest(app).delete('/pagos/mercadopago/cuenta').set('Authorization', `Bearer ${tokenRecep}`)).status).toBe(403);
  });

  it('un state adulterado en el callback devuelve 400', async () => {
    const res = await supertest(app).post('/pagos/mercadopago/callback')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ code: 'x', state: 'inventado' });
    expect(res.status).toBe(400);
  });

  it('crear una preferencia sin cuenta vinculada falla con un mensaje claro', async () => {
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const reserva = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({
      canchaId: cancha.id, whatsapp: '+5491150000000', nombreCliente: 'Juan',
      esContacto: false, fecha: manana, horaInicio: '18:00',
    });
    expect(reserva.status).toBe(201);

    const res = await supertest(app).post('/pagos/mercadopago/preferencia')
      .set('x-api-key', 'svc').send({ reservaId: reserva.body.id });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/cuenta de Mercado Pago/i);
  });

  it('datosPago informa que los cobros online están apagados', async () => {
    const res = await supertest(app).get('/config/sena').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.cobrosOnline).toBe(false);
  });

  it('datosPago informa que los cobros online están prendidos con una cuenta vinculada y sana', async () => {
    await cuentaVinculada(100);
    const res = await supertest(app).get('/config/sena').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.cobrosOnline).toBe(true);
  });

  it('crearPreferencia y obtenerPago usan el token de la cuenta vinculada, no uno fijo', async () => {
    // mercadopago-webhook.test.ts y mercadopago-preferencia.test.ts reemplazan crearPreferencia
    // y obtenerPago enteras con mockResolvedValue, así que nunca ejercitan client() ni
    // tokenDeAcceso() de verdad. Este test SÍ llama a las funciones reales: si alguien
    // hardcodea un token fijo (el bug que este cambio vino a sacar), el header Authorization
    // no va a coincidir con el token descifrado de la cuenta y el test tiene que fallar.
    await cuentaVinculada(100);
    const fetchMock = mockFetchMp();

    const { checkoutUrl } = await mercadoPagoService.crearPreferencia({ id: 'r1', montoSena: 5000, canchaNombre: 'Cancha 1' });
    expect(checkoutUrl).toBe('https://mp.test/checkout/x');
    const pago = await mercadoPagoService.obtenerPago('pago-x');
    expect(pago.status).toBe('approved');

    const llamadas = fetchMock.mock.calls;
    const preferenciaCall = llamadas.find(([url]) => String(url).includes('/checkout/preferences'));
    const pagoCall = llamadas.find(([url]) => String(url).includes('/v1/payments/'));
    expect(preferenciaCall).toBeTruthy();
    expect(pagoCall).toBeTruthy();
    const authPreferencia = (preferenciaCall![1] as any)?.headers?.Authorization;
    const authPago = (pagoCall![1] as any)?.headers?.Authorization;
    expect(authPreferencia).toBe('Bearer APP_USR-token-del-vendedor');
    expect(authPago).toBe('Bearer APP_USR-token-del-vendedor');
  });

  it('la preferencia manda categoría y descripción del ítem (datos que usa el antifraude de MP)', async () => {
    await cuentaVinculada(100);
    const fetchMock = mockFetchMp();
    // 2030-05-10 20:00 en Argentina (UTC-3) = 23:00 UTC.
    await mercadoPagoService.crearPreferencia({ id: 'r1', montoSena: 5000, canchaNombre: 'Pádel 1', fechaInicio: new Date('2030-05-10T23:00:00.000Z') });

    const llamada = fetchMock.mock.calls.find(([url]) => String(url).includes('/checkout/preferences'))!;
    const item = JSON.parse(String((llamada[1] as any).body)).items[0];
    expect(item.category_id).toBe('services');
    expect(item.description).toContain('Pádel 1');
    expect(item.description).toContain('20:00');
    expect(item.description).toContain('10-05');
    expect(item.description.length).toBeLessThanOrEqual(256);
  });

  it('sin fecha, la descripción igual existe (no rompe a quien no la pasa)', async () => {
    await cuentaVinculada(100);
    const fetchMock = mockFetchMp();
    await mercadoPagoService.crearPreferencia({ id: 'r1', montoSena: 5000, canchaNombre: 'Cancha 1' });
    const llamada = fetchMock.mock.calls.find(([url]) => String(url).includes('/checkout/preferences'))!;
    const item = JSON.parse(String((llamada[1] as any).body)).items[0];
    expect(item.category_id).toBe('services');
    expect(item.description).toContain('Cancha 1');
  });

  it('cuando Mercado Pago devuelve los dos checkout, manda al de producción y no al de sandbox', async () => {
    // Bug real detectado en la primera prueba con la cuenta ya vinculada: el código elegía
    // `sandbox_init_point ?? init_point`, así que con credenciales de producción mandaba a
    // TODOS los clientes al checkout de prueba, donde no entra un peso. Mercado Pago devuelve
    // los dos campos, así que el orden del ?? es la única diferencia entre cobrar y no cobrar.
    await cuentaVinculada(100);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('/checkout/preferences')) {
        return {
          ok: true, status: 201, headers: new Headers(),
          json: async () => ({
            id: 'pref-x',
            init_point: 'https://www.mercadopago.com.ar/checkout/PRODUCCION',
            sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/SANDBOX',
          }),
        } as Response;
      }
      throw new Error('fetch inesperado en el test: ' + String(url));
    });

    const { checkoutUrl } = await mercadoPagoService.crearPreferencia({ id: 'r1', montoSena: 5000, canchaNombre: 'Cancha 1' });
    expect(checkoutUrl).toBe('https://www.mercadopago.com.ar/checkout/PRODUCCION');
    expect(checkoutUrl).not.toContain('sandbox');
  });
});

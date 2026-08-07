import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(async () => {
  process.env.MP_CLIENT_ID = 'app-123';
  process.env.MP_CLIENT_SECRET = 'secreto-app';
  process.env.PANEL_PUBLIC_URL = 'https://panel.test';
  // Requerida por src/utils/cripto.ts (getEnv().MP_ENCRYPTION_KEY): sin esto cifrar/descifrar
  // tiran Conflict. Mismo patrón que tests/unit/cripto.test.ts.
  process.env.MP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  await setupTestDb();
});
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); vi.restoreAllMocks(); });

/** Respuesta típica del endpoint /oauth/token de Mercado Pago. */
const respuestaToken = (over: Partial<Record<string, unknown>> = {}) => ({
  access_token: 'APP_USR-token-vendedor',
  refresh_token: 'TG-refresh-vendedor',
  expires_in: 15552000, // 180 días
  user_id: 987654321,
  ...over,
});

/** Sustituye fetch: ningún test puede pegarle a Mercado Pago de verdad. */
function mockFetch(respuesta: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    text: async () => JSON.stringify(respuesta),
  } as Response);
}

/** Inserta una cuenta ya vinculada que vence dentro de `dias`. */
async function cuentaVinculada(dias: number) {
  const { cifrar } = await import('../../src/utils/cripto.js');
  await getPrisma().mercadoPagoCuenta.create({
    data: {
      id: 'default',
      accessToken: cifrar('APP_USR-viejo'),
      refreshToken: cifrar('TG-viejo'),
      venceEn: new Date(Date.now() + dias * 86400000),
      mpUserId: '987654321',
      apodo: 'COMPLEJO',
    },
  });
}

describe('vincular', () => {
  it('guarda los tokens cifrados: en la base no se leen en claro', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    const { state } = svc.urlDeAutorizacion();
    mockFetch(respuestaToken());

    await svc.vincular('codigo-de-mp', state);

    const fila = await getPrisma().mercadoPagoCuenta.findUniqueOrThrow({ where: { id: 'default' } });
    expect(fila.accessToken).not.toContain('APP_USR-token-vendedor');
    expect(fila.refreshToken).not.toContain('TG-refresh-vendedor');
    expect(fila.mpUserId).toBe('987654321');
    // Y sin embargo el servicio lo devuelve descifrado.
    expect(await svc.tokenDeAcceso()).toBe('APP_USR-token-vendedor');
  });

  it('rechaza un state adulterado y no guarda nada', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    mockFetch(respuestaToken());

    await expect(svc.vincular('codigo-de-mp', 'state-inventado')).rejects.toThrow();
    expect(await getPrisma().mercadoPagoCuenta.findUnique({ where: { id: 'default' } })).toBeNull();
  });

  it('rechaza un state con la firma alterada y no guarda nada', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    const { state } = svc.urlDeAutorizacion();
    mockFetch(respuestaToken());

    // A diferencia de 'state-inventado' (que ni siquiera tiene el formato esperado y muere en
    // el chequeo estructural), este state tiene los tres campos correctos salvo el último
    // carácter de la firma: ejercita específicamente la comparación HMAC, no el parseo.
    const partes = state.split('.');
    const ultimoChar = partes[2].slice(-1);
    partes[2] = partes[2].slice(0, -1) + (ultimoChar === '0' ? '1' : '0');
    const stateAlterado = partes.join('.');

    await expect(svc.vincular('codigo-de-mp', stateAlterado)).rejects.toThrow();
    expect(await getPrisma().mercadoPagoCuenta.findUnique({ where: { id: 'default' } })).toBeNull();
  });

  it('rechaza un state vencido (firmado bien, pero de hace más de 10 minutos) y no guarda nada', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    mockFetch(respuestaToken());

    // Firmado correctamente con el mismo secreto que usa el servicio (JWT_SECRET), pero con
    // una marca de tiempo de hace 11 minutos: ejercita específicamente el control de
    // vencimiento, no la firma.
    const nonce = randomBytes(16).toString('hex');
    const emitido = String(Date.now() - 11 * 60_000);
    const firma = createHmac('sha256', process.env.JWT_SECRET!).update(`${nonce}.${emitido}`).digest('hex');
    const stateVencido = `${nonce}.${emitido}.${firma}`;

    await expect(svc.vincular('codigo-de-mp', stateVencido)).rejects.toThrow();
    expect(await getPrisma().mercadoPagoCuenta.findUnique({ where: { id: 'default' } })).toBeNull();
  });

  it('si Mercado Pago rechaza el código, no queda cuenta a medias', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    const { state } = svc.urlDeAutorizacion();
    mockFetch({ error: 'invalid_grant', message: 'El código expiró' }, false);

    await expect(svc.vincular('codigo-vencido', state)).rejects.toThrow();
    expect(await getPrisma().mercadoPagoCuenta.findUnique({ where: { id: 'default' } })).toBeNull();
  });

  it('la URL de autorización lleva offline_access y el redirect del panel', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    const { url } = svc.urlDeAutorizacion();
    // Sin offline_access no hay refresh token y a los 180 días se corta el cobro.
    expect(url).toContain('offline_access');
    expect(url).toContain(encodeURIComponent('https://panel.test/configuracion/mercadopago/callback'));
    expect(url).toContain('app-123');
  });
});

describe('renovación', () => {
  it('un token lejos de vencer NO se renueva', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(100);
    const f = mockFetch(respuestaToken());

    expect(await svc.tokenDeAcceso()).toBe('APP_USR-viejo');
    expect(f).not.toHaveBeenCalled();
  });

  it('un token por vencer se renueva y guarda el par nuevo', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(2); // menos de los 7 días de margen
    const f = mockFetch(respuestaToken({ access_token: 'APP_USR-nuevo', refresh_token: 'TG-nuevo' }));

    expect(await svc.tokenDeAcceso()).toBe('APP_USR-nuevo');

    // El pedido a MP tiene que llevar el refresh token EN CLARO, no el valor cifrado que está
    // guardado en la base. Sin esta aserción, mandar el cifrado igual haría pasar los otros
    // tests (el fetch está mockeado y no le importa el cuerpo).
    const cuerpoEnviado = JSON.parse(String(f.mock.calls[0][1]?.body));
    expect(cuerpoEnviado.refresh_token).toBe('TG-viejo');
    expect(cuerpoEnviado.grant_type).toBe('refresh_token');

    // El refresh token rota: si no se guarda el nuevo, la próxima renovación falla.
    const { descifrar } = await import('../../src/utils/cripto.js');
    const fila = await getPrisma().mercadoPagoCuenta.findUniqueOrThrow({ where: { id: 'default' } });
    expect(descifrar(fila.refreshToken)).toBe('TG-nuevo');
    expect(fila.venceEn.getTime()).toBeGreaterThan(Date.now() + 170 * 86400000);
  });

  it('una renovación exitosa limpia la bandera caida', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(2);
    await getPrisma().mercadoPagoCuenta.update({ where: { id: 'default' }, data: { caida: true } });
    mockFetch(respuestaToken({ access_token: 'APP_USR-nuevo', refresh_token: 'TG-nuevo' }));

    await svc.tokenDeAcceso();

    expect((await svc.estado()).caida).toBe(false);
  });

  it('dos renovaciones simultáneas no se pisan: una sola llamada a Mercado Pago', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(2);
    const f = mockFetch(respuestaToken({ access_token: 'APP_USR-nuevo', refresh_token: 'TG-nuevo' }));

    // Mercado Pago invalida el refresh token en cada uso. Si las dos renovaran, la segunda
    // usaría un token ya muerto y perderíamos la vinculación entera.
    const [a, b] = await Promise.all([svc.tokenDeAcceso(), svc.tokenDeAcceso()]);

    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toBe('APP_USR-nuevo');
    expect(b).toBe('APP_USR-nuevo');
  });

  it('si Mercado Pago rechaza explícitamente la renovación, la cuenta queda caída', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(2);
    mockFetch({ error: 'invalid_grant' }, false); // ok:false, status 400 -> rechazo explícito

    await expect(svc.tokenDeAcceso()).rejects.toThrow();

    const estado = await svc.estado();
    expect(estado.caida).toBe(true);
    expect(estado.vinculada).toBe(true); // sigue existiendo, pero rota
  });

  it('un error transitorio de Mercado Pago (5xx) NO marca la cuenta como caída', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(2);
    // Un 5xx es un problema del lado de MP, no un rechazo de nuestras credenciales: la
    // próxima reserva tiene que poder reintentar sin que nadie tenga que revincular a mano.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ message: 'Servicio no disponible' }),
    } as Response);

    await expect(svc.tokenDeAcceso()).rejects.toThrow();

    expect((await svc.estado()).caida).toBe(false);
  });

  it('un fallo de red al renovar NO marca la cuenta como caída', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(2);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(svc.tokenDeAcceso()).rejects.toThrow();

    expect((await svc.estado()).caida).toBe(false);
  });

  it('un token guardado corrupto falla con un error que nombra MP_ENCRYPTION_KEY, no un error crudo, y no marca caída', async () => {
    const { cifrar } = await import('../../src/utils/cripto.js');
    // Mismo dato que produciría una clave de cifrado distinta a la que se usó para guardar:
    // el descifrado falla la autenticación GCM y cripto.ts tira un Error crudo de la lib de
    // crypto, no un AppError. El servicio tiene que envolver eso, no dejarlo pasar como 500.
    const cifradoValido = cifrar('APP_USR-viejo');
    const [iv, tag, datos] = cifradoValido.split('.');
    const datosAlterados = datos.slice(0, -2) + (datos.slice(-2) === 'AA' ? 'AB' : 'AA');
    await getPrisma().mercadoPagoCuenta.create({
      data: {
        id: 'default',
        accessToken: `${iv}.${tag}.${datosAlterados}`,
        refreshToken: cifrar('TG-viejo'),
        venceEn: new Date(Date.now() + 100 * 86400000), // camino rápido, sin lock
        mpUserId: '987654321',
        apodo: 'COMPLEJO',
      },
    });
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;

    await expect(svc.tokenDeAcceso()).rejects.toThrow(/MP_ENCRYPTION_KEY/);

    // No es un rechazo de MP (ni siquiera se llegó a llamar a MP): no hay que marcar caída.
    expect((await svc.estado()).caida).toBe(false);
  });
});

describe('estado y desvinculación', () => {
  it('sin cuenta, no está vinculada y pedir el token falla', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    expect(await svc.hayCuentaVinculada()).toBe(false);
    expect((await svc.estado()).vinculada).toBe(false);
    await expect(svc.tokenDeAcceso()).rejects.toThrow();
  });

  it('el estado no filtra los tokens', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(100);
    const estado = await svc.estado();
    expect(JSON.stringify(estado)).not.toContain('APP_USR');
    expect(JSON.stringify(estado)).not.toContain('TG-');
    expect(estado.apodo).toBe('COMPLEJO');
  });

  it('desvincular borra la cuenta', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(100);
    await svc.desvincular();
    expect(await svc.hayCuentaVinculada()).toBe(false);
  });

  it('desvincular sin cuenta no rompe', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await expect(svc.desvincular()).resolves.not.toThrow();
  });
});

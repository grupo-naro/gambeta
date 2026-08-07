import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../config/env.js';
import { cifrar, descifrar } from '../utils/cripto.js';
import { logger } from '../utils/logger.js';
import { BadRequest, Conflict } from '../utils/errors.js';
import { mercadoPagoCuentaRepo } from '../repositories/mercadoPagoCuenta.repo.js';

const AUTORIZACION_URL = 'https://auth.mercadopago.com.ar/authorization';
const TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
const RUTA_CALLBACK = '/configuracion/mercadopago/callback';

/** Margen para renovar antes de vencer. Holgado a propósito: con el complejo cerrado una
 * semana entera, la primera reserva que entre después todavía renueva a tiempo. */
const MARGEN_RENOVACION_MS = 7 * 86400000;
/** Cuánto vale un `state`. Es el tiempo que el dueño tiene para completar el login en MP. */
const STATE_VALIDO_MS = 10 * 60000;

function requerida(nombre: string, valor: string): string {
  if (!valor) throw Conflict(`Mercado Pago no está configurado: falta la variable ${nombre} en el backend`);
  return valor;
}

function redirectUri(): string {
  return `${requerida('PANEL_PUBLIC_URL', getEnv().PANEL_PUBLIC_URL)}${RUTA_CALLBACK}`;
}

/**
 * `state` = `<nonce>.<emitidoEn>.<firma>`, firmado con JWT_SECRET.
 *
 * Sin esto cualquiera puede armar un enlace de callback y vincular SU cuenta al sistema del
 * complejo, quedándose con todas las señas. No hace falta guardarlo en la base: la firma y la
 * marca de tiempo alcanzan para verificar que lo emitimos nosotros y hace poco.
 */
function firmarState(): string {
  const nonce = randomBytes(16).toString('hex');
  const emitido = String(Date.now());
  const firma = createHmac('sha256', getEnv().JWT_SECRET).update(`${nonce}.${emitido}`).digest('hex');
  return `${nonce}.${emitido}.${firma}`;
}

function verificarState(state: string): void {
  const [nonce, emitido, firma] = (state ?? '').split('.');
  if (!nonce || !emitido || !firma) throw BadRequest('La vinculación con Mercado Pago no es válida. Volvé a intentarla.');
  const esperada = createHmac('sha256', getEnv().JWT_SECRET).update(`${nonce}.${emitido}`).digest('hex');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw BadRequest('La vinculación con Mercado Pago no es válida. Volvé a intentarla.');
  }
  if (Date.now() - Number(emitido) > STATE_VALIDO_MS) {
    throw BadRequest('La vinculación tardó demasiado. Volvé a intentarla.');
  }
}

interface RespuestaToken { access_token: string; refresh_token: string; expires_in: number; user_id: number | string }

async function pedirToken(cuerpo: Record<string, string>): Promise<RespuestaToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!res.ok) {
    // El mensaje de MP se muestra tal cual: tragárselo deja al dueño sin saber qué pasó.
    const msg = (datos as { message?: string } | null)?.message ?? 'Mercado Pago rechazó la operación';
    throw Conflict(`Mercado Pago: ${msg}`);
  }
  if (!datos?.access_token || !datos?.refresh_token) throw Conflict('Mercado Pago no devolvió los tokens esperados');
  return datos as RespuestaToken;
}

export const mercadoPagoOauthService = {
  urlDeAutorizacion(): { url: string; state: string } {
    const clientId = requerida('MP_CLIENT_ID', getEnv().MP_CLIENT_ID);
    const state = firmarState();
    const q = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      platform_id: 'mp',
      // offline_access es lo que habilita el refresh token. Sin él, a los 180 días
      // habría que rehacer el flujo a mano.
      scope: 'offline_access read write',
      state,
      redirect_uri: redirectUri(),
    });
    return { url: `${AUTORIZACION_URL}?${q.toString()}`, state };
  },

  async vincular(code: string, state: string): Promise<{ apodo: string }> {
    verificarState(state);
    const env = getEnv();
    const datos = await pedirToken({
      client_id: requerida('MP_CLIENT_ID', env.MP_CLIENT_ID),
      client_secret: requerida('MP_CLIENT_SECRET', env.MP_CLIENT_SECRET),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    });
    const apodo = String(datos.user_id);
    await mercadoPagoCuentaRepo.guardar({
      accessToken: cifrar(datos.access_token),
      refreshToken: cifrar(datos.refresh_token),
      venceEn: new Date(Date.now() + datos.expires_in * 1000),
      mpUserId: String(datos.user_id),
      apodo,
    });
    logger.info({ mpUserId: apodo }, 'cuenta de Mercado Pago vinculada');
    return { apodo };
  },

  async desvincular(): Promise<void> {
    await mercadoPagoCuentaRepo.borrar();
    logger.info('cuenta de Mercado Pago desvinculada');
  },

  async hayCuentaVinculada(): Promise<boolean> {
    const c = await mercadoPagoCuentaRepo.get();
    return !!c && !c.caida;
  },

  async estado() {
    const c = await mercadoPagoCuentaRepo.get();
    // Devuelve solo lo que el panel necesita mostrar. Nunca los tokens.
    if (!c) return { vinculada: false, apodo: null, venceEn: null, caida: false };
    return { vinculada: true, apodo: c.apodo, venceEn: c.venceEn.toISOString(), caida: c.caida };
  },

  /** Token del vendedor, renovándolo si está por vencer. */
  async tokenDeAcceso(): Promise<string> {
    const actual = await mercadoPagoCuentaRepo.get();
    if (!actual) throw Conflict('No hay una cuenta de Mercado Pago vinculada');
    if (actual.venceEn.getTime() - Date.now() > MARGEN_RENOVACION_MS) return descifrar(actual.accessToken);

    const env = getEnv();
    try {
      return await mercadoPagoCuentaRepo.conFilaBloqueada(async (tx) => {
        // Releer DENTRO del lock: si otra petición ya renovó mientras esperábamos,
        // acá se ve el token nuevo y no se llama a Mercado Pago de nuevo.
        const c = await mercadoPagoCuentaRepo.leerEn(tx);
        if (!c) throw Conflict('No hay una cuenta de Mercado Pago vinculada');
        if (c.venceEn.getTime() - Date.now() > MARGEN_RENOVACION_MS) return descifrar(c.accessToken);

        const datos = await pedirToken({
          client_id: requerida('MP_CLIENT_ID', env.MP_CLIENT_ID),
          client_secret: requerida('MP_CLIENT_SECRET', env.MP_CLIENT_SECRET),
          grant_type: 'refresh_token',
          refresh_token: descifrar(c.refreshToken),
        });
        await mercadoPagoCuentaRepo.actualizarTokens(tx, {
          accessToken: cifrar(datos.access_token),
          refreshToken: cifrar(datos.refresh_token),
          venceEn: new Date(Date.now() + datos.expires_in * 1000),
        });
        logger.info('token de Mercado Pago renovado');
        return datos.access_token;
      });
    } catch (e) {
      // La renovación falló: la cuenta queda caída para que el panel lo muestre en rojo.
      await mercadoPagoCuentaRepo.marcarCaida();
      logger.error({ err: e }, 'falló la renovación del token de Mercado Pago');
      throw e;
    }
  },
};

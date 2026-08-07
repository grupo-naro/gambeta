import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../config/env.js';
import { cifrar, descifrar } from '../utils/cripto.js';
import { logger } from '../utils/logger.js';
import { AppError, BadRequest, Conflict } from '../utils/errors.js';
import { mercadoPagoCuentaRepo } from '../repositories/mercadoPagoCuenta.repo.js';

const AUTORIZACION_URL = 'https://auth.mercadopago.com.ar/authorization';
const TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
const RUTA_CALLBACK = '/configuracion/mercadopago/callback';

/** Margen para renovar antes de vencer. Holgado a propósito: con el complejo cerrado una
 * semana entera, la primera reserva que entre después todavía renueva a tiempo. */
const MARGEN_RENOVACION_MS = 7 * 86400000;
/** Cuánto vale un `state`. Es el tiempo que el dueño tiene para completar el login en MP. */
const STATE_VALIDO_MS = 10 * 60000;

/**
 * Timeout del fetch a Mercado Pago. Tiene que ser MENOR al timeout de la transacción que
 * sostiene el lock de renovación (`TRANSACCION_TIMEOUT_MS` en `mercadoPagoCuenta.repo.ts`):
 * así es siempre el fetch el que corta primero. Si se invirtiera la relación, Prisma podría
 * cerrar la transacción con la llamada a MP todavía en vuelo, y un refresh token que MP ya
 * rotó de su lado quedaría sin persistir del nuestro — la vinculación se pierde igual.
 */
const TOKEN_FETCH_TIMEOUT_MS = 10_000;

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

/**
 * Envuelve `descifrar`: si `MP_ENCRYPTION_KEY` cambió o el dato guardado está corrupto,
 * `cripto.ts` puede tirar tanto un `Conflict` (formato inválido) como un `Error` crudo de la
 * librería de crypto (falla de autenticación GCM). Acá los unificamos en un solo `Conflict`
 * que nombra la variable a revisar, para que ningún camino —ni el rápido sin lock, ni el de
 * la renovación— explote con un 500 opaco cuando en realidad el problema es de configuración.
 */
function descifrarToken(valor: string): string {
  try {
    return descifrar(valor);
  } catch {
    throw Conflict('No se pudo leer el token de Mercado Pago guardado: revisá MP_ENCRYPTION_KEY en el backend');
  }
}

/**
 * Se lanza únicamente cuando Mercado Pago respondió y rechazó explícitamente la operación
 * (4xx: código vencido, refresh token inválido, etc.). Es la única causa que amerita marcar
 * la cuenta como caída — cualquier otra falla (red, timeout, 5xx de MP, la propia transacción
 * de Postgres) es transitoria y se resuelve sola en el próximo intento.
 */
class RechazoExplicitoMp extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

interface RespuestaToken { access_token: string; refresh_token: string; expires_in: number; user_id: number | string }

async function pedirToken(cuerpo: Record<string, string>, opts: { marcarSiRechazo?: boolean } = {}): Promise<RespuestaToken> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
    });
  } catch {
    // Red caída, DNS, timeout: no es que MP haya dicho que no, es que no lo pudimos
    // contactar. Transitorio — nunca marca la cuenta como caída.
    throw Conflict('No se pudo contactar a Mercado Pago. Probá de nuevo en un momento.');
  }

  const texto = await res.text();
  let datos: unknown;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    // MP (o un proxy en el medio) devolvió algo que no es JSON: típico de un 502/503 con una
    // página de error HTML en vez de la respuesta esperada. Tampoco es un rechazo explícito.
    throw Conflict('Mercado Pago devolvió una respuesta inesperada. Probá de nuevo en un momento.');
  }

  if (!res.ok) {
    // El mensaje de MP se muestra tal cual: tragárselo deja al dueño sin saber qué pasó.
    const msg = (datos as { message?: string } | null)?.message ?? 'Mercado Pago rechazó la operación';
    if (res.status >= 500) {
      // Falla del lado de MP, no un rechazo de nuestras credenciales: transitorio.
      throw Conflict(`Mercado Pago no está disponible: ${msg}`);
    }
    if (opts.marcarSiRechazo) throw new RechazoExplicitoMp(`Mercado Pago: ${msg}`);
    throw Conflict(`Mercado Pago: ${msg}`);
  }

  const d = datos as Partial<RespuestaToken> | null;
  if (!d?.access_token || !d?.refresh_token || !d?.expires_in || !d?.user_id) {
    throw Conflict('Mercado Pago no devolvió los datos esperados');
  }
  return d as RespuestaToken;
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

  /**
   * `true` solo si hay cuenta Y está operativa (no caída). Es lo que tienen que consultar los
   * llamadores que van a pedir un token (ej. antes de armar un cobro): una cuenta caída no
   * sirve aunque la fila siga existiendo. Para saber si existe una fila para mostrar en el
   * panel — incluso rota —, ver `estado().vinculada`.
   */
  async hayCuentaVinculada(): Promise<boolean> {
    const c = await mercadoPagoCuentaRepo.get();
    return !!c && !c.caida;
  },

  /**
   * Estado para el panel. `vinculada` significa "existe una fila" (aunque esté `caida`,
   * sigue existiendo y hay que mostrarla en rojo con opción de revincular). Para saber si el
   * token efectivamente se puede usar, ver `hayCuentaVinculada()`.
   */
  async estado(): Promise<{ vinculada: boolean; apodo: string | null; venceEn: string | null; caida: boolean }> {
    const c = await mercadoPagoCuentaRepo.get();
    // Devuelve solo lo que el panel necesita mostrar. Nunca los tokens.
    if (!c) return { vinculada: false, apodo: null, venceEn: null, caida: false };
    return { vinculada: true, apodo: c.apodo, venceEn: c.venceEn.toISOString(), caida: c.caida };
  },

  /** Token del vendedor, renovándolo si está por vencer. */
  async tokenDeAcceso(): Promise<string> {
    const actual = await mercadoPagoCuentaRepo.get();
    if (!actual) throw Conflict('No hay una cuenta de Mercado Pago vinculada');
    if (actual.venceEn.getTime() - Date.now() > MARGEN_RENOVACION_MS) return descifrarToken(actual.accessToken);

    const env = getEnv();
    try {
      return await mercadoPagoCuentaRepo.conFilaBloqueada(async (tx) => {
        // Releer DENTRO del lock: si otra petición ya renovó mientras esperábamos,
        // acá se ve el token nuevo y no se llama a Mercado Pago de nuevo.
        const c = await mercadoPagoCuentaRepo.leerEn(tx);
        if (!c) throw Conflict('No hay una cuenta de Mercado Pago vinculada');
        if (c.venceEn.getTime() - Date.now() > MARGEN_RENOVACION_MS) return descifrarToken(c.accessToken);

        const datos = await pedirToken(
          {
            client_id: requerida('MP_CLIENT_ID', env.MP_CLIENT_ID),
            client_secret: requerida('MP_CLIENT_SECRET', env.MP_CLIENT_SECRET),
            grant_type: 'refresh_token',
            refresh_token: descifrarToken(c.refreshToken),
          },
          { marcarSiRechazo: true },
        );

        try {
          await mercadoPagoCuentaRepo.actualizarTokens(tx, {
            accessToken: cifrar(datos.access_token),
            refreshToken: cifrar(datos.refresh_token),
            venceEn: new Date(Date.now() + datos.expires_in * 1000),
          });
        } catch (e) {
          // Mercado Pago ya invalidó el refresh token viejo y nos dio uno nuevo, pero no
          // logramos guardarlo (ej. la transacción se cortó justo acá). No hay forma de
          // recuperar esto en código: el par nuevo se perdió y la cuenta va a quedar con un
          // refresh token muerto sin que nadie lo note. Dejamos un rastro imposible de pasar
          // por alto para que alguien revincule a mano cuanto antes.
          logger.error(
            { err: e },
            'CRÍTICO: Mercado Pago renovó el token de la cuenta pero no se pudo persistir el par nuevo. ' +
              'El refresh token guardado quedó muerto — hay que revincular Mercado Pago a mano desde el panel.',
          );
          throw e;
        }

        logger.info('token de Mercado Pago renovado');
        return datos.access_token;
      });
    } catch (e) {
      if (e instanceof RechazoExplicitoMp) {
        // Mercado Pago dijo explícitamente que no: no hay margen, la cuenta queda caída para
        // que el panel lo muestre en rojo y el dueño sepa que hay que revincular.
        logger.error({ err: e }, 'Mercado Pago rechazó la renovación del token: la cuenta queda caída');
        try {
          await mercadoPagoCuentaRepo.marcarCaida();
        } catch (e2) {
          // No tapar el error original (el rechazo de MP) si además falla marcar la bandera.
          logger.error({ err: e2 }, 'además, no se pudo marcar la cuenta de Mercado Pago como caída');
        }
      } else {
        // Red, timeout, 5xx de MP, la propia transacción de Postgres, una clave de cifrado
        // que cambió: nada de esto es un rechazo de MP. Se propaga sin marcar nada — la
        // próxima reserva vuelve a intentar la renovación desde cero.
        logger.error({ err: e }, 'falló la renovación del token de Mercado Pago (transitorio, se reintentará)');
      }
      throw e;
    }
  },
};

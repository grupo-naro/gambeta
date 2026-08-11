import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../config/env.js';

/**
 * Identifica al mostrador en cada request, firmado por el servidor.
 *
 * No alcanza con que el mostrador diga quién es en un header: la `x-buffet-key` es compartida
 * entre los dos puestos, así que cualquiera podría hacerse pasar por el otro — y toda la
 * conciliación del cierre depende de que "quién vendió" sea confiable. El token solo se emite
 * contra el PIN correcto.
 *
 * El HMAC usa `BUFFET_API_KEY` como secreto — la misma env var que valida la `x-buffet-key`. Que
 * este esquema sea seguro depende de una condición concreta: `BUFFET_API_KEY` nunca llega al
 * dispositivo del mostrador. Vive en el backend y en el servidor de Next (que la reenvía como
 * header en cada request y también la usa para firmar la cookie de sesión del buffet, ver
 * `frontend/src/lib/buffet-session.ts`), pero jamás en el navegador que opera el puesto. Si algún
 * día un dispositivo llegara a conocer `BUFFET_API_KEY` directamente, cualquiera que pasara el
 * primer chequeo podría calcularse un token válido sin saber ningún PIN — este esquema dejaría de
 * sostenerse y habría que firmar con un secreto propio, no compartido con la key de transporte.
 *
 * El payload que se firma lleva un prefijo de dominio (`mostrador:v1:`) y no el id pelado: la
 * cookie de sesión del buffet (`frontend/src/lib/buffet-session.ts`) firma con la misma
 * `BUFFET_API_KEY` sobre otro formato (`<expMs>.<hmac>`), y sin esta separación un cambio de
 * forma en cualquiera de los dos ids podría hacer que un token válido para uno se leyera como
 * válido para el otro.
 *
 * Formato del token: `<mostradorId>.<firma>`. No lleva vencimiento a propósito: la sesión del
 * mostrador dura todo el turno y expirarla a mitad de una venta sería peor que el riesgo que
 * evita.
 */
const DOMINIO_FIRMA = 'mostrador:v1:';

function firma(mostradorId: string): string {
  return createHmac('sha256', getEnv().BUFFET_API_KEY).update(DOMINIO_FIRMA + mostradorId).digest('hex');
}

export function firmarTokenMostrador(mostradorId: string): string {
  return `${mostradorId}.${firma(mostradorId)}`;
}

export function verificarTokenMostrador(token: string | undefined): string | null {
  if (!token) return null;
  const corte = token.lastIndexOf('.');
  if (corte < 1) return null;
  const id = token.slice(0, corte);
  const dada = Buffer.from(token.slice(corte + 1));
  const esperada = Buffer.from(firma(id));
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  return id;
}

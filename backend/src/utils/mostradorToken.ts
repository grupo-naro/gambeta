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
 * Formato: `<mostradorId>.<firma>`. No lleva vencimiento a propósito: la sesión del mostrador
 * dura todo el turno y expirarla a mitad de una venta sería peor que el riesgo que evita.
 */
function firma(mostradorId: string): string {
  return createHmac('sha256', getEnv().BUFFET_API_KEY).update(mostradorId).digest('hex');
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

import 'server-only';
import { parseApiError } from './api';
import { ApiError } from './types';
import { tokenMostradorDeSesion } from './buffet-session';

/**
 * Cabeceras de una llamada del mostrador.
 *
 * `x-mostrador` se omite cuando no hay sesión, no se manda vacío: `/buffet/pin/verificar` se
 * llama justamente antes de que exista una, y usa `authBuffet`, que no lo pide. Un header
 * vacío haría que `authMostrador` lo rechace como token inválido.
 */
export function cabecerasBuffet(
  key: string,
  tokenMostrador: string | null,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-buffet-key': key,
    ...(tokenMostrador ? { 'x-mostrador': tokenMostrador } : {}),
    ...extra,
  };
}

/** Llama al backend con la llave del buffet. La key vive solo en el server. */
export async function buffetFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.API_URL;
  const key = process.env.BUFFET_API_KEY;
  if (!base) throw new Error('API_URL no configurada');
  if (!key) throw new Error('BUFFET_API_KEY no configurada');

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: cabecerasBuffet(key, await tokenMostradorDeSesion(), (init.headers ?? {}) as Record<string, string>),
    cache: 'no-store',
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, parseApiError(body, res.status));
  return body as T;
}

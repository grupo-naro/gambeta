import 'server-only';
import { parseApiError } from './api';
import { ApiError, ApiAuthError } from './types';
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
  // Igual que `apiFetch`: un 401 no es "no se pudo cargar", es "el token murió" — un mostrador
  // desactivado o una rotación de BUFFET_API_KEY dejan la cookie del dispositivo firmada y
  // vigente pero inválida contra el backend. Distinguirlo permite mandar al PIN en vez de al
  // error.tsx genérico. El body se lee ANTES de tirar el error: si no, se pierde el motivo que
  // mandó el backend y las actions (`cobrar`, `abrirCaja`, etc) terminan mostrando un
  // "No autorizado" genérico en vez del mensaje real.
  if (res.status === 401) throw new ApiAuthError(parseApiError(body, res.status));
  if (!res.ok) throw new ApiError(res.status, parseApiError(body, res.status));
  return body as T;
}

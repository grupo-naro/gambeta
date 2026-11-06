import 'server-only';
import { cookies } from 'next/headers';
import { ApiError, ApiAuthError } from './types';

export const TOKEN_COOKIE = 'token';
/** Desbloqueo del dashboard (PIN): lo guarda `desbloquearDashboard` y `apiFetch` lo reenvía al backend. */
export const DASHBOARD_UNLOCK_COOKIE = 'dash_unlock';

export function parseApiError(body: unknown, status: number): string {
  const msg = (body as { error?: { message?: string } } | null)?.error?.message;
  if (msg) return msg;
  if (status >= 500) return 'Error del servidor. Probá de nuevo en un rato.';
  return 'No se pudo completar la solicitud.';
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  // `cookies()` va ANTES del chequeo de API_URL a propósito: leerlo marca la ruta como
  // dinámica y saca a las páginas del panel del prerender de `next build`, donde API_URL no
  // existe. Si el `throw` corriera primero, el build las intentaría prerenderizar y explotaría.
  const jar = await cookies();
  const token = jar.get(TOKEN_COOKIE)?.value;
  const desbloqueo = jar.get(DASHBOARD_UNLOCK_COOKIE)?.value;
  const base = process.env.API_URL;
  if (!base) throw new Error('API_URL no configurada');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(desbloqueo ? { 'x-dashboard-unlock': desbloqueo } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401) throw new ApiAuthError();
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, parseApiError(body, res.status));
  return body as T;
}

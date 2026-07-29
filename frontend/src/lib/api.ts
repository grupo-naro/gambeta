import 'server-only';
import { cookies } from 'next/headers';
import { ApiError, ApiAuthError } from './types';

export const TOKEN_COOKIE = 'token';

export function parseApiError(body: unknown, status: number): string {
  const msg = (body as { error?: { message?: string } } | null)?.error?.message;
  if (msg) return msg;
  if (status >= 500) return 'Error del servidor. Probá de nuevo en un rato.';
  return 'No se pudo completar la solicitud.';
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.API_URL;
  if (!base) throw new Error('API_URL no configurada');
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

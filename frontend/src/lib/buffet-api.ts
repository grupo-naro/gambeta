import 'server-only';
import { parseApiError } from './api';
import { ApiError } from './types';

/** Llama al backend con la llave del buffet. La key vive solo en el server. */
export async function buffetFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.API_URL;
  const key = process.env.BUFFET_API_KEY;
  if (!base) throw new Error('API_URL no configurada');
  if (!key) throw new Error('BUFFET_API_KEY no configurada');

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-buffet-key': key, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, parseApiError(body, res.status));
  return body as T;
}

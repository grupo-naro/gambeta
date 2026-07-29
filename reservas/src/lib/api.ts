import 'server-only';

export async function apiReservas<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.API_URL;
  const key = process.env.SERVICE_API_KEY;
  if (!base) throw new Error('API_URL no configurada');
  if (!key) throw new Error('SERVICE_API_KEY no configurada');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(msg ?? (res.status >= 500 ? 'Error del servidor. Probá de nuevo.' : 'No se pudo completar la solicitud.'));
  }
  return body as T;
}

'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { apiFetch, DASHBOARD_UNLOCK_COOKIE } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };
const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Error inesperado');

/**
 * Pide al backend el desbloqueo con el PIN y lo guarda en una cookie httpOnly que vence con él
 * (15 minutos). El navegador nunca ve el token: `apiFetch` lo reenvía solo en cada pedido.
 */
export async function desbloquearDashboard(pin: string): Promise<Result> {
  try {
    const r = await apiFetch<{ token: string; expiraEn: string }>('/config/dashboard-pin/verificar', {
      method: 'POST', body: JSON.stringify({ pin }),
    });
    (await cookies()).set(DASHBOARD_UNLOCK_COOKIE, r.token, {
      httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production',
      expires: new Date(r.expiraEn),
    });
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

/** Vuelve a ocultar los números ya mismo, sin esperar a que venza el desbloqueo. */
export async function bloquearDashboard(): Promise<Result> {
  (await cookies()).delete(DASHBOARD_UNLOCK_COOKIE);
  revalidatePath('/dashboard');
  return { ok: true };
}

/** Pone o cambia el PIN. Si ya había uno hay que mandar el actual. */
export async function fijarPinDashboard(pin: string, pinActual?: string): Promise<Result> {
  try {
    await apiFetch('/config/dashboard-pin', { method: 'PUT', body: JSON.stringify({ pin, pinActual: pinActual || undefined }) });
    (await cookies()).delete(DASHBOARD_UNLOCK_COOKIE);
    revalidatePath('/configuracion');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

export async function quitarPinDashboard(pinActual: string): Promise<Result> {
  try {
    await apiFetch('/config/dashboard-pin/quitar', { method: 'POST', body: JSON.stringify({ pinActual }) });
    (await cookies()).delete(DASHBOARD_UNLOCK_COOKIE);
    revalidatePath('/configuracion');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

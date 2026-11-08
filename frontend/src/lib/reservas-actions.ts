'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { Slot } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath('/reservas');
    revalidatePath('/calendario');
    revalidatePath('/hoy');
    return { ok: true };
  }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

// NOTE: this file is a 'use server' module, so every EXPORT must be an `async function`
// (Next's RSC compiler rejects non-async exports here, even though tsc/lint accept them).
export async function cancelarReserva(id: string): Promise<Result> {
  return run(() => apiFetch(`/reservas/${id}/cancelar`, { method: 'PATCH' }));
}

export async function aprobarSena(id: string): Promise<Result> {
  return run(() => apiFetch(`/reservas/${id}/aprobar-sena`, { method: 'PATCH', body: '{}' }));
}

export async function rechazarSena(id: string): Promise<Result> {
  return run(() => apiFetch(`/reservas/${id}/rechazar-sena`, { method: 'PATCH' }));
}

export async function reprogramarReserva(id: string, fecha: string, horaInicio: string): Promise<Result> {
  return run(() => apiFetch(`/reservas/${id}/reprogramar`, { method: 'PATCH', body: JSON.stringify({ fecha, horaInicio }) }));
}

// Editar una reserva suelta: alargar/acortar, monto total y nota. Solo viaja lo que cambió.
export async function editarReserva(id: string, cambios: { duracionMin?: number; monto?: number; notas?: string }): Promise<Result> {
  return run(() => apiFetch(`/reservas/${id}/editar`, { method: 'PATCH', body: JSON.stringify(cambios) }));
}

/** Precio de la tarifa para otra duración de esta reserva; null si no se pudo calcular. */
export async function getPrecioSugerido(id: string, duracionMin: number): Promise<number | null> {
  try { return (await apiFetch<{ monto: number }>(`/reservas/${id}/precio-sugerido?duracionMin=${duracionMin}`)).monto; }
  catch { return null; }
}

export async function getDisponibilidad(canchaId: string, fecha: string): Promise<Slot[]> {
  try { const r = await apiFetch<{ slots: Slot[] }>(`/disponibilidad?canchaId=${canchaId}&fecha=${fecha}`); return r.slots ?? []; }
  catch { return []; }
}

// No usa el helper run(): necesita devolver el flag cobroOmitido (ver materializarFijo en
// fijos-actions.ts, mismo motivo). Revalida las mismas rutas que run() de este archivo.
export async function crearReserva(input: { canchaId: string; whatsapp: string; nombreCliente: string; fecha: string; horaInicio: string; duracionMin?: number; cobroInicial: 'ninguno' | 'sena' | 'total'; medioCobro: 'EFECTIVO' | 'TRANSFERENCIA'; montoCobro?: number; montoFinal?: number; notas?: string }): Promise<{ ok: true; cobroOmitido?: boolean } | { ok: false; error: string }> {
  try {
    const data = await apiFetch<{ cobroOmitido?: boolean }>('/reservas', { method: 'POST', body: JSON.stringify({ ...input, esContacto: false, nombreConfirmado: true }) });
    revalidatePath('/reservas');
    revalidatePath('/calendario');
    revalidatePath('/hoy');
    revalidatePath('/disponibilidad');
    return { ok: true, cobroOmitido: data.cobroOmitido };
  }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

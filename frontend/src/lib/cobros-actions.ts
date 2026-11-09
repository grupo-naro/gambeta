'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { CobrosReserva, MedioPago } from './types';
import type { MesesBloqueo } from './meses-bloqueo';

type Result = { ok: true } | { ok: false; error: string };
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/reservas'); revalidatePath('/caja'); revalidatePath('/turnos-fijos'); revalidatePath('/bloqueos'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function getCobros(reservaId: string): Promise<CobrosReserva> {
  return apiFetch<CobrosReserva>(`/reservas/${reservaId}/cobros`);
}
export async function registrarCobro(reservaId: string, input: { monto: number; medio: MedioPago }): Promise<Result> {
  return run(() => apiFetch(`/reservas/${reservaId}/cobros`, { method: 'POST', body: JSON.stringify(input) }));
}
// Cobros del abono de un turno fijo: misma forma que los de una reserva (total, pagado, saldo).
export async function getCobrosFijo(fijoId: string): Promise<CobrosReserva> {
  return apiFetch<CobrosReserva>(`/turnos-fijos/${fijoId}/cobros`);
}
export async function registrarCobroFijo(fijoId: string, input: { monto: number; medio: MedioPago }): Promise<Result> {
  return run(() => apiFetch(`/turnos-fijos/${fijoId}/cobros`, { method: 'POST', body: JSON.stringify(input) }));
}
// Cobros de un evento (bloqueo con valor): misma forma que los de una reserva.
// En un entrenamiento recurrente el valor es mensual: `mes` ('YYYY-MM') elige el mes.
export async function getCobrosBloqueo(bloqueoId: string, mes?: string | null): Promise<CobrosReserva> {
  return apiFetch<CobrosReserva>(`/bloqueos/${bloqueoId}/cobros${mes ? `?mes=${mes}` : ''}`);
}
// Los meses de un entrenamiento recurrente (5 atrás a 1 adelante, dentro de su período) con lo cobrado de cada uno.
export async function getMesesBloqueo(bloqueoId: string): Promise<MesesBloqueo> {
  return apiFetch<MesesBloqueo>(`/bloqueos/${bloqueoId}/meses`);
}
export async function registrarCobroBloqueo(bloqueoId: string, input: { monto: number; medio: MedioPago; mes?: string }): Promise<Result> {
  return run(() => apiFetch(`/bloqueos/${bloqueoId}/cobros`, { method: 'POST', body: JSON.stringify(input) }));
}
export async function anularCobro(id: string): Promise<Result> {
  return run(() => apiFetch(`/cobros/${id}`, { method: 'DELETE' }));
}

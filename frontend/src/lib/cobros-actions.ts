'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { CobrosReserva, MedioPago } from './types';
import type { ClasesBloqueo } from './clases-bloqueo';

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
// En un entrenamiento recurrente el valor es por clase: `fecha` ('YYYY-MM-DD') elige la clase.
export async function getCobrosBloqueo(bloqueoId: string, fecha?: string | null): Promise<CobrosReserva> {
  return apiFetch<CobrosReserva>(`/bloqueos/${bloqueoId}/cobros${fecha ? `?fecha=${fecha}` : ''}`);
}
// Las clases de un entrenamiento recurrente (5 semanas atrás a 2 adelante) con lo cobrado de cada una.
export async function getClasesBloqueo(bloqueoId: string): Promise<ClasesBloqueo> {
  return apiFetch<ClasesBloqueo>(`/bloqueos/${bloqueoId}/clases`);
}
export async function registrarCobroBloqueo(bloqueoId: string, input: { monto: number; medio: MedioPago; fecha?: string }): Promise<Result> {
  return run(() => apiFetch(`/bloqueos/${bloqueoId}/cobros`, { method: 'POST', body: JSON.stringify(input) }));
}
export async function anularCobro(id: string): Promise<Result> {
  return run(() => apiFetch(`/cobros/${id}`, { method: 'DELETE' }));
}

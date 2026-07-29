'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { CobrosReserva, MedioPago } from './types';

type Result = { ok: true } | { ok: false; error: string };
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/reservas'); revalidatePath('/caja'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function getCobros(reservaId: string): Promise<CobrosReserva> {
  return apiFetch<CobrosReserva>(`/reservas/${reservaId}/cobros`);
}
export async function registrarCobro(reservaId: string, input: { monto: number; medio: MedioPago }): Promise<Result> {
  return run(() => apiFetch(`/reservas/${reservaId}/cobros`, { method: 'POST', body: JSON.stringify(input) }));
}
export async function anularCobro(id: string): Promise<Result> {
  return run(() => apiFetch(`/cobros/${id}`, { method: 'DELETE' }));
}

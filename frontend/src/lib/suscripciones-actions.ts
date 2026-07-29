'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

// Una suscripción afecta lo que se ve en /socios y el chip de pago de las reservas del socio.
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath('/socios');
    revalidatePath('/reservas');
    revalidatePath('/caja');
    return { ok: true };
  }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

type AltaInput = { clienteId: string; inicio: string; vencimiento: string; precio?: number; medio?: 'EFECTIVO' | 'TRANSFERENCIA'; nota?: string };

// NOTE: este archivo es 'use server', así que TODOS los exports tienen que ser `async function`.
export async function crearSuscripcion(i: AltaInput): Promise<Result> {
  return run(() => apiFetch('/suscripciones', { method: 'POST', body: JSON.stringify(i) }));
}

export async function renovarSuscripcion(id: string, i: { precio?: number; medio?: 'EFECTIVO' | 'TRANSFERENCIA' }): Promise<Result> {
  return run(() => apiFetch(`/suscripciones/${id}/renovar`, { method: 'POST', body: JSON.stringify(i) }));
}

export async function cancelarSuscripcion(id: string): Promise<Result> {
  return run(() => apiFetch(`/suscripciones/${id}/cancelar`, { method: 'PATCH' }));
}

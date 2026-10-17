'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath('/bloqueos');
    revalidatePath('/calendario');
    revalidatePath('/hoy');
    return { ok: true };
  }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

type BloqueoInput = { canchaId: string; motivo: string; recurrente: boolean; diaSemana?: number; fecha?: string; horaInicio: string; horaFin: string; nota?: string;
  // Período de un bloqueo recurrente ('YYYY-MM-DD', inclusivo). Cada extremo es opcional.
  vigenciaDesde?: string; vigenciaHasta?: string };

export async function crearBloqueo(i: BloqueoInput): Promise<Result> {
  return run(() => apiFetch('/bloqueos', { method: 'POST', body: JSON.stringify(i) }));
}

export async function eliminarBloqueo(id: string): Promise<Result> {
  return run(() => apiFetch(`/bloqueos/${id}`, { method: 'DELETE' }));
}

export async function agregarExcepcionBloqueo(id: string, fecha: string): Promise<Result> {
  return run(() => apiFetch(`/bloqueos/${id}/excepciones`, { method: 'POST', body: JSON.stringify({ fecha }) }));
}

export async function quitarExcepcionBloqueo(id: string, fecha: string): Promise<Result> {
  return run(() => apiFetch(`/bloqueos/${id}/excepciones/${fecha}`, { method: 'DELETE' }));
}

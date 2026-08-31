'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError, type Config } from './types';

type Result = { ok: true; config: Config } | { ok: false; error: string };

export async function guardarConfig(patch: Record<string, unknown>): Promise<Result> {
  try {
    // El PATCH devuelve la config ya persistida. Se la pasamos de vuelta al form para que pueda
    // repoblar los campos que el admin haya vaciado (y que por lo tanto no viajaron en el patch):
    // si no, el toast dice "guardada" pero el input queda vacío mostrando algo que no es lo real.
    const config = await apiFetch<Config>('/config', { method: 'PATCH', body: JSON.stringify(patch) });
    revalidatePath('/configuracion');
    return { ok: true, config };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

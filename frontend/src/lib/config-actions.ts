'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

export async function guardarConfig(patch: Record<string, unknown>): Promise<Result> {
  try {
    await apiFetch('/config', { method: 'PATCH', body: JSON.stringify(patch) });
    revalidatePath('/configuracion');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

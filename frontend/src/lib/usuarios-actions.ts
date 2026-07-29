'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { Rol } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/usuarios'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function crearUsuario(input: { email: string; nombre: string; password: string; rol: Rol; duracionDias?: 1 | 2 | 7 | 30 }): Promise<Result> {
  return run(() => apiFetch('/usuarios', { method: 'POST', body: JSON.stringify(input) }));
}

export async function cambiarExpiracionUsuario(id: string, duracionDias: 1 | 2 | 7 | 30 | null): Promise<Result> {
  return run(() => apiFetch(`/usuarios/${id}/expiracion`, { method: 'PATCH', body: JSON.stringify({ duracionDias }) }));
}

export async function cambiarRolUsuario(id: string, rol: Rol): Promise<Result> {
  return run(() => apiFetch(`/usuarios/${id}/rol`, { method: 'PATCH', body: JSON.stringify({ rol }) }));
}

export async function eliminarUsuario(id: string): Promise<Result> {
  return run(() => apiFetch(`/usuarios/${id}`, { method: 'DELETE' }));
}

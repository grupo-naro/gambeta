'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import { aCanonico } from '@/lib/whatsapp';

type Result = { ok: true } | { ok: false; error: string };
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/clientes'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function editarConfianza(id: string, confiable: boolean): Promise<Result> {
  return run(() => apiFetch(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify({ confiable }) }));
}
export async function editarNombreCliente(id: string, nombre: string): Promise<Result> {
  return run(() => apiFetch(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify({ nombre }) }));
}
export async function editarWhatsappCliente(id: string, whatsapp: string): Promise<Result> {
  return run(() => apiFetch(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify({ whatsapp }) }));
}
export async function eliminarCliente(id: string): Promise<Result> {
  return run(() => apiFetch(`/clientes/${id}`, { method: 'DELETE' }));
}
export async function crearCliente(input: { nombre: string; whatsapp: string; confiable: boolean }): Promise<Result> {
  return run(() => apiFetch('/clientes', { method: 'POST', body: JSON.stringify({ ...input, nombreConfirmado: true }) }));
}
export async function buscarClientePorWhatsapp(whatsapp: string): Promise<{ id: string; nombre: string } | null> {
  const canon = aCanonico(whatsapp);
  if (!canon) return null;
  try {
    const c = await apiFetch<{ id: string; nombre: string } | null>(`/clientes/buscar?whatsapp=${encodeURIComponent(canon)}`);
    return c ? { id: c.id, nombre: c.nombre } : null;
  } catch {
    return null;
  }
}

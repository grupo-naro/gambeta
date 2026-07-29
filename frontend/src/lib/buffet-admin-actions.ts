'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath('/buffet');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

type ProductoInput = {
  nombre: string; codigoBarra?: string | null; precio: number;
  stock?: number; stockMinimo?: number; enBotonera?: boolean; orden?: number; activo?: boolean;
};

export async function crearProducto(i: ProductoInput): Promise<Result> {
  return run(() => apiFetch('/buffet/productos', { method: 'POST', body: JSON.stringify(i) }));
}

export async function actualizarProducto(id: string, i: Partial<ProductoInput>): Promise<Result> {
  return run(() => apiFetch(`/buffet/productos/${id}`, { method: 'PATCH', body: JSON.stringify(i) }));
}

export async function reponerStock(id: string, cantidad: number): Promise<Result> {
  return run(() => apiFetch(`/buffet/productos/${id}/reponer`, { method: 'POST', body: JSON.stringify({ cantidad }) }));
}

export async function setPinBuffet(pin: string): Promise<Result> {
  return run(() => apiFetch('/buffet/pin', { method: 'PUT', body: JSON.stringify({ pin }) }));
}

'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath('/alquileres');
    revalidatePath('/alquileres/movimientos');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

type ArticuloInput = { nombre: string; precio: number; stock?: number; orden?: number; activo?: boolean };

export async function crearArticulo(i: ArticuloInput): Promise<Result> {
  return run(() => apiFetch('/alquileres/articulos', { method: 'POST', body: JSON.stringify(i) }));
}

export async function actualizarArticulo(id: string, i: Partial<ArticuloInput>): Promise<Result> {
  return run(() => apiFetch(`/alquileres/articulos/${id}`, { method: 'PATCH', body: JSON.stringify(i) }));
}

/** `cantidad` puede ser negativa: sirve para dar de baja una unidad rota sin alquiler de por medio. */
export async function ajustarStockArticulo(id: string, cantidad: number): Promise<Result> {
  return run(() => apiFetch(`/alquileres/articulos/${id}/reponer`, { method: 'POST', body: JSON.stringify({ cantidad }) }));
}

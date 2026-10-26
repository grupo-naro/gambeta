'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/canchas'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

type CanchaInput = { nombre: string; tipo: string; precioHora: number; jugadores: number; destacada: boolean; precioHoraPico: number; turnoBloqueMin?: number | null; turnoDesfaseMin?: number };

export async function crearCancha(input: CanchaInput): Promise<Result> {
  return run(() => apiFetch('/canchas', { method: 'POST', body: JSON.stringify(input) }));
}

export async function editarCancha(id: string, input: CanchaInput): Promise<Result> {
  return run(() => apiFetch(`/canchas/${id}`, { method: 'PATCH', body: JSON.stringify(input) }));
}

export async function setActivaCancha(id: string, activa: boolean): Promise<Result> {
  return run(() => apiFetch(`/canchas/${id}/activa`, { method: 'PATCH', body: JSON.stringify({ activa }) }));
}

export async function eliminarCancha(id: string): Promise<Result> {
  return run(() => apiFetch(`/canchas/${id}`, { method: 'DELETE' }));
}

export async function crearCanchaDivisible(input: { nombre: string; partes: number; precioEntera: number; precioParte: number; jugadoresEntera: number; jugadoresParte: number }): Promise<Result> {
  return run(() => apiFetch('/canchas/divisible', { method: 'POST', body: JSON.stringify(input) }));
}

/** Escalona las canchas de pádel (corre el primer turno de cada una 30 min) o, con `quitar`, las deja todas desde la apertura. */
export async function escalonarPadel(quitar: boolean): Promise<Result> {
  return run(() => apiFetch('/canchas/escalonar-padel', { method: 'POST', body: JSON.stringify({ quitar, pasoMin: 30 }) }));
}

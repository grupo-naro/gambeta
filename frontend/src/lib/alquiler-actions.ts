'use server';
import { buffetFetch } from './buffet-api';
import { requireSesionBuffet } from './buffet-session';
import { ApiError } from './types';
import type { Alquiler, EntregaAlquilerResultado, EstadoCierreAlquiler, MedioPago } from './types';
import type { Resultado } from './buffet-actions';

async function conSesion<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    await requireSesionBuffet();
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

export async function entregarAlquiler(input: {
  uid: string; articuloId: string; cantidad: number;
  quienRetira: string; garantia: string | null;
  medioPago: MedioPago; montoPagado: number;
}): Promise<Resultado<EntregaAlquilerResultado>> {
  return conSesion(() => buffetFetch<EntregaAlquilerResultado>('/alquileres/entregas', {
    method: 'POST', body: JSON.stringify(input),
  }));
}

export async function cerrarAlquiler(id: string, estado: EstadoCierreAlquiler): Promise<Resultado<Alquiler>> {
  return conSesion(() => buffetFetch<Alquiler>(`/alquileres/${encodeURIComponent(id)}/cerrar`, {
    method: 'POST', body: JSON.stringify({ estado }),
  }));
}

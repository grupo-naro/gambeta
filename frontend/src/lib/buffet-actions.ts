'use server';
import { buffetFetch } from './buffet-api';
import { crearSesionBuffet, requireSesionBuffet } from './buffet-session';
import { ApiError } from './types';
import type { CajaBuffetEstado, CierreBuffet, MedioPago, CobroResultado, ProductoCobro } from './types';

export async function verificarPin(pin: string): Promise<{ ok: boolean }> {
  try {
    const r = await buffetFetch<{ ok: boolean }>('/buffet/pin/verificar', {
      method: 'POST', body: JSON.stringify({ pin }),
    });
    if (r.ok) await crearSesionBuffet();
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

async function conSesion<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    await requireSesionBuffet();
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

export async function abrirCaja(): Promise<Resultado<CajaBuffetEstado>> {
  return conSesion(() => buffetFetch<CajaBuffetEstado>('/buffet/caja/abrir', { method: 'POST' }));
}

export async function cerrarCaja(): Promise<Resultado<CierreBuffet>> {
  return conSesion(() => buffetFetch<CierreBuffet>('/buffet/caja/cerrar', { method: 'POST' }));
}

export async function buscarPorCodigo(codigoBarra: string): Promise<Resultado<ProductoCobro>> {
  return conSesion(() => buffetFetch<ProductoCobro>(`/buffet/producto?codigoBarra=${encodeURIComponent(codigoBarra)}`));
}

export async function cobrar(input: { uid: string; medioPago: MedioPago; montoPagado: number; items: { productoId: string; cantidad: number }[] }): Promise<Resultado<CobroResultado>> {
  return conSesion(() => buffetFetch<CobroResultado>('/buffet/cobrar', { method: 'POST', body: JSON.stringify(input) }));
}

'use server';
import { buffetFetch } from './buffet-api';
import { crearSesionBuffet, borrarSesionBuffet, requireSesionBuffet } from './buffet-session';
import { ApiError } from './types';
import type { CajaBuffetEstado, CierreBuffet, MedioPago, CobroResultado, ProductoCobro, MostradorIdentificado } from './types';

/**
 * El PIN ya no dice solo "sí o no": dice QUÉ mostrador es. El token que devuelve el backend
 * se guarda en la cookie firmada y viaja después en `x-mostrador`, que es lo que permite
 * saber quién vendió a la hora de conciliar el cierre.
 */
export async function verificarPin(pin: string): Promise<{ ok: boolean }> {
  try {
    const r = await buffetFetch<MostradorIdentificado>('/buffet/pin/verificar', {
      method: 'POST', body: JSON.stringify({ pin }),
    });
    if (!r?.token) return { ok: false };
    await crearSesionBuffet({ token: r.token, nombre: r.nombre, tipo: r.tipo });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Cierra la sesión del puesto. Sirve para corregir un PIN puesto en el mostrador equivocado. */
export async function salirDelMostrador(): Promise<void> {
  await borrarSesionBuffet();
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

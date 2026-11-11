'use server';
import { revalidatePath } from 'next/cache';
import { buffetFetch } from './buffet-api';
import { crearSesionBuffet, borrarSesionBuffet, requireSesionBuffet } from './buffet-session';
import { ApiError } from './types';
import type { CuentaBuffet, CanchaMostrador, RendirCuentaResultado, CajaBuffetEstado, CierreBuffet, MedioPago, CobroResultado, ProductoCobro, MostradorIdentificado, LineaConciliacion } from './types';

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

export async function entregarStock(items: { productoId: string; cantidad: number }[], puestoId: string): Promise<Resultado<{ entregaId: string }>> {
  return conSesion(() => buffetFetch<{ entregaId: string }>('/buffet/entregas', {
    method: 'POST', body: JSON.stringify({ items, puestoId }),
  }));
}

// Le baja a un puesto (el secundario) parte de su cupo (lo devuelve al principal). Manual: nada vuelve solo.
export async function devolverStock(items: { productoId: string; cantidad: number }[], puestoId: string): Promise<Resultado<{ entregaId: string }>> {
  return conSesion(() => buffetFetch<{ entregaId: string }>('/buffet/devoluciones', {
    method: 'POST', body: JSON.stringify({ items, puestoId }),
  }));
}

export async function conciliarCaja(
  cajaId: string,
  conteos: { productoId: string; contado: number }[],
): Promise<Resultado<{ lineas: (LineaConciliacion & { contado: number; diferencia: number })[] }>> {
  return conSesion(() => buffetFetch<{ lineas: (LineaConciliacion & { contado: number; diferencia: number })[] }>(
    `/buffet/cajas/${encodeURIComponent(cajaId)}/conciliacion`,
    { method: 'POST', body: JSON.stringify({ conteos }) },
  ));
}

// --- Cuentas por cancha ---
// Cada cuenta que cambia revalida la lista: la pantalla de cuentas se arma en el servidor.
const jsonPost = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

async function conCuentas<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  const r = await conSesion(fn);
  if (r.ok) revalidatePath('/mostrador/cuentas');
  return r;
}

export async function getCanchasMostrador(): Promise<Resultado<CanchaMostrador[]>> {
  return conSesion(() => buffetFetch<CanchaMostrador[]>('/buffet/canchas'));
}

export async function abrirCuenta(canchaId: string): Promise<Resultado<CuentaBuffet>> {
  return conCuentas(() => buffetFetch<CuentaBuffet>('/buffet/cuentas', jsonPost({ canchaId })));
}

/** Deja el consumo de un producto en `cantidad` (absoluta; 0 lo quita). Reintentar da el mismo resultado. */
export async function fijarConsumo(cuentaId: string, productoId: string, cantidad: number): Promise<Resultado<CuentaBuffet>> {
  return conCuentas(() => buffetFetch<CuentaBuffet>(
    `/buffet/cuentas/${encodeURIComponent(cuentaId)}/lineas/${encodeURIComponent(productoId)}`,
    { method: 'PUT', body: JSON.stringify({ cantidad }) },
  ));
}

export async function rendirCuenta(cuentaId: string, medioPago: MedioPago, montoPagado: number): Promise<Resultado<RendirCuentaResultado>> {
  return conCuentas(() => buffetFetch<RendirCuentaResultado>(`/buffet/cuentas/${encodeURIComponent(cuentaId)}/rendir`, jsonPost({ medioPago, montoPagado })));
}

export async function cancelarCuenta(cuentaId: string): Promise<Resultado<CuentaBuffet>> {
  return conCuentas(() => buffetFetch<CuentaBuffet>(`/buffet/cuentas/${encodeURIComponent(cuentaId)}/cancelar`, jsonPost()));
}

export async function cuentaImpaga(cuentaId: string): Promise<Resultado<CuentaBuffet>> {
  return conCuentas(() => buffetFetch<CuentaBuffet>(`/buffet/cuentas/${encodeURIComponent(cuentaId)}/impaga`, jsonPost()));
}

import type { CuentaBuffet, EstadoCuentaBuffet, MedioPago } from '@/lib/types';

/** Tope que acepta el backend por producto en una cuenta (ver `fijarCantidadSchema`). */
export const MAX_CONSUMO = 999;

/** Cuánto de un producto hay ya cargado en la cuenta. */
export function cantidadDe(cuenta: Pick<CuentaBuffet, 'lineas'>, productoId: string): number {
  return cuenta.lineas.find((l) => l.productoId === productoId)?.cantidad ?? 0;
}

/** Sube o baja una cantidad sin salirse de lo que el backend acepta (0..999). */
export function ajustarCantidad(actual: number, delta: number): number {
  return Math.min(MAX_CONSUMO, Math.max(0, actual + delta));
}

/** Mensaje de error si la cuenta no se puede rendir con ese medio y monto; `null` si está bien. */
export function validarRendicion(cuenta: Pick<CuentaBuffet, 'lineas' | 'total'>, medio: MedioPago, pagoTxt: string): string | null {
  if (cuenta.lineas.length === 0) return 'La cuenta está vacía';
  if (medio === 'EFECTIVO' && !(Number(pagoTxt) >= cuenta.total)) return 'El monto es menor al total';
  return null;
}

const ETIQUETAS: Record<EstadoCuentaBuffet, string> = { ABIERTA: 'Abierta', RENDIDA: 'Rendida', CANCELADA: 'Cancelada', IMPAGA: 'Impaga' };
export const etiquetaEstado = (e: EstadoCuentaBuffet): string => ETIQUETAS[e];

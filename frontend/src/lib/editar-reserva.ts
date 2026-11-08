/** Reglas puras de la edición de una reserva suelta (sin red), para poder probarlas solas. */

export interface EstadoEdicion { duracionMin: number; monto: number; notas: string }
export interface CambiosReserva { duracionMin?: number; monto?: number; notas?: string }

/** Minutos que dura una reserva a partir de sus dos instantes ISO. */
export function minutosDeReserva(inicioIso: string, finIso: string): number {
  return Math.round((new Date(finIso).getTime() - new Date(inicioIso).getTime()) / 60000);
}

/** Duraciones que se pueden elegir: de a 30 min hasta 4 h, y la actual aunque no sea múltiplo de 30. */
export function duracionesPosibles(actual: number): number[] {
  const base = Array.from({ length: 8 }, (_, i) => (i + 1) * 30);
  return base.includes(actual) ? base : [...base, actual].sort((a, b) => a - b);
}

/** 30 → "30 min", 60 → "1 h", 90 → "1½ h", 120 → "2 h", 150 → "2½ h". */
export function etiquetaDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  if (resto === 0) return `${h} h`;
  if (resto === 30) return `${h}½ h`;
  return `${h} h ${resto} min`;
}

/**
 * Qué mandar al backend: solo lo que cambió. Devuelve error si el monto no es un número válido o si
 * no hay nada para guardar.
 */
export function cambiosDeEdicion(antes: EstadoEdicion, ahora: EstadoEdicion): { ok: true; cambios: CambiosReserva } | { ok: false; error: string } {
  if (!Number.isFinite(ahora.monto) || ahora.monto < 0) return { ok: false, error: 'El monto tiene que ser un número de 0 o más' };
  const cambios: CambiosReserva = {};
  if (ahora.duracionMin !== antes.duracionMin) cambios.duracionMin = ahora.duracionMin;
  if (ahora.monto !== antes.monto) cambios.monto = ahora.monto;
  if (ahora.notas.trim() !== antes.notas.trim()) cambios.notas = ahora.notas.trim();
  if (Object.keys(cambios).length === 0) return { ok: false, error: 'No cambiaste nada' };
  return { ok: true, cambios };
}

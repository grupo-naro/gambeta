import { normalizeTipo } from './canchas-catalogo';

/** El deporte de una cancha ('futbol', 'padel'…): los tipos viejos como "futbol5" cuentan como fútbol. */
export const deporteDe = (tipo: string): string => normalizeTipo((tipo ?? '').toLowerCase());

export interface FiltroCancha { deporte: string | null; canchaId: string | null }

/**
 * Si una cancha entra en el filtro de la agenda de Hoy. Sin filtro entran todas; con un deporte, solo
 * las de ese deporte; con una cancha puntual, solo esa (la cancha manda sobre el deporte).
 */
export function coincideConFiltro(cancha: { id: string; tipo: string } | undefined, f: FiltroCancha): boolean {
  if (f.canchaId) return cancha?.id === f.canchaId;
  if (f.deporte) return !!cancha && deporteDe(cancha.tipo) === f.deporte;
  return true;
}

/** Los deportes que hay entre las canchas, en el orden de aparición (para armar los botones). */
export function deportesDe(canchas: { tipo: string }[]): string[] {
  return [...new Set(canchas.map((c) => deporteDe(c.tipo)))];
}

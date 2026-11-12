import type { CanchaMostrador } from './types';

export interface BloqueCanchas {
  id: string;
  /** Nombre del grupo, ej. "CANCHA 1". */
  nombre: string;
  /** La cancha entera (la de 9), si está entre las que ve este mostrador. */
  entera: CanchaMostrador | null;
  /** Las partes en que se divide (las de 6), ordenadas por nombre. */
  partes: CanchaMostrador[];
}

/**
 * Ordena las canchas de la pantalla de cuentas: las divisibles se agrupan en un bloque (la entera y
 * sus partes juntas) y las demás (pádel) quedan sueltas. Los bloques salen en el orden de sus nombres.
 */
export function agruparCanchas(canchas: CanchaMostrador[]): { bloques: BloqueCanchas[]; sueltas: CanchaMostrador[] } {
  const porGrupo = new Map<string, BloqueCanchas>();
  const sueltas: CanchaMostrador[] = [];
  for (const c of canchas) {
    if (!c.grupo) { sueltas.push(c); continue; }
    const b = porGrupo.get(c.grupo.id) ?? { id: c.grupo.id, nombre: c.grupo.nombre, entera: null, partes: [] };
    if (c.esEntera) b.entera = c; else b.partes.push(c);
    porGrupo.set(c.grupo.id, b);
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });
  const bloques = [...porGrupo.values()].sort((a, b) => cmp(a.nombre, b.nombre));
  for (const b of bloques) b.partes.sort((x, y) => cmp(x.nombre, y.nombre));
  return { bloques, sueltas };
}

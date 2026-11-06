import type { LineaDiaSecundario } from './types';

/**
 * Con cuánto "arrancó" el secundario ese día: lo que le había quedado más lo que le entregaron,
 * menos lo que se devolvió. Es el número que el admin quiere leer ("arrancó con 30").
 */
export function arrancoCon(l: Pick<LineaDiaSecundario, 'arranco' | 'entregado' | 'devuelto'>): number {
  return l.arranco + l.entregado - l.devuelto;
}

/** De dónde sale ese número, en palabras: "10 de ayer + 20 entregadas − 5 devueltas". */
export function detalleArranque(l: Pick<LineaDiaSecundario, 'arranco' | 'entregado' | 'devuelto'>): string {
  const partes: string[] = [];
  if (l.arranco) partes.push(`${l.arranco} de antes`);
  if (l.entregado) partes.push(`${partes.length ? '+ ' : ''}${l.entregado} entregadas`);
  if (l.devuelto) partes.push(`− ${l.devuelto} devueltas`);
  return partes.join(' ');
}

/** "2026-11-05" → "05/11/2026" sin pasar por Date (no hay corrimiento de zona horaria). */
export function fechaCorta(ymd: string): string {
  return ymd.split('-').reverse().join('/');
}

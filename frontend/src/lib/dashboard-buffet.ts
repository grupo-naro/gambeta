import type { BuffetDia } from './types';

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** '2026-11-08' → "dom 08/11". El día de la semana se calcula en UTC: la fecha es un rótulo, sin hora. */
export function etiquetaDia(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** Ancho (0 a 100) de la barra de un día, contra el día que más vendió del período. */
export function porcentajeBarra(total: number, max: number): number {
  if (max <= 0 || total <= 0) return 0;
  return Math.min(100, Math.round((total / max) * 100));
}

export const maximoDelPeriodo = (dias: BuffetDia[]): number => dias.reduce((m, d) => Math.max(m, d.total), 0);

/** Un día sin ventas se muestra apagado y no se puede abrir. */
export const diaSinVentas = (d: BuffetDia): boolean => d.total === 0 && d.unidades === 0;

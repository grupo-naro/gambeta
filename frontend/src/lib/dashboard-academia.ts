import type { AcademiaEntrenamiento } from './types';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** "Martes 17:00–18:00". */
export function diaYHora(e: Pick<AcademiaEntrenamiento, 'diaSemana' | 'horaInicio' | 'horaFin'>): string {
  const dia = e.diaSemana == null ? '' : `${DIAS[e.diaSemana] ?? ''} `;
  return `${dia}${e.horaInicio}–${e.horaFin}`;
}

/** "1 mes" / "3 meses" (los meses que se deben de un entrenamiento). */
export const textoMeses = (n: number): string => `${n} ${n === 1 ? 'mes' : 'meses'}`;

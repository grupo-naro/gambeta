import type { Bloqueo } from './types';
import type { MesBloqueo } from './meses-bloqueo';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Las clases de la academia: los entrenamientos recurrentes (viven en la misma tabla que los bloqueos). */
export function clasesDeAcademia(bloqueos: Bloqueo[]): Bloqueo[] {
  return bloqueos.filter((b) => b.motivo === 'ENTRENAMIENTO' && b.recurrente);
}

/** El nombre de la clase es su nota ("Clase Nahuel"); sin nota, "Entrenamiento". */
export function nombreClase(b: Pick<Bloqueo, 'nota'>): string {
  return b.nota?.trim() || 'Entrenamiento';
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca por nombre (o cancha), sin importar mayúsculas ni tildes. */
export function filtrarClases(clases: Bloqueo[], texto: string): Bloqueo[] {
  const q = normalizar(texto.trim());
  if (!q) return clases;
  return clases.filter((b) => normalizar(`${nombreClase(b)} ${b.cancha?.nombre ?? ''}`).includes(q));
}

export type EstadoClase =
  | { tipo: 'sin-valor'; texto: string; saldo: number }
  | { tipo: 'pago'; texto: string; saldo: number }
  | { tipo: 'debe'; texto: string; saldo: number }
  | { tipo: 'fuera'; texto: string; saldo: number };

/** Cómo está la clase en el mes actual ('YYYY-MM'): al día, debe, sin valor o fuera de su período. */
export function estadoClase(valor: number | null | undefined, meses: MesBloqueo[] | undefined, mesActual: string): EstadoClase {
  if (valor == null) return { tipo: 'sin-valor', texto: 'Sin valor por mes', saldo: 0 };
  const m = meses?.find((x) => x.mes === mesActual);
  if (!m) return { tipo: 'fuera', texto: 'Fuera de período', saldo: 0 };
  return m.saldo > 0
    ? { tipo: 'debe', texto: `Debe ${money(m.saldo)}`, saldo: m.saldo }
    : { tipo: 'pago', texto: 'Al día', saldo: 0 };
}

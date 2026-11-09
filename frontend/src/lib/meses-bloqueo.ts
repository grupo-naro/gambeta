/** Un mes ('YYYY-MM') de un entrenamiento recurrente, con lo cobrado de ese mes. */
export interface MesBloqueo { mes: string; pagado: number; saldo: number }
export interface MesesBloqueo { valor: number | null; meses: MesBloqueo[] }

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** '2030-05' → "Mayo 2030". */
export function etiquetaMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Cómo se ve cada mes en la lista: pagado o debe lo que falta. */
export function estadoMes(m: MesBloqueo): { texto: string; tono: 'verde' | 'ambar' } {
  return m.saldo > 0 ? { texto: `Debe ${money(m.saldo)}`, tono: 'ambar' } : { texto: 'Pagado', tono: 'verde' };
}

/** Una clase (una fecha) de un entrenamiento recurrente, con lo cobrado de esa fecha. */
export interface ClaseBloqueo { fecha: string; liberada: boolean; pagado: number; saldo: number }
export interface ClasesBloqueo { valor: number | null; clases: ClaseBloqueo[] }

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** '2030-05-10' → "Vie 10/05". El día se calcula en UTC: la fecha es un rótulo, sin hora. */
export function etiquetaClase(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dia} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Cómo se ve cada clase en la lista: pagada, debe lo que falta, o liberada. */
export function estadoClase(c: ClaseBloqueo): { texto: string; tono: 'verde' | 'ambar' | 'gris' } {
  if (c.liberada) return { texto: 'Liberada', tono: 'gris' };
  if (c.saldo > 0) return { texto: `Debe ${money(c.saldo)}`, tono: 'ambar' };
  return { texto: 'Pagado', tono: 'verde' };
}

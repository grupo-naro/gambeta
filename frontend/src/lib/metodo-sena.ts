import type { MetodoSena } from './types';

const ETIQUETAS: Record<MetodoSena, string> = {
  MERCADO_PAGO: 'Mercado Pago',
  TRANSFERENCIA: 'Transferencia',
};

/**
 * Cómo dijo el cliente que iba a pagar la seña, para mostrar en el panel.
 *
 * Devuelve `null` cuando no hay método: las reservas que carga el staff y las anteriores a
 * este campo no eligieron nada, y poner una etiqueta por defecto le haría creer al staff
 * que va a llegar un pago que nadie prometió.
 */
export function etiquetaMetodoSena(metodo: MetodoSena | null | undefined): string | null {
  return metodo ? ETIQUETAS[metodo] : null;
}

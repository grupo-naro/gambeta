import { BusinessRule } from '../utils/errors.js';

/**
 * Reglas puras del pago del abono de un turno fijo. Sin base de datos, para testearlas solas.
 *
 * El abono tiene un monto total (`montoAbono`) y se puede pagar en partes: lo cobrado es la suma
 * de los cobros del fijo, y el saldo es lo que falta. Igual que una reserva con seña.
 */

/**
 * Cuánto se cobra en el momento del alta. Sin abono no hay nada que cobrar; con abono y sin
 * `montoPagado` se asume que pagó todo (así se comportaba el alta antes de existir el pago parcial,
 * y es lo que esperan los clientes viejos de la API); con `montoPagado` es ese monto, incluso 0.
 */
export function pagoInicialAbono(montoAbono: number | undefined, montoPagado: number | undefined): number {
  if (montoAbono == null) return 0;
  return montoPagado ?? montoAbono;
}

const plata = (n: number) => '$' + n.toLocaleString('es-AR');

/** Un cobro nuevo no puede superar lo que falta pagar: casi siempre es un error de tipeo. */
export function assertPagoDentroDelSaldo(montoAbono: number, yaPagado: number, nuevo: number): void {
  const saldo = Math.max(0, montoAbono - yaPagado);
  if (nuevo > saldo) {
    throw BusinessRule(
      saldo === 0
        ? 'El abono ya está pago por completo'
        : `El pago supera el saldo del abono: faltan ${plata(saldo)}`,
    );
  }
}

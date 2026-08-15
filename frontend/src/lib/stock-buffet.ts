/** Lo mínimo que hace falta para decidir si hay que reponer. */
type ConStock = { stock: number; asignado: number; stockMinimo: number; activo: boolean };

/**
 * Todo lo que hay en el complejo: el general más lo que está en el secundario.
 *
 * `stock` es el general, y las unidades entregadas al secundario SALIERON de ahí, así que mirar
 * solo ese campo cuenta de menos.
 */
export function stockTotal(p: ConStock): number {
  return p.stock + p.asignado;
}

/**
 * Si hay que reponer comprando.
 *
 * Mide el total y no el general a propósito: la alerta existe para disparar una compra, y las
 * unidades que están en el otro mostrador ya se compraron.
 */
export function estaBajo(p: ConStock): boolean {
  return p.activo && stockTotal(p) <= p.stockMinimo;
}

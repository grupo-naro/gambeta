/** Lo mínimo que hace falta para decidir si hay que reponer. */
type ConStock = { stock: number; asignado: number; stockMinimo: number; activo: boolean };

/**
 * Todo lo que hay en el complejo. `stock` ya es el total: lo asignado al secundario es un cupo
 * DENTRO de ese número (entregar no descuenta, vender sí), así que no se le suma.
 */
export function stockTotal(p: ConStock): number {
  return p.stock;
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

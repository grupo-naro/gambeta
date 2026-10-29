import type { Prisma } from '../db/client.js';
import { BusinessRule } from '../utils/errors.js';

// Reglas de stock y de pago del buffet, compartidas por el cobro suelto (`cobrar`) y por las
// cuentas por cancha. Viven acá para que las dos cosas muevan el stock y calculen el vuelto igual.

export type MedioPago = 'EFECTIVO' | 'TRANSFERENCIA';
export interface MostradorStock { id: string; tipo: 'PRINCIPAL' | 'SECUNDARIO' }

// Postgres check_violation SQLSTATE es 23514. Con el driver adapter de Prisma 7, el código
// vive en e.cause.code (no en e.code ni en e.meta.code) — mismo patrón que isExclusionViolation
// en reserva.repo.ts. Se filtra además por el nombre de la constraint para no confundir esto
// con cualquier otro CHECK que pueda existir en la base.
export function esViolacionStockAsignadoNegativo(e: unknown): boolean {
  const anyE = e as any;
  const esCheckViolation = anyE?.code === '23514' || anyE?.cause?.code === '23514' || anyE?.meta?.code === '23514';
  return esCheckViolation && String(anyE?.message ?? '').includes('StockMostrador_cantidad_no_negativa');
}

export const mensajeSinStockAsignado = (nombre: string) =>
  `No tenés stock asignado de ${nombre}. Pedile al mostrador principal que te entregue.`;

/** Efectivo: exige que alcance y devuelve el vuelto. Transferencia: paga el total exacto. */
export function calcularPago(medioPago: MedioPago, montoPagado: number, total: number): { montoPagado: number; vuelto: number } {
  if (medioPago === 'EFECTIVO') {
    if (montoPagado < total) throw BusinessRule('El monto pagado es menor al total');
    return { montoPagado, vuelto: montoPagado - total };
  }
  return { montoPagado: total, vuelto: 0 };
}

/**
 * Saca `cantidad` unidades del stock que le corresponde al mostrador.
 *
 * El principal vende contra el stock general; el secundario, contra lo que se le asignó.
 * Descontar del general una venta del secundario contaría dos veces la misma unidad: ya había
 * salido del general cuando se la entregaron.
 */
export async function descontarStock(
  tx: Prisma.TransactionClient,
  mostrador: MostradorStock,
  producto: { id: string; nombre: string },
  cantidad: number,
): Promise<void> {
  if (mostrador.tipo === 'SECUNDARIO') {
    const clave = { mostradorId_productoId: { mostradorId: mostrador.id, productoId: producto.id } };
    const asignado = await tx.stockMostrador.findUnique({ where: clave });
    if (!asignado || asignado.cantidad < cantidad) throw BusinessRule(mensajeSinStockAsignado(producto.nombre));
    await tx.stockMostrador.update({ where: clave, data: { cantidad: { decrement: cantidad } } });
  } else {
    await tx.productoBuffet.update({ where: { id: producto.id }, data: { stock: { decrement: cantidad } } });
  }
}

/** Devuelve `cantidad` unidades a donde `descontarStock` las sacó. */
export async function devolverStock(
  tx: Prisma.TransactionClient,
  mostrador: MostradorStock,
  productoId: string,
  cantidad: number,
): Promise<void> {
  if (mostrador.tipo === 'SECUNDARIO') {
    await tx.stockMostrador.update({
      where: { mostradorId_productoId: { mostradorId: mostrador.id, productoId } },
      data: { cantidad: { increment: cantidad } },
    });
  } else {
    await tx.productoBuffet.update({ where: { id: productoId }, data: { stock: { increment: cantidad } } });
  }
}

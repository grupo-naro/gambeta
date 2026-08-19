import { BusinessRule } from '../utils/errors.js';

export type MedioAlquiler = 'EFECTIVO' | 'TRANSFERENCIA';
export type EstadoAlquiler = 'ENTREGADO' | 'DEVUELTO' | 'PERDIDO' | 'ROTO';
export type EstadoCierre = Exclude<EstadoAlquiler, 'ENTREGADO'>;

export interface Cobro { total: number; montoPagado: number; vuelto: number }

/**
 * La plata de una entrega. Misma regla que el cobro del buffet: en efectivo hay que cubrir el
 * total y el resto es vuelto; por transferencia se paga exacto.
 */
export function calcularCobro(
  precio: number, cantidad: number, medioPago: MedioAlquiler, montoPagado: number,
): Cobro {
  const total = precio * cantidad;
  if (medioPago === 'TRANSFERENCIA') return { total, montoPagado: total, vuelto: 0 };
  if (montoPagado < total) throw BusinessRule('El monto pagado es menor al total');
  return { total, montoPagado, vuelto: montoPagado - total };
}

/** Si al cerrar así la unidad se va del inventario. Lo perdido y lo roto ya no existen. */
export function saleDelInventario(estado: EstadoCierre): boolean {
  return estado !== 'DEVUELTO';
}

// Postgres check_violation es 23514, y con el driver adapter de Prisma 7 el código vive en
// e.cause.code — mismo patrón que esViolacionStockAsignadoNegativo en buffetCaja.service.ts.
// Se filtra por el prefijo del nombre porque las dos constraints del inventario empiezan igual.
// Exportada (no solo de uso interno): alquilerArticulo.service.ts la necesita en ajustarStock
// para traducir el mismo CHECK de la base a un 422 en vez de dejarlo pasar como 500.
export function esViolacionInventario(e: unknown): boolean {
  const anyE = e as any;
  const esCheck = anyE?.code === '23514' || anyE?.cause?.code === '23514' || anyE?.meta?.code === '23514';
  return esCheck && String(anyE?.message ?? '').includes('ArticuloAlquiler_prestado');
}

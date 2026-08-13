import type { StockAsignado } from './types';

/**
 * Indexa el stock asignado por producto.
 *
 * El backend solo devuelve filas de lo que tiene asignado, así que un producto ausente vale
 * cero: el consumidor lee `mapa[id] ?? 0` y no necesita una fila por cada producto del catálogo.
 */
export function asignadoPorProducto(filas: StockAsignado[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of filas) out[f.productoId] = f.cantidad;
  return out;
}

/** Lo contado contra lo esperado: negativo es faltante, positivo es sobrante. */
export function diferencia(esperado: number, contado: number): number {
  return contado - esperado;
}

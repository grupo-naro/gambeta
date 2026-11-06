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

/**
 * Los productos que muestra un mostrador. El principal ve todo el catálogo; el secundario solo lo
 * que tiene asignado (más de 0), para no ofrecerle productos que no puede vender.
 *
 * `conservar` son ids que se siguen mostrando aunque se hayan quedado sin asignado (por ejemplo,
 * los que ya están cargados en una cuenta abierta, para poder restarlos).
 */
export function productosDelMostrador<T extends { id: string }>(
  productos: T[],
  tipo: 'PRINCIPAL' | 'SECUNDARIO',
  asignado: StockAsignado[],
  conservar: string[] = [],
): T[] {
  if (tipo === 'PRINCIPAL') return productos;
  const tiene = asignadoPorProducto(asignado);
  return productos.filter((p) => (tiene[p.id] ?? 0) > 0 || conservar.includes(p.id));
}

/** Lo contado contra lo esperado: negativo es faltante, positivo es sobrante. */
export function diferencia(esperado: number, contado: number): number {
  return contado - esperado;
}

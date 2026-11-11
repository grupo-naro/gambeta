import { prisma } from '../db/prisma.js';
import { BadRequest, Conflict, NotFound } from '../utils/errors.js';
import { auditService } from './audit.service.js';

export interface ProductoDTO {
  id: string;
  nombre: string;
  codigoBarra: string | null;
  precio: number;
  stock: number;
  stockMinimo: number;
  enBotonera: boolean;
  orden: number;
  activo: boolean;
  /** Catálogo al que pertenece: null = el general; si no, el mostrador dueño (el tercero). */
  mostradorId: string | null;
  /** Cupo del secundario: unidades del `stock` total que están asignadas a él. */
  asignado?: number;
}

const toDTO = (p: {
  id: string; nombre: string; codigoBarra: string | null; precio: unknown;
  stock: number; stockMinimo: number; enBotonera: boolean; orden: number; activo: boolean; mostradorId: string | null;
}): ProductoDTO => ({ ...p, precio: Number(p.precio) });

/**
 * El catálogo que ve un mostrador: el tercero, el suyo; el principal y el secundario, el general (null).
 * Sin mostrador (el admin pidiendo "el general") también es null.
 */
async function catalogoDe(mostradorId?: string): Promise<string | null> {
  if (!mostradorId) return null;
  const m = await prisma.mostrador.findUnique({ where: { id: mostradorId }, select: { id: true, tipo: true } });
  return m?.tipo === 'TERCERO' ? m.id : null;
}

export const buffetProductoService = {
  async listBotonera(mostradorId?: string): Promise<ProductoDTO[]> {
    const rows = await prisma.productoBuffet.findMany({
      where: { activo: true, enBotonera: true, mostradorId: await catalogoDe(mostradorId) },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
    return rows.map(toDTO);
  },

  /** Cupo asignado al secundario por producto (lo que el total tiene "reservado" para él). */
  async asignados(): Promise<Map<string, number>> {
    const filas = await prisma.stockMostrador.groupBy({ by: ['productoId'], _sum: { cantidad: true } });
    return new Map(filas.map((f) => [f.productoId, f._sum.cantidad ?? 0]));
  },

  async listActivos(mostradorId?: string): Promise<{ id: string; nombre: string; precio: number; stock: number }[]> {
    const catalogo = await catalogoDe(mostradorId);
    const rows = await prisma.productoBuffet.findMany({
      where: { activo: true, mostradorId: catalogo },
      orderBy: { nombre: 'asc' },
    });
    // El tercero no tiene cupo: su stock es el del producto.
    if (catalogo) return rows.map((p) => ({ id: p.id, nombre: p.nombre, precio: Number(p.precio), stock: p.stock }));
    // `stock` es lo que se puede asignar: el total menos lo que ya tiene asignado el secundario. La
    // pantalla de entrega lo necesita para no ofrecer repartir lo que no hay; la de venta lo ignora.
    const asignados = await buffetProductoService.asignados();
    return rows.map((p) => ({ id: p.id, nombre: p.nombre, precio: Number(p.precio), stock: Math.max(0, p.stock - (asignados.get(p.id) ?? 0)) }));
  },

  /** El catálogo general, o el de un mostrador con productos propios (el tercero). */
  async list(mostradorId?: string): Promise<ProductoDTO[]> {
    const catalogo = await catalogoDe(mostradorId);
    const rows = await prisma.productoBuffet.findMany({ where: { mostradorId: catalogo }, orderBy: [{ activo: 'desc' }, { nombre: 'asc' }] });
    if (catalogo) return rows.map(toDTO);
    const asignados = await buffetProductoService.asignados();
    // `stock` es el total del complejo; `asignado` es cuánto de ese total tiene reservado el secundario.
    return rows.map((p) => ({ ...toDTO(p), asignado: asignados.get(p.id) ?? 0 }));
  },

  async crear(input: {
    nombre: string; codigoBarra?: string | null; precio: number;
    stock?: number; stockMinimo?: number; enBotonera?: boolean; orden?: number; activo?: boolean;
    /** Solo el tercero tiene catálogo propio; sin esto, el producto es del general. */
    mostradorId?: string | null;
  }): Promise<ProductoDTO> {
    const catalogo = input.mostradorId ? await catalogoDe(input.mostradorId) : null;
    if (input.mostradorId && !catalogo) throw BadRequest('Solo el mostrador tercero tiene productos propios');
    if (input.codigoBarra) {
      const dup = await prisma.productoBuffet.findFirst({ where: { codigoBarra: input.codigoBarra, mostradorId: catalogo } });
      if (dup) throw Conflict('Ya existe un producto con ese código de barras');
    }
    try {
      const creado = await prisma.productoBuffet.create({
        data: {
          nombre: input.nombre,
          codigoBarra: input.codigoBarra ?? null,
          precio: input.precio,
          stock: input.stock ?? 0,
          stockMinimo: input.stockMinimo ?? 0,
          enBotonera: input.enBotonera ?? false,
          orden: input.orden ?? 0,
          activo: input.activo ?? true,
          mostradorId: catalogo,
        },
      });
      return toDTO(creado);
    } catch (e: any) {
      if (e?.code === 'P2002') throw Conflict('Ya existe un producto con ese código de barras');
      throw e;
    }
  },

  async actualizar(id: string, entrada: Record<string, unknown>): Promise<ProductoDTO> {
    const actual = await prisma.productoBuffet.findUnique({ where: { id } });
    if (!actual) throw NotFound('ProductoBuffet', id);
    // Un producto no cambia de catálogo: ya tiene ventas y stock en el que nació.
    const { mostradorId: _ignorado, ...input } = entrada;
    if (typeof input.codigoBarra === 'string' && input.codigoBarra !== actual.codigoBarra) {
      const dup = await prisma.productoBuffet.findFirst({ where: { codigoBarra: input.codigoBarra, mostradorId: actual.mostradorId } });
      if (dup) throw Conflict('Ya existe un producto con ese código de barras');
    }
    try {
      const upd = await prisma.productoBuffet.update({ where: { id }, data: input });
      return toDTO(upd);
    } catch (e: any) {
      if (e?.code === 'P2002') throw Conflict('Ya existe un producto con ese código de barras');
      throw e;
    }
  },

  porCodigo: async (codigoBarra: string, mostradorId?: string) => {
    const p = await prisma.productoBuffet.findFirst({ where: { codigoBarra, activo: true, mostradorId: await catalogoDe(mostradorId) } });
    return p ? { id: p.id, nombre: p.nombre, precio: Number(p.precio) } : null;
  },

  async reponer(id: string, cantidad: number, adminId: string): Promise<ProductoDTO> {
    const actual = await prisma.productoBuffet.findUnique({ where: { id } });
    if (!actual) throw NotFound('ProductoBuffet', id);
    const upd = await prisma.productoBuffet.update({ where: { id }, data: { stock: { increment: cantidad } } });
    await auditService.record(adminId, {
      accion: 'REPONER', entidad: 'ProductoBuffet', entidadId: id,
      descripcion: `Repuso ${cantidad} de ${actual.nombre} (${actual.stock} → ${upd.stock})`,
    });
    return toDTO(upd);
  },

  /**
   * Fija el stock general en un total exacto (sube o baja): para corregir un conteo, una rotura o
   * un error de carga. `reponer` solo suma. Deja rastro con el antes y el después.
   */
  async ajustarStock(id: string, stock: number, motivo: string | undefined, adminId: string): Promise<ProductoDTO> {
    const actual = await prisma.productoBuffet.findUnique({ where: { id } });
    if (!actual) throw NotFound('ProductoBuffet', id);
    const upd = await prisma.productoBuffet.update({ where: { id }, data: { stock } });
    await auditService.record(adminId, {
      accion: 'AJUSTAR_STOCK', entidad: 'ProductoBuffet', entidadId: id,
      descripcion: `Ajustó el stock de ${actual.nombre} (${actual.stock} → ${upd.stock})${motivo ? ': ' + motivo : ''}`,
    });
    return toDTO(upd);
  },
};

import { prisma } from '../db/prisma.js';
import { Conflict, NotFound } from '../utils/errors.js';
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
}

const toDTO = (p: {
  id: string; nombre: string; codigoBarra: string | null; precio: unknown;
  stock: number; stockMinimo: number; enBotonera: boolean; orden: number; activo: boolean;
}): ProductoDTO => ({ ...p, precio: Number(p.precio) });

export const buffetProductoService = {
  async listBotonera(): Promise<ProductoDTO[]> {
    const rows = await prisma.productoBuffet.findMany({
      where: { activo: true, enBotonera: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
    return rows.map(toDTO);
  },

  async listActivos(): Promise<{ id: string; nombre: string; precio: number }[]> {
    const rows = await prisma.productoBuffet.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
    return rows.map((p) => ({ id: p.id, nombre: p.nombre, precio: Number(p.precio) }));
  },

  async list(): Promise<ProductoDTO[]> {
    const rows = await prisma.productoBuffet.findMany({ orderBy: [{ activo: 'desc' }, { nombre: 'asc' }] });
    return rows.map(toDTO);
  },

  async crear(input: {
    nombre: string; codigoBarra?: string | null; precio: number;
    stock?: number; stockMinimo?: number; enBotonera?: boolean; orden?: number; activo?: boolean;
  }): Promise<ProductoDTO> {
    if (input.codigoBarra) {
      const dup = await prisma.productoBuffet.findUnique({ where: { codigoBarra: input.codigoBarra } });
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
        },
      });
      return toDTO(creado);
    } catch (e: any) {
      if (e?.code === 'P2002') throw Conflict('Ya existe un producto con ese código de barras');
      throw e;
    }
  },

  async actualizar(id: string, input: Record<string, unknown>): Promise<ProductoDTO> {
    const actual = await prisma.productoBuffet.findUnique({ where: { id } });
    if (!actual) throw NotFound('ProductoBuffet', id);
    if (typeof input.codigoBarra === 'string' && input.codigoBarra !== actual.codigoBarra) {
      const dup = await prisma.productoBuffet.findUnique({ where: { codigoBarra: input.codigoBarra } });
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

  porCodigo: async (codigoBarra: string) => {
    const p = await prisma.productoBuffet.findFirst({ where: { codigoBarra, activo: true } });
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
};

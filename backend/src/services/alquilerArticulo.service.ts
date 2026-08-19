import { prisma } from '../db/prisma.js';
import { BusinessRule, NotFound } from '../utils/errors.js';
import { auditService } from './audit.service.js';

export interface ArticuloAlquilerDTO {
  id: string; nombre: string; precio: number;
  stock: number; prestado: number; disponible: number;
  activo: boolean; orden: number;
}

const toDTO = (a: {
  id: string; nombre: string; precio: unknown; stock: number; prestado: number; activo: boolean; orden: number;
}): ArticuloAlquilerDTO => ({
  id: a.id, nombre: a.nombre, precio: Number(a.precio),
  stock: a.stock, prestado: a.prestado, disponible: a.stock - a.prestado,
  activo: a.activo, orden: a.orden,
});

export const alquilerArticuloService = {
  /** Lo que ve el mostrador: solo activos, en el orden en que se muestran los botones. */
  async listBotonera(): Promise<ArticuloAlquilerDTO[]> {
    const rows = await prisma.articuloAlquiler.findMany({
      where: { activo: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
    return rows.map(toDTO);
  },

  /** Lo que ve el panel: todo, con los dados de baja al final. */
  async list(): Promise<ArticuloAlquilerDTO[]> {
    const rows = await prisma.articuloAlquiler.findMany({ orderBy: [{ activo: 'desc' }, { nombre: 'asc' }] });
    return rows.map(toDTO);
  },

  async crear(input: {
    nombre: string; precio: number; stock?: number; orden?: number; activo?: boolean;
  }): Promise<ArticuloAlquilerDTO> {
    const creado = await prisma.articuloAlquiler.create({
      data: {
        nombre: input.nombre, precio: input.precio,
        stock: input.stock ?? 0, orden: input.orden ?? 0, activo: input.activo ?? true,
      },
    });
    return toDTO(creado);
  },

  /**
   * Edita los datos del artículo. `stock` y `prestado` NO se tocan por acá a propósito: el
   * inventario tiene un solo camino (`ajustarStock` y las transiciones del alquiler), que es
   * lo que mantiene la invariante en un lugar solo.
   */
  async actualizar(id: string, input: {
    nombre?: string; precio?: number; orden?: number; activo?: boolean;
  }): Promise<ArticuloAlquilerDTO> {
    const actual = await prisma.articuloAlquiler.findUnique({ where: { id } });
    if (!actual) throw NotFound('ArticuloAlquiler', id);
    const upd = await prisma.articuloAlquiler.update({ where: { id }, data: input });
    return toDTO(upd);
  },

  /**
   * Ajusta el inventario. `cantidad` puede ser negativa (se descartó una raqueta vieja).
   * No se puede dejar el stock por debajo de lo que está afuera: esas unidades existen y
   * todavía tienen que poder volver.
   */
  async ajustarStock(id: string, cantidad: number, adminId: string): Promise<ArticuloAlquilerDTO> {
    const actual = await prisma.articuloAlquiler.findUnique({ where: { id } });
    if (!actual) throw NotFound('ArticuloAlquiler', id);
    const nuevo = actual.stock + cantidad;
    if (nuevo < actual.prestado) {
      throw BusinessRule(`No podés dejar el stock en ${nuevo}: hay ${actual.prestado} ${actual.nombre} afuera`);
    }
    const upd = await prisma.articuloAlquiler.update({
      where: { id },
      // Atómico a propósito: `stock: nuevo` con `nuevo` calculado sobre una lectura previa
      // pierde ajustes concurrentes (5, dos +3 a la vez, terminaba en 8 en vez de 11).
      data: { stock: { increment: cantidad } },
    });
    await auditService.record(adminId, {
      accion: 'AJUSTAR_STOCK', entidad: 'ArticuloAlquiler', entidadId: id,
      descripcion: `Ajustó ${cantidad >= 0 ? '+' : ''}${cantidad} de ${actual.nombre} (${actual.stock} → ${nuevo})`,
    });
    return toDTO(upd);
  },
};

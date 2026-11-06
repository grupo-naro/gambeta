import { prisma } from '../db/prisma.js';
import { BusinessRule, Forbidden, NotFound } from '../utils/errors.js';

const SECUNDARIO = 'mostrador-secundario';

export interface EntregarInput {
  desdeMostradorId: string;
  items: { productoId: string; cantidad: number }[];
}

export const buffetEntregaService = {
  /**
   * Le asigna al secundario un cupo de mercadería. NO mueve stock: el general es el total del
   * complejo y solo baja cuando se vende. Lo que el secundario no venda se queda asignado a él
   * (no vuelve al principal ni se borra).
   *
   * Todo dentro de una transacción: una entrega de varias líneas es todo o nada. Si la
   * segunda línea no tiene stock, la primera tampoco se aplica — mover mercadería por una
   * entrega que el operador vio fallar sería peor que no moverla.
   */
  async entregar(input: EntregarInput): Promise<{ entregaId: string }> {
    if (input.desdeMostradorId !== 'mostrador-principal') {
      throw Forbidden('Solo el mostrador principal puede entregar stock');
    }
    if (!input.items.length) throw BusinessRule('No hay productos para entregar');
    for (const it of input.items) {
      if (!Number.isInteger(it.cantidad) || it.cantidad < 1) throw BusinessRule('Cantidad inválida');
    }

    return prisma.$transaction(async (tx) => {
      const entrega = await tx.entregaMostrador.create({ data: { mostradorId: SECUNDARIO } });
      for (const it of input.items) {
        const p = await tx.productoBuffet.findUnique({ where: { id: it.productoId } });
        if (!p) throw NotFound('ProductoBuffet', it.productoId);
        // Lo que se puede asignar es lo que no está ya asignado: el total menos los cupos vigentes.
        const { _sum } = await tx.stockMostrador.aggregate({ where: { productoId: p.id }, _sum: { cantidad: true } });
        const libre = p.stock - (_sum.cantidad ?? 0);
        if (libre < it.cantidad) {
          throw BusinessRule(`No hay stock suficiente de ${p.nombre}: hay ${Math.max(0, libre)} sin asignar y querés entregar ${it.cantidad}`);
        }
        await tx.stockMostrador.upsert({
          where: { mostradorId_productoId: { mostradorId: SECUNDARIO, productoId: p.id } },
          create: { mostradorId: SECUNDARIO, productoId: p.id, cantidad: it.cantidad },
          update: { cantidad: { increment: it.cantidad } },
        });
        await tx.entregaMostradorLinea.create({ data: { entregaId: entrega.id, productoId: p.id, cantidad: it.cantidad } });
      }
      return { entregaId: entrega.id };
    });
  },

  async stockAsignado(mostradorId: string) {
    const filas = await prisma.stockMostrador.findMany({ where: { mostradorId } });
    return filas.map((f) => ({ productoId: f.productoId, cantidad: f.cantidad }));
  },
};

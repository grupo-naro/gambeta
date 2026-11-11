import { prisma } from '../db/prisma.js';
import { BusinessRule, Forbidden, NotFound } from '../utils/errors.js';
import { esViolacionStockAsignadoNegativo, tieneCatalogoPropio, tieneCupo, type TipoMostrador } from './buffetStock.js';

const SECUNDARIO = 'mostrador-secundario';

/** El puesto con cupo al que se entrega o del que se devuelve; si no se dice, el secundario. */
async function puestoConCupo(id: string | undefined): Promise<string> {
  const puestoId = id ?? SECUNDARIO;
  const m = await prisma.mostrador.findUnique({ where: { id: puestoId } });
  if (!m) throw NotFound('Mostrador', puestoId);
  if (tieneCatalogoPropio(m.tipo as TipoMostrador)) throw BusinessRule(`${m.nombre} maneja su propio stock: no recibe entregas del principal`);
  if (!tieneCupo(m.tipo as TipoMostrador)) throw BusinessRule('El mostrador principal no recibe entregas: es de donde sale la mercadería');
  return m.id;
}

export interface EntregarInput {
  desdeMostradorId: string;
  /** Puesto destino (entregar) u origen (devolver). Sin esto, el secundario. */
  puestoId?: string;
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
    const puesto = await puestoConCupo(input.puestoId);

    return prisma.$transaction(async (tx) => {
      const entrega = await tx.entregaMostrador.create({ data: { mostradorId: puesto } });
      for (const it of input.items) {
        const p = await tx.productoBuffet.findUnique({ where: { id: it.productoId } });
        if (!p || p.mostradorId !== null) throw NotFound('ProductoBuffet', it.productoId);
        // Lo que se puede asignar es lo que no está ya asignado: el total menos los cupos vigentes.
        const { _sum } = await tx.stockMostrador.aggregate({ where: { productoId: p.id }, _sum: { cantidad: true } });
        const libre = p.stock - (_sum.cantidad ?? 0);
        if (libre < it.cantidad) {
          throw BusinessRule(`No hay stock suficiente de ${p.nombre}: hay ${Math.max(0, libre)} sin asignar y querés entregar ${it.cantidad}`);
        }
        await tx.stockMostrador.upsert({
          where: { mostradorId_productoId: { mostradorId: puesto, productoId: p.id } },
          create: { mostradorId: puesto, productoId: p.id, cantidad: it.cantidad },
          update: { cantidad: { increment: it.cantidad } },
        });
        await tx.entregaMostradorLinea.create({ data: { entregaId: entrega.id, productoId: p.id, cantidad: it.cantidad } });
      }
      return { entregaId: entrega.id };
    });
  },

  /**
   * Le saca al secundario parte de su cupo (lo que ya tiene asignado y quiere devolver al principal).
   *
   * No mueve stock: el general es el total y no cambia. Solo baja el cupo, y esas unidades quedan
   * libres para asignarse de nuevo. Es una acción manual del principal; nada se devuelve solo.
   * Todo o nada. Queda en el historial como un movimiento con cantidades negativas.
   */
  async devolver(input: EntregarInput): Promise<{ entregaId: string }> {
    if (input.desdeMostradorId !== 'mostrador-principal') {
      throw Forbidden('Solo el mostrador principal puede devolver stock');
    }
    if (!input.items.length) throw BusinessRule('No hay productos para devolver');
    for (const it of input.items) {
      if (!Number.isInteger(it.cantidad) || it.cantidad < 1) throw BusinessRule('Cantidad inválida');
    }
    const puesto = await puestoConCupo(input.puestoId);
    const nombrePuesto = (await prisma.mostrador.findUniqueOrThrow({ where: { id: puesto } })).nombre;

    try {
      return await prisma.$transaction(async (tx) => {
        const mov = await tx.entregaMostrador.create({ data: { mostradorId: puesto } });
        for (const it of input.items) {
          const p = await tx.productoBuffet.findUnique({ where: { id: it.productoId } });
          if (!p || p.mostradorId !== null) throw NotFound('ProductoBuffet', it.productoId);
          const clave = { mostradorId_productoId: { mostradorId: puesto, productoId: p.id } };
          const asig = await tx.stockMostrador.findUnique({ where: clave });
          const tiene = asig?.cantidad ?? 0;
          if (tiene < it.cantidad) {
            throw BusinessRule(`${nombrePuesto} no tiene tantas unidades de ${p.nombre}: tiene ${tiene} y querés devolver ${it.cantidad}`);
          }
          await tx.stockMostrador.update({ where: clave, data: { cantidad: { decrement: it.cantidad } } });
          await tx.entregaMostradorLinea.create({ data: { entregaId: mov.id, productoId: p.id, cantidad: -it.cantidad } });
        }
        return { entregaId: mov.id };
      });
    } catch (e) {
      // El secundario vendió justo en el medio y el cupo no alcanzó: lo frena el CHECK de la base.
      if (esViolacionStockAsignadoNegativo(e)) throw BusinessRule(`${nombrePuesto} vendió mientras tanto y ya no tiene tantas unidades`);
      throw e;
    }
  },

  async stockAsignado(mostradorId: string) {
    const filas = await prisma.stockMostrador.findMany({ where: { mostradorId } });
    return filas.map((f) => ({ productoId: f.productoId, cantidad: f.cantidad }));
  },
};

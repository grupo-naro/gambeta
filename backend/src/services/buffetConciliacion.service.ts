import { prisma } from '../db/prisma.js';
import { BusinessRule, Conflict, Forbidden, NotFound } from '../utils/errors.js';

const PRINCIPAL = 'mostrador-principal';

export interface LineaConciliacion {
  productoId: string; nombre: string;
  entregado: number; vendido: number; esperado: number;
}
export interface LineaConciliada extends LineaConciliacion { contado: number; diferencia: number }

/** Entregado y vendido que le corresponden a esa caja, producto por producto. */
async function resumenDe(cajaId: string): Promise<LineaConciliacion[]> {
  const caja = await prisma.cajaBuffet.findUnique({ where: { id: cajaId }, include: { mostrador: true } });
  if (!caja) throw NotFound('CajaBuffet', cajaId);

  // Entregas todavía sin rendir de ESE mostrador, no un rango de fechas: el principal suele
  // entregar antes de que el secundario abra la caja, y por fecha esa entrega quedaría afuera.
  const entregas = await prisma.entregaMostradorLinea.findMany({
    where: { entrega: { mostradorId: caja.mostradorId, conciliadaEnCajaId: null } },
    include: { producto: { select: { nombre: true } } },
  });
  const ventas = await prisma.ventaBuffet.findMany({
    where: { ticket: { cajaId } },
    include: { producto: { select: { nombre: true } } },
  });

  const mapa = new Map<string, LineaConciliacion>();
  const tomar = (id: string, nombre: string) => {
    const cur = mapa.get(id) ?? { productoId: id, nombre, entregado: 0, vendido: 0, esperado: 0 };
    mapa.set(id, cur);
    return cur;
  };
  for (const e of entregas) tomar(e.productoId, e.producto.nombre).entregado += e.cantidad;
  for (const v of ventas) tomar(v.productoId, v.producto.nombre).vendido += v.cantidad;
  for (const l of mapa.values()) l.esperado = l.entregado - l.vendido;
  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export const buffetConciliacionService = {
  pendiente: resumenDe,

  /**
   * Cierra la conciliación: guarda las cuatro cifras y devuelve al stock general **lo contado**,
   * no lo esperado.
   *
   * Esa es la decisión de fondo: devolviendo lo esperado, cada unidad regalada volvería al
   * general como una unidad que no existe, y el stock del complejo mentiría un poco más cada
   * día sin que nadie se entere. Devolviendo lo contado, el faltante desaparece del sistema,
   * que es lo que pasó en la realidad.
   */
  async conciliar(input: { cajaId: string; porMostradorId: string; conteos: { productoId: string; contado: number }[] }) {
    // Lo carga el principal, no el secundario: si quien pudo haberse llevado la mercadería es
    // también quien declara cuánto quedó, el control no controla nada.
    if (input.porMostradorId !== PRINCIPAL) throw Forbidden('El conteo lo carga el mostrador principal');

    const caja = await prisma.cajaBuffet.findUnique({ where: { id: input.cajaId } });
    if (!caja) throw NotFound('CajaBuffet', input.cajaId);
    if (caja.estado !== 'CERRADA') throw Conflict('La caja todavía está abierta');

    const ya = await prisma.conteoCierreLinea.count({ where: { cajaId: input.cajaId } });
    if (ya > 0) throw Conflict('Esta caja ya fue conciliada');

    for (const c of input.conteos) {
      if (!Number.isInteger(c.contado) || c.contado < 0) throw BusinessRule('Conteo inválido');
    }

    const resumen = await resumenDe(input.cajaId);
    const contadoPorProducto = new Map(input.conteos.map((c) => [c.productoId, c.contado]));

    return prisma.$transaction(async (tx) => {
      // Marcar las entregas como rendidas en ESTA caja. Va dentro de la transacción: si algo
      // falla después, no pueden quedar entregas rendidas contra un cierre que no existió.
      await tx.entregaMostrador.updateMany({
        where: { mostradorId: caja.mostradorId, conciliadaEnCajaId: null },
        data: { conciliadaEnCajaId: input.cajaId },
      });

      const lineas: LineaConciliada[] = [];
      for (const l of resumen) {
        // Un producto que no se contó cuenta como cero: si quedaba algo y nadie lo declaró,
        // aparece como faltante, que es la lectura honesta.
        const contado = contadoPorProducto.get(l.productoId) ?? 0;
        const diferencia = contado - l.esperado;
        await tx.conteoCierreLinea.create({
          data: { cajaId: input.cajaId, productoId: l.productoId, entregado: l.entregado, vendido: l.vendido, esperado: l.esperado, contado, diferencia },
        });
        if (contado > 0) {
          await tx.productoBuffet.update({ where: { id: l.productoId }, data: { stock: { increment: contado } } });
        }
        // El asignado queda en cero: el secundario arranca cada día limpio.
        await tx.stockMostrador.updateMany({
          where: { mostradorId: caja.mostradorId, productoId: l.productoId },
          data: { cantidad: 0 },
        });
        lineas.push({ ...l, contado, diferencia });
      }
      return { lineas };
    });
  },
};

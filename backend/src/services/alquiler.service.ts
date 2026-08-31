import { prisma } from '../db/prisma.js';
import { BusinessRule, Conflict, Forbidden, NotFound } from '../utils/errors.js';
import { cajaAbierta } from './buffetCaja.service.js';
import { calcularCobro, esViolacionInventario, saleDelInventario } from './alquiler.reglas.js';
import type { EstadoAlquiler, EstadoCierre, MedioAlquiler } from './alquiler.reglas.js';
import { getEnv } from '../config/env.js';
import { dayWindowUtc } from '../utils/tz.js';

// Se reexportan para que routes y tests tengan un solo lugar del que importar el módulo.
export type { EstadoAlquiler, EstadoCierre, MedioAlquiler };

export interface AlquilerDTO {
  id: string; articuloId: string; articuloNombre: string; cantidad: number;
  quienRetira: string; garantia: string | null;
  precioUnit: number; total: number; medioPago: MedioAlquiler;
  estado: EstadoAlquiler; entregadoEn: string; cerradoEn: string | null;
}

export interface EntregarInput {
  mostradorId: string; uid: string; articuloId: string; cantidad: number;
  quienRetira: string; garantia?: string | null;
  medioPago: MedioAlquiler; montoPagado: number;
}

export interface EntregaResultado { alquiler: AlquilerDTO; vuelto: number }

const conArticulo = { articulo: { select: { nombre: true } } } as const;

type FilaAlquiler = {
  id: string; articuloId: string; cantidad: number; quienRetira: string; garantia: string | null;
  precioUnit: unknown; total: unknown; medioPago: string; estado: string;
  entregadoEn: Date; cerradoEn: Date | null; articulo: { nombre: string };
};

const toDTO = (a: FilaAlquiler): AlquilerDTO => ({
  id: a.id, articuloId: a.articuloId, articuloNombre: a.articulo.nombre, cantidad: a.cantidad,
  quienRetira: a.quienRetira, garantia: a.garantia,
  precioUnit: Number(a.precioUnit), total: Number(a.total),
  medioPago: a.medioPago as MedioAlquiler, estado: a.estado as EstadoAlquiler,
  entregadoEn: a.entregadoEn.toISOString(), cerradoEn: a.cerradoEn?.toISOString() ?? null,
});

export const alquilerService = {
  async entregar(input: EntregarInput): Promise<EntregaResultado> {
    const previo = await prisma.alquiler.findUnique({ where: { uid: input.uid }, include: conArticulo });
    if (previo) return { alquiler: toDTO(previo), vuelto: Number(previo.vuelto) };

    const mostrador = await prisma.mostrador.findUnique({ where: { id: input.mostradorId } });
    if (!mostrador) throw NotFound('Mostrador', input.mostradorId);
    // El secundario vende contra el stock que le asignaron y su cierre se concilia contra ese
    // conteo. El inventario de alquileres es el general, que es del principal.
    if (mostrador.tipo !== 'PRINCIPAL') throw Forbidden('Los alquileres los maneja el mostrador principal');

    const caja = await cajaAbierta(input.mostradorId);
    if (!caja) throw Conflict('No hay una caja abierta');

    if (!input.quienRetira.trim()) throw BusinessRule('Falta el nombre de quien retira');

    const art = await prisma.articuloAlquiler.findFirst({ where: { id: input.articuloId, activo: true } });
    if (!art) throw NotFound('ArticuloAlquiler', input.articuloId);
    const disponible = art.stock - art.prestado;
    if (input.cantidad > disponible) throw BusinessRule(`Solo quedan ${disponible} de ${art.nombre}`);

    const { total, montoPagado, vuelto } = calcularCobro(
      Number(art.precio), input.cantidad, input.medioPago, input.montoPagado,
    );

    try {
      const creado = await prisma.$transaction(async (tx) => {
        const a = await tx.alquiler.create({
          data: {
            uid: input.uid, cajaId: caja.id, articuloId: art.id, cantidad: input.cantidad,
            quienRetira: input.quienRetira.trim(), garantia: input.garantia?.trim() || null,
            precioUnit: art.precio, total, medioPago: input.medioPago, montoPagado, vuelto,
          },
          include: conArticulo,
        });
        await tx.articuloAlquiler.update({
          where: { id: art.id }, data: { prestado: { increment: input.cantidad } },
        });
        return a;
      });
      return { alquiler: toDTO(creado), vuelto };
    } catch (e: any) {
      // Dos toques simultáneos con el mismo uid: los dos vieron `null` arriba y entraron a la
      // transacción. El que pierde el índice único devuelve el alquiler que quedó, no un error.
      if (e?.code === 'P2002') {
        const ya = await prisma.alquiler.findUnique({ where: { uid: input.uid }, include: conArticulo });
        if (ya) return { alquiler: toDTO(ya), vuelto: Number(ya.vuelto) };
      }
      // La otra transacción se llevó la última unidad entre el pre-chequeo y el update: la base
      // lo frena con el CHECK. Es el mismo caso de negocio, descubierto más tarde.
      if (esViolacionInventario(e)) throw BusinessRule(`No quedan suficientes ${art.nombre}`);
      throw e;
    }
  },

  /**
   * Cierra un alquiler. DEVUELTO solo libera el disponible; PERDIDO y ROTO además sacan la
   * unidad del inventario, porque esa raqueta ya no existe.
   */
  async cerrar(id: string, estado: EstadoCierre): Promise<AlquilerDTO> {
    const actual = await prisma.alquiler.findUnique({ where: { id } });
    if (!actual) throw NotFound('Alquiler', id);

    const saleDelStock = saleDelInventario(estado);
    return prisma.$transaction(async (tx) => {
      // Compare-and-set: el filtro por estado es lo que hace atómica la transición. Leer el
      // estado y después escribir dejaría que dos toques simultáneos descuenten dos veces.
      const { count } = await tx.alquiler.updateMany({
        where: { id, estado: 'ENTREGADO' },
        data: { estado, cerradoEn: new Date() },
      });
      if (count === 0) throw BusinessRule('Ese alquiler ya está cerrado');

      await tx.articuloAlquiler.update({
        where: { id: actual.articuloId },
        data: {
          prestado: { decrement: actual.cantidad },
          ...(saleDelStock ? { stock: { decrement: actual.cantidad } } : {}),
        },
      });
      const cerrado = await tx.alquiler.findUniqueOrThrow({ where: { id }, include: conArticulo });
      return toDTO(cerrado);
    });
  },

  /** Lo que está afuera ahora: es la lista que el mostrador usa para recibir devoluciones. */
  async afuera(): Promise<AlquilerDTO[]> {
    const rows = await prisma.alquiler.findMany({
      where: { estado: 'ENTREGADO' }, include: conArticulo, orderBy: { entregadoEn: 'asc' },
    });
    return rows.map(toDTO);
  },

  async historial(opts: { desde?: string; hasta?: string; estado?: EstadoAlquiler }): Promise<AlquilerDTO[]> {
    const tz = getEnv().TZ_NEGOCIO;
    // `hasta` es inclusivo para el usuario: dayWindowUtc devuelve el arranque del día siguiente
    // como `end`, así que un `lt` sobre eso cubre el día entero.
    const desde = opts.desde ? dayWindowUtc(opts.desde, tz).start : undefined;
    const hasta = opts.hasta ? dayWindowUtc(opts.hasta, tz).end : undefined;
    const rows = await prisma.alquiler.findMany({
      where: {
        ...(opts.estado ? { estado: opts.estado } : {}),
        ...(desde || hasta
          ? { entregadoEn: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lt: hasta } : {}) } }
          : {}),
      },
      include: conArticulo,
      orderBy: { entregadoEn: 'desc' },
    });
    return rows.map(toDTO);
  },
};

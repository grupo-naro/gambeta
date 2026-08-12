import { Prisma, EstadoReserva, MetodoSena } from '../db/client.js';
import { prisma } from '../db/prisma.js';
import { Conflict } from '../utils/errors.js';

export interface CreateReservaData {
  canchaId: string;
  clienteId: string;
  fechaInicio: Date;
  fechaFin: Date;
  estado: EstadoReserva;
  esContacto: boolean;
  monto: number;
  montoLista?: number | null;
  montoSena?: number | null;
  metodoSena?: MetodoSena | null;
  suscripcionId?: string | null;
  notas?: string | null;
  turnoFijoId?: string | null;
}

export function isExclusionViolation(e: unknown): boolean {
  // Postgres exclusion_violation SQLSTATE is 23P01.
  // With Prisma 7 + pg driver adapter, the error is a DriverAdapterError where the
  // SQLSTATE code lives on e.cause.code (not e.code or e.meta.code).
  // Shape observed: { message: '...exclusion constraint "reserva_no_overlap"...', cause: { code: '23P01', ... } }
  const anyE = e as any;
  return (
    anyE?.code === '23P01' ||
    anyE?.cause?.code === '23P01' ||
    anyE?.meta?.code === '23P01'
  );
}

export const reservaRepo = {
  async create(data: CreateReservaData, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma;
    const reserva = await db.reserva.create({ data });
    let cs = await db.canchaSector.findMany({ where: { canchaId: data.canchaId }, select: { sectorId: true } });
    // Fallback: toda cancha debe tener ≥1 sector. Si por algún motivo no lo tiene
    // (ej. canchas creadas directo en tests), le creamos uno al vuelo para no perder
    // la protección de overlap. En producción siempre lo tienen (service/seed).
    if (cs.length === 0) {
      const s = await db.sector.create({ data: { nombre: 'auto' } });
      await db.canchaSector.create({ data: { canchaId: data.canchaId, sectorId: s.id } });
      cs = [{ sectorId: s.id }];
    }
    try {
      await db.reservaSector.createMany({
        data: cs.map((s) => ({ reservaId: reserva.id, sectorId: s.sectorId, estado: data.estado, fechaInicio: data.fechaInicio, fechaFin: data.fechaFin })),
      });
    } catch (e) {
      if (isExclusionViolation(e)) throw Conflict('El horario ya está reservado para esa cancha');
      throw e;
    }
    return reserva;
  },
  findById: (id: string) => prisma.reserva.findUnique({ where: { id }, include: { pago: true, cliente: true, cancha: true } }),
  updateEstado: async (id: string, estado: EstadoReserva, tx?: Prisma.TransactionClient) => {
    const db = tx ?? prisma;
    await db.reservaSector.updateMany({ where: { reservaId: id }, data: { estado } });
    return db.reserva.update({ where: { id }, data: { estado } });
  },
  confirmarSiEsperandoSena: async (id: string, tx?: Prisma.TransactionClient) => {
    const db = tx ?? prisma;
    const { count } = await db.reserva.updateMany({ where: { id, estado: 'ESPERANDO_SENA' }, data: { estado: 'CONFIRMADA' } });
    if (count !== 1) return null;
    await db.reservaSector.updateMany({ where: { reservaId: id }, data: { estado: 'CONFIRMADA' } });
    return db.reserva.findUniqueOrThrow({ where: { id } });
  },
  /**
   * Cancela solo si la reserva sigue esperando seña. El estado va en el `where` del
   * updateMany para que comprobar y escribir sean una sola sentencia: si el admin aprueba
   * la seña en el mismo instante en que el job la da por vencida, gana el que llegue
   * primero y el otro recibe `null` en vez de pisar una reserva ya pagada.
   * Espejo de `confirmarSiEsperandoSena`.
   */
  cancelarSiEsperandoSena: async (id: string, tx?: Prisma.TransactionClient) => {
    const db = tx ?? prisma;
    const { count } = await db.reserva.updateMany({ where: { id, estado: 'ESPERANDO_SENA' }, data: { estado: 'CANCELADA' } });
    if (count !== 1) return null;
    // Sin esto el horario NO se libera: la restricción de exclusión mira ReservaSector.
    await db.reservaSector.updateMany({ where: { reservaId: id }, data: { estado: 'CANCELADA' } });
    return db.reserva.findUniqueOrThrow({ where: { id } });
  },
  async reprogramar(id: string, fechaInicio: Date, fechaFin: Date, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma;
    try {
      await db.reservaSector.updateMany({ where: { reservaId: id }, data: { fechaInicio, fechaFin } });
      return await db.reserva.update({ where: { id }, data: { fechaInicio, fechaFin } });
    } catch (e) {
      if (isExclusionViolation(e)) throw Conflict('El horario ya está reservado para esa cancha');
      throw e;
    }
  },
  async moverDeCancha(id: string, canchaId: string, fechaInicio: Date, fechaFin: Date, estado: EstadoReserva, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma;
    await db.reservaSector.deleteMany({ where: { reservaId: id } });
    let cs = await db.canchaSector.findMany({ where: { canchaId }, select: { sectorId: true } });
    if (cs.length === 0) {
      const s = await db.sector.create({ data: { nombre: 'auto' } });
      await db.canchaSector.create({ data: { canchaId, sectorId: s.id } });
      cs = [{ sectorId: s.id }];
    }
    try {
      await db.reservaSector.createMany({
        data: cs.map((s) => ({ reservaId: id, sectorId: s.sectorId, estado, fechaInicio, fechaFin })),
      });
    } catch (e) {
      if (isExclusionViolation(e)) throw Conflict('El horario ya está reservado para esa cancha');
      throw e;
    }
    return db.reserva.update({ where: { id }, data: { canchaId, fechaInicio, fechaFin } });
  },
  list: (where: Prisma.ReservaWhereInput) =>
    prisma.reserva.findMany({ where, include: { cliente: true, cancha: true }, orderBy: { fechaInicio: 'asc' } }),
  countByCancha: (canchaId: string) => prisma.reserva.count({ where: { canchaId } }),
  contarCumplidasPorCliente: (clienteId: string) =>
    prisma.reserva.count({ where: { clienteId, estado: { in: ['CONFIRMADA', 'COMPLETADA'] } } }),
  cumplidasPorCliente: async () => {
    const rows = await prisma.reserva.groupBy({ by: ['clienteId'], where: { estado: { in: ['CONFIRMADA', 'COMPLETADA'] } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.clienteId, r._count._all]));
  },
};

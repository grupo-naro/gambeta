import { Prisma } from '../db/client.js';
import { prisma } from '../db/prisma.js';

export const cobroRepo = {
  create: (data: Prisma.CobroUncheckedCreateInput, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).cobro.create({ data }),
  listByReserva: (reservaId: string) =>
    prisma.cobro.findMany({
      where: { reservaId },
      orderBy: { creadoEn: 'asc' },
      include: { registradoPor: { select: { nombre: true } } },
    }),
  listByTurnoFijo: (turnoFijoId: string) =>
    prisma.cobro.findMany({
      where: { turnoFijoId },
      orderBy: { creadoEn: 'asc' },
      include: { registradoPor: { select: { nombre: true } } },
    }),
  listByBloqueo: (bloqueoId: string) =>
    prisma.cobro.findMany({
      where: { bloqueoId },
      orderBy: { creadoEn: 'asc' },
      include: { registradoPor: { select: { nombre: true } } },
    }),
  sumByBloqueos: async (ids: string[]) => {
    if (ids.length === 0) return new Map<string, number>();
    const rows = await prisma.cobro.groupBy({ by: ['bloqueoId'], where: { bloqueoId: { in: ids } }, _sum: { monto: true } });
    return new Map(rows.map((r) => [r.bloqueoId as string, Number(r._sum.monto ?? 0)]));
  },
  sumByTurnoFijo: async (turnoFijoId: string) => {
    const r = await prisma.cobro.aggregate({ where: { turnoFijoId }, _sum: { monto: true } });
    return Number(r._sum.monto ?? 0);
  },
  /** Cobrado por fijo, para una lista de fijos de una sola vez (evita una consulta por fila). */
  sumByTurnoFijos: async (ids: string[]) => {
    if (ids.length === 0) return new Map<string, number>();
    const rows = await prisma.cobro.groupBy({ by: ['turnoFijoId'], where: { turnoFijoId: { in: ids } }, _sum: { monto: true } });
    return new Map(rows.map((r) => [r.turnoFijoId as string, Number(r._sum.monto ?? 0)]));
  },
  findById: (id: string) => prisma.cobro.findUnique({ where: { id } }),
  remove: (id: string) => prisma.cobro.delete({ where: { id } }),
  sumByReserva: async (reservaId: string) => {
    const r = await prisma.cobro.aggregate({ where: { reservaId }, _sum: { monto: true } });
    return Number(r._sum.monto ?? 0);
  },
  listRange: (start: Date, end: Date) =>
    prisma.cobro.findMany({
      where: { creadoEn: { gte: start, lt: end } },
      orderBy: { creadoEn: 'desc' },
      include: {
        registradoPor: { select: { nombre: true } },
        reserva: { select: { cancha: { select: { id: true, nombre: true } }, cliente: { select: { nombre: true } } } },
        suscripcion: { select: { cliente: { select: { nombre: true } } } },
        turnoFijo: { select: { clienteNombre: true } },
        bloqueo: { select: { nota: true, cancha: { select: { nombre: true } } } },
      },
    }),
};

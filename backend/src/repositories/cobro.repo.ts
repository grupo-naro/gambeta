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
      },
    }),
};

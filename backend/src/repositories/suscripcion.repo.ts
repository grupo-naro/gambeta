import { Prisma } from '../db/client.js';
import { prisma } from '../db/prisma.js';

export const suscripcionRepo = {
  create: (data: Prisma.SuscripcionUncheckedCreateInput, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).suscripcion.create({ data }),

  findById: (id: string) =>
    prisma.suscripcion.findUnique({ where: { id }, include: { cliente: true } }),

  /** ACTIVAS del cliente que cubren `fecha`, la de mayor vencimiento primero. */
  cubriendo: (clienteId: string, fecha: Date) =>
    prisma.suscripcion.findMany({
      where: { clienteId, estado: 'ACTIVA', inicio: { lte: fecha }, vencimiento: { gte: fecha } },
      orderBy: { vencimiento: 'desc' },
    }),

  /** ACTIVAS del cliente que se solapan con [inicio, vencimiento]. Dos rangos se solapan si a.inicio <= b.fin && b.inicio <= a.fin. */
  solapadas: (clienteId: string, inicio: Date, vencimiento: Date, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).suscripcion.findMany({
      where: { clienteId, estado: 'ACTIVA', inicio: { lte: vencimiento }, vencimiento: { gte: inicio } },
    }),

  list: () =>
    prisma.suscripcion.findMany({ include: { cliente: true }, orderBy: { creadoEn: 'desc' } }),

  listByCliente: (clienteId: string) =>
    prisma.suscripcion.findMany({ where: { clienteId }, orderBy: { inicio: 'desc' } }),

  cancelar: (id: string, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).suscripcion.update({ where: { id }, data: { estado: 'CANCELADA' } }),

  /** Turnos bonificados por suscripción, para el listado del panel. */
  contarReservasPorSuscripcion: async (ids: string[]): Promise<Map<string, number>> => {
    if (ids.length === 0) return new Map();
    const rows = await prisma.reserva.groupBy({
      by: ['suscripcionId'],
      where: { suscripcionId: { in: ids } },
      _count: { suscripcionId: true },
    });
    return new Map(rows.map((r) => [r.suscripcionId as string, r._count.suscripcionId]));
  },
};

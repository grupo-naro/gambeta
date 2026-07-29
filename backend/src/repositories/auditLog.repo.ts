import { Prisma } from '../db/client.js';
import { prisma } from '../db/prisma.js';

export const auditLogRepo = {
  record: (data: Prisma.AuditLogUncheckedCreateInput, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).auditLog.create({ data }),
  list: (opts: { entidad?: string; limit?: number }) =>
    prisma.auditLog.findMany({
      where: opts.entidad ? { entidad: opts.entidad } : {},
      orderBy: { creadoEn: 'desc' },
      take: opts.limit ?? 200,
      include: { admin: { select: { nombre: true } } },
    }),
};

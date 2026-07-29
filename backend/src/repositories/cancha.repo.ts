import { Prisma } from '../db/client.js';
import { prisma } from '../db/prisma.js';

export const canchaRepo = {
  list: (onlyActive?: boolean) =>
    prisma.cancha.findMany({ where: onlyActive ? { activa: true } : {}, orderBy: { nombre: 'asc' } }),
  findById: (id: string) => prisma.cancha.findUnique({ where: { id } }),
  create: (data: Prisma.CanchaCreateInput) => prisma.cancha.create({ data }),
  update: (id: string, data: Prisma.CanchaUpdateInput) => prisma.cancha.update({ where: { id }, data }),
  delete: (id: string) => prisma.cancha.delete({ where: { id } }),
};

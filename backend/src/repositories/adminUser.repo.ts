import { prisma } from '../db/prisma.js';

const publicSelect = { id: true, email: true, nombre: true, rol: true, esDefault: true, expiraEn: true } as const;

export const adminUserRepo = {
  findByEmail: (email: string) => prisma.adminUser.findUnique({ where: { email } }),
  findById: (id: string) => prisma.adminUser.findUnique({ where: { id } }),
  list: () => prisma.adminUser.findMany({ orderBy: { creadoEn: 'asc' }, select: publicSelect }),
  create: (data: { email: string; nombre: string; passwordHash: string; rol: 'ADMIN' | 'RECEPCIONISTA'; expiraEn?: Date | null }) =>
    prisma.adminUser.create({ data, select: publicSelect }),
  updateRol: (id: string, rol: 'ADMIN' | 'RECEPCIONISTA') =>
    prisma.adminUser.update({ where: { id }, data: { rol }, select: publicSelect }),
  updateExpiracion: (id: string, expiraEn: Date | null) =>
    prisma.adminUser.update({ where: { id }, data: { expiraEn }, select: publicSelect }),
  remove: (id: string) => prisma.adminUser.delete({ where: { id } }),
};

import { prisma } from '../db/prisma.js';

export interface UpsertClienteInput { whatsapp: string; nombre: string; esContacto?: boolean; confiable?: boolean; nombreConfirmado?: boolean }

export const clienteRepo = {
  list: () => prisma.cliente.findMany({ orderBy: { creadoEn: 'desc' } }),
  findById: (id: string) => prisma.cliente.findUnique({ where: { id }, include: { reservas: true, suscripciones: true } }),
  findByWhatsapp: (whatsapp: string) => prisma.cliente.findUnique({ where: { whatsapp } }),
  update: (id: string, data: { nombre?: string; confiable?: boolean; nombreConfirmado?: boolean; whatsapp?: string }) =>
    prisma.cliente.update({ where: { id }, data }),
  delete: (id: string) => prisma.cliente.delete({ where: { id } }),
  upsert: (i: UpsertClienteInput) =>
    prisma.cliente.upsert({
      where: { whatsapp: i.whatsapp },
      create: { whatsapp: i.whatsapp, nombre: i.nombre, esContacto: i.esContacto ?? false, confiable: i.confiable ?? false, nombreConfirmado: i.nombreConfirmado ?? false },
      update: {
        nombre: i.nombre,
        esContacto: i.esContacto ?? false,
        ...(i.confiable !== undefined ? { confiable: i.confiable } : {}),
        ...(i.nombreConfirmado ? { nombreConfirmado: true } : {}),
      },
    }),
};

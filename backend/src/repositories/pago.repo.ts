import { Prisma, EstadoPago, VerificadoPor } from '../db/client.js';
import { prisma } from '../db/prisma.js';

export const pagoRepo = {
  upsertForReserva: (
    reservaId: string,
    data: { estado: EstadoPago; verificadoPor?: VerificadoPor; aprobadoPorId?: string | null; montoDetectado?: number | null; comprobanteUrl?: string | null },
    tx?: Prisma.TransactionClient,
  ) =>
    (tx ?? prisma).pago.upsert({
      where: { reservaId },
      create: { reservaId, ...data },
      update: data,
    }),
  setPreferencia: async (reservaId: string, mpPreferenceId: string): Promise<void> => {
    await prisma.pago.update({ where: { reservaId }, data: { mpPreferenceId } });
  },
  setPago: async (reservaId: string, mpPaymentId: string): Promise<void> => {
    await prisma.pago.update({ where: { reservaId }, data: { mpPaymentId } });
  },
};

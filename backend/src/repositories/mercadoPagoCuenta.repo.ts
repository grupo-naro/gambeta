import { prisma } from '../db/prisma.js';
import type { Prisma } from '../db/client.js';

const ID = 'default';

export const mercadoPagoCuentaRepo = {
  get: () => prisma.mercadoPagoCuenta.findUnique({ where: { id: ID } }),

  guardar: (datos: { accessToken: string; refreshToken: string; venceEn: Date; mpUserId: string; apodo: string }) =>
    prisma.mercadoPagoCuenta.upsert({
      where: { id: ID },
      create: { id: ID, ...datos, caida: false },
      update: { ...datos, caida: false, vinculadaEn: new Date() },
    }),

  borrar: () => prisma.mercadoPagoCuenta.deleteMany({ where: { id: ID } }),

  marcarCaida: () => prisma.mercadoPagoCuenta.updateMany({ where: { id: ID }, data: { caida: true } }),

  /**
   * Corre `fn` con la fila bloqueada (`FOR UPDATE`), para que dos renovaciones simultáneas
   * se serialicen. La segunda entra recién cuando la primera hizo commit, y ahí ve el token
   * ya renovado y no vuelve a llamar a Mercado Pago.
   *
   * El lock es de base de datos, no del proceso: una bandera en memoria no serviría el día
   * que haya más de un backend, y este es justo el caso donde perder la carrera cuesta la
   * vinculación entera (Mercado Pago invalida el refresh token en cada uso).
   */
  conFilaBloqueada: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MercadoPagoCuenta" WHERE id = ${ID} FOR UPDATE`;
      return fn(tx);
    }),

  actualizarTokens: (
    tx: Prisma.TransactionClient,
    datos: { accessToken: string; refreshToken: string; venceEn: Date },
  ) => tx.mercadoPagoCuenta.update({ where: { id: ID }, data: { ...datos, caida: false } }),

  leerEn: (tx: Prisma.TransactionClient) => tx.mercadoPagoCuenta.findUnique({ where: { id: ID } }),
};

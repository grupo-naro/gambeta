import { prisma } from '../db/prisma.js';
import type { Prisma } from '../db/client.js';

const ID = 'default';

/**
 * Tope de la transacción que sostiene el lock de fila. Prisma 7 corta a los 5 s por defecto
 * (`timeout`), y ese default cuenta tanto la espera del segundo renovador en el `FOR UPDATE`
 * como el tiempo que tarda el primero en hablar con Mercado Pago. Un `/oauth/token` que tarde
 * más que eso —nada raro en el p99 de un endpoint de auth— hace que Prisma haga rollback
 * DESPUÉS de que Mercado Pago ya rotó el refresh token: el nuevo par nunca se guarda y el
 * viejo ya está muerto. Lo mismo puede pisar al segundo renovador aunque el primero haya
 * renovado bien.
 *
 * Este valor tiene que ser MAYOR al timeout del fetch a Mercado Pago (ver
 * `TOKEN_FETCH_TIMEOUT_MS` en `mercadoPagoOauth.service.ts`), para que sea siempre el fetch
 * el que corte primero y nunca Prisma en medio de una llamada en vuelo.
 */
const TRANSACCION_TIMEOUT_MS = 30_000;
const TRANSACCION_MAX_WAIT_MS = 10_000;

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
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MercadoPagoCuenta" WHERE id = ${ID} FOR UPDATE`;
        return fn(tx);
      },
      { timeout: TRANSACCION_TIMEOUT_MS, maxWait: TRANSACCION_MAX_WAIT_MS },
    ),

  actualizarTokens: (
    tx: Prisma.TransactionClient,
    datos: { accessToken: string; refreshToken: string; venceEn: Date },
  ) => tx.mercadoPagoCuenta.update({ where: { id: ID }, data: { ...datos, caida: false } }),

  leerEn: (tx: Prisma.TransactionClient) => tx.mercadoPagoCuenta.findUnique({ where: { id: ID } }),
};

import { z } from 'zod';
const empty = z.looseObject({});

export const crearPreferenciaSchema = z.object({
  body: z.object({ reservaId: z.string().min(1) }),
  query: empty, params: empty,
});

export const reservaPagoSchema = z.object({
  body: z.unknown(), query: empty,
  params: z.object({ id: z.string().min(1) }),
});

export const callbackMpSchema = z.object({
  body: z.object({ code: z.string().min(1), state: z.string().min(1) }),
  query: empty, params: empty,
});

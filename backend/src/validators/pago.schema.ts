import { z } from 'zod';
const empty = z.looseObject({});

export const crearPreferenciaSchema = z.object({
  body: z.object({ reservaId: z.string().min(1) }),
  query: empty, params: empty,
});

export const callbackMpSchema = z.object({
  body: z.object({ code: z.string().min(1), state: z.string().min(1) }),
  query: empty, params: empty,
});

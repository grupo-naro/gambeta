import { z } from 'zod';
const empty = z.looseObject({});

export const crearPreferenciaSchema = z.object({
  body: z.object({ reservaId: z.string().min(1) }),
  query: empty, params: empty,
});

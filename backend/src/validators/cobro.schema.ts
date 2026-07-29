import { z } from 'zod';

const empty = z.looseObject({});
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const crearCobroSchema = z.object({
  body: z.object({
    monto: z.number().positive(),
    medio: z.enum(['EFECTIVO', 'TRANSFERENCIA']),
  }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

export const cajaSchema = z.object({
  query: z.object({ desde: ymd.optional(), hasta: ymd.optional() }),
  body: z.unknown(),
  params: empty,
});

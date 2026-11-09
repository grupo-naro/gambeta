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

// Cobros de un bloqueo. En un entrenamiento recurrente cada cobro es de una clase (fecha).
export const crearCobroBloqueoSchema = z.object({
  body: z.object({ monto: z.number().positive(), medio: z.enum(['EFECTIVO', 'TRANSFERENCIA']), fecha: ymd.optional() }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
export const cobrosBloqueoSchema = z.object({
  body: z.unknown(),
  query: z.object({ fecha: ymd.optional() }),
  params: z.object({ id: z.string().min(1) }),
});
export const clasesBloqueoSchema = z.object({
  body: z.unknown(),
  query: z.object({ desde: ymd.optional(), hasta: ymd.optional() }),
  params: z.object({ id: z.string().min(1) }),
});

export const cajaSchema = z.object({
  query: z.object({ desde: ymd.optional(), hasta: ymd.optional() }),
  body: z.unknown(),
  params: empty,
});

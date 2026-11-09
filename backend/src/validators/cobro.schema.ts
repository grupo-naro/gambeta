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

// Cobros de un bloqueo. En un entrenamiento recurrente cada cobro es de un mes ('YYYY-MM').
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido (YYYY-MM)');
export const crearCobroBloqueoSchema = z.object({
  body: z.object({ monto: z.number().positive(), medio: z.enum(['EFECTIVO', 'TRANSFERENCIA']), mes: ym.optional() }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
export const cobrosBloqueoSchema = z.object({
  body: z.unknown(),
  query: z.object({ mes: ym.optional() }),
  params: z.object({ id: z.string().min(1) }),
});
export const mesesBloqueoSchema = z.object({
  body: z.unknown(),
  query: z.object({ desde: ym.optional(), hasta: ym.optional() }),
  params: z.object({ id: z.string().min(1) }),
});

export const cajaSchema = z.object({
  query: z.object({ desde: ymd.optional(), hasta: ymd.optional() }),
  body: z.unknown(),
  params: empty,
});

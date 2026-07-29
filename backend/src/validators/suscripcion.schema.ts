import { z } from 'zod';

const empty = z.looseObject({});
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
const medio = z.enum(['EFECTIVO', 'TRANSFERENCIA']);

/** Un cobro sin medio de pago no tiene sentido en Caja: si hay precio, el medio es obligatorio. */
const exigeMedioSiHayPrecio = (b: { precio?: number; medio?: 'EFECTIVO' | 'TRANSFERENCIA' }) =>
  !(b.precio != null && b.precio > 0) || b.medio != null;

export const crearSuscripcionSchema = z.object({
  body: z.object({
    clienteId: z.string().min(1),
    inicio: ymd,
    vencimiento: ymd,
    precio: z.coerce.number().nonnegative().optional(),
    medio: medio.optional(),
    nota: z.string().optional(),
  })
    .refine((b) => b.inicio <= b.vencimiento, { message: 'El vencimiento no puede ser anterior al inicio', path: ['vencimiento'] })
    .refine(exigeMedioSiHayPrecio, { message: 'Elegí el medio de pago de la cuota', path: ['medio'] }),
  query: empty,
  params: empty,
});

export const renovarSuscripcionSchema = z.object({
  body: z.object({
    precio: z.coerce.number().nonnegative().optional(),
    medio: medio.optional(),
  }).refine(exigeMedioSiHayPrecio, { message: 'Elegí el medio de pago de la cuota', path: ['medio'] }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

export const idSuscripcionParamSchema = z.object({
  body: z.unknown(),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

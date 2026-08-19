import { z } from 'zod';

const empty = z.looseObject({});
const idParam = z.object({ id: z.string().min(1) });
const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const estadoAlquiler = z.enum(['ENTREGADO', 'DEVUELTO', 'PERDIDO', 'ROTO']);

export const crearArticuloSchema = z.object({
  body: z.object({
    nombre: z.string().min(1),
    precio: z.coerce.number().nonnegative(),
    stock: z.coerce.number().int().nonnegative().optional(),
    orden: z.coerce.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  query: empty, params: empty,
});

export const actualizarArticuloSchema = z.object({
  body: z.object({
    nombre: z.string().min(1).optional(),
    precio: z.coerce.number().nonnegative().optional(),
    orden: z.coerce.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  query: empty, params: idParam,
});

// La cantidad puede ser negativa (se descartó una raqueta), pero 0 no es un ajuste.
export const ajustarStockSchema = z.object({
  body: z.object({ cantidad: z.coerce.number().int().refine((n) => n !== 0, 'La cantidad no puede ser 0') }),
  query: empty, params: idParam,
});

export const entregarAlquilerSchema = z.object({
  body: z.object({
    uid: z.string().min(1),
    articuloId: z.string().min(1),
    cantidad: z.coerce.number().int().positive(),
    quienRetira: z.string().min(1),
    garantia: z.string().nullable().optional(),
    medioPago: z.enum(['EFECTIVO', 'TRANSFERENCIA']),
    montoPagado: z.coerce.number().nonnegative(),
  }),
  query: empty, params: empty,
});

export const cerrarAlquilerSchema = z.object({
  body: z.object({ estado: z.enum(['DEVUELTO', 'PERDIDO', 'ROTO']) }),
  query: empty, params: idParam,
});

export const historialAlquileresSchema = z.object({
  body: z.unknown(),
  query: z.object({ desde: fechaISO.optional(), hasta: fechaISO.optional(), estado: estadoAlquiler.optional() }),
  params: empty,
});

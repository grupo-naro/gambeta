import { z } from 'zod';

const empty = z.looseObject({});
const idParam = z.object({ id: z.string().min(1) });

export const crearProductoSchema = z.object({
  body: z.object({
    nombre: z.string().min(1),
    codigoBarra: z.string().min(1).nullable().optional(),
    precio: z.coerce.number().nonnegative(),
    stock: z.coerce.number().int().nonnegative().optional(),
    stockMinimo: z.coerce.number().int().nonnegative().optional(),
    enBotonera: z.boolean().optional(),
    orden: z.coerce.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  query: empty, params: empty,
});

export const actualizarProductoSchema = z.object({
  body: z.object({
    nombre: z.string().min(1).optional(),
    codigoBarra: z.string().min(1).nullable().optional(),
    precio: z.coerce.number().nonnegative().optional(),
    stockMinimo: z.coerce.number().int().nonnegative().optional(),
    enBotonera: z.boolean().optional(),
    orden: z.coerce.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  query: empty, params: idParam,
});

export const reponerSchema = z.object({
  body: z.object({ cantidad: z.coerce.number().int().positive() }),
  query: empty, params: idParam,
});

export const cobrarSchema = z.object({
  body: z.object({
    uid: z.string().min(1),
    medioPago: z.enum(['EFECTIVO', 'TRANSFERENCIA']),
    montoPagado: z.coerce.number().nonnegative(),
    items: z.array(z.object({ productoId: z.string().min(1), cantidad: z.coerce.number().int().positive() })).min(1),
  }),
  query: empty, params: empty,
});

export const porCodigoSchema = z.object({
  body: z.unknown(),
  query: z.object({ codigoBarra: z.string().min(1) }),
  params: empty,
});

export const entregarSchema = z.object({
  body: z.object({
    items: z.array(z.object({ productoId: z.string().min(1), cantidad: z.number().int().positive() })).min(1),
  }),
  query: empty, params: empty,
});

export const conciliarSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    conteos: z.array(z.object({ productoId: z.string().min(1), contado: z.number().int().nonnegative() })),
  }),
  query: empty,
});

const pin4 = z.string().regex(/^\d{4}$/, 'El PIN son 4 dígitos');
// Los ids son fijos: los crea la migración de Task 1 y no hay alta de mostradores por API.
const mostradorIdExistente = z.enum(['mostrador-principal', 'mostrador-secundario']);
export const setPinSchema = z.object({ body: z.object({ pin: pin4, mostradorId: mostradorIdExistente }), query: empty, params: empty });
export const verificarPinSchema = z.object({ body: z.object({ pin: pin4 }), query: empty, params: empty });
export const setActivoMostradorSchema = z.object({
  body: z.object({ activo: z.boolean() }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

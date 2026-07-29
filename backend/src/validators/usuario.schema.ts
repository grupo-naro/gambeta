import { z } from 'zod';
const empty = z.looseObject({});
const rol = z.enum(['ADMIN', 'RECEPCIONISTA']);
const duracionDias = z.union([z.literal(1), z.literal(2), z.literal(7), z.literal(30)]);

export const crearUsuarioSchema = z.object({
  body: z.object({ email: z.string().email(), nombre: z.string().min(1), password: z.string().min(6), rol, duracionDias: duracionDias.optional() }),
  query: empty, params: empty,
});
export const cambiarRolSchema = z.object({
  body: z.object({ rol }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const idUsuarioParamSchema = z.object({
  body: z.unknown(), query: empty, params: z.object({ id: z.string().min(1) }),
});
export const cambiarExpiracionSchema = z.object({
  body: z.object({ duracionDias: duracionDias.nullable() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});

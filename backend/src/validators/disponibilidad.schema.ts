import { z } from 'zod';
const empty = z.looseObject({});
export const disponibilidadSchema = z.object({
  query: z.object({
    canchaId: z.string().min(1),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD'),
  }),
  body: z.unknown(), params: empty,
});

export const disponibilidadPorTamanoSchema = z.object({
  query: z.object({
    jugadores: z.coerce.number().int().refine((n) => [5, 6, 7, 9, 11].includes(n), 'jugadores debe ser 5, 6, 7, 9 u 11'),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD'),
  }),
  body: z.unknown(), params: empty,
});

export const grillaSchema = z.object({
  query: z.object({
    deporte: z.enum(['futbol', 'padel']),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD'),
  }),
  body: z.unknown(), params: empty,
});

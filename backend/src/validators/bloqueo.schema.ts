import { z } from 'zod';
const empty = z.looseObject({});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');

export const crearBloqueoSchema = z.object({
  body: z.object({
    canchaId: z.string().min(1),
    motivo: z.enum(['TORNEO', 'ENTRENAMIENTO', 'MANTENIMIENTO', 'OTRO']),
    recurrente: z.boolean(),
    diaSemana: z.coerce.number().int().min(0).max(6).optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    horaInicio: hhmm,
    horaFin: hhmm,
    nota: z.string().optional(),
  })
    .refine((b) => b.horaInicio < b.horaFin, { message: 'La hora de inicio debe ser anterior al fin', path: ['horaFin'] })
    .refine((b) => (b.recurrente ? b.diaSemana != null : b.fecha != null), { message: 'Recurrente necesita diaSemana; puntual necesita fecha', path: ['recurrente'] }),
  query: empty, params: empty,
});
export const idBloqueoParamSchema = z.object({ body: z.unknown(), query: empty, params: z.object({ id: z.string().min(1) }) });
export const excepcionBloqueoSchema = z.object({
  body: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

import { z } from 'zod';
import { hhmmAMin, cierreMin } from '../utils/tz.js';
import { fechaYmd } from './fecha.field.js';
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
    // Período de un bloqueo recurrente ("todos los jueves hasta el 12/12"). Inclusivo; cada extremo es opcional.
    vigenciaDesde: fechaYmd.optional(),
    vigenciaHasta: fechaYmd.optional(),
  })
    // `cierreMin` y no comparación de texto: "00:00" es el FIN del día (1440), así que un bloqueo
    // de 23:00 a medianoche es válido. Comparando strings, "23:00" < "00:00" daba falso.
    .refine((b) => hhmmAMin(b.horaInicio) < cierreMin(b.horaFin), { message: 'La hora de inicio debe ser anterior al fin', path: ['horaFin'] })
    .refine((b) => (b.recurrente ? b.diaSemana != null : b.fecha != null), { message: 'Recurrente necesita diaSemana; puntual necesita fecha', path: ['recurrente'] })
    .refine((b) => b.recurrente || (b.vigenciaDesde == null && b.vigenciaHasta == null), { message: 'El período solo aplica a bloqueos recurrentes', path: ['vigenciaDesde'] })
    .refine((b) => !b.vigenciaDesde || !b.vigenciaHasta || b.vigenciaDesde <= b.vigenciaHasta, { message: 'El período está invertido', path: ['vigenciaHasta'] }),
  query: empty, params: empty,
});
export const idBloqueoParamSchema = z.object({ body: z.unknown(), query: empty, params: z.object({ id: z.string().min(1) }) });
export const excepcionBloqueoSchema = z.object({
  body: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

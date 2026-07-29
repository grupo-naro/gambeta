import { z } from 'zod';
import { hhmmAMin, cierreMin } from '../utils/tz.js';
const empty = z.looseObject({});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
const hhmmOrEmpty = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Hora inválida (HH:MM) o vacío');

export const updateConfigSchema = z.object({
  body: z.object({
    horaApertura: hhmm.optional(),
    horaCierre: hhmm.optional(),
    horaAperturaFinde: hhmm.optional(),
    horaCierreFinde: hhmm.optional(),
    adminWhatsapp: z.string().min(8).optional(),
    senaModo: z.enum(['PORCENTAJE', 'FIJO']).optional(),
    senaPorcentaje: z.coerce.number().int().min(0).max(100).optional(),
    senaMontoFijo: z.coerce.number().nonnegative().optional(),
    cbu: z.string().optional(),
    alias: z.string().optional(),
    titular: z.string().optional(),
    cbu2: z.string().optional(),
    alias2: z.string().optional(),
    titular2: z.string().optional(),
    picoDesde: hhmmOrEmpty.optional(),
    picoHasta: hhmmOrEmpty.optional(),
    picoFindeDesde: hhmmOrEmpty.optional(),
    picoFindeHasta: hhmmOrEmpty.optional(),
  })
    .refine((b) => !(b.horaApertura && b.horaCierre) || hhmmAMin(b.horaApertura) < cierreMin(b.horaCierre), { message: 'La apertura (semana) debe ser anterior al cierre', path: ['horaCierre'] })
    .refine((b) => !(b.horaAperturaFinde && b.horaCierreFinde) || hhmmAMin(b.horaAperturaFinde) < cierreMin(b.horaCierreFinde), { message: 'La apertura (finde) debe ser anterior al cierre', path: ['horaCierreFinde'] })
    .refine((b) => !(b.picoDesde && b.picoHasta) || b.picoDesde < b.picoHasta, { message: 'La franja pico (semana) es inválida', path: ['picoHasta'] })
    .refine((b) => !(b.picoFindeDesde && b.picoFindeHasta) || b.picoFindeDesde < b.picoFindeHasta, { message: 'La franja pico (finde) es inválida', path: ['picoFindeHasta'] }),
  query: empty,
  params: empty,
});

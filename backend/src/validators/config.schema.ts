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
    // min(1) porque 0 dejaría reservar solo el día en curso: apaga el sitio, y es más fácil
    // de conseguir por accidente que a propósito.
    diasAnticipacionMax: z.coerce.number().int().min(1).max(365).optional(),
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
    // Se compara con los MISMOS helpers que usa `precioDeRango`, no como texto. El desde se lee
    // con `hhmmAMin` (00:00 => minuto 0, arranque del día) y el hasta con `cierreMin`
    // (00:00 => minuto 1440, fin del día). Comparar strings hacía que "20:00" < "00:00" diera
    // falso y rechazaba una franja pico que termina a medianoche — justo la que el complejo
    // necesita cuando el pico corre hasta el cierre — aunque el cálculo de precios sí la soporta.
    .refine((b) => !(b.picoDesde && b.picoHasta) || hhmmAMin(b.picoDesde) < cierreMin(b.picoHasta), { message: 'La franja pico (semana) es inválida', path: ['picoHasta'] })
    .refine((b) => !(b.picoFindeDesde && b.picoFindeHasta) || hhmmAMin(b.picoFindeDesde) < cierreMin(b.picoFindeHasta), { message: 'La franja pico (finde) es inválida', path: ['picoFindeHasta'] }),
  query: empty,
  params: empty,
});

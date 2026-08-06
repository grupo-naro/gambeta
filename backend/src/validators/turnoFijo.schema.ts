import { z } from 'zod';
import { whatsappCanonico } from './whatsapp.field.js';
const empty = z.looseObject({});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
// El regex solo valida el formato: "2026-02-31" lo pasa y Date la corre al 3 de marzo. Se
// reconstruye la fecha en UTC y se compara contra los mismos componentes para confirmar que
// existe de verdad (rechaza 31 de febrero, 30 de febrero, etc).
const fechaReal = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const fechaYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(fechaReal, { message: 'La fecha no existe' });

export const crearTurnoFijoSchema = z.object({
  body: z.object({
    canchaId: z.string().min(1),
    clienteNombre: z.string().min(1),
    whatsapp: whatsappCanonico,
    diaSemana: z.coerce.number().int().min(0).max(6),
    horaInicio: hhmm,
    horaFin: hhmm,
    vigenciaDesde: fechaYmd.optional(),
    vigenciaHasta: fechaYmd.optional(),
    montoAbono: z.coerce.number().positive().max(99999999.99).optional(),
    medioAbono: z.enum(['EFECTIVO', 'TRANSFERENCIA']).optional(),
  })
    .refine((b) => b.horaInicio < b.horaFin, { message: 'La hora de inicio debe ser anterior al fin', path: ['horaFin'] })
    .refine((b) => {
      // Los cuatro van juntos: sin período no hay qué cobrar, y sin medio no se sabe cómo registrarlo.
      const puestos = [b.vigenciaDesde, b.vigenciaHasta, b.montoAbono, b.medioAbono].filter((v) => v != null).length;
      return puestos === 0 || puestos === 4;
    }, { message: 'El abono necesita desde, hasta, monto y medio de pago', path: ['montoAbono'] })
    .refine((b) => !b.vigenciaDesde || !b.vigenciaHasta || b.vigenciaDesde <= b.vigenciaHasta,
      { message: 'El período del abono está invertido', path: ['vigenciaHasta'] }),
  query: empty, params: empty,
});
export const excepcionSchema = z.object({
  body: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const idFijoParamSchema = z.object({ body: z.unknown(), query: empty, params: z.object({ id: z.string().min(1) }) });
export const liberarFijoSchema = z.object({
  body: z.object({ whatsapp: z.string().min(5), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  query: empty, params: empty,
});
export const materializarFijoSchema = z.object({
  body: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
export const misFijosSchema = z.object({
  body: z.unknown(),
  query: z.object({ whatsapp: z.string().min(5) }),
  params: empty,
});

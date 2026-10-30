import { z } from 'zod';
import { whatsappCanonico } from './whatsapp.field.js';
import { hhmmAMin, cierreMin } from '../utils/tz.js';
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

export const disponibilidadFijoSchema = z.object({
  body: z.unknown(),
  query: z.object({
    deporte: z.enum(['futbol', 'padel']),
    diaSemana: z.coerce.number().int().min(0).max(6),
    duracionMin: z.coerce.number().int().refine((n) => [60, 90, 120].includes(n), 'Duración inválida').default(60),
    semanas: z.coerce.number().int().min(1).max(26).default(8),
  }),
  params: empty,
});

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
    // Cuánto pagó en el alta. Sin él se asume que pagó el total del abono. 0 = todavía no pagó.
    montoPagado: z.coerce.number().min(0).max(99999999.99).optional(),
    nota: z.string().trim().max(500).optional(),
  })
    // `cierreMin` y no comparación de texto: "00:00" es el FIN del día (1440). `agenda.service`
    // y `turnoFijo.service` ya calculan la duración con `cierreMin(horaFin)` justamente para el
    // fijo que cierra a medianoche; comparar strings acá lo hacía imposible de crear.
    .refine((b) => hhmmAMin(b.horaInicio) < cierreMin(b.horaFin), { message: 'La hora de inicio debe ser anterior al fin', path: ['horaFin'] })
    .refine((b) => {
      // Los cuatro van juntos: sin período no hay qué cobrar, y sin medio no se sabe cómo registrarlo.
      const puestos = [b.vigenciaDesde, b.vigenciaHasta, b.montoAbono, b.medioAbono].filter((v) => v != null).length;
      return puestos === 0 || puestos === 4;
    }, { message: 'El abono necesita desde, hasta, monto y medio de pago', path: ['montoAbono'] })
    .refine((b) => !b.vigenciaDesde || !b.vigenciaHasta || b.vigenciaDesde <= b.vigenciaHasta,
      { message: 'El período del abono está invertido', path: ['vigenciaHasta'] })
    .refine((b) => b.montoPagado == null || b.montoAbono != null,
      { message: 'No se puede informar un pago sin abono', path: ['montoPagado'] })
    .refine((b) => b.montoPagado == null || b.montoAbono == null || b.montoPagado <= b.montoAbono,
      { message: 'El pago no puede superar el monto del abono', path: ['montoPagado'] }),
  query: empty, params: empty,
});
// Edición parcial: llega solo lo que cambió. El medio de pago NO se edita acá (es el de un cobro
// ya asentado) y los pagos van por /turnos-fijos/:id/cobros. Las reglas que dependen del fijo
// actual (horas cruzadas, período, monto vs. lo cobrado) se validan en el servicio con el
// resultado de aplicar los cambios.
export const editarTurnoFijoSchema = z.object({
  body: z.object({
    canchaId: z.string().min(1).optional(),
    clienteNombre: z.string().min(1).optional(),
    whatsapp: whatsappCanonico.optional(),
    diaSemana: z.coerce.number().int().min(0).max(6).optional(),
    horaInicio: hhmm.optional(),
    horaFin: hhmm.optional(),
    vigenciaDesde: fechaYmd.optional(),
    vigenciaHasta: fechaYmd.optional(),
    montoAbono: z.coerce.number().positive().max(99999999.99).optional(),
    // Vacía ('') borra la nota.
    nota: z.string().trim().max(500).optional(),
  }).refine((b) => Object.keys(b).length > 0, { message: 'No hay nada para editar' }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
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

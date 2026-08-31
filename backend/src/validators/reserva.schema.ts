import { z } from 'zod';
import { whatsappCanonico } from './whatsapp.field.js';
import { DURACIONES_MIN } from '../services/precio.service.js';
const empty = z.looseObject({});

// Deriva del mismo conjunto que usa la grilla de disponibilidad (precio.service.ts). Si alguien
// agrega una duración en un solo lugar, esto deja de coincidir y falla en review, en vez de que
// la grilla ofrezca una duración que `crear` rechaza con 400.
const duracionesValidas: readonly number[] = DURACIONES_MIN;
const duracionMinSchema = z.number().refine((n) => duracionesValidas.includes(n), {
  message: `duracionMin debe ser una de: ${DURACIONES_MIN.join(', ')}`,
});

export const createReservaSchema = z.object({
  body: z.object({
    canchaId: z.string().min(1),
    whatsapp: whatsappCanonico,
    nombreCliente: z.string().min(1),
    esContacto: z.boolean().default(false),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
    duracionMin: duracionMinSchema.optional(),
    montoSena: z.number().nonnegative().optional(),
    metodoSena: z.enum(['MERCADO_PAGO', 'TRANSFERENCIA']).optional(),
    montoCobro: z.number().nonnegative().optional(),
    nombreConfirmado: z.boolean().default(false),
    notas: z.string().optional(),
    // La manda sólo la web pública, con la etiqueta del link por el que llegó el cliente.
    // Mismo formato que valida `POST /visitas`.
    origenEtiqueta: z.string().regex(/^[a-z0-9-]{1,40}$/).nullish(),
    cobroInicial: z.enum(['ninguno', 'sena', 'total']).default('ninguno'),
    medioCobro: z.enum(['EFECTIVO', 'TRANSFERENCIA']).default('EFECTIVO'),
  }),
  query: empty,
  params: empty,
});

export const listReservaSchema = z.object({
  query: z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    canchaId: z.string().optional(),
    estado: z.enum(['CONFIRMADA', 'ESPERANDO_SENA', 'CANCELADA', 'COMPLETADA']).optional(),
    whatsapp: z.string().optional(),
  }),
  body: z.unknown(),
  params: empty,
});

export const aprobarSenaSchema = z.object({
  body: z.object({
    montoDetectado: z.number().optional(),
    comprobanteUrl: z.url().optional(),
  }).default({}),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

export const reprogramarSchema = z.object({
  body: z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
    canchaId: z.string().min(1).optional(),
  }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

export const misReservasSchema = z.object({
  body: z.unknown(),
  query: z.object({ whatsapp: z.string().min(5) }),
  params: empty,
});

export const idParamSchema = z.object({
  body: z.unknown(),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

export const buscarReservaSchema = z.object({
  body: z.unknown(),
  query: z.object({
    nombre: z.string().min(1),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cancha: z.string().optional(),
    hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  }),
  params: empty,
});

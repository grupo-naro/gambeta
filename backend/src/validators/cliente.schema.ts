import { z } from 'zod';
import { whatsappCanonico } from './whatsapp.field.js';
const empty = z.looseObject({});

export const upsertClienteSchema = z.object({
  body: z.object({
    whatsapp: whatsappCanonico,
    nombre: z.string().min(1),
    esContacto: z.boolean().default(false),
    confiable: z.boolean().default(false),
    nombreConfirmado: z.boolean().optional(),
  }),
  query: empty, params: empty,
});

export const buscarClienteSchema = z.object({
  body: z.unknown(),
  query: z.object({ whatsapp: z.string().min(1) }),
  params: empty,
});

export const editarClienteSchema = z.object({
  body: z.object({ nombre: z.string().min(1).optional(), confiable: z.boolean().optional(), whatsapp: whatsappCanonico.optional() }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

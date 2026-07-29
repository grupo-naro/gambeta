import { z } from 'zod';
import { normalizarWhatsapp } from '../utils/whatsapp.js';

const MSG = 'Número inválido. Ingresá los 10 dígitos del celular (ej: 11 3662 0274)';

// Requerido: valida que resuelva y transforma a canónico.
export const whatsappCanonico = z
  .string()
  .refine((s) => normalizarWhatsapp(s) !== null, { message: MSG })
  .transform((s) => normalizarWhatsapp(s) as string);

// Opcional: si viene vacío/undefined queda undefined; si viene con valor, normaliza.
export const whatsappCanonicoOpcional = z
  .string()
  .optional()
  .transform((s) => (s == null || s.trim() === '' ? undefined : s))
  .refine((s) => s === undefined || normalizarWhatsapp(s) !== null, { message: MSG })
  .transform((s) => (s === undefined ? undefined : (normalizarWhatsapp(s) as string)));

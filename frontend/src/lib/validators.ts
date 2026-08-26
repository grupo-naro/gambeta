import { z } from 'zod';
import { aCanonico } from './whatsapp';
import { cierreMin } from './hora';

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Ingresá la contraseña'),
});

export const nuevaReservaSchema = z.object({
  canchaId: z.string().min(1, 'Elegí una cancha'),
  nombreCliente: z.string().min(1, 'Ingresá el nombre'),
  whatsapp: z.string().refine((s) => aCanonico(s) !== null, 'WhatsApp inválido (ej: 11 3662 0274)'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
});

export const reprogramarSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
});

const jugadoresFutbolField = z.coerce.number().int().refine((n) => [5, 6, 7, 9, 11].includes(n), 'Tamaño inválido');
const jugadoresField = z.coerce.number().int().refine((n) => [0, 5, 6, 7, 9, 11].includes(n), 'Tamaño inválido');

export const canchaSchema = z.object({
  nombre: z.string().min(1, 'Ingresá el nombre'),
  tipo: z.string().min(1, 'Elegí el tipo'),
  precioHora: z.coerce.number().positive('El precio debe ser mayor a 0'),
  jugadores: jugadoresField,
  destacada: z.boolean().default(false),
  precioHoraPico: z.coerce.number().nonnegative('No puede ser negativo').default(0),
  senaMonto: z.coerce.number().nonnegative().nullable().optional(),
  precio90: z.number().positive().nullable().optional(),
  precio90Pico: z.number().positive().nullable().optional(),
  precio120: z.number().positive().nullable().optional(),
  precio120Pico: z.number().positive().nullable().optional(),
});

export const canchaDivisibleSchema = z.object({
  nombre: z.string().min(1, 'Ingresá el nombre'),
  partes: z.coerce.number().int().min(2, 'Mínimo 2 partes').max(6, 'Máximo 6'),
  precioEntera: z.coerce.number().positive('Precio inválido'),
  precioParte: z.coerce.number().positive('Precio inválido'),
  jugadoresEntera: jugadoresFutbolField,
  jugadoresParte: jugadoresFutbolField,
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
const hhmmOrEmpty = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Hora inválida (HH:MM)');
export const configSchema = z.object({
  horaApertura: hhmm,
  horaCierre: hhmm,
  horaAperturaFinde: hhmm,
  horaCierreFinde: hhmm,
  adminWhatsapp: z.string().min(8, 'WhatsApp inválido'),
  diasAnticipacionMax: z.coerce.number().int().min(1, 'Tiene que ser al menos 1 día').max(365, 'Máximo 365 días'),
  senaModo: z.enum(['PORCENTAJE', 'FIJO']),
  senaPorcentaje: z.coerce.number().int().min(0).max(100),
  senaMontoFijo: z.coerce.number().nonnegative(),
  cbu: z.string(),
  alias: z.string(),
  titular: z.string(),
  alias2: z.string(),
  cbu2: z.string(),
  titular2: z.string(),
  picoDesde: hhmmOrEmpty,
  picoHasta: hhmmOrEmpty,
  picoFindeDesde: hhmmOrEmpty,
  picoFindeHasta: hhmmOrEmpty,
}).refine((b) => (Number(b.horaApertura.slice(0,2))*60 + Number(b.horaApertura.slice(3,5))) < cierreMin(b.horaCierre), { message: 'La apertura (semana) debe ser anterior al cierre', path: ['horaCierre'] })
  .refine((b) => (Number(b.horaAperturaFinde.slice(0,2))*60 + Number(b.horaAperturaFinde.slice(3,5))) < cierreMin(b.horaCierreFinde), { message: 'La apertura (finde) debe ser anterior al cierre', path: ['horaCierreFinde'] })
  .refine((b) => !(b.picoDesde && b.picoHasta) || b.picoDesde < b.picoHasta, { message: 'Franja pico (semana) inválida', path: ['picoHasta'] })
  .refine((b) => !(b.picoFindeDesde && b.picoFindeHasta) || b.picoFindeDesde < b.picoFindeHasta, { message: 'Franja pico (finde) inválida', path: ['picoFindeHasta'] });

export const turnoFijoSchema = z.object({
  canchaId: z.string().min(1, 'Elegí una cancha'),
  clienteNombre: z.string().min(1, 'Ingresá el cliente'),
  whatsapp: z.string().refine((s) => aCanonico(s) !== null, 'WhatsApp inválido (ej: 11 3662 0274)'),
  diaSemana: z.coerce.number().int().min(0).max(6),
  horaInicio: hhmm, horaFin: hhmm,
}).refine((b) => b.horaInicio < b.horaFin, { message: 'Inicio debe ser antes del fin', path: ['horaFin'] });

export const usuarioSchema = z.object({
  email: z.string().email('Email inválido'),
  nombre: z.string().min(1, 'Ingresá el nombre'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  rol: z.enum(['ADMIN', 'RECEPCIONISTA']),
  duracionDias: z.union([z.literal(1), z.literal(2), z.literal(7), z.literal(30)]).optional(),
});

export const cobroSchema = z.object({
  monto: z.coerce.number().positive('El monto debe ser mayor a 0'),
  medio: z.enum(['EFECTIVO', 'TRANSFERENCIA']),
});

export const bloqueoSchema = z.object({
  canchaId: z.string().min(1, 'Elegí una cancha'),
  motivo: z.enum(['TORNEO', 'ENTRENAMIENTO', 'MANTENIMIENTO', 'OTRO']),
  recurrente: z.boolean(),
  diaSemana: z.coerce.number().int().min(0).max(6).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  horaInicio: hhmm, horaFin: hhmm,
  nota: z.string().optional(),
}).refine((b) => b.horaInicio < b.horaFin, { message: 'Inicio debe ser antes del fin', path: ['horaFin'] })
  .refine((b) => (b.recurrente ? b.diaSemana != null : !!b.fecha), { message: 'Completá día (recurrente) o fecha (puntual)', path: ['recurrente'] });

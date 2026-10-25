import { z } from 'zod';
import { aCanonico } from './whatsapp';
import { cierreMin, hhmmAMin, minutoDeJornada, cierreDeJornada } from './hora';

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
  turnoBloqueMin: z.union([z.literal(60), z.literal(90), z.literal(120)]).nullable().optional(),
  turnoDesfaseMin: z.number().int().min(0).max(120).optional(),
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
// Opcional a propósito: el backend puede no tenerlo todavía (deploy escalonado panel/backend),
// y en ese caso el campo debe poder quedar vacío sin bloquear el resto del formulario ni viajar en el PATCH.
const diasAnticipacionMaxOrEmpty = z.string().optional()
  .transform((s) => (s === undefined || s === '' ? undefined : Number(s)))
  .refine((n) => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 365), 'Tiene que ser un entero entre 1 y 365 días');
export const configSchema = z.object({
  horaApertura: hhmm,
  horaCierre: hhmm,
  horaAperturaFinde: hhmm,
  horaCierreFinde: hhmm,
  adminWhatsapp: z.string().min(8, 'WhatsApp inválido'),
  diasAnticipacionMax: diasAnticipacionMaxOrEmpty,
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
})
  // `cierreDeJornada` y no `cierreMin`: con apertura 07:00, un cierre a la 01:00 son 1500
  // minutos, no 60. Para los cierres de hoy (23:00, 00:00) da exactamente lo mismo. Acá la
  // apertura siempre está disponible (es un campo requerido de todo el formulario, no un PATCH
  // parcial), así que no hace falta el resguardo que sí necesita el schema del backend. No se usa
  // `minutoDeJornada`: esa cruza al día siguiente para CUALQUIER hora anterior a la apertura, sin
  // límite, y eso aceptaba pares invertidos por error de carga (ej. apertura 22:00, cierre 20:00)
  // como si fueran una jornada de 22 horas. `cierreDeJornada` sólo cruza si el cierre cae temprano
  // en la madrugada (antes de las 06:00), que es lo único que un complejo real hace.
  .refine((b) => hhmmAMin(b.horaApertura) < cierreDeJornada(b.horaCierre, b.horaApertura), { message: 'La apertura (semana) debe ser anterior al cierre', path: ['horaCierre'] })
  .refine((b) => hhmmAMin(b.horaAperturaFinde) < cierreDeJornada(b.horaCierreFinde, b.horaAperturaFinde), { message: 'La apertura (finde) debe ser anterior al cierre', path: ['horaCierreFinde'] })
  .refine((b) => !(b.picoDesde && b.picoHasta) || minutoDeJornada(b.picoDesde, b.horaApertura) < cierreDeJornada(b.picoHasta, b.horaApertura), { message: 'Franja pico (semana) inválida', path: ['picoHasta'] })
  .refine((b) => !(b.picoFindeDesde && b.picoFindeHasta) || minutoDeJornada(b.picoFindeDesde, b.horaAperturaFinde) < cierreDeJornada(b.picoFindeHasta, b.horaAperturaFinde), { message: 'Franja pico (finde) inválida', path: ['picoFindeHasta'] });

export const turnoFijoSchema = z.object({
  canchaId: z.string().min(1, 'Elegí una cancha'),
  clienteNombre: z.string().min(1, 'Ingresá el cliente'),
  whatsapp: z.string().refine((s) => aCanonico(s) !== null, 'WhatsApp inválido (ej: 11 3662 0274)'),
  diaSemana: z.coerce.number().int().min(0).max(6),
  horaInicio: hhmm, horaFin: hhmm,
}).refine((b) => hhmmAMin(b.horaInicio) < cierreMin(b.horaFin), { message: 'Inicio debe ser antes del fin', path: ['horaFin'] });

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
  // Período de un bloqueo recurrente (inclusivo, cada extremo opcional).
  vigenciaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vigenciaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((b) => hhmmAMin(b.horaInicio) < cierreMin(b.horaFin), { message: 'Inicio debe ser antes del fin', path: ['horaFin'] })
  .refine((b) => (b.recurrente ? b.diaSemana != null : !!b.fecha), { message: 'Completá día (recurrente) o fecha (puntual)', path: ['recurrente'] })
  .refine((b) => !b.vigenciaDesde || !b.vigenciaHasta || b.vigenciaDesde <= b.vigenciaHasta, { message: 'El período está invertido: "Desde" es posterior a "Hasta"', path: ['vigenciaHasta'] });

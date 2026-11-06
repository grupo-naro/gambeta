import { z } from 'zod';
import { hhmmAMin, cierreMin, minutoDeJornada, cierreDeJornada } from '../utils/tz.js';
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
    // `cierreDeJornada` y no `cierreMin`: con apertura 07:00, un cierre a la 01:00 son 1500
    // minutos, no 60. Para los cierres de hoy (23:00, 00:00) da exactamente lo mismo. No se usa
    // `minutoDeJornada`: esa cruza al día siguiente para CUALQUIER hora anterior a la apertura,
    // sin límite, y eso aceptaba pares invertidos por error de carga (ej. apertura 22:00, cierre
    // 20:00) como si fueran una jornada de 22 horas. `cierreDeJornada` sólo cruza si el cierre cae
    // temprano en la madrugada (antes de las 06:00), que es lo único que un complejo real hace.
    .refine((b) => !(b.horaApertura && b.horaCierre) || hhmmAMin(b.horaApertura) < cierreDeJornada(b.horaCierre, b.horaApertura), { message: 'La apertura (semana) debe ser anterior al cierre', path: ['horaCierre'] })
    .refine((b) => !(b.horaAperturaFinde && b.horaCierreFinde) || hhmmAMin(b.horaAperturaFinde) < cierreDeJornada(b.horaCierreFinde, b.horaAperturaFinde), { message: 'La apertura (finde) debe ser anterior al cierre', path: ['horaCierreFinde'] })
    // Si la apertura no viene en el mismo body, no se puede resolver la jornada de la franja pico
    // (¿"01:00" es antes o después del cierre?) — se cae al chequeo de siempre (`cierreMin`), que
    // sigue detectando una franja invertida o de ancho cero aunque no entienda la madrugada. La
    // validación completa, con la apertura efectiva, la hace `config.service.ts`.
    .refine((b) => !(b.picoDesde && b.picoHasta) || (b.horaApertura ? minutoDeJornada(b.picoDesde, b.horaApertura) < cierreDeJornada(b.picoHasta, b.horaApertura) : hhmmAMin(b.picoDesde) < cierreMin(b.picoHasta)), { message: 'La franja pico (semana) es inválida', path: ['picoHasta'] })
    .refine((b) => !(b.picoFindeDesde && b.picoFindeHasta) || (b.horaAperturaFinde ? minutoDeJornada(b.picoFindeDesde, b.horaAperturaFinde) < cierreDeJornada(b.picoFindeHasta, b.horaAperturaFinde) : hhmmAMin(b.picoFindeDesde) < cierreMin(b.picoFindeHasta)), { message: 'La franja pico (finde) es inválida', path: ['picoFindeHasta'] }),
  query: empty,
  params: empty,
});

const pinDashboard = z.string().regex(/^\d{4,8}$/, 'El PIN tiene entre 4 y 8 dígitos');
export const fijarPinDashboardSchema = z.object({
  body: z.object({ pin: pinDashboard, pinActual: z.string().min(1).optional() }),
  query: z.looseObject({}), params: z.looseObject({}),
});
export const verificarPinDashboardSchema = z.object({
  body: z.object({ pin: z.string().min(1).max(32) }),
  query: z.looseObject({}), params: z.looseObject({}),
});
export const quitarPinDashboardSchema = z.object({
  body: z.object({ pinActual: z.string().min(1).max(32) }),
  query: z.looseObject({}), params: z.looseObject({}),
});

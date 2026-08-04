import { getEnv } from '../config/env.js';
import { dayOfWeekInTz, hhmmAMin, cierreMin } from '../utils/tz.js';

interface CanchaPrecio { precioHora: unknown; precioHoraPico: unknown }
interface PicoCfg { picoDesde: string; picoHasta: string; picoFindeDesde: string; picoFindeHasta: string }

/** Duraciones de reserva permitidas, en minutos. Única fuente de verdad: la grilla de
 * disponibilidad y el schema zod de creación derivan de esta constante para no desincronizarse. */
export const DURACIONES_MIN = [60, 90, 120] as const;

/** Duración por defecto cuando la reserva no especifica `duracionMin`. */
export const DURACION_DEFAULT_MIN = 60;

/**
 * Precio de una reserva de `duracionMin` minutos que arranca a `horaInicio` (HH:MM) el `fecha`
 * (YYYY-MM-DD). Prorratea: cobra a precio pico solo los minutos que caen dentro de la franja,
 * así una reserva de 17:00 a 19:00 sale 1 hora base + 1 hora pico y no una de las dos cosas.
 */
export function precioDeRango(
  cancha: CanchaPrecio,
  fecha: string,
  horaInicio: string,
  duracionMin: number,
  cfg: PicoCfg,
): number {
  const base = Number(cancha.precioHora);
  const pico = Number(cancha.precioHoraPico);
  // Se divide por 60 una sola vez, al final, sobre la suma de minuto-pesos: dividir cada
  // término por separado (duracionMin * (base / 60)) arrastra error de punto flotante
  // (60 * (1000/60) === 1000.0000000000001) y rompe comparaciones exactas de plata.
  // Math.round además evita devolver más de dos decimales (la columna es Decimal(10,2) y
  // Postgres los trunca en silencio); redondeamos a pesos enteros.
  if (!(pico > 0)) return Math.round((duracionMin * base) / 60);

  const wd = dayOfWeekInTz(fecha, getEnv().TZ_NEGOCIO); // 0=domingo..6=sábado
  const esFinde = wd === 0 || wd === 6;
  const desdeStr = esFinde ? cfg.picoFindeDesde : cfg.picoDesde;
  const hastaStr = esFinde ? cfg.picoFindeHasta : cfg.picoHasta;
  if (!desdeStr || !hastaStr) return Math.round((duracionMin * base) / 60);

  // cierreMin() mapea "00:00" a 1440. Sin esto, la comparación de strings del código viejo
  // daba "18:00" >= "00:00" === true y anulaba el pico de toda franja que cerrara a medianoche.
  const desde = hhmmAMin(desdeStr);
  const hasta = cierreMin(hastaStr);
  if (desde >= hasta) return Math.round((duracionMin * base) / 60);

  const ini = hhmmAMin(horaInicio);
  const fin = ini + duracionMin;
  const minutosPico = Math.max(0, Math.min(fin, hasta) - Math.max(ini, desde));
  const minutosBase = duracionMin - minutosPico;
  return Math.round((minutosPico * pico + minutosBase * base) / 60);
}

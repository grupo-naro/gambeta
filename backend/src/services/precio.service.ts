import { getEnv } from '../config/env.js';
import { dayOfWeekInTz, hhmmAMin, cierreMin } from '../utils/tz.js';

interface CanchaPrecio {
  precioHora: unknown; precioHoraPico: unknown;
  precio90?: unknown; precio90Pico?: unknown;
  precio120?: unknown; precio120Pico?: unknown;
}
interface PicoCfg { picoDesde: string; picoHasta: string; picoFindeDesde: string; picoFindeHasta: string }

/** Duraciones de reserva permitidas, en minutos. Única fuente de verdad: la grilla de
 * disponibilidad y el schema zod de creación derivan de esta constante para no desincronizarse. */
export const DURACIONES_MIN = [60, 90, 120] as const;

/** Duración por defecto cuando la reserva no especifica `duracionMin`. */
export const DURACION_DEFAULT_MIN = 60;

export interface ReglasDeAgenda {
  /** Cada cuántos minutos puede arrancar un turno. */
  pasoMin: number;
  /** Duraciones reservables, en minutos. Siempre ascendente. */
  duracionesMin: readonly number[];
}

/**
 * Reglas de agenda según el deporte de la cancha.
 *
 * El fútbol se agenda **por hora en punto** y su único modificador de precio es la franja pico:
 * no admite turnos de 1½ ni de 2 horas, ni arranques a y media. El pádel sí, porque el complejo
 * vende esas duraciones.
 *
 * Se deriva de `Cancha.tipo` (`futbol5`, `futbol7`, `padel`), con el mismo criterio que ya usa
 * `disponibilidad.service.grilla` para separar deportes. Si algún día esto tiene que ser
 * configurable por cancha desde el panel, **este es el único lugar que hay que cambiar**.
 */
export function reglasDeAgenda(tipo: string): ReglasDeAgenda {
  const esFutbol = tipo.toLowerCase().startsWith('futbol');
  return esFutbol
    ? { pasoMin: 60, duracionesMin: [60] }
    : { pasoMin: 30, duracionesMin: DURACIONES_MIN };
}

/**
 * Tarifas horarias (base y pico) a usar para una duración dada.
 *
 * Un precio propio por duración se expresa como su tarifa horaria equivalente
 * (`precio × 60 / duracion`), y así el prorrateo de `precioDeRango` no cambia: solo cambia
 * de dónde salen sus dos tarifas. Sin precio propio devuelve las de la cancha, que es
 * exactamente el comportamiento de siempre.
 *
 * La decisión es por duración y por banda: si falta el precio de una banda, esa banda cae
 * al proporcional aunque la otra tenga precio propio.
 */
function tarifasDe(cancha: CanchaPrecio, duracionMin: number): { base: number; pico: number } {
  const base = Number(cancha.precioHora);
  const pico = Number(cancha.precioHoraPico);
  const propio = duracionMin === 90
    ? { b: cancha.precio90, p: cancha.precio90Pico }
    : duracionMin === 120
    ? { b: cancha.precio120, p: cancha.precio120Pico }
    : { b: null, p: null }; // 1 hora: precioHora YA es su precio propio.
  const aTarifa = (v: unknown) => (v == null ? null : (Number(v) * 60) / duracionMin);
  return { base: aTarifa(propio.b) ?? base, pico: aTarifa(propio.p) ?? pico };
}

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
  const { base, pico } = tarifasDe(cancha, duracionMin);
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

import { getEnv } from '../config/env.js';
import { dayOfWeekInTz, minutoDeJornada } from '../utils/tz.js';

interface CanchaPrecio {
  precioHora: unknown; precioHoraPico: unknown;
  precio90?: unknown; precio90Pico?: unknown;
  precio120?: unknown; precio120Pico?: unknown;
}
interface JornadaCfg {
  horaApertura: string; horaAperturaFinde: string;
  picoDesde: string; picoHasta: string;
  picoFindeDesde: string; picoFindeHasta: string;
}

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
  /** Minutos desde la apertura hasta el primer turno. Solo con bloque fijo; si no, 0. */
  desfaseMin: number;
  /** true si la cancha trabaja en bloques fijos alineados a (apertura + desfaseMin). */
  bloqueFijo: boolean;
}

/** Lo que `reglasDeAgenda` necesita saber de la cancha además de su tipo. */
export interface CanchaAgenda { tipo: string; turnoBloqueMin?: number | null; turnoDesfaseMin?: number | null }

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
export function reglasDeAgenda(cancha: string | CanchaAgenda): ReglasDeAgenda {
  const { tipo, turnoBloqueMin, turnoDesfaseMin } = typeof cancha === 'string' ? { tipo: cancha } as CanchaAgenda : cancha;
  // Bloque fijo (pádel escalonado): un solo largo de turno y un paso igual a ese largo, con el
  // primer turno corrido `desfaseMin` desde la apertura.
  if (turnoBloqueMin) {
    return { pasoMin: turnoBloqueMin, duracionesMin: [turnoBloqueMin], desfaseMin: turnoDesfaseMin ?? 0, bloqueFijo: true };
  }
  const esFutbol = tipo.toLowerCase().startsWith('futbol');
  return esFutbol
    ? { pasoMin: 60, duracionesMin: [60], desfaseMin: 0, bloqueFijo: false }
    : { pasoMin: 30, duracionesMin: DURACIONES_MIN, desfaseMin: 0, bloqueFijo: false };
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
  cfg: JornadaCfg,
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
  const apertura = esFinde ? cfg.horaAperturaFinde : cfg.horaApertura;
  const desdeStr = esFinde ? cfg.picoFindeDesde : cfg.picoDesde;
  const hastaStr = esFinde ? cfg.picoFindeHasta : cfg.picoHasta;
  if (!desdeStr || !hastaStr) return Math.round((duracionMin * base) / 60);

  // Todo en minutos de jornada: una hora anterior a la apertura pertenece al día siguiente.
  // Sin esto, un pico de 20:00 a 01:00 se leía como [1200, 60) —invertido— y la función caía al
  // precio base anulando el pico todo el día; y el turno de las 00:00 se leía como el minuto 0,
  // así que no caía dentro de ninguna franja y el turno más caro salía al precio más barato.
  const desde = minutoDeJornada(desdeStr, apertura);
  const hasta = minutoDeJornada(hastaStr, apertura);
  if (desde >= hasta) return Math.round((duracionMin * base) / 60);

  const ini = minutoDeJornada(horaInicio, apertura);
  const fin = ini + duracionMin;
  const minutosPico = Math.max(0, Math.min(fin, hasta) - Math.max(ini, desde));
  const minutosBase = duracionMin - minutosPico;
  return Math.round((minutosPico * pico + minutosBase * base) / 60);
}

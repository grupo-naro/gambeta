import { getEnv } from '../config/env.js';
import { dayOfWeekInTz } from '../utils/tz.js';

interface CanchaPrecio { precioHora: unknown; precioHoraPico: unknown }
interface PicoCfg { picoDesde: string; picoHasta: string; picoFindeDesde: string; picoFindeHasta: string }

/** Precio efectivo (base o pico) para una reserva que empieza en `horaInicio` (HH:MM) el `fecha` (YYYY-MM-DD). */
export function precioEfectivo(cancha: CanchaPrecio, fecha: string, horaInicio: string, cfg: PicoCfg): number {
  const base = Number(cancha.precioHora);
  const pico = Number(cancha.precioHoraPico);
  if (!(pico > 0)) return base;
  const wd = dayOfWeekInTz(fecha, getEnv().TZ_NEGOCIO); // 0=domingo..6=sábado
  const esFinde = wd === 0 || wd === 6;
  const desde = esFinde ? cfg.picoFindeDesde : cfg.picoDesde;
  const hasta = esFinde ? cfg.picoFindeHasta : cfg.picoHasta;
  if (!desde || !hasta || desde >= hasta) return base;
  return desde <= horaInicio && horaInicio < hasta ? pico : base;
}

import { getEnv } from '../config/env.js';
import { dayWindowUtc } from './tz.js';
import { BadRequest } from './errors.js';

const DIAS_POR_DEFECTO = 90;

/**
 * Traduce `?desde=&hasta=` a un rango UTC.
 *
 * Las fechas son del negocio, así que se interpretan en `TZ_NEGOCIO`: un cierre de las 23:00
 * del día `hasta` tiene que entrar en el reporte, y por eso el fin del rango es el comienzo
 * del día SIGUIENTE (`dayWindowUtc(...).end`), no el del propio `hasta`.
 *
 * Sin parámetros, los últimos 90 días: sin ventana la consulta crece sin techo, y "faltó
 * siempre lo mismo" pierde valor cuanto más viejo es el dato.
 */
export function rangoDeFechas(desde?: string, hasta?: string): { start: Date; end: Date } {
  const tz = getEnv().TZ_NEGOCIO;
  const end = hasta ? dayWindowUtc(hasta, tz).end : new Date();
  const start = desde
    ? dayWindowUtc(desde, tz).start
    : new Date(end.getTime() - DIAS_POR_DEFECTO * 24 * 60 * 60 * 1000);
  if (start >= end) throw BadRequest('El rango de fechas está invertido');
  return { start, end };
}

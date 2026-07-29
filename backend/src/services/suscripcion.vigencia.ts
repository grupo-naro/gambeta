import type { EstadoSuscripcion } from '../db/client.js';

/**
 * Helpers puros de vigencia. Sin acceso a base de datos, para poder testear todos los
 * bordes de fechas sin levantar un contenedor.
 *
 * Convención: las fechas de negocio se manejan como strings 'YYYY-MM-DD'. En la DB son
 * columnas `@db.Date`, que Prisma devuelve como Date a medianoche UTC.
 */

/** Día de hoy en la zona del negocio (no en UTC). */
export function hoyEnTz(tz: string, ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ahora);
}

/** 'YYYY-MM-DD' → Date a medianoche UTC, que es como Postgres guarda un `@db.Date`. */
export function aFechaUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Date de una columna `@db.Date` → 'YYYY-MM-DD'. */
export function deFechaUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ¿La suscripción cubre esa fecha? El vencimiento es INCLUSIVE. */
export function cubreFecha(s: { inicio: Date; vencimiento: Date }, ymd: string): boolean {
  return deFechaUtc(s.inicio) <= ymd && ymd <= deFechaUtc(s.vencimiento);
}

/** Suma un mes calendario. Si el mes destino es más corto, recorta (31/01 → 28/02). */
export function sumarUnMes(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const anio = m === 12 ? y + 1 : y;
  const mes = m === 12 ? 1 : m + 1;
  // Día 0 del mes siguiente = último día del mes destino.
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function diaSiguiente(ymd: string): string {
  const d = aFechaUtc(ymd);
  d.setUTCDate(d.getUTCDate() + 1);
  return deFechaUtc(d);
}

/**
 * Inicio de una renovación: el día siguiente al vencimiento anterior, o hoy si ese día ya pasó.
 * Renovación anticipada → no pierde días pagos. Renovación tardía → no regala días retroactivos.
 */
export function inicioRenovacion(vencimientoAnterior: string, hoy: string): string {
  const siguiente = diaSiguiente(vencimientoAnterior);
  return siguiente > hoy ? siguiente : hoy;
}

export type EstadoVista = 'ACTIVA' | 'VENCIDA' | 'CANCELADA';

/** "Vencida" NO se persiste: se deriva de la fecha. Por eso no hace falta ningún cron. */
export function estadoVista(s: { estado: EstadoSuscripcion; vencimiento: Date }, hoy: string): EstadoVista {
  if (s.estado === 'CANCELADA') return 'CANCELADA';
  return deFechaUtc(s.vencimiento) < hoy ? 'VENCIDA' : 'ACTIVA';
}

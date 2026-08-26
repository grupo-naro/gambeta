export function hhmmAMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
/** Minutos de cierre; "00:00" = fin del día (1440). */
export function cierreMin(hhmm: string): number { const min = hhmmAMin(hhmm); return min === 0 ? 1440 : min; }

function offsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  // Normalize '24' hour (some runtimes emit '24' for midnight)
  const rawHour = parts.hour === '24' ? '0' : parts.hour;
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(rawHour), Number(parts.minute), Number(parts.second),
  );
  return (date.getTime() - asUTC) / 60000;
}

export function combineDateTimeUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const off = offsetMinutes(guess, timeZone);
  return new Date(guess.getTime() + off * 60000);
}

export function dayOfWeekInTz(date: string, timeZone: string): number {
  const noonUtc = combineDateTimeUtc(date, '12:00', timeZone);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(noonUtc);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

export function dayWindowUtc(date: string, timeZone: string): { start: Date; end: Date } {
  const start = combineDateTimeUtc(date, '00:00', timeZone);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** El día de hoy en la zona del negocio, como "YYYY-MM-DD". */
export function hoyEnTz(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * Suma días de calendario a un "YYYY-MM-DD". Se usa `Date.UTC` a propósito: la fecha es un
 * rótulo sin hora, así que sumarle días en UTC no puede caer en un salto de huso.
 */
export function sumarDias(date: string, dias: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

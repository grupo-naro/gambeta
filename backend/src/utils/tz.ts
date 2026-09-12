export function hhmmAMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
/** Minutos de cierre; "00:00" = fin del día (1440). */
export function cierreMin(hhmm: string): number { const min = hhmmAMin(hhmm); return min === 0 ? 1440 : min; }

/**
 * Minuto de una hora "HH:MM" dentro de la jornada que arranca en `apertura`. Una hora anterior
 * a la apertura pertenece al día siguiente y suma 1440: con apertura 07:00, "01:00" son 1500
 * minutos, no 60.
 *
 * Esta regla subsume a `cierreMin`, que sólo entiende "00:00" como fin de día. Para las
 * configuraciones que ya existen da exactamente el mismo resultado.
 */
export function minutoDeJornada(hhmm: string, apertura: string): number {
  const m = hhmmAMin(hhmm);
  return m < hhmmAMin(apertura) ? m + 1440 : m;
}

/** Tope de la madrugada hasta el que un CIERRE (de jornada o de franja pico) puede legítimamente
 *  extenderse al día siguiente: 06:00. Sin este tope, comparar una apertura tardía (ej. 16:00)
 *  contra un cierre temprano cargado por error (ej. 10:00) se interpretaba como una jornada o una
 *  franja pico de casi un día entero, en vez de rechazar el dato invertido. Un complejo real
 *  cierra a la 1, 2 o 3 de la mañana — nunca "al mediodía siguiente". */
export const LIMITE_MADRUGADA_MIN = 360; // 06:00

/**
 * Como `minutoDeJornada`, pero sólo cruza al día siguiente si la hora cae en la madrugada
 * temprana (antes de las 06:00). Se usa para validar que un CIERRE (de jornada o de franja pico)
 * tenga sentido frente a su apertura — no para ubicar un evento ya conocido dentro de una jornada
 * ya válida, que es lo que sigue haciendo `minutoDeJornada` sin este tope.
 */
export function cierreDeJornada(hhmm: string, apertura: string): number {
  const m = hhmmAMin(hhmm);
  return (m < hhmmAMin(apertura) && m < LIMITE_MADRUGADA_MIN) ? m + 1440 : m;
}

/** Etiqueta de un minuto de jornada, como lo diría un reloj: 1440 => "00:00", 1500 => "01:00". */
export function hhmmDeMin(m: number): string {
  const d = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
}

/**
 * Instante UTC del minuto `m` de la jornada de `fecha`. A partir de 1440 cruza al día siguiente.
 *
 * Se usa `combineDateTimeUtc` en las dos ramas —y no aritmética de milisegundos sobre el arranque
 * del día— para que siga siendo correcto ante un eventual cambio de huso.
 */
export function instanteDeJornada(fecha: string, m: number, timeZone: string): Date {
  return m < 1440
    ? combineDateTimeUtc(fecha, hhmmDeMin(m), timeZone)
    : combineDateTimeUtc(sumarDias(fecha, Math.floor(m / 1440)), hhmmDeMin(m), timeZone);
}

/** Ventana UTC real de la jornada: de la apertura al cierre, aunque cruce la medianoche. */
export function jornadaWindowUtc(fecha: string, timeZone: string, apertura: string, cierre: string): { start: Date; end: Date } {
  return {
    start: instanteDeJornada(fecha, hhmmAMin(apertura), timeZone),
    end: instanteDeJornada(fecha, minutoDeJornada(cierre, apertura), timeZone),
  };
}

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

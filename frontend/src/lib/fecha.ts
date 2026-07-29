const TZ = 'America/Argentina/Buenos_Aires';

export function hoyAR(): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(d);
  const h = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${f} ${h}`;
}

export interface Filtros { fecha: string; canchaId: string; estado: string }
export function parseFiltros(sp: Record<string, string | undefined>): Filtros {
  return {
    fecha: sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : hoyAR(),
    canchaId: sp.canchaId ?? '',
    estado: sp.estado ?? '',
  };
}

export function fmtHora(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** Suma n días a un 'YYYY-MM-DD' y devuelve 'YYYY-MM-DD' (sin corrimientos de TZ). */
export function addDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  return new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);
}

export function esHoy(ymd: string): boolean {
  return ymd === hoyAR();
}

/** "martes 15 de junio" */
export function fmtFechaLarga(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(base);
}

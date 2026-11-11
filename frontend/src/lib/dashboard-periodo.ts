import { addDias, fmtFechaLarga } from './fecha';

const DIAS_ATRAS: Record<string, number> = { hoy: 0, '7': 6, '30': 29 };
const ETIQUETA: Record<string, string> = { hoy: 'Hoy', '7': 'Últimos 7 días', semana: 'Esta semana', '30': 'Últimos 30 días', mes: 'Este mes' };
const MAX_DIAS = 366;

export interface PeriodoDashboard {
  /** 'hoy' | '7' | 'semana' | '30' | 'mes' | 'fecha' (un día o un rango elegido a mano). */
  periodo: string;
  /** 'YYYY-MM-DD', inclusivo en los dos extremos. */
  desde: string;
  hasta: string;
  etiqueta: string;
}

const esYmd = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ddmmyyyy = (ymd: string) => ymd.split('-').reverse().join('/');

/**
 * El período que pide la URL del dashboard. Además de los atajos (hoy, 7 días, semana, 30 días, mes)
 * acepta `periodo=fecha` con `desde` y, opcionalmente, `hasta`: un día puntual o un rango.
 * Nunca mira al futuro (se recorta a hoy), ordena las fechas si vienen al revés y limita el rango a un año.
 * Cualquier valor raro cae en los últimos 30 días.
 */
export function resolverPeriodo(sp: { periodo?: string; desde?: string; hasta?: string }, hoy: string): PeriodoDashboard {
  if (sp.periodo === 'fecha' && esYmd(sp.desde)) {
    let desde = sp.desde;
    let hasta = esYmd(sp.hasta) ? sp.hasta : desde;
    if (desde > hasta) [desde, hasta] = [hasta, desde];
    if (hasta > hoy) hasta = hoy;
    if (desde > hoy) desde = hoy;
    const tope = addDias(hasta, -(MAX_DIAS - 1));
    if (desde < tope) desde = tope;
    const etiqueta = desde === hasta ? mayus(fmtFechaLarga(desde)) : `${ddmmyyyy(desde)} al ${ddmmyyyy(hasta)}`;
    return { periodo: 'fecha', desde, hasta, etiqueta };
  }

  const periodo = sp.periodo && (sp.periodo in DIAS_ATRAS || sp.periodo === 'mes' || sp.periodo === 'semana') ? sp.periodo : '30';
  const diaSemana = new Date(hoy + 'T00:00:00Z').getUTCDay(); // 0 = domingo
  // "Esta semana" arranca el lunes; "Este mes", el día 1; los demás son los últimos N días hasta hoy.
  const desde = periodo === 'mes' ? `${hoy.slice(0, 8)}01`
    : periodo === 'semana' ? addDias(hoy, -((diaSemana + 6) % 7))
    : addDias(hoy, -DIAS_ATRAS[periodo]);
  return { periodo, desde, hasta: hoy, etiqueta: ETIQUETA[periodo] };
}

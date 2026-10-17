import type { TurnoFijo, Bloqueo, MotivoBloqueo, EstadoReserva } from './types';
import { hhmmAMin, minutoDeJornada, hhmmDeMin, sumarDias } from './hora';

export const TZ = 'America/Argentina/Buenos_Aires';

// Paleta fija de colores por cancha. Clases Tailwind ESTÁTICAS (no generadas
// dinámicamente) para que el JIT no las purgue.
export interface ColorCancha { bg: string; text: string; border: string; dot: string }
export const PALETA: ColorCancha[] = [
  { bg: 'bg-blue-100', text: 'text-blue-900', border: 'border-blue-400', dot: 'bg-blue-500' },
  { bg: 'bg-emerald-100', text: 'text-emerald-900', border: 'border-emerald-400', dot: 'bg-emerald-500' },
  { bg: 'bg-amber-100', text: 'text-amber-900', border: 'border-amber-400', dot: 'bg-amber-500' },
  { bg: 'bg-violet-100', text: 'text-violet-900', border: 'border-violet-400', dot: 'bg-violet-500' },
  { bg: 'bg-rose-100', text: 'text-rose-900', border: 'border-rose-400', dot: 'bg-rose-500' },
  { bg: 'bg-cyan-100', text: 'text-cyan-900', border: 'border-cyan-400', dot: 'bg-cyan-500' },
  { bg: 'bg-orange-100', text: 'text-orange-900', border: 'border-orange-400', dot: 'bg-orange-500' },
  { bg: 'bg-lime-100', text: 'text-lime-900', border: 'border-lime-400', dot: 'bg-lime-500' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-900', border: 'border-fuchsia-400', dot: 'bg-fuchsia-500' },
  { bg: 'bg-teal-100', text: 'text-teal-900', border: 'border-teal-400', dot: 'bg-teal-500' },
];

export function colorDeCancha(canchaId: string, canchas: { id: string }[]): ColorCancha {
  const ordenadas = [...canchas].sort((a, b) => a.id.localeCompare(b.id));
  const idx = ordenadas.findIndex((c) => c.id === canchaId);
  return PALETA[(idx < 0 ? 0 : idx) % PALETA.length];
}

/** "2" -> "Cancha 2"; "4/1" -> "Cancha 4/1"; "TECHADA" -> "TECHADA"; vacio -> "Cancha". */
export function nombreCancha(nombre?: string | null): string {
  const n = (nombre ?? '').trim();
  if (!n) return 'Cancha';
  return /^[\d/]+$/.test(n) ? 'Cancha ' + n : n;
}

function toYMD(dateUtcMidnight: Date): string {
  return dateUtcMidnight.toISOString().slice(0, 10);
}

export function semanaDe(ancla: string): { lunes: string; domingo: string; dias: string[] } {
  const [y, m, d] = ancla.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const diffToMon = (base.getUTCDay() + 6) % 7; // días desde el lunes
  const lunesMs = base.getTime() - diffToMon * 86400000;
  const dias: string[] = [];
  for (let i = 0; i < 7; i++) dias.push(toYMD(new Date(lunesMs + i * 86400000)));
  return { lunes: dias[0], domingo: dias[6], dias };
}

export function ubicarEnTz(iso: string, apertura: string): { fecha: string; horaNum: number; minuto: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  let horaNum = Number(get('hour'));
  if (horaNum === 24) horaNum = 0;
  const minuto = Number(get('minute'));
  let fecha = `${get('year')}-${get('month')}-${get('day')}`;
  // Si la hora calendario es anterior a la apertura, el instante pertenece a la JORNADA del día
  // anterior, no al día calendario en el que cae — mismo criterio que minutoDeJornada del lado
  // del backend. Sin esto, una reserva de las 00:00 (guardada con el instante del día siguiente)
  // aparecía en la columna del día equivocado del calendario semanal.
  if (horaNum * 60 + minuto < hhmmAMin(apertura)) {
    fecha = sumarDias(fecha, -1);
  }
  return { fecha, horaNum, minuto };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 1110 -> "18:30". Minutos desde la medianoche. */
export function hhmmDeMinutos(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

// Lista de horas ("HH:00") de la jornada, de la apertura a una hora antes del cierre. Si el
// cierre cruza la medianoche (p.ej. apertura 07:00, cierre 01:00), la lista llega hasta "00:00".
export function horasDelDia(apertura: string, cierre: string): string[] {
  const out: string[] = [];
  const fin = minutoDeJornada(cierre, apertura);
  for (let m = hhmmAMin(apertura); m + 60 <= fin; m += 60) out.push(hhmmDeMin(m));
  return out;
}

export interface EventoCal {
  key: string;
  tipo: 'reserva' | 'fijo' | 'bloqueo';
  fecha: string;
  /** Celda de la grilla donde se dibuja: la hora entera. */
  horaNum: number;
  /** Hora real de inicio del turno, "18:30". Es lo que se le muestra al mostrador. */
  horaTexto: string;
  /** Hora real de fin, "20:00". Se calcula al crear el evento, donde ya están los minutos:
      así la vista no tiene que re-parsear `horaTexto` para mostrar el rango. */
  finTexto: string;
  duracionMin: number;
  /** true en las celdas posteriores a la primera, para turnos que cruzan de hora. */
  esContinuacion: boolean;
  canchaId: string;
  titulo: string;     // nombre de la cancha
  subtitulo: string;  // cliente (reserva/fijo) o motivo (+nota) (bloqueo)
  estado?: EstadoReserva;
  motivo?: MotivoBloqueo;
  refId: string;      // id de la reserva / fijo / bloqueo
}

const MOTIVO_LBL: Record<MotivoBloqueo, string> = {
  TORNEO: 'Torneo', ENTRENAMIENTO: 'Entren.', MANTENIMIENTO: 'Mantenim.', OTRO: 'Otro',
};
export function etiquetaMotivo(m: MotivoBloqueo): string {
  return MOTIVO_LBL[m] ?? 'Bloqueo';
}

function weekdayDe(dia: string): number {
  return new Date(dia + 'T12:00:00Z').getUTCDay(); // 0 = domingo
}
/**
 * Las horas enteras (fila de la grilla, 0-23) que toca el rango [ini, fin) en minutos DE
 * JORNADA. 18:30-20:00 -> [18, 19]. Un rango que cruza la medianoche sigue de largo en `fin`
 * (p.ej. 1500 para "01:00" del día siguiente) en vez de envolver: acá es donde se envuelve al
 * mapear cada hora a la fila del calendario con `hhmmDeMin`, así 23:30-01:00 (90 min) da
 * [23, 0] y no [23, 24] (una fila "24" que no existe, donde la reserva se volvía invisible).
 */
export const horasQueToca = (ini: number, fin: number) => {
  const out: number[] = [];
  for (let m = Math.floor(ini / 60) * 60; m < fin; m += 60) out.push(Number(hhmmDeMin(m).slice(0, 2)));
  return out;
};

/**
 * `matPorDia`: por día (YYYY-MM-DD), los ids de turnos fijos que ya tienen una reserva
 * materializada. Esos no se dibujan como fijo — se muestran como la reserva concreta,
 * igual que hace el backend en /agenda (si no, aparecen duplicados).
 */
export function materializar(dias: string[], fijos: TurnoFijo[], bloqueos: Bloqueo[], matPorDia?: Map<string, Set<string>>, apertura = '00:00'): EventoCal[] {
  const out: EventoCal[] = [];
  for (const dia of dias) {
    const wd = weekdayDe(dia);
    for (const f of fijos) {
      if (!f.activo || f.diaSemana !== wd) continue;
      if (f.excepciones?.some((e) => e.fecha.slice(0, 10) === dia)) continue;
      // Fuera de su período (pasado el "hasta" o antes del "desde", ambos inclusivos) el fijo no
      // existe ese día. Misma regla que el backend (`fijoVigenteEn`): las fechas son 'YYYY-MM-DD'.
      if ((f.vigenciaDesde && dia < f.vigenciaDesde) || (f.vigenciaHasta && dia > f.vigenciaHasta)) continue;
      if (matPorDia?.get(dia)?.has(f.id)) continue;
      // minutoDeJornada (no aMin crudo): un fijo que cierra a medianoche (horaFin "00:00")
      // pertenece al minuto 1440 de la jornada, no al 0 — si no, fin < ini y el fijo desaparece.
      const ini = minutoDeJornada(f.horaInicio, apertura); const fin = minutoDeJornada(f.horaFin, apertura);
      const horas = horasQueToca(ini, fin);
      horas.forEach((h, i) => {
        out.push({ key: `f${f.id}@${dia}-${h}`, tipo: 'fijo', fecha: dia, horaNum: h, horaTexto: hhmmDeMin(ini), finTexto: hhmmDeMin(fin), duracionMin: fin - ini, esContinuacion: i > 0, canchaId: f.canchaId, titulo: f.cancha?.nombre ?? '', subtitulo: f.clienteNombre, refId: f.id });
      });
    }
    for (const b of bloqueos) {
      const aplica = b.recurrente ? b.diaSemana === wd : (b.fecha ?? '').slice(0, 10) === dia;
      if (!aplica) continue;
      if (b.excepciones?.some((e) => e.fecha.slice(0, 10) === dia)) continue;
      // Un bloqueo recurrente con período solo bloquea dentro de él (inclusivo). Mismo criterio que el backend.
      if (b.recurrente && ((b.vigenciaDesde && dia < b.vigenciaDesde) || (b.vigenciaHasta && dia > b.vigenciaHasta))) continue;
      const sub = b.nota ? `${etiquetaMotivo(b.motivo)} · ${b.nota}` : etiquetaMotivo(b.motivo);
      const ini = minutoDeJornada(b.horaInicio, apertura); const fin = minutoDeJornada(b.horaFin, apertura);
      const horas = horasQueToca(ini, fin);
      horas.forEach((h, i) => {
        out.push({ key: `b${b.id}@${dia}-${h}`, tipo: 'bloqueo', fecha: dia, horaNum: h, horaTexto: hhmmDeMin(ini), finTexto: hhmmDeMin(fin), duracionMin: fin - ini, esContinuacion: i > 0, canchaId: b.canchaId, titulo: b.cancha?.nombre ?? '', subtitulo: sub, motivo: b.motivo, refId: b.id });
      });
    }
  }
  return out;
}

/** Parte los eventos de una celda en visibles + ocultos, dejando lugar al botón "+N más". */
export function dividirCelda<T>(eventos: T[], max: number): { visibles: T[]; ocultos: T[] } {
  if (eventos.length <= max) return { visibles: eventos, ocultos: [] };
  return { visibles: eventos.slice(0, max - 1), ocultos: eventos.slice(max - 1) };
}

// Estilos por TIPO de evento (fijo/bloqueo) para que resalten en Hoy y Calendario.
// Clases Tailwind LITERALES (el JIT las purga si no aparecen como string).
export const ESTILO_TIPO = {
  fijo: {
    card: 'border-l-4 border-lime-500 bg-lime-50',
    icono: 'text-lime-600',
    badge: 'bg-lime-200 text-lime-900',
    cal: 'bg-lime-100 text-lime-900 border-lime-400',
  },
  bloqueo: {
    card: 'border-l-4 border-orange-500 bg-orange-50',
    icono: 'text-orange-700',
    texto: 'text-orange-800',
    cal: 'bg-orange-100 text-orange-900 border-orange-400',
  },
} as const;

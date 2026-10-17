import { dayOfWeekInTz } from '../../utils/tz.js';
import type { ReservaCelda, TipoTurno } from './grilla.js';

export interface FijoInput {
  canchaId: string; clienteNombre: string; diaSemana: number;
  horaInicio: string; horaFin: string; precio: number | null; excepciones: string[];
  /** Período del fijo ('YYYY-MM-DD', inclusivo). Fuera de él no ocupa la celda. */
  vigenciaDesde?: string | null; vigenciaHasta?: string | null;
}
export interface BloqueoInput {
  canchaId: string; motivo: 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO';
  recurrente: boolean; diaSemana: number | null; fecha: string | null;
  horaInicio: string; horaFin: string; nota: string | null; excepciones: string[];
  /** Período de un bloqueo recurrente ('YYYY-MM-DD', inclusivo). Fuera de él no bloquea. */
  vigenciaDesde?: string | null; vigenciaHasta?: string | null;
}
export interface ExpandInput { reservas: ReservaCelda[]; fijos: FijoInput[]; bloqueos: BloqueoInput[] }

const hNum = (hhmm: string) => Number(hhmm.slice(0, 2));

function tipoDeMotivo(m: BloqueoInput['motivo']): TipoTurno {
  if (m === 'TORNEO') return 'torneo';
  if (m === 'ENTRENAMIENTO') return 'escuela';
  return 'otro';
}
function etiquetaMotivo(m: BloqueoInput['motivo'], nota: string | null): string {
  const base = m === 'TORNEO' ? 'Torneo' : m === 'ENTRENAMIENTO' ? 'Entrenamiento' : m === 'MANTENIMIENTO' ? 'Mantenimiento' : 'Bloqueo';
  return nota ? `${base} · ${nota}` : base;
}

export function expandirSemana(input: ExpandInput, dias: { dia: string; fecha: string }[], horas: string[], tz: string): ReservaCelda[] {
  const out: ReservaCelda[] = [...input.reservas];
  const horasSet = new Set(horas);
  const ocupado = new Set(input.reservas.map((r) => `${r.canchaId}|${r.fecha}|${r.hora}`));

  const expandir = (canchaId: string, fecha: string, horaInicio: string, horaFin: string, make: (hora: string) => ReservaCelda) => {
    for (let h = hNum(horaInicio); h < hNum(horaFin); h++) {
      const hora = String(h).padStart(2, '0') + ':00';
      if (!horasSet.has(hora)) continue;
      const key = `${canchaId}|${fecha}|${hora}`;
      if (ocupado.has(key)) continue;
      ocupado.add(key);
      out.push(make(hora));
    }
  };

  for (const { fecha } of dias) {
    const dow = dayOfWeekInTz(fecha, tz);
    for (const f of input.fijos) {
      if (f.diaSemana !== dow || f.excepciones.includes(fecha)) continue;
      if ((f.vigenciaDesde && fecha < f.vigenciaDesde) || (f.vigenciaHasta && fecha > f.vigenciaHasta)) continue;
      expandir(f.canchaId, fecha, f.horaInicio, f.horaFin, (hora) => ({
        canchaId: f.canchaId, fecha, hora, cliente: f.clienteNombre,
        monto: Number(f.precio ?? 0), pagado: 0, tipo: 'fijo',
      }));
    }
    for (const b of input.bloqueos) {
      const aplica = b.recurrente ? b.diaSemana === dow : b.fecha === fecha;
      if (!aplica || b.excepciones.includes(fecha)) continue;
      if (b.recurrente && ((b.vigenciaDesde && fecha < b.vigenciaDesde) || (b.vigenciaHasta && fecha > b.vigenciaHasta))) continue;
      expandir(b.canchaId, fecha, b.horaInicio, b.horaFin, (hora) => ({
        canchaId: b.canchaId, fecha, hora, cliente: etiquetaMotivo(b.motivo, b.nota),
        monto: 0, pagado: 0, tipo: tipoDeMotivo(b.motivo),
      }));
    }
  }
  return out;
}

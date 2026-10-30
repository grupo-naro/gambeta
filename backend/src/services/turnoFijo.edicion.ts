import { BusinessRule } from '../utils/errors.js';
import { hhmmAMin, cierreMin } from '../utils/tz.js';

/**
 * Reglas puras para editar un turno fijo. Sin base de datos, para testearlas solas.
 *
 * Se edita lo que se cargó mal (cancha, día, horas, cliente, WhatsApp y, si tiene abono, su
 * período y su monto). Los PAGOS no se editan acá: viven en los cobros del fijo.
 */
export interface FijoEditable {
  canchaId: string;
  clienteNombre: string;
  whatsapp: string | null;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  /** 'YYYY-MM-DD'. null si el fijo no tiene abono. */
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  montoAbono: number | null;
  /** Texto libre; '' o null = sin nota. */
  nota: string | null;
}

export type CambiosFijo = Partial<Omit<FijoEditable, 'whatsapp'>> & { whatsapp?: string };

/**
 * Devuelve el fijo con los cambios aplicados o lanza BusinessRule si el resultado no es válido.
 * Se valida el fijo RESULTANTE, no solo lo que llegó: cambiar solo la hora de fin tiene que
 * compararse con la hora de inicio que ya estaba.
 *
 * El monto del abono SÍ puede quedar por debajo de lo ya cobrado: cargarlo mal es un error
 * frecuente del recepcionista y tiene que poder corregirse. No se rechaza; el saldo queda en 0 y
 * el excedente se corrige anulando el cobro de más (ver `cobradoDeMas` en el servicio).
 */
export function aplicarEdicion(actual: FijoEditable, cambios: CambiosFijo): FijoEditable {
  const tocaAbono = cambios.vigenciaDesde !== undefined || cambios.vigenciaHasta !== undefined || cambios.montoAbono !== undefined;
  if (tocaAbono && actual.montoAbono == null) {
    throw BusinessRule('Este turno fijo no tiene abono: no se puede editar su período ni su monto');
  }

  const r: FijoEditable = { ...actual, ...Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined)) };

  if (hhmmAMin(r.horaInicio) >= cierreMin(r.horaFin)) {
    throw BusinessRule('La hora de inicio debe ser anterior al fin');
  }
  if (r.vigenciaDesde && r.vigenciaHasta && r.vigenciaDesde > r.vigenciaHasta) {
    throw BusinessRule('El período del abono está invertido');
  }
  return r;
}

/** ¿Cambió algo que mueve el turno en la grilla (cancha, día u horas)? */
export function cambiaElHorario(a: FijoEditable, b: FijoEditable): boolean {
  return a.canchaId !== b.canchaId || a.diaSemana !== b.diaSemana || a.horaInicio !== b.horaInicio || a.horaFin !== b.horaFin;
}

/** ¿Cambió el período del abono? */
export function cambiaElPeriodo(a: FijoEditable, b: FijoEditable): boolean {
  return a.vigenciaDesde !== b.vigenciaDesde || a.vigenciaHasta !== b.vigenciaHasta;
}

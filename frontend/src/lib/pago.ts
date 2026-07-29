import type { EstadoReserva } from './types';

export type TonoPago = 'pagado' | 'parcial' | 'debe' | 'espera';
export interface PagoVista { tono: TonoPago; label: string }

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Lógica pura del chip de pago de un turno. */
export function estadoPago(r: { estado: EstadoReserva; monto: number; pagado: number; saldo: number }): PagoVista {
  if (r.estado === 'ESPERANDO_SENA') return { tono: 'espera', label: 'Espera seña' };
  if (r.saldo <= 0 && r.monto > 0) return { tono: 'pagado', label: 'Pagado' };
  if (r.pagado > 0) return { tono: 'parcial', label: 'Debe ' + money(r.saldo) };
  return { tono: 'debe', label: 'Debe ' + money(r.saldo) };
}

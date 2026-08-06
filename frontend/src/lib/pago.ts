import type { EstadoReserva } from './types';

export type TonoPago = 'pagado' | 'parcial' | 'debe' | 'espera';
export interface PagoVista { tono: TonoPago; label: string }

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Lógica pura del chip de pago de un turno. */
export function estadoPago(r: { estado: EstadoReserva; monto: number; pagado: number; saldo: number; suscripcionId?: string | null; montoLista?: number | null }): PagoVista {
  // Turno de socio: nace saldado con monto 0. Sin este caso caería en "Debe $0".
  if (r.suscripcionId) return { tono: 'pagado', label: 'Socio' };
  if (r.estado === 'ESPERANDO_SENA') return { tono: 'espera', label: 'Espera seña' };
  if (r.saldo <= 0 && r.monto > 0) return { tono: 'pagado', label: 'Pagado' };
  // Turno de fijo con abono: monto 0 porque ya está pago por el período, pero montoLista guarda
  // el precio real de la cancha. Sin este caso caería en "Debe $0", que compite visualmente con
  // el aviso de abono vencido (el control real).
  if (r.monto === 0 && Number(r.montoLista ?? 0) > 0) return { tono: 'pagado', label: 'Abono' };
  if (r.pagado > 0) return { tono: 'parcial', label: 'Debe ' + money(r.saldo) };
  return { tono: 'debe', label: 'Debe ' + money(r.saldo) };
}

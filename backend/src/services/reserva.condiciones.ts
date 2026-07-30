import type { EstadoReserva } from '../db/client.js';

export interface CondicionesArgs {
  esContacto: boolean;
  porStaff: boolean;
  clienteConfiable: boolean;
  precio: number;
  montoSenaPedido?: number;
  senaPorDefecto: number;
  /** Suscripción vigente del cliente al momento de reservar, si la hay. */
  suscripcionId?: string | null;
}

export interface Condiciones {
  estado: EstadoReserva;
  monto: number;
  montoLista: number | null;
  montoSena: number | null;
  suscripcionId: string | null;
}

/**
 * Decisión económica de una reserva, aislada de la DB para poder testear todos los bordes
 * sin levantar un contenedor.
 *
 * Reserva creada por staff (panel/JWT): se considera confirmada — la seña se cobra en caja.
 * El flujo de seña queda solo para el autoservicio (bot / web).
 */
export function resolverCondiciones(a: CondicionesArgs): Condiciones {
  // Socio: la reserva nace saldada. `monto` significa "lo que el cliente debe pagar", así que
  // va en 0; el precio real se conserva en `montoLista` para poder informar cuánto se bonificó.
  // Gana sobre esContacto/confiable: todos llevan a CONFIRMADA, pero solo la suscripción bonifica.
  if (a.suscripcionId) {
    return { estado: 'CONFIRMADA', monto: 0, montoLista: a.precio, montoSena: null, suscripcionId: a.suscripcionId };
  }
  const confianza = a.porStaff || a.esContacto || a.clienteConfiable;
  const estado: EstadoReserva = confianza ? 'CONFIRMADA' : 'ESPERANDO_SENA';
  return {
    estado,
    monto: a.precio,
    montoLista: null,
    montoSena: estado === 'ESPERANDO_SENA' ? (a.montoSenaPedido ?? a.senaPorDefecto) : null,
    suscripcionId: null,
  };
}

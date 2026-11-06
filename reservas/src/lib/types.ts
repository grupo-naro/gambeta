export type Deporte = 'futbol' | 'padel';

export interface DuracionSlot {
  min: number;
  horaFin: string;
  precio: number;
}

export interface Grilla {
  deporte: Deporte;
  fecha: string;
  canchas: { id: string; nombre: string; precioHora: number }[];
  horas: string[];
  libres: Record<string, Record<string, boolean>>;
  precios: Record<string, Record<string, number>>;
  /** Duraciones reservables por cancha y hora, con el precio ya calculado por el backend.
   * Opcional: `reservas/` se deploya a Vercel de forma independiente del backend y puede
   * haber skew de versiones, por eso el componente siempre la lee con `?.`. */
  duraciones?: Record<string, Record<string, DuracionSlot[]>>;
}

export interface ReservaCreada { id: string; montoSena: number | null; suscripcionId?: string | null }

export interface PreferenciaPago { checkoutUrl: string }

/** Estado de pago de una reserva, para ofrecer transferencia si Mercado Pago rechaza el pago. */
export interface EstadoPagoReserva {
  estado: 'ESPERANDO_SENA' | 'CONFIRMADA' | 'CANCELADA' | 'COMPLETADA';
  canchaNombre: string;
  fechaInicio: string;
  montoSena: number | null;
  venceEn: string;
}

export type MetodoSena = 'MERCADO_PAGO' | 'TRANSFERENCIA';

/** Qué le podemos ofrecer al cliente y con qué datos, resuelto en el server. */
export interface MetodosPago {
  mercadoPago: boolean;
  transferencia: boolean;
  cbu: string;
  alias: string;
  titular: string;
  adminWhatsapp: string;
  senaTimeoutMinutos: number;
  /** Cuántos días adelante se puede reservar, contando hoy como día 0. */
  diasAnticipacionMax: number;
  /** Primer día reservable ("YYYY-MM-DD"). Vacío si no hay restricción de apertura. */
  reservasDesde: string;
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

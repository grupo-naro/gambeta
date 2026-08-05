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
  /** Duraciones reservables por cancha y hora, con el precio ya calculado por el backend. */
  duraciones: Record<string, Record<string, DuracionSlot[]>>;
}

export interface ReservaCreada { id: string; montoSena: number | null; suscripcionId?: string | null }

export interface PreferenciaPago { checkoutUrl: string }

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

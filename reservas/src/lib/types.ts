export type Deporte = 'futbol' | 'padel';

export interface Grilla {
  deporte: Deporte;
  fecha: string;
  canchas: { id: string; nombre: string; precioHora: number }[];
  horas: string[];
  libres: Record<string, Record<string, boolean>>;
  precios: Record<string, Record<string, number>>;
}

export interface ReservaCreada { id: string; montoSena: number | null }

export interface PreferenciaPago { checkoutUrl: string }

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

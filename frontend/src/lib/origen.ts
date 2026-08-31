import type { TipoOrigen } from './types';

const NOMBRE: Record<TipoOrigen, string> = {
  WHATSAPP: 'WhatsApp',
  QR: 'QR',
  REDES: 'Redes',
  LANDING: 'Landing',
  DIRECTO: 'Directo',
  OTRO: 'Otro',
};

export function nombreOrigen(tipo: TipoOrigen): string {
  return NOMBRE[tipo] ?? tipo;
}

/** La etiqueta se muestra cruda porque es lo que está impreso en el QR o pegado en el link. */
export function nombreEtiqueta(etiqueta: string | null): string {
  return etiqueta ?? '(sin link)';
}

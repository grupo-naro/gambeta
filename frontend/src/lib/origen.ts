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
  // El `?? tipo` parece inalcanzable porque `TipoOrigen` es un tipo cerrado acá, pero ese tipo
  // es una aserción sobre lo que manda la red, no una garantía: si el backend agrega un valor
  // al enum antes de que el panel se actualice, este guard de runtime evita un `undefined` en
  // pantalla y muestra la etiqueta cruda en su lugar.
  return NOMBRE[tipo] ?? tipo;
}

/** La etiqueta se muestra cruda porque es lo que está impreso en el QR o pegado en el link. */
export function nombreEtiqueta(etiqueta: string | null): string {
  return etiqueta ?? '(sin link)';
}

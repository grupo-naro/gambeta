import type { TipoOrigen } from '../db/client.js';
import { visitaRepo } from '../repositories/visita.repo.js';

// El primer segmento de la etiqueta —lo que va antes del primer guion— manda el tipo. Así
// `whatsapp`, `whatsapp-bot` y `wsp-bot` caen todas en WHATSAPP sin que cada etiqueta tenga
// que llevar guion, y sumar un QR nuevo (`qr-entrada`, `qr-buffet`) es imprimir un link
// distinto: no toca ni código ni base.
const TIPO_POR_SEGMENTO: Record<string, TipoOrigen> = {
  whatsapp: 'WHATSAPP',
  wsp: 'WHATSAPP',
  qr: 'QR',
  ig: 'REDES',
  fb: 'REDES',
  tt: 'REDES',
  yt: 'REDES',
  redes: 'REDES',
  landing: 'LANDING',
  web: 'LANDING',
};

/** Sin etiqueta la visita es DIRECTA; una etiqueta que no reconocemos cae en OTRO y no se pierde. */
export function clasificarOrigen(etiqueta: string | null | undefined): TipoOrigen {
  if (!etiqueta) return 'DIRECTO';
  return TIPO_POR_SEGMENTO[etiqueta.split('-')[0]!] ?? 'OTRO';
}

export interface RegistrarVisitaInput {
  etiqueta?: string | null;
  sesionId: string;
  visitanteId: string;
  referer?: string | null;
}

export const visitaService = {
  registrar(input: RegistrarVisitaInput): Promise<void> {
    return visitaRepo.registrar({
      etiqueta: input.etiqueta ?? null,
      tipo: clasificarOrigen(input.etiqueta),
      sesionId: input.sesionId,
      visitanteId: input.visitanteId,
      referer: input.referer ?? null,
    });
  },
};

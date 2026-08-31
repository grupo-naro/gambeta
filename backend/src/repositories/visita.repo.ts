import type { TipoOrigen } from '../db/client.js';
import { prisma } from '../db/prisma.js';

export interface CreateVisitaData {
  etiqueta: string | null;
  tipo: TipoOrigen;
  sesionId: string;
  visitanteId: string;
  referer: string | null;
}

export const visitaRepo = {
  // `skipDuplicates` se apoya en el índice único de `sesionId`: si el navegador manda el
  // beacon dos veces (remount de React, dos pestañas), la segunda no duplica la visita ni
  // hace fallar la request. Registrar una visita nunca debe devolver un error al sitio.
  async registrar(data: CreateVisitaData): Promise<void> {
    await prisma.visita.createMany({ data: [data], skipDuplicates: true });
  },
};

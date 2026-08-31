import { z } from 'zod';

const empty = z.looseObject({});

// Mismo formato que valida el sitio de reservas antes de setear la cookie. Si acá entrara
// texto libre, el detalle por etiqueta del panel se llenaría de basura imposible de agrupar.
export const registrarVisitaSchema = z.object({
  body: z.object({
    etiqueta: z.string().regex(/^[a-z0-9-]{1,40}$/).nullish(),
    sesionId: z.string().min(1).max(64),
    visitanteId: z.string().min(1).max(64),
    referer: z.string().max(500).nullish(),
  }),
  query: empty,
  params: empty,
});

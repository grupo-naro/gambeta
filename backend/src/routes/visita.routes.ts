import { Router } from 'express';
import { authAny } from '../middlewares/authAny.js';
import { validate } from '../middlewares/validate.js';
import { registrarVisitaSchema } from '../validators/visita.schema.js';
import { visitaService } from '../services/visita.service.js';

export const visitaRoutes = Router();

// Lo llama el server del sitio de reservas con `x-api-key`, igual que el resto de los
// endpoints públicos. Sin `auditService.log`: esto no es una acción de admin sobre una
// entidad del negocio, es telemetría de la web pública, y una fila de auditoría por visita
// ahogaría el listado de actividad.
visitaRoutes.post('/', authAny, validate(registrarVisitaSchema), async (req, res, next) => {
  try {
    await visitaService.registrar((req as any).valid.body);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authAny } from '../middlewares/authAny.js';
import { disponibilidadSchema, disponibilidadPorTamanoSchema, grillaSchema } from '../validators/disponibilidad.schema.js';
import { disponibilidadService } from '../services/disponibilidad.service.js';

export const disponibilidadRoutes = Router();
disponibilidadRoutes.get('/', authAny, validate(disponibilidadSchema), async (req, res, next) => {
  try {
    const { canchaId, fecha } = (req as any).valid.query;
    res.json(await disponibilidadService.listar(canchaId, fecha));
  } catch (e) { next(e); }
});

disponibilidadRoutes.get('/por-tamano', authAny, validate(disponibilidadPorTamanoSchema), async (req, res, next) => {
  try {
    const { jugadores, fecha } = (req as any).valid.query;
    res.json(await disponibilidadService.listarPorTamano(jugadores, fecha));
  } catch (e) { next(e); }
});

disponibilidadRoutes.get('/grilla', authAny, validate(grillaSchema), async (req, res, next) => {
  try {
    const { deporte, fecha } = (req as any).valid.query;
    res.json(await disponibilidadService.grilla(deporte, fecha));
  } catch (e) { next(e); }
});

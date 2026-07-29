import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { validate } from '../middlewares/validate.js';
import { cajaSchema } from '../validators/cobro.schema.js';
import { cajaService } from '../services/caja.service.js';
import { getEnv } from '../config/env.js';

function hoyEnTz(): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: getEnv().TZ_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export const cajaRoutes = Router();

cajaRoutes.get('/', authJwt, validate(cajaSchema), async (req, res, next) => {
  try {
    const q = (req as any).valid.query as { desde?: string; hasta?: string };
    const hoy = hoyEnTz();
    res.json(await cajaService.reporte(q.desde ?? hoy, q.hasta ?? q.desde ?? hoy));
  } catch (e) {
    next(e);
  }
});

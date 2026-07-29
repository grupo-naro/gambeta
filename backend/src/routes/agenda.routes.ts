import { Router } from 'express';
import { z } from 'zod';
import { authAny } from '../middlewares/authAny.js';
import { validate } from '../middlewares/validate.js';
import { agendaService } from '../services/agenda.service.js';

const empty = z.looseObject({});
const agendaSchema = z.object({
  query: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  body: z.unknown(), params: empty,
});

export const agendaRoutes = Router();
agendaRoutes.get('/', authAny, validate(agendaSchema), async (req, res, next) => {
  try { res.json(await agendaService.delDia((req as any).valid.query.fecha)); } catch (e) { next(e); }
});

import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { auditService } from '../services/audit.service.js';

export const auditoriaRoutes = Router();
auditoriaRoutes.get('/', authJwt, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const entidad = typeof req.query.entidad === 'string' ? req.query.entidad : undefined;
    res.json(await auditService.list({ entidad, limit: 200 }));
  } catch (e) { next(e); }
});

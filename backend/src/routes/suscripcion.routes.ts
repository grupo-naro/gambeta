import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import { suscripcionService } from '../services/suscripcion.service.js';
import { auditService } from '../services/audit.service.js';
import { crearSuscripcionSchema, renovarSuscripcionSchema, idSuscripcionParamSchema } from '../validators/suscripcion.schema.js';

export const suscripcionRoutes = Router();

const adminId = (req: any) => (req.principal?.kind === 'admin' ? req.principal.adminId : null);

suscripcionRoutes.get('/', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json(await suscripcionService.listar()); } catch (e) { next(e); }
});

suscripcionRoutes.post('/', authJwt, requireRole('ADMIN'), validate(crearSuscripcionSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    const s = await suscripcionService.crear(body, adminId(req));
    await auditService.log(req, { accion: 'CREAR', entidad: 'Suscripcion', entidadId: s.id, descripcion: 'Dio de alta un socio' });
    res.status(201).json(s);
  } catch (e) { next(e); }
});

suscripcionRoutes.post('/:id/renovar', authJwt, requireRole('ADMIN'), validate(renovarSuscripcionSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const s = await suscripcionService.renovar(id, (req as any).valid.body, adminId(req));
    await auditService.log(req, { accion: 'CREAR', entidad: 'Suscripcion', entidadId: s.id, descripcion: 'Renovó la suscripción de un socio' });
    res.status(201).json(s);
  } catch (e) { next(e); }
});

suscripcionRoutes.patch('/:id/cancelar', authJwt, requireRole('ADMIN'), validate(idSuscripcionParamSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const s = await suscripcionService.cancelar(id);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Suscripcion', entidadId: id, descripcion: 'Canceló la suscripción de un socio' });
    res.json(s);
  } catch (e) { next(e); }
});

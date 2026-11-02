import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import { bloqueoService } from '../services/bloqueo.service.js';
import { crearBloqueoSchema, idBloqueoParamSchema, excepcionBloqueoSchema } from '../validators/bloqueo.schema.js';
import { crearCobroSchema } from '../validators/cobro.schema.js';
import { auditService } from '../services/audit.service.js';

export const bloqueoRoutes = Router();
bloqueoRoutes.get('/', authJwt, async (req, res, next) => { try { res.json(await bloqueoService.list((req.query.canchaId as string) || undefined)); } catch (e) { next(e); } });
bloqueoRoutes.post('/', authJwt, requireRole('ADMIN'), validate(crearBloqueoSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : null;
    const b = await bloqueoService.crear(body, adminId);
    await auditService.log(req, { accion: 'CREAR', entidad: 'Bloqueo', entidadId: b.id, descripcion: 'Creó un bloqueo (' + body.motivo + ')' });
    res.status(201).json(b);
  } catch (e) { next(e); }
});
// Cobros del evento (seña y saldo). Solo staff: es plata. Anular un cobro usa DELETE /cobros/:id.
bloqueoRoutes.get('/:id/cobros', authJwt, validate(idBloqueoParamSchema), async (req, res, next) => {
  try { res.json(await bloqueoService.listarCobros(String(req.params.id))); } catch (e) { next(e); }
});
bloqueoRoutes.post('/:id/cobros', authJwt, validate(crearCobroSchema), async (req, res, next) => {
  try {
    const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : null;
    const r = await bloqueoService.registrarCobro(String(req.params.id), (req as any).valid.body, adminId);
    await auditService.log(req, { accion: 'CREAR', entidad: 'Cobro', entidadId: r.cobro.id, descripcion: `Registró un pago de $${r.cobro.monto} de un evento` });
    res.status(201).json(r);
  } catch (e) { next(e); }
});
bloqueoRoutes.delete('/:id', authJwt, requireRole('ADMIN'), validate(idBloqueoParamSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await bloqueoService.eliminar(id);
    await auditService.log(req, { accion: 'ELIMINAR', entidad: 'Bloqueo', entidadId: id, descripcion: 'Eliminó un bloqueo' });
    res.json(result);
  } catch (e) { next(e); }
});
bloqueoRoutes.post('/:id/excepciones', authJwt, requireRole('ADMIN'), validate(excepcionBloqueoSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const body = (req as any).valid.body;
    const result = await bloqueoService.agregarExcepcion(id, body.fecha);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Bloqueo', entidadId: id, descripcion: 'Liberó la fecha ' + body.fecha + ' de un bloqueo' });
    res.status(201).json(result);
  } catch (e) { next(e); }
});
bloqueoRoutes.delete('/:id/excepciones/:fecha', authJwt, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await bloqueoService.quitarExcepcion(id, String(req.params.fecha));
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Bloqueo', entidadId: id, descripcion: 'Reactivó la fecha ' + req.params.fecha + ' de un bloqueo' });
    res.json(result);
  } catch (e) { next(e); }
});

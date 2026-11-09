import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import { bloqueoService } from '../services/bloqueo.service.js';
import { crearBloqueoSchema, editarBloqueoSchema, idBloqueoParamSchema, excepcionBloqueoSchema } from '../validators/bloqueo.schema.js';
import { crearCobroBloqueoSchema, cobrosBloqueoSchema, mesesBloqueoSchema } from '../validators/cobro.schema.js';
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
bloqueoRoutes.patch('/:id', authJwt, requireRole('ADMIN'), validate(editarBloqueoSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const b = await bloqueoService.editar(id, (req as any).valid.body);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Bloqueo', entidadId: id, descripcion: 'Editó un bloqueo' });
    res.json(b);
  } catch (e) { next(e); }
});
// Cobros del evento (seña y saldo). Solo staff: es plata. Anular un cobro usa DELETE /cobros/:id.
// En un entrenamiento recurrente el valor es mensual: ?mes=YYYY-MM elige el mes.
bloqueoRoutes.get('/:id/cobros', authJwt, validate(cobrosBloqueoSchema), async (req, res, next) => {
  try { res.json(await bloqueoService.listarCobros(String(req.params.id), (req as any).valid.query.mes)); } catch (e) { next(e); }
});
// Meses de un entrenamiento recurrente (con lo cobrado de cada uno) para elegir cuál cobrar.
bloqueoRoutes.get('/:id/meses', authJwt, validate(mesesBloqueoSchema), async (req, res, next) => {
  try { res.json(await bloqueoService.meses(String(req.params.id), (req as any).valid.query)); } catch (e) { next(e); }
});
bloqueoRoutes.post('/:id/cobros', authJwt, validate(crearCobroBloqueoSchema), async (req, res, next) => {
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

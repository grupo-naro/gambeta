import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { authAny } from '../middlewares/authAny.js';
import { requireRole } from '../middlewares/requireRole.js';
import { canchaService } from '../services/cancha.service.js';
import { createCanchaSchema, updateCanchaSchema, setActivaSchema, listCanchaSchema, idCanchaParamSchema, crearDivisibleSchema, escalonarPadelSchema } from '../validators/cancha.schema.js';
import { auditService } from '../services/audit.service.js';

export const canchaRoutes = Router();

canchaRoutes.get('/', authAny, validate(listCanchaSchema), async (req, res, next) => {
  try {
    const activa = (req as any).valid.query.activa;
    res.json(await canchaService.list(activa === 'true' ? true : undefined));
  } catch (e) { next(e); }
});

canchaRoutes.get('/:id', authAny, async (req, res, next) => {
  try { res.json(await canchaService.get(String(req.params.id))); } catch (e) { next(e); }
});

canchaRoutes.post('/', authJwt, requireRole('ADMIN'), validate(createCanchaSchema), async (req, res, next) => {
  try {
    const c = await canchaService.create((req as any).valid.body);
    await auditService.log(req, { accion: 'CREAR', entidad: 'Cancha', entidadId: c.id, descripcion: 'Creó la cancha «' + c.nombre + '»' });
    res.status(201).json(c);
  } catch (e) { next(e); }
});

canchaRoutes.post('/divisible', authJwt, requireRole('ADMIN'), validate(crearDivisibleSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    const r = await canchaService.crearDivisible(body);
    await auditService.log(req, { accion: 'CREAR', entidad: 'Cancha', descripcion: 'Creó la cancha divisible «' + body.nombre + '»' });
    res.status(201).json(r);
  } catch (e) { next(e); }
});

canchaRoutes.post('/escalonar-padel', authJwt, requireRole('ADMIN'), validate(escalonarPadelSchema), async (req, res, next) => {
  try {
    const { bloqueMin, pasoMin, quitar } = (req as any).valid.body;
    const r = await canchaService.escalonarPadel(bloqueMin, pasoMin, quitar);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Cancha', descripcion: quitar ? 'Quitó el escalonado de las canchas de pádel' : 'Escalonó las canchas de pádel (primer turno de cada una corrido ' + pasoMin + ' min)' });
    res.json(r);
  } catch (e) { next(e); }
});

canchaRoutes.patch('/:id', authJwt, requireRole('ADMIN'), validate(updateCanchaSchema), async (req, res, next) => {
  try {
    const c = await canchaService.update(String(req.params.id), (req as any).valid.body);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Cancha', entidadId: c.id, descripcion: 'Editó la cancha «' + c.nombre + '»' });
    res.json(c);
  } catch (e) { next(e); }
});

canchaRoutes.patch('/:id/activa', authJwt, requireRole('ADMIN'), validate(setActivaSchema), async (req, res, next) => {
  try {
    const activa = (req as any).valid.body.activa;
    const c = await canchaService.setActiva(String(req.params.id), activa);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Cancha', entidadId: c.id, descripcion: (activa ? 'Activó' : 'Desactivó') + ' la cancha «' + c.nombre + '»' });
    res.json(c);
  } catch (e) { next(e); }
});

canchaRoutes.delete('/:id', authJwt, requireRole('ADMIN'), validate(idCanchaParamSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const c = await canchaService.get(id);
    const result = await canchaService.eliminar(id);
    await auditService.log(req, { accion: 'ELIMINAR', entidad: 'Cancha', entidadId: id, descripcion: 'Eliminó la cancha «' + c.nombre + '»' });
    res.json(result);
  } catch (e) { next(e); }
});

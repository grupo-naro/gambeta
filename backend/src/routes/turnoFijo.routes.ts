import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { authAny } from '../middlewares/authAny.js';
import { validate } from '../middlewares/validate.js';
import { turnoFijoService } from '../services/turnoFijo.service.js';
import { crearTurnoFijoSchema, excepcionSchema, idFijoParamSchema, liberarFijoSchema, materializarFijoSchema, misFijosSchema } from '../validators/turnoFijo.schema.js';
import { auditService } from '../services/audit.service.js';
import { prisma } from '../db/prisma.js';
import { reservaService } from '../services/reserva.service.js';

export const turnoFijoRoutes = Router();
turnoFijoRoutes.get('/', authJwt, async (req, res, next) => { try { res.json(await turnoFijoService.list((req.query.canchaId as string) || undefined)); } catch (e) { next(e); } });
turnoFijoRoutes.get('/mios', authAny, validate(misFijosSchema), async (req, res, next) => {
  try {
    res.json(await turnoFijoService.misFijos((req as any).valid.query.whatsapp));
  } catch (e) { next(e); }
});
turnoFijoRoutes.post('/', authJwt, validate(crearTurnoFijoSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : null;
    const f = await turnoFijoService.crear(body, adminId);
    await auditService.log(req, { accion: 'CREAR', entidad: 'TurnoFijo', entidadId: f.id, descripcion: 'Creó turno fijo de ' + body.clienteNombre });
    res.status(201).json(f);
  } catch (e) { next(e); }
});
turnoFijoRoutes.post('/liberar', authAny, validate(liberarFijoSchema), async (req, res, next) => {
  try {
    const { whatsapp, fecha } = (req as any).valid.body;
    const result = await turnoFijoService.liberarPorWhatsapp(whatsapp, fecha);
    if (result.liberado) await auditService.log(req, { accion: 'EDITAR', entidad: 'TurnoFijo', entidadId: '-', descripcion: 'Bot liberó la fecha ' + fecha + ' de un turno fijo' });
    res.json(result);
  } catch (e) { next(e); }
});
turnoFijoRoutes.post('/:id/materializar', authAny, validate(materializarFijoSchema), async (req, res, next) => {
  try {
    const { fecha } = (req as any).valid.body;
    const porStaff = req.principal?.kind === 'admin';
    const creada = await turnoFijoService.materializar(String(req.params.id), fecha, { porStaff });
    const reserva = await reservaService.get(creada.id); // incluye cliente + cancha
    const agg = await prisma.cobro.aggregate({ where: { reservaId: reserva.id }, _sum: { monto: true } });
    const pagado = Number(agg._sum.monto ?? 0);
    res.status(201).json({ ...reserva, pagado, saldo: Math.max(0, Number(reserva.monto) - pagado) });
  } catch (e) { next(e); }
});
turnoFijoRoutes.delete('/:id', authJwt, validate(idFijoParamSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await turnoFijoService.eliminar(id);
    await auditService.log(req, { accion: 'ELIMINAR', entidad: 'TurnoFijo', entidadId: id, descripcion: 'Eliminó un turno fijo' });
    res.json(result);
  } catch (e) { next(e); }
});
turnoFijoRoutes.post('/:id/desactivar', authJwt, validate(idFijoParamSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await turnoFijoService.desactivar(id);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'TurnoFijo', entidadId: id, descripcion: 'Desactivó un turno fijo' });
    res.json(result);
  } catch (e) { next(e); }
});
turnoFijoRoutes.post('/:id/excepciones', authJwt, validate(excepcionSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const body = (req as any).valid.body;
    const result = await turnoFijoService.agregarExcepcion(id, body.fecha);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'TurnoFijo', entidadId: id, descripcion: 'Liberó la fecha ' + body.fecha + ' de un turno fijo' });
    res.status(201).json(result);
  } catch (e) { next(e); }
});
turnoFijoRoutes.delete('/:id/excepciones/:fecha', authJwt, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await turnoFijoService.quitarExcepcion(id, String(req.params.fecha));
    await auditService.log(req, { accion: 'EDITAR', entidad: 'TurnoFijo', entidadId: id, descripcion: 'Reactivó la fecha ' + req.params.fecha + ' de un turno fijo' });
    res.json(result);
  } catch (e) { next(e); }
});

import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { usuarioService } from '../services/usuario.service.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { crearUsuarioSchema, cambiarRolSchema, idUsuarioParamSchema, cambiarExpiracionSchema } from '../validators/usuario.schema.js';
import { auditService } from '../services/audit.service.js';

export const usuarioRoutes = Router();
usuarioRoutes.use(authJwt, requireRole('ADMIN'));

usuarioRoutes.get('/', async (_req, res, next) => { try { res.json(await usuarioService.list()); } catch (e) { next(e); } });
usuarioRoutes.post('/', validate(crearUsuarioSchema), async (req, res, next) => {
  try {
    const u = await usuarioService.crear((req as any).valid.body);
    await auditService.log(req, { accion: 'CREAR', entidad: 'Usuario', entidadId: u.id, descripcion: 'Creó el usuario ' + u.email + ' (' + u.rol + ')' });
    res.status(201).json(u);
  } catch (e) { next(e); }
});
usuarioRoutes.patch('/:id/rol', validate(cambiarRolSchema), async (req, res, next) => {
  try {
    const me = req.principal?.kind === 'admin' ? req.principal.adminId : '';
    const u = await usuarioService.cambiarRol(String(req.params.id), (req as any).valid.body.rol, me);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Usuario', entidadId: u.id, descripcion: 'Cambió el rol de ' + u.email + ' a ' + u.rol });
    res.json(u);
  } catch (e) { next(e); }
});
usuarioRoutes.patch('/:id/expiracion', validate(cambiarExpiracionSchema), async (req, res, next) => {
  try {
    const me = req.principal?.kind === 'admin' ? req.principal.adminId : '';
    const u = await usuarioService.cambiarExpiracion(String(req.params.id), (req as any).valid.body.duracionDias, me);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Usuario', entidadId: u.id, descripcion: 'Cambió el vencimiento de ' + u.email });
    res.json(u);
  } catch (e) { next(e); }
});
usuarioRoutes.delete('/:id', validate(idUsuarioParamSchema), async (req, res, next) => {
  try {
    const me = req.principal?.kind === 'admin' ? req.principal.adminId : '';
    const id = String(req.params.id);
    const victim = await adminUserRepo.findById(id);
    const result = await usuarioService.eliminar(id, me);
    await auditService.log(req, { accion: 'ELIMINAR', entidad: 'Usuario', entidadId: id, descripcion: 'Eliminó el usuario ' + (victim?.email ?? id) });
    res.json(result);
  } catch (e) { next(e); }
});

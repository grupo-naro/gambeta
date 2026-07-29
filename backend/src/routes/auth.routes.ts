import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { loginSchema } from '../validators/auth.schema.js';
import { login } from '../services/auth.service.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { NotFound } from '../utils/errors.js';
import { auditService } from '../services/audit.service.js';
import { loginLimiter } from '../middlewares/rateLimiters.js';

export const authRoutes = Router();

authRoutes.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = (req as any).valid.body;
    const result = await login(email, password);
    await auditService.record(result.admin.id, { accion: 'LOGIN', entidad: 'Auth', descripcion: 'Inició sesión' });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

authRoutes.get('/me', authJwt, async (req, res, next) => {
  try {
    const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : '';
    const admin = await adminUserRepo.findById(adminId);
    if (!admin) throw NotFound('AdminUser');
    res.json({ id: admin.id, email: admin.email, nombre: admin.nombre, rol: admin.rol });
  } catch (e) {
    next(e);
  }
});

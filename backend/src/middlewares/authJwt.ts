import type { Request, Response, NextFunction } from 'express';
import { verifyAdminToken } from '../services/auth.service.js';
import { Unauthorized } from '../utils/errors.js';

export function authJwt(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(Unauthorized('Falta token'));
  const claims = verifyAdminToken(header.slice(7));
  req.principal = { kind: 'admin', adminId: claims.adminId, email: claims.email, rol: claims.rol };
  next();
}

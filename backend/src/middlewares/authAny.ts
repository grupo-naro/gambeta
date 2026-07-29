import type { Request, Response, NextFunction } from 'express';
import { verifyAdminToken } from '../services/auth.service.js';
import { isValidServiceKey } from '../utils/serviceAuth.js';
import { Unauthorized } from '../utils/errors.js';

export function authAny(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.header('x-api-key');
  if (isValidServiceKey(apiKey)) {
    req.principal = { kind: 'service' };
    return next();
  }
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const claims = verifyAdminToken(header.slice(7));
    req.principal = { kind: 'admin', adminId: claims.adminId, email: claims.email, rol: claims.rol };
    return next();
  }
  return next(Unauthorized('Falta autenticación'));
}

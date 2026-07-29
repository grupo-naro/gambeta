import type { Request, Response, NextFunction } from 'express';
import type { Rol } from '../types/domain.js';
import { Forbidden } from '../utils/errors.js';

export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const p = req.principal;
    if (!p || p.kind !== 'admin' || !roles.includes(p.rol)) return next(Forbidden('Requiere rol ' + roles.join('/')));
    next();
  };
}

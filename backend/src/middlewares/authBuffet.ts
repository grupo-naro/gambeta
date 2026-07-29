import type { Request, Response, NextFunction } from 'express';
import { isValidBuffetKey } from '../utils/buffetAuth.js';
import { Unauthorized } from '../utils/errors.js';

// Auth de menor privilegio: solo abre las rutas del mostrador del buffet.
// A propósito NO acepta el JWT de admin ni la SERVICE_API_KEY.
export function authBuffet(req: Request, _res: Response, next: NextFunction) {
  if (!isValidBuffetKey(req.header('x-buffet-key'))) return next(Unauthorized('Buffet key inválida'));
  next();
}

import type { Request, Response, NextFunction } from 'express';
import { isValidServiceKey } from '../utils/serviceAuth.js';
import { Unauthorized } from '../utils/errors.js';

export function authApiKey(req: Request, _res: Response, next: NextFunction) {
  if (!isValidServiceKey(req.header('x-api-key'))) return next(Unauthorized('API key inválida'));
  req.principal = { kind: 'service' };
  next();
}

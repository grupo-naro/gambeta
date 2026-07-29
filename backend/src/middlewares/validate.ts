import type { Request, Response, NextFunction } from 'express';
import { ZodError, ZodType } from 'zod';
import { BadRequest } from '../utils/errors.js';

export function validate(schema: ZodType) {
  return (req: Request & { valid?: unknown }, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({ body: req.body, query: req.query, params: req.params });
      (req as Request & { valid: unknown }).valid = parsed;
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        next(BadRequest('Datos inválidos', e.flatten()));
      } else {
        next(e);
      }
    }
  };
}

import type { Request, Response, NextFunction } from 'express';
import { isValidBuffetKey } from '../utils/buffetAuth.js';
import { verificarTokenMostrador } from '../utils/mostradorToken.js';
import { prisma } from '../db/prisma.js';
import { Unauthorized } from '../utils/errors.js';

// Auth de menor privilegio: solo abre las rutas del mostrador del buffet.
// A propósito NO acepta el JWT de admin ni la SERVICE_API_KEY.
export function authBuffet(req: Request, _res: Response, next: NextFunction) {
  if (!isValidBuffetKey(req.header('x-buffet-key'))) return next(Unauthorized('Buffet key inválida'));
  next();
}

/**
 * Además de la key, exige el token que identifica al mostrador. Va en las rutas donde importa
 * QUIÉN está operando: vender, entregar, conciliar.
 */
export async function authMostrador(req: Request, _res: Response, next: NextFunction) {
  if (!isValidBuffetKey(req.header('x-buffet-key'))) return next(Unauthorized('Buffet key inválida'));
  const id = verificarTokenMostrador(req.header('x-mostrador'));
  if (!id) return next(Unauthorized('Sesión de mostrador inválida'));
  const m = await prisma.mostrador.findUnique({ where: { id } });
  if (!m || !m.activo) return next(Unauthorized('Sesión de mostrador inválida'));
  req.mostrador = { id: m.id, tipo: m.tipo };
  next();
}

import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { verifyPassword } from '../utils/password.js';
import { Unauthorized, UsuarioVencido } from '../utils/errors.js';
import type { Rol } from '../types/domain.js';

export interface AdminClaims { adminId: string; email: string; rol: Rol; }

export function signAdminToken(claims: AdminClaims, expiresInSeconds?: number): string {
  const env = getEnv();
  const expiresIn = (expiresInSeconds ?? env.JWT_EXPIRES_IN) as jwt.SignOptions['expiresIn'];
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn });
}

export function verifyAdminToken(token: string): AdminClaims {
  try {
    const decoded = jwt.verify(token, getEnv().JWT_SECRET) as jwt.JwtPayload;
    if (!decoded.adminId || !decoded.email || (decoded.rol !== 'ADMIN' && decoded.rol !== 'RECEPCIONISTA')) {
      throw Unauthorized('Token inválido');
    }
    return { adminId: String(decoded.adminId), email: String(decoded.email), rol: decoded.rol };
  } catch (e) {
    if ((e as any)?.status === 401) throw e;
    throw Unauthorized('Token inválido');
  }
}

export async function login(email: string, password: string) {
  const admin = await adminUserRepo.findByEmail(email);
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    throw Unauthorized('Credenciales inválidas');
  }
  if (admin.expiraEn && admin.expiraEn.getTime() <= Date.now()) {
    throw UsuarioVencido();
  }
  const expiresInSeconds = admin.expiraEn
    ? Math.max(1, Math.floor((admin.expiraEn.getTime() - Date.now()) / 1000))
    : undefined;
  const token = signAdminToken({ adminId: admin.id, email: admin.email, rol: admin.rol as Rol }, expiresInSeconds);
  return { token, admin: { id: admin.id, email: admin.email, nombre: admin.nombre, rol: admin.rol } };
}

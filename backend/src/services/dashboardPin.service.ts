import jwt from 'jsonwebtoken';
import { configRepo } from '../repositories/config.repo.js';
import { getEnv } from '../config/env.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { AppError, Unauthorized } from '../utils/errors.js';

/** Cuánto dura el desbloqueo: pasado ese tiempo el dashboard vuelve a pedir el PIN. */
export const DESBLOQUEO_MINUTOS = 15;
const SCOPE = 'dashboard-unlock';
/** Parte del hash del PIN (no revela el PIN): cambia cuando cambia el PIN. */
const huella = (hash: string) => hash.slice(-16);

/**
 * PIN para ver los números del dashboard, como los bancos que ocultan el saldo.
 *
 * Sin PIN configurado el dashboard está abierto, como siempre. Con PIN, los endpoints de analytics
 * (los que traen los números) responden 403 hasta que el admin lo ingresa: el bloqueo es real, no
 * solo visual — los datos ni siquiera viajan al navegador. El desbloqueo es un token firmado, atado
 * al admin que puso el PIN y con vencimiento corto.
 */
export const dashboardPinService = {
  async configurado(): Promise<boolean> {
    return (await configRepo.getOrCreate()).dashboardPinHash !== '';
  },

  /** Cambia o pone el PIN. Si ya había uno, hace falta el actual: una sesión abierta no alcanza para sacar el candado. */
  async setear(pin: string, pinActual: string | undefined): Promise<void> {
    await this.exigirPinActual(pinActual);
    await configRepo.update({ dashboardPinHash: await hashPassword(pin) });
  },

  async quitar(pinActual: string | undefined): Promise<void> {
    await this.exigirPinActual(pinActual);
    await configRepo.update({ dashboardPinHash: '' });
  },

  /** Valida el PIN actual SOLO si hay uno puesto. */
  async exigirPinActual(pinActual: string | undefined): Promise<void> {
    const { dashboardPinHash } = await configRepo.getOrCreate();
    if (dashboardPinHash === '') return;
    if (!pinActual || !(await verifyPassword(pinActual, dashboardPinHash))) throw Unauthorized('El PIN actual no es correcto');
  },

  /** PIN correcto → token de desbloqueo (de ese admin, vence en DESBLOQUEO_MINUTOS minutos). */
  async verificar(pin: string, adminId: string): Promise<{ token: string; expiraEn: string }> {
    const { dashboardPinHash } = await configRepo.getOrCreate();
    if (dashboardPinHash === '' || !(await verifyPassword(pin, dashboardPinHash))) throw Unauthorized('PIN incorrecto');
    const expiraEn = new Date(Date.now() + DESBLOQUEO_MINUTOS * 60000);
    // `h` ata el token al PIN vigente: si se cambia el PIN, los desbloqueos abiertos dejan de valer.
    const token = jwt.sign({ scope: SCOPE, adminId, h: huella(dashboardPinHash) }, getEnv().JWT_SECRET, { expiresIn: DESBLOQUEO_MINUTOS * 60 });
    return { token, expiraEn: expiraEn.toISOString() };
  },

  /** ¿Este token desbloquea el dashboard para este admin? Sin PIN configurado, siempre sí. */
  async desbloqueado(token: string | undefined, adminId: string): Promise<boolean> {
    const { dashboardPinHash } = await configRepo.getOrCreate();
    if (dashboardPinHash === '') return true;
    if (!token) return false;
    try {
      const d = jwt.verify(token, getEnv().JWT_SECRET) as jwt.JwtPayload;
      return d.scope === SCOPE && d.adminId === adminId && d.h === huella(dashboardPinHash);
    } catch {
      return false;
    }
  },

  /** Para las rutas: lanza 403 DASHBOARD_BLOQUEADO si hay PIN y el token no sirve. */
  async exigirDesbloqueo(token: string | undefined, adminId: string): Promise<void> {
    if (!(await this.desbloqueado(token, adminId))) {
      throw new AppError(403, 'DASHBOARD_BLOQUEADO', 'El dashboard está bloqueado. Ingresá el PIN para ver los números.');
    }
  },
};

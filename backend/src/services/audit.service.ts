import type { Request } from 'express';
import { auditLogRepo } from '../repositories/auditLog.repo.js';

interface LogInput { accion: string; entidad: string; entidadId?: string | null; descripcion: string; payload?: unknown }

function adminIdOf(req: Request): string | null {
  return req.principal?.kind === 'admin' ? req.principal.adminId : null;
}

export const auditService = {
  /** Best-effort: nunca rompe la operación principal. */
  async record(adminId: string | null, input: LogInput): Promise<void> {
    try {
      await auditLogRepo.record({
        adminId, accion: input.accion, entidad: input.entidad,
        entidadId: input.entidadId ?? null, descripcion: input.descripcion,
        payload: (input.payload ?? undefined) as never,
      });
    } catch { /* no-op */ }
  },
  log(req: Request, input: LogInput): Promise<void> {
    return auditService.record(adminIdOf(req), input);
  },
  async list(opts: { entidad?: string; limit?: number }) {
    const rows = await auditLogRepo.list(opts);
    return rows.map((r) => ({
      id: r.id, creadoEn: r.creadoEn, usuario: r.admin?.nombre ?? 'Sistema',
      accion: r.accion, entidad: r.entidad, descripcion: r.descripcion,
    }));
  },
};

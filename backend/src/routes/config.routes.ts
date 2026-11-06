import { Router } from 'express';
import { authAny } from '../middlewares/authAny.js';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import { senaService } from '../services/sena.service.js';
import { configService } from '../services/config.service.js';
import { updateConfigSchema, fijarPinDashboardSchema, verificarPinDashboardSchema, quitarPinDashboardSchema } from '../validators/config.schema.js';
import { dashboardPinService } from '../services/dashboardPin.service.js';
import { pinDashboardLimiter } from '../middlewares/rateLimiters.js';
import { auditService } from '../services/audit.service.js';

const CAMPO_LABEL: Record<string, string> = {
  alias: 'el alias', cbu: 'el CBU', titular: 'el titular',
  horaApertura: 'el horario de apertura', horaCierre: 'el horario de cierre',
  horaAperturaFinde: 'el horario de apertura (finde)', horaCierreFinde: 'el horario de cierre (finde)',
  adminWhatsapp: 'el WhatsApp del administrador',
  diasAnticipacionMax: 'la anticipación máxima para reservar',
  senaModo: 'el modo de seña', senaPorcentaje: 'el porcentaje de seña', senaMontoFijo: 'el monto de seña',
  picoDesde: 'la franja pico (semana)', picoHasta: 'la franja pico (semana)',
  picoFindeDesde: 'la franja pico (finde)', picoFindeHasta: 'la franja pico (finde)',
};

export const configRoutes = Router();

configRoutes.get('/', authAny, async (_req, res, next) => {
  try { res.json(await configService.get()); } catch (e) { next(e); }
});

configRoutes.patch('/', authJwt, requireRole('ADMIN'), validate(updateConfigSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body as Record<string, unknown>;
    const before = await configService.get() as Record<string, unknown>;
    const updated = await configService.update(body);
    const cambiados = Object.keys(body).filter((k) => String(before[k]) !== String(body[k]));
    const labels = [...new Set(cambiados.map((k) => CAMPO_LABEL[k] ?? k))];
    const descripcion = labels.length ? ('Cambió ' + labels.join(', ')) : 'Actualizó la configuración';
    await auditService.log(req, { accion: 'ACTUALIZAR', entidad: 'Config', descripcion });
    res.json(updated);
  } catch (e) { next(e); }
});

configRoutes.get('/sena', authAny, async (_req, res, next) => {
  try { res.json(await senaService.datosPago()); } catch (e) { next(e); }
});

// --- PIN del dashboard (solo ADMIN) ---
const adminIdDe = (req: any): string => (req.principal?.kind === 'admin' ? req.principal.adminId : '');
const tokenDesbloqueo = (req: any): string | undefined => (req.header('x-dashboard-unlock') as string | undefined) || undefined;

configRoutes.get('/dashboard-pin/estado', authJwt, requireRole('ADMIN'), async (req, res, next) => {
  try {
    res.json({
      configurado: await dashboardPinService.configurado(),
      desbloqueado: await dashboardPinService.desbloqueado(tokenDesbloqueo(req), adminIdDe(req)),
    });
  } catch (e) { next(e); }
});

configRoutes.put('/dashboard-pin', authJwt, requireRole('ADMIN'), validate(fijarPinDashboardSchema), async (req, res, next) => {
  try {
    const { pin, pinActual } = (req as any).valid.body;
    await dashboardPinService.setear(pin, pinActual);
    await auditService.log(req, { accion: 'ACTUALIZAR', entidad: 'Config', descripcion: 'Cambió el PIN del dashboard' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

configRoutes.post('/dashboard-pin/quitar', authJwt, requireRole('ADMIN'), validate(quitarPinDashboardSchema), async (req, res, next) => {
  try {
    await dashboardPinService.quitar((req as any).valid.body.pinActual);
    await auditService.log(req, { accion: 'ACTUALIZAR', entidad: 'Config', descripcion: 'Quitó el PIN del dashboard' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

configRoutes.post('/dashboard-pin/verificar', authJwt, requireRole('ADMIN'), pinDashboardLimiter, validate(verificarPinDashboardSchema), async (req, res, next) => {
  try { res.json(await dashboardPinService.verificar((req as any).valid.body.pin, adminIdDe(req))); } catch (e) { next(e); }
});

import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { analyticsService } from '../services/analytics.service.js';
import { dashboardPinService } from '../services/dashboardPin.service.js';
import { getEnv } from '../config/env.js';
import { dayWindowUtc } from '../utils/tz.js';

export const analyticsRoutes = Router();
analyticsRoutes.use(authJwt, requireRole('ADMIN'));
// Con PIN del dashboard configurado, los números solo salen si el admin lo ingresó (ver dashboardPin.service).
analyticsRoutes.use(async (req, _res, next) => {
  try {
    const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : '';
    await dashboardPinService.exigirDesbloqueo(req.header('x-dashboard-unlock') || undefined, adminId);
    next();
  } catch (e) { next(e); }
});

function serializeBigInt(rows: any[]) {
  return rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])),
  );
}

// Parsea ?desde&hasta (YYYY-MM-DD) a ventana UTC; default últimos 30 días.
function rango(req: any): { desde: Date; hasta: Date; desdeYmd: string; hastaYmd: string } {
  const tz = getEnv().TZ_NEGOCIO;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const q = req.query || {};
  const hastaYmd = re.test(q.hasta) ? q.hasta : hoy;
  const desdeYmd = re.test(q.desde) ? q.desde : new Date(Date.now() - 29 * 86400000).toLocaleDateString('en-CA', { timeZone: tz });
  return { desde: dayWindowUtc(desdeYmd, tz).start, hasta: dayWindowUtc(hastaYmd, tz).end, desdeYmd, hastaYmd };
}

analyticsRoutes.get('/ingresos', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(await analyticsService.ingresos(desde, hasta)); } catch (e) { next(e); }
});
analyticsRoutes.get('/reservas', async (req, res, next) => {
  try { const { desde, hasta, desdeYmd, hastaYmd } = rango(req); res.json(await analyticsService.reservas(desde, hasta, { desdeYmd, hastaYmd })); } catch (e) { next(e); }
});
analyticsRoutes.get('/ingresos-por-dia', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(await analyticsService.ingresosPorDia(desde, hasta)); } catch (e) { next(e); }
});
analyticsRoutes.get('/canchas-top', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(await analyticsService.canchasTop(desde, hasta)); } catch (e) { next(e); }
});
analyticsRoutes.get('/horarios-pico', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(serializeBigInt(await analyticsService.horariosPico(desde, hasta))); } catch (e) { next(e); }
});
// Ventas del buffet por mostrador (principal y secundario) en el período.
analyticsRoutes.get('/buffet', async (req, res, next) => {
  try { const { desde, hasta, desdeYmd, hastaYmd } = rango(req); res.json(await analyticsService.buffet(desde, hasta, { desdeYmd, hastaYmd })); } catch (e) { next(e); }
});
analyticsRoutes.get('/ocupacion', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(serializeBigInt(await analyticsService.ocupacion(desde, hasta))); } catch (e) { next(e); }
});
analyticsRoutes.get('/origenes', async (req, res, next) => {
  try {
    const { desde, hasta } = rango(req);
    const r = await analyticsService.origenes(desde, hasta);
    // `total` y `unicos` ya vienen convertidos; los agrupados son filas crudas con BigInt.
    res.json({ ...r, porTipo: serializeBigInt(r.porTipo), porEtiqueta: serializeBigInt(r.porEtiqueta) });
  } catch (e) { next(e); }
});

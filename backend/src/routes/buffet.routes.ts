import { Router } from 'express';
import { authBuffet } from '../middlewares/authBuffet.js';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import { loginLimiter } from '../middlewares/rateLimiters.js';
import { buffetProductoService } from '../services/buffetProducto.service.js';
import { buffetCajaService } from '../services/buffetCaja.service.js';
import { buffetPinService } from '../services/buffetPin.service.js';
import { crearProductoSchema, actualizarProductoSchema, reponerSchema, cobrarSchema, porCodigoSchema, setPinSchema, verificarPinSchema } from '../validators/buffet.schema.js';
import { NotFound } from '../utils/errors.js';

export const buffetRoutes = Router();

// --- Mostrador (x-buffet-key) ---
// OJO: /productos/botonera va antes que cualquier /productos/:id de admin.
buffetRoutes.get('/productos/botonera', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetProductoService.listBotonera()); } catch (e) { next(e); }
});

buffetRoutes.get('/productos/activos', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetProductoService.listActivos()); } catch (e) { next(e); }
});

buffetRoutes.post('/caja/abrir', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetCajaService.abrir()); } catch (e) { next(e); }
});

buffetRoutes.get('/caja/actual', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetCajaService.actual()); } catch (e) { next(e); }
});

buffetRoutes.get('/producto', authBuffet, validate(porCodigoSchema), async (req, res, next) => {
  try {
    const p = await buffetProductoService.porCodigo((req as any).valid.query.codigoBarra);
    if (!p) return next(NotFound('ProductoBuffet', (req as any).valid.query.codigoBarra));
    res.json(p);
  } catch (e) { next(e); }
});

buffetRoutes.post('/cobrar', authBuffet, validate(cobrarSchema), async (req, res, next) => {
  try { res.json(await buffetCajaService.cobrar((req as any).valid.body)); } catch (e) { next(e); }
});

buffetRoutes.post('/caja/cerrar', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetCajaService.cerrar()); } catch (e) { next(e); }
});

buffetRoutes.post('/pin/verificar', authBuffet, loginLimiter, validate(verificarPinSchema), async (req, res, next) => {
  try { res.json({ ok: await buffetPinService.verificar((req as any).valid.body.pin) }); } catch (e) { next(e); }
});

// --- Admin (JWT) ---
buffetRoutes.get('/cajas', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json(await buffetCajaService.listCierres()); } catch (e) { next(e); }
});
buffetRoutes.get('/productos', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json(await buffetProductoService.list()); } catch (e) { next(e); }
});

buffetRoutes.post('/productos', authJwt, requireRole('ADMIN'), validate(crearProductoSchema), async (req, res, next) => {
  try { res.status(201).json(await buffetProductoService.crear((req as any).valid.body)); } catch (e) { next(e); }
});

buffetRoutes.patch('/productos/:id', authJwt, requireRole('ADMIN'), validate(actualizarProductoSchema), async (req, res, next) => {
  try { res.json(await buffetProductoService.actualizar((req as any).valid.params.id, (req as any).valid.body)); } catch (e) { next(e); }
});

buffetRoutes.post('/productos/:id/reponer', authJwt, requireRole('ADMIN'), validate(reponerSchema), async (req, res, next) => {
  try {
    const adminId = (req as any).principal.adminId as string;
    res.json(await buffetProductoService.reponer((req as any).valid.params.id, (req as any).valid.body.cantidad, adminId));
  } catch (e) { next(e); }
});

buffetRoutes.put('/pin', authJwt, requireRole('ADMIN'), validate(setPinSchema), async (req, res, next) => {
  try { await buffetPinService.setear((req as any).valid.body.pin); res.status(204).end(); } catch (e) { next(e); }
});

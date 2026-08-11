import { Router } from 'express';
import { authBuffet, authMostrador } from '../middlewares/authBuffet.js';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import { loginLimiter } from '../middlewares/rateLimiters.js';
import { buffetProductoService } from '../services/buffetProducto.service.js';
import { buffetCajaService } from '../services/buffetCaja.service.js';
import { buffetPinService } from '../services/buffetPin.service.js';
import { buffetEntregaService } from '../services/buffetEntrega.service.js';
import { crearProductoSchema, actualizarProductoSchema, reponerSchema, cobrarSchema, porCodigoSchema, setPinSchema, verificarPinSchema, entregarSchema } from '../validators/buffet.schema.js';
import { firmarTokenMostrador } from '../utils/mostradorToken.js';
import { NotFound, Unauthorized } from '../utils/errors.js';

export const buffetRoutes = Router();

// --- Mostrador (x-buffet-key + x-mostrador: el token que emite /pin/verificar) ---
// OJO: /productos/botonera va antes que cualquier /productos/:id de admin.
buffetRoutes.get('/productos/botonera', authMostrador, async (_req, res, next) => {
  try { res.json(await buffetProductoService.listBotonera()); } catch (e) { next(e); }
});

buffetRoutes.get('/productos/activos', authMostrador, async (_req, res, next) => {
  try { res.json(await buffetProductoService.listActivos()); } catch (e) { next(e); }
});

buffetRoutes.post('/caja/abrir', authMostrador, async (_req, res, next) => {
  try { res.json(await buffetCajaService.abrir()); } catch (e) { next(e); }
});

buffetRoutes.get('/caja/actual', authMostrador, async (_req, res, next) => {
  try { res.json(await buffetCajaService.actual()); } catch (e) { next(e); }
});

buffetRoutes.get('/producto', authMostrador, validate(porCodigoSchema), async (req, res, next) => {
  try {
    const p = await buffetProductoService.porCodigo((req as any).valid.query.codigoBarra);
    if (!p) return next(NotFound('ProductoBuffet', (req as any).valid.query.codigoBarra));
    res.json(p);
  } catch (e) { next(e); }
});

buffetRoutes.post('/cobrar', authMostrador, validate(cobrarSchema), async (req, res, next) => {
  try { res.json(await buffetCajaService.cobrar((req as any).valid.body)); } catch (e) { next(e); }
});

buffetRoutes.post('/caja/cerrar', authMostrador, async (_req, res, next) => {
  try { res.json(await buffetCajaService.cerrar()); } catch (e) { next(e); }
});

buffetRoutes.post('/entregas', authMostrador, validate(entregarSchema), async (req, res, next) => {
  try {
    const { items } = (req as any).valid.body;
    res.json(await buffetEntregaService.entregar({ desdeMostradorId: (req as any).mostrador.id, items }));
  } catch (e) { next(e); }
});

buffetRoutes.get('/stock-asignado', authMostrador, async (req, res, next) => {
  try { res.json(await buffetEntregaService.stockAsignado((req as any).mostrador.id)); } catch (e) { next(e); }
});

// Sigue con authBuffet (no authMostrador): acá es donde el mostrador todavía no tiene token,
// porque el PIN es justamente lo que se lo va a dar.
buffetRoutes.post('/pin/verificar', authBuffet, loginLimiter, validate(verificarPinSchema), async (req, res, next) => {
  try {
    const m = await buffetPinService.verificar((req as any).valid.body.pin);
    if (!m) return next(Unauthorized('PIN incorrecto'));
    res.json({ token: firmarTokenMostrador(m.mostradorId), tipo: m.tipo, nombre: m.nombre });
  } catch (e) { next(e); }
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
  try {
    const { mostradorId, pin } = (req as any).valid.body;
    await buffetPinService.setear(mostradorId, pin);
    res.status(204).end();
  } catch (e) { next(e); }
});

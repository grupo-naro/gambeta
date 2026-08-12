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
import { buffetConciliacionService } from '../services/buffetConciliacion.service.js';
import { crearProductoSchema, actualizarProductoSchema, reponerSchema, cobrarSchema, porCodigoSchema, setPinSchema, verificarPinSchema, entregarSchema, conciliarSchema } from '../validators/buffet.schema.js';
import { idParamSchema } from '../validators/reserva.schema.js';
import { firmarTokenMostrador } from '../utils/mostradorToken.js';
import { Forbidden, NotFound, Unauthorized } from '../utils/errors.js';

export const buffetRoutes = Router();

// --- Mostrador (x-buffet-key + x-mostrador: el token que emite /pin/verificar) ---
// OJO: /productos/botonera va antes que cualquier /productos/:id de admin.
buffetRoutes.get('/productos/botonera', authMostrador, async (_req, res, next) => {
  try { res.json(await buffetProductoService.listBotonera()); } catch (e) { next(e); }
});

buffetRoutes.get('/productos/activos', authMostrador, async (_req, res, next) => {
  try { res.json(await buffetProductoService.listActivos()); } catch (e) { next(e); }
});

buffetRoutes.post('/caja/abrir', authMostrador, async (req, res, next) => {
  try { res.json(await buffetCajaService.abrir((req as any).mostrador.id)); } catch (e) { next(e); }
});

buffetRoutes.get('/caja/actual', authMostrador, async (req, res, next) => {
  try { res.json(await buffetCajaService.actual((req as any).mostrador.id)); } catch (e) { next(e); }
});

buffetRoutes.get('/producto', authMostrador, validate(porCodigoSchema), async (req, res, next) => {
  try {
    const p = await buffetProductoService.porCodigo((req as any).valid.query.codigoBarra);
    if (!p) return next(NotFound('ProductoBuffet', (req as any).valid.query.codigoBarra));
    res.json(p);
  } catch (e) { next(e); }
});

buffetRoutes.post('/cobrar', authMostrador, validate(cobrarSchema), async (req, res, next) => {
  try {
    const mostradorId = (req as any).mostrador.id;
    res.json(await buffetCajaService.cobrar({ ...(req as any).valid.body, mostradorId }));
  } catch (e) { next(e); }
});

buffetRoutes.post('/caja/cerrar', authMostrador, async (req, res, next) => {
  try { res.json(await buffetCajaService.cerrar((req as any).mostrador.id)); } catch (e) { next(e); }
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

// Mismo guard de tipo que el POST (ahí vive dentro del servicio, porque `porMostradorId` es
// parte del input de negocio de `conciliar`; acá `pendiente` es una lectura pura sin ese input,
// así que el guard queda en la ruta): la conciliación la ve el principal y el administrador, el
// secundario no — ni siquiera el resumen de una caja ajena.
buffetRoutes.get('/cajas/:id/conciliacion', authMostrador, validate(idParamSchema), async (req, res, next) => {
  try {
    if ((req as any).mostrador.tipo !== 'PRINCIPAL') return next(Forbidden('La conciliación la ve el mostrador principal'));
    res.json(await buffetConciliacionService.pendiente(String(req.params.id)));
  } catch (e) { next(e); }
});

buffetRoutes.post('/cajas/:id/conciliacion', authMostrador, validate(conciliarSchema), async (req, res, next) => {
  try {
    const { conteos } = (req as any).valid.body;
    res.json(await buffetConciliacionService.conciliar({
      cajaId: String(req.params.id), porMostradorId: (req as any).mostrador.id, conteos,
    }));
  } catch (e) { next(e); }
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

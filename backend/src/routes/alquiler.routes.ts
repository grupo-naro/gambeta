import { Router } from 'express';
import { authMostrador } from '../middlewares/authBuffet.js';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import { alquilerService } from '../services/alquiler.service.js';
import { alquilerArticuloService } from '../services/alquilerArticulo.service.js';
import { auditService } from '../services/audit.service.js';
import { Forbidden } from '../utils/errors.js';
import {
  crearArticuloSchema, actualizarArticuloSchema, ajustarStockSchema,
  entregarAlquilerSchema, cerrarAlquilerSchema, historialAlquileresSchema,
} from '../validators/alquiler.schema.js';

export const alquilerRoutes = Router();

const SOLO_PRINCIPAL = 'Los alquileres los maneja el mostrador principal';

// --- Mostrador (x-buffet-key + x-mostrador) ---
// OJO: las rutas literales van ANTES que /:id/cerrar, igual que en buffet.routes.ts.
alquilerRoutes.get('/botonera', authMostrador, async (req, res, next) => {
  try {
    if ((req as any).mostrador.tipo !== 'PRINCIPAL') return next(Forbidden(SOLO_PRINCIPAL));
    res.json(await alquilerArticuloService.listBotonera());
  } catch (e) { next(e); }
});

alquilerRoutes.get('/afuera', authMostrador, async (req, res, next) => {
  try {
    if ((req as any).mostrador.tipo !== 'PRINCIPAL') return next(Forbidden(SOLO_PRINCIPAL));
    res.json(await alquilerService.afuera());
  } catch (e) { next(e); }
});

// El guard de puesto vive en el servicio: `entregar` ya lo necesita para su propia invariante.
alquilerRoutes.post('/entregas', authMostrador, validate(entregarAlquilerSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    res.status(201).json(await alquilerService.entregar({ ...body, mostradorId: (req as any).mostrador.id }));
  } catch (e) { next(e); }
});

alquilerRoutes.post('/:id/cerrar', authMostrador, validate(cerrarAlquilerSchema), async (req, res, next) => {
  try {
    if ((req as any).mostrador.tipo !== 'PRINCIPAL') return next(Forbidden(SOLO_PRINCIPAL));
    const { id } = (req as any).valid.params;
    res.json(await alquilerService.cerrar(id, (req as any).valid.body.estado));
  } catch (e) { next(e); }
});

// --- Admin (JWT) ---
alquilerRoutes.get('/articulos', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json(await alquilerArticuloService.list()); } catch (e) { next(e); }
});

alquilerRoutes.post('/articulos', authJwt, requireRole('ADMIN'), validate(crearArticuloSchema), async (req, res, next) => {
  try {
    const creado = await alquilerArticuloService.crear((req as any).valid.body);
    await auditService.log(req, {
      accion: 'CREAR', entidad: 'ArticuloAlquiler', entidadId: creado.id,
      descripcion: `Creó el artículo de alquiler ${creado.nombre}`,
    });
    res.status(201).json(creado);
  } catch (e) { next(e); }
});

alquilerRoutes.patch('/articulos/:id', authJwt, requireRole('ADMIN'), validate(actualizarArticuloSchema), async (req, res, next) => {
  try {
    const { id } = (req as any).valid.params;
    const upd = await alquilerArticuloService.actualizar(id, (req as any).valid.body);
    await auditService.log(req, {
      accion: 'EDITAR', entidad: 'ArticuloAlquiler', entidadId: id,
      descripcion: `Editó el artículo de alquiler ${upd.nombre}`,
    });
    res.json(upd);
  } catch (e) { next(e); }
});

alquilerRoutes.post('/articulos/:id/reponer', authJwt, requireRole('ADMIN'), validate(ajustarStockSchema), async (req, res, next) => {
  try {
    const adminId = (req as any).principal.adminId as string;
    const { id } = (req as any).valid.params;
    res.json(await alquilerArticuloService.ajustarStock(id, (req as any).valid.body.cantidad, adminId));
  } catch (e) { next(e); }
});

alquilerRoutes.get('/', authJwt, requireRole('ADMIN'), validate(historialAlquileresSchema), async (req, res, next) => {
  try { res.json(await alquilerService.historial((req as any).valid.query)); } catch (e) { next(e); }
});

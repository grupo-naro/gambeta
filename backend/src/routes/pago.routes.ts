import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authAny } from '../middlewares/authAny.js';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { crearPreferenciaSchema, callbackMpSchema, reservaPagoSchema } from '../validators/pago.schema.js';
import { getEnv } from '../config/env.js';
import { reservaService } from '../services/reserva.service.js';
import { mercadoPagoService } from '../services/mercadoPago.service.js';
import { mercadoPagoOauthService } from '../services/mercadoPagoOauth.service.js';
import { pagoRepo } from '../repositories/pago.repo.js';
import { auditService } from '../services/audit.service.js';
import { Conflict } from '../utils/errors.js';

export const pagoRoutes = Router();

pagoRoutes.post('/mercadopago/preferencia', authAny, validate(crearPreferenciaSchema), async (req, res, next) => {
  try {
    const { reservaId } = (req as any).valid.body;
    const reserva = await reservaService.get(reservaId);
    if (reserva.estado !== 'ESPERANDO_SENA') throw Conflict('La reserva no está esperando seña');
    const { preferenceId, checkoutUrl } = await mercadoPagoService.crearPreferencia({
      id: reserva.id,
      montoSena: Number(reserva.montoSena),
      canchaNombre: reserva.cancha.nombre,
      fechaInicio: reserva.fechaInicio,
    });
    await pagoRepo.setPreferencia(reserva.id, preferenceId);
    res.json({ checkoutUrl });
  } catch (e) { next(e); }
});

// Lo mínimo que el sitio público necesita si Mercado Pago rechaza el pago: cuánto es la seña, hasta
// cuándo se guarda el horario y si la reserva sigue esperando. Sin nombre ni teléfono a propósito.
pagoRoutes.get('/reserva/:id', authAny, validate(reservaPagoSchema), async (req, res, next) => {
  try {
    const reserva = await reservaService.get(String((req as any).valid.params.id));
    res.json({
      estado: reserva.estado,
      canchaNombre: reserva.cancha.nombre,
      fechaInicio: reserva.fechaInicio.toISOString(),
      montoSena: reserva.montoSena == null ? null : Number(reserva.montoSena),
      venceEn: new Date(reserva.creadoEn.getTime() + getEnv().SENA_TIMEOUT_MINUTOS * 60000).toISOString(),
    });
  } catch (e) { next(e); }
});

// Vincular/desvincular la cuenta de Mercado Pago redirige adónde va la plata de las señas:
// solo un admin autenticado con JWT puede tocarlo. La x-api-key de servicio (que usan n8n y
// la web pública) NO alcanza acá a propósito.
pagoRoutes.get('/mercadopago/cuenta', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json(await mercadoPagoOauthService.estado()); } catch (e) { next(e); }
});

pagoRoutes.post('/mercadopago/vincular', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json({ url: mercadoPagoOauthService.urlDeAutorizacion().url }); } catch (e) { next(e); }
});

pagoRoutes.post('/mercadopago/callback', authJwt, requireRole('ADMIN'), validate(callbackMpSchema), async (req, res, next) => {
  try {
    const { code, state } = (req as any).valid.body;
    const { apodo } = await mercadoPagoOauthService.vincular(code, state);
    await auditService.log(req, { accion: 'ACTUALIZAR', entidad: 'Config', descripcion: 'Vinculó la cuenta de Mercado Pago' });
    res.json({ apodo });
  } catch (e) { next(e); }
});

pagoRoutes.delete('/mercadopago/cuenta', authJwt, requireRole('ADMIN'), async (req, res, next) => {
  try {
    await mercadoPagoOauthService.desvincular();
    await auditService.log(req, { accion: 'ELIMINAR', entidad: 'Config', descripcion: 'Desvinculó la cuenta de Mercado Pago' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

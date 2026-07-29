import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authAny } from '../middlewares/authAny.js';
import { crearPreferenciaSchema } from '../validators/pago.schema.js';
import { reservaService } from '../services/reserva.service.js';
import { mercadoPagoService } from '../services/mercadoPago.service.js';
import { pagoRepo } from '../repositories/pago.repo.js';
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
    });
    await pagoRepo.setPreferencia(reserva.id, preferenceId);
    res.json({ checkoutUrl });
  } catch (e) { next(e); }
});

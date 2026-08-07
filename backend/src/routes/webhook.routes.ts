import { Router } from 'express';
import { mercadoPagoService } from '../services/mercadoPago.service.js';
import { reservaService } from '../services/reserva.service.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { pagoRepo } from '../repositories/pago.repo.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

export const webhookRoutes = Router();

webhookRoutes.post('/mercadopago', async (req, res, next) => {
  try {
    const type = (req.query.type ?? req.query.topic ?? (req.body as any)?.type) as string | undefined;
    if (type !== 'payment') { res.sendStatus(200); return; }

    const dataId = (req.query['data.id'] ?? (req.body as any)?.data?.id) as string | undefined;
    const xSignature = req.header('x-signature');
    const xRequestId = req.header('x-request-id');

    const firmaOk = mercadoPagoService.verificarFirma({ xSignature, xRequestId, dataId });
    if (!firmaOk) {
      // Sin este log el modo de falla es mudo: si MP_WEBHOOK_SECRET no es el de la aplicación
      // que emitió el token, TODAS las notificaciones vuelven 401, ninguna seña se aprueba
      // sola, las reservas se cancelan a los 30 minutos y en los logs no queda nada.
      logger.warn({ dataId, xRequestId }, 'webhook MP: firma inválida — revisar MP_WEBHOOK_SECRET');
      res.sendStatus(401);
      return;
    }

    const pago = await mercadoPagoService.obtenerPago(dataId!);
    if (pago.status !== 'approved') { res.sendStatus(200); return; }
    if (!pago.externalReference) { res.sendStatus(200); return; }

    const reserva = await reservaRepo.findById(pago.externalReference);
    if (!reserva) {
      logger.warn({ reservaId: pago.externalReference }, 'webhook MP: reserva no encontrada');
      res.sendStatus(200);
      return;
    }
    if (reserva.estado !== 'ESPERANDO_SENA') {
      // Sobre una reserva CANCELADA esto es plata cobrada sin turno: alguien tiene que
      // devolverla o reubicar al cliente a mano. Va como error, con el monto, para que se
      // pueda rastrear. Sobre una CONFIRMADA/COMPLETADA es una reentrega del webhook y no
      // pasa nada.
      const datos = { reservaId: reserva.id, mpPaymentId: pago.id, estado: reserva.estado, monto: pago.montoAprobado };
      if (reserva.estado === 'CANCELADA') {
        logger.error(datos, 'webhook MP: pago aprobado sobre una reserva ya cancelada — revisar a mano');
      } else {
        logger.warn(datos, 'webhook MP: pago aprobado sobre reserva no ESPERANDO_SENA');
      }
      res.sendStatus(200);
      return;
    }

    try {
      await reservaService.aprobarSena(reserva.id, { notificar: true }, { montoDetectado: pago.montoAprobado });
    } catch (e) {
      if (e instanceof AppError && e.status === 409) { res.sendStatus(200); return; } // otra entrega ya la procesó (race) — idempotente
      throw e;
    }
    await pagoRepo.setPago(reserva.id, pago.id);
    res.sendStatus(200);
  } catch (e) { next(e); }
});

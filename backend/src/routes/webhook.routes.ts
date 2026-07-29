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
    if (!firmaOk) { res.sendStatus(401); return; }

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
      logger.warn({ reservaId: reserva.id, mpPaymentId: pago.id, estado: reserva.estado }, 'webhook MP: pago aprobado sobre reserva no ESPERANDO_SENA');
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

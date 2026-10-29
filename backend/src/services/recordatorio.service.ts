import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { normalizarWhatsapp } from '../utils/whatsapp.js';
import { evolutionService } from './evolution.service.js';
import { mensajeRecordatorio } from './notificacion.service.js';
import { momentoRecordatorio } from './recordatorio.reglas.js';

/**
 * Avisa por WhatsApp, un día antes (a las 18:00, ver `momentoRecordatorio`), las reservas confirmadas.
 * Solo notifica: el número no atiende respuestas. Devuelve cuántos avisos salieron.
 *
 * - Solo `CONFIRMADA`: las que esperan seña o están canceladas no se avisan.
 * - Sin turnos fijos: se materializan el mismo día y su cliente ya sabe que viene.
 * - No avisa una reserva hecha después de la hora del recordatorio: ya recibió la confirmación.
 * - La marca `recordatorioEnviadoEn` se toma ANTES de enviar (así dos pasadas simultáneas no
 *   duplican) y se deshace si el envío falla, para reintentar en la próxima pasada.
 */
export async function enviarRecordatorios(ahora: Date = new Date()): Promise<number> {
  const tz = getEnv().TZ_NEGOCIO;
  const candidatas = await prisma.reserva.findMany({
    where: {
      estado: 'CONFIRMADA', recordatorioEnviadoEn: null, turnoFijoId: null,
      // Ni los ya empezados ni los lejanos: el aviso de un turno a 2+ días todavía no corresponde.
      fechaInicio: { gt: ahora, lt: new Date(ahora.getTime() + 2 * 86400000) },
    },
    include: { cancha: { select: { nombre: true } }, cliente: { select: { nombre: true, whatsapp: true } } },
  });

  let enviados = 0;
  for (const r of candidatas) {
    try {
      const momento = momentoRecordatorio(r.fechaInicio, tz);
      if (ahora < momento || r.creadoEn >= momento) continue;
      const numero = normalizarWhatsapp(r.cliente.whatsapp);
      if (!numero) continue;

      const tomada = await prisma.reserva.updateMany({
        where: { id: r.id, estado: 'CONFIRMADA', recordatorioEnviadoEn: null },
        data: { recordatorioEnviadoEn: ahora },
      });
      if (tomada.count === 0) continue;

      let salio = false;
      try {
        salio = await evolutionService.enviarWhatsapp(numero, mensajeRecordatorio({ nombreCliente: r.cliente.nombre, canchaNombre: r.cancha.nombre, fechaInicio: r.fechaInicio }, tz));
      } catch (e) {
        logger.warn({ err: e, reservaId: r.id }, 'recordatorio: falló el envío');
      }
      if (!salio) {
        await prisma.reserva.update({ where: { id: r.id }, data: { recordatorioEnviadoEn: null } });
        continue;
      }
      enviados++;
    } catch (e) {
      // Una reserva que falla no puede frenar a las demás.
      logger.warn({ err: e, reservaId: r.id }, 'recordatorio: no se pudo procesar una reserva');
    }
  }
  if (enviados > 0) logger.info({ enviados }, 'recordatorios enviados');
  return enviados;
}

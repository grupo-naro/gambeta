import { evolutionService } from './evolution.service.js';
import { normalizarWhatsapp } from '../utils/whatsapp.js';
import { logger } from '../utils/logger.js';

export interface DatosNotificacion {
  nombreCliente: string;
  whatsapp: string;
  canchaNombre: string;
  fechaInicio: Date;
  montoSena: number;
}

/** "hoy", "mañana" o "el viernes 15/03", siempre en la zona del negocio. */
function fraseDia(fechaInicio: Date, tz: string): string {
  const ymd = fechaInicio.toLocaleDateString('en-CA', { timeZone: tz });
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const manana = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: tz });
  if (ymd === hoy) return 'hoy';
  if (ymd === manana) return 'mañana';
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `el ${dias[dow]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

function fraseHora(fechaInicio: Date, tz: string): string {
  return fechaInicio.toLocaleTimeString('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function mensajeSenaAprobada(r: { cancha: { nombre: string }; fechaInicio: Date }, tz: string): string {
  return `¡Listo! Confirmamos tu seña ✅. Tu turno de ${r.cancha.nombre} ${fraseDia(r.fechaInicio, tz)} a las ${fraseHora(r.fechaInicio, tz)} quedó reservado. ¡Te esperamos!`;
}

export function mensajeReservaConfirmada(d: DatosNotificacion, tz: string): string {
  return `¡Hola ${d.nombreCliente}! Tu turno de ${d.canchaNombre} ${fraseDia(d.fechaInicio, tz)} a las ${fraseHora(d.fechaInicio, tz)} quedó confirmado ✅. ¡Te esperamos!`;
}

export function mensajeComprobantePendiente(d: DatosNotificacion, tz: string): string {
  const sena = d.montoSena.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  return (
    `🧾 Reserva por transferencia, falta revisar el comprobante.\n` +
    `Cliente: ${d.nombreCliente} (${d.whatsapp})\n` +
    `Turno: ${d.canchaNombre} ${fraseDia(d.fechaInicio, tz)} a las ${fraseHora(d.fechaInicio, tz)}\n` +
    `Seña: $${sena}\n` +
    `Cuando llegue el comprobante, aprobá la seña desde el panel.`
  );
}

/** Fire-and-forget: un WhatsApp caído nunca puede hacer fallar (ni demorar) una reserva. */
function enviar(numero: string, texto: () => string, contexto: string): void {
  try {
    void evolutionService.enviarWhatsapp(numero, texto()).catch(() => {});
  } catch (e) {
    logger.warn({ err: e }, `${contexto}: fallo al construir/enviar el mensaje`);
  }
}

export const notificacionService = {
  /** Al cliente, cuando su reserva queda CONFIRMADA sin pasar por seña. */
  avisarReservaConfirmada(d: DatosNotificacion, tz: string): void {
    enviar(d.whatsapp, () => mensajeReservaConfirmada(d, tz), 'aviso de reserva confirmada');
  },

  /** Al encargado, cuando se crea una reserva por transferencia y hay un comprobante por revisar. */
  avisarComprobantePendiente(d: DatosNotificacion, whatsappEncargado: string, tz: string): void {
    const numero = normalizarWhatsapp(whatsappEncargado);
    if (!numero) {
      logger.warn('aviso de comprobante: no hay WhatsApp de encargado válido, no se avisa');
      return;
    }
    enviar(numero, () => mensajeComprobantePendiente(d, tz), 'aviso de comprobante pendiente');
  },
};

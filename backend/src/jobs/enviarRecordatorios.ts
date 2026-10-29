import { enviarRecordatorios } from '../services/recordatorio.service.js';
import { logger } from '../utils/logger.js';

/**
 * Cada cuánto se revisa. El aviso sale a las 18:00 del día anterior, así que llega entre las 18:00
 * y las 18:05. Constante y no variable de entorno, por el mismo motivo que `HORA_RECORDATORIO`.
 */
export const INTERVALO_MS = 5 * 60 * 1000;

// Evita que dos pasadas corran superpuestas (una pasada lenta con WhatsApp caído no debe apilarse).
let corriendo = false;

/**
 * Programa el job. Llamar SOLO desde `index.ts`, nunca desde `buildApp()`: los tests construyen la
 * app y un temporizador mandando WhatsApps de fondo los volvería intermitentes.
 */
export function iniciarJobRecordatorios(): NodeJS.Timeout {
  const ejecutar = () => {
    if (corriendo) return;
    corriendo = true;
    enviarRecordatorios()
      .catch((e) => logger.error({ err: e }, 'falló la pasada del job de recordatorios'))
      .finally(() => { corriendo = false; });
  };
  ejecutar();
  const timer = setInterval(ejecutar, INTERVALO_MS);
  timer.unref();
  return timer;
}

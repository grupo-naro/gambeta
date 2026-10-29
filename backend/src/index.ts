import 'dotenv/config';
import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { iniciarJobSenasVencidas } from './jobs/liberarSenasVencidas.js';
import { iniciarJobRecordatorios } from './jobs/enviarRecordatorios.js';
import { logger } from './utils/logger.js';

const env = getEnv();
buildApp().listen(env.PORT, () => logger.info(`API on :${env.PORT}`));

// Acá y no en buildApp(): los tests construyen la app y no deben arrancar temporizadores.
iniciarJobSenasVencidas();
logger.info({ timeoutMin: env.SENA_TIMEOUT_MINUTOS }, 'job de señas vencidas iniciado');

// Los recordatorios solo corren si Evolution está configurado: sin eso cada pasada reintentaría en vano.
if (env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCE) {
  iniciarJobRecordatorios();
  logger.info('job de recordatorios iniciado');
} else {
  logger.warn('recordatorios apagados: falta EVOLUTION_API_KEY / EVOLUTION_INSTANCE');
}

import { logger } from '../utils/logger.js';

const TIMEOUT_MS = 8000;

/**
 * Envía un texto por WhatsApp vía Evolution. Best-effort: NUNCA lanza.
 * Lee la config de process.env en cada llamada (permite rotar sin reiniciar
 * y hace testeable el módulo). Si falta la API key o la instancia, no intenta
 * enviar y devuelve false. Devuelve true solo si Evolution respondió 2xx.
 */
export const evolutionService = {
  async enviarWhatsapp(number: string, text: string): Promise<boolean> {
    const base = process.env.EVOLUTION_URL || 'http://evolution:8080';
    const apiKey = process.env.EVOLUTION_API_KEY || '';
    const instance = process.env.EVOLUTION_INSTANCE || '';
    if (!apiKey || !instance) {
      logger.warn('evolution: EVOLUTION_API_KEY/INSTANCE sin configurar, no se envía el WhatsApp');
      return false;
    }
    if (!number) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/message/sendText/${instance}`, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'evolution: envío de WhatsApp devolvió no-2xx');
        return false;
      }
      return true;
    } catch (e) {
      logger.warn({ err: e }, 'evolution: falló el envío de WhatsApp');
      return false;
    } finally {
      clearTimeout(timer);
    }
  },
};

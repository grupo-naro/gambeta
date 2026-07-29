import { getEnv } from '../config/env.js';
import { suscripcionRepo } from '../repositories/suscripcion.repo.js';
import { aFechaUtc, hoyEnTz } from './suscripcion.vigencia.js';

export const suscripcionService = {
  /**
   * ÚNICA función que decide si alguien es socio. Todo lo demás (reservas, panel, web)
   * consume esto; nunca reimplementa la regla.
   *
   * Recibe `clienteId` y no `whatsapp` porque `reserva.service.crear` ya buscó el cliente
   * unas líneas antes: así se reutiliza esa consulta en vez de hacer un join extra.
   */
  async vigenteDe(clienteId: string, fecha?: string) {
    const ymd = fecha ?? hoyEnTz(getEnv().TZ_NEGOCIO);
    const encontradas = await suscripcionRepo.cubriendo(clienteId, aFechaUtc(ymd));
    return encontradas[0] ?? null;
  },
};

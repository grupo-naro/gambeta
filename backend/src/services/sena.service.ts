import { configService } from './config.service.js';
import { mercadoPagoOauthService } from './mercadoPagoOauth.service.js';
import { getEnv } from '../config/env.js';

export interface DatosPago {
  modo: 'fijo';
  porcentaje: number;
  cbu: string;
  alias: string;
  titular: string;
  cobrosOnline: boolean;
  /** El número al que el cliente manda el comprobante de la transferencia. */
  adminWhatsapp: string;
  /** Si el complejo cargó datos bancarios. Sin esto, ofrecer transferencia mostraría un alias vacío. */
  transferenciaDisponible: boolean;
  /** Cuánto aguanta la reserva sin pagar antes de que el job libere el horario. */
  senaTimeoutMinutos: number;
}

export const senaService = {
  /** Seña de una cancha: su monto propio si está seteado (>0), si no el monto fijo global. */
  async montoParaCancha(cancha: { senaMonto?: unknown }, precioHora: number): Promise<number> {
    const propio = cancha?.senaMonto == null ? 0 : Number(cancha.senaMonto);
    if (propio > 0) return Math.round(propio);
    return this.montoParaPrecio(precioHora);
  },
  /** Fallback global: siempre monto fijo (el porcentaje quedó anulado). */
  async montoParaPrecio(_precioHora: number): Promise<number> {
    const c = await configService.get();
    return Math.round(Number(c.senaMontoFijo));
  },
  async datosPago(): Promise<DatosPago> {
    const c = await configService.get();
    return {
      modo: 'fijo', porcentaje: c.senaPorcentaje, cbu: c.cbu, alias: c.alias, titular: c.titular,
      // La web pública lo usa para decidir si ofrece Mercado Pago. Sin cuenta vinculada no hay
      // checkout, pero sí puede haber transferencia: ya no apaga el sitio por sí solo.
      cobrosOnline: await mercadoPagoOauthService.cobrosOnlineActivos(),
      adminWhatsapp: c.adminWhatsapp,
      // La regla vive acá y no en el sitio: es la misma pregunta que se hace el panel al mostrar
      // los datos, y duplicarla garantiza que se desincronicen.
      transferenciaDisponible: c.cbu.trim() !== '' || c.alias.trim() !== '',
      senaTimeoutMinutos: getEnv().SENA_TIMEOUT_MINUTOS,
    };
  },
};

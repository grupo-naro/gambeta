import { MercadoPagoConfig, Preference, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError } from 'mercadopago';
import { getEnv } from '../config/env.js';
import { Conflict } from '../utils/errors.js';

function client(): MercadoPagoConfig {
  const env = getEnv();
  if (!env.MP_ACCESS_TOKEN) throw Conflict('Mercado Pago no está configurado');
  return new MercadoPagoConfig({ accessToken: env.MP_ACCESS_TOKEN });
}

export const mercadoPagoService = {
  async crearPreferencia(reserva: { id: string; montoSena: number; canchaNombre: string }): Promise<{ preferenceId: string; checkoutUrl: string }> {
    const env = getEnv();
    if (!env.RESERVAS_PUBLIC_URL) throw Conflict('Mercado Pago no está configurado');
    const preference = new Preference(client());
    const result = await preference.create({
      body: {
        items: [
          { id: reserva.id, title: `Seña reserva - ${reserva.canchaNombre}`, quantity: 1, unit_price: reserva.montoSena, currency_id: 'ARS' },
        ],
        back_urls: {
          success: `${env.RESERVAS_PUBLIC_URL}/reservar/pago/exito?external_reference=${reserva.id}`,
          pending: `${env.RESERVAS_PUBLIC_URL}/reservar/pago/pendiente?external_reference=${reserva.id}`,
          failure: `${env.RESERVAS_PUBLIC_URL}/reservar/pago/pendiente?external_reference=${reserva.id}`,
        },
        auto_return: 'approved',
        external_reference: reserva.id,
        notification_url: `${env.BACKEND_PUBLIC_URL}/webhooks/mercadopago`,
      },
    });
    const checkoutUrl = result.sandbox_init_point ?? result.init_point;
    if (!result.id || !checkoutUrl) throw Conflict('Mercado Pago no devolvió una preferencia válida');
    return { preferenceId: result.id, checkoutUrl };
  },

  async obtenerPago(paymentId: string): Promise<{ id: string; status: string; externalReference: string | null; montoAprobado: number }> {
    const payment = new Payment(client());
    const p = await payment.get({ id: paymentId });
    return {
      id: String(p.id),
      status: String(p.status),
      externalReference: p.external_reference ?? null,
      montoAprobado: Number(p.transaction_amount ?? 0),
    };
  },

  verificarFirma(input: { xSignature: string | undefined; xRequestId: string | undefined; dataId: string | undefined }): boolean {
    const env = getEnv();
    if (!env.MP_WEBHOOK_SECRET || !input.xSignature || !input.dataId) return false;
    try {
      WebhookSignatureValidator.validate({
        xSignature: input.xSignature,
        xRequestId: input.xRequestId ?? '',
        dataId: input.dataId,
        secret: env.MP_WEBHOOK_SECRET,
      });
      return true;
    } catch (e) {
      if (e instanceof InvalidWebhookSignatureError) return false;
      throw e;
    }
  },
};

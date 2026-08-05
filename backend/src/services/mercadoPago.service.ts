import { MercadoPagoConfig, Preference, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError } from 'mercadopago';
import { getEnv } from '../config/env.js';
import { Conflict } from '../utils/errors.js';

/**
 * Falla nombrando la variable que falta.
 *
 * OJO al desplegar: `docker-compose.vm.yml` **enumera** las variables que entran al contenedor,
 * no usa `env_file`. Si una variable no está declarada ahí, NO llega al backend aunque esté
 * cargada en el `.env` de la VM. Ese fue el origen real de "no se pudo generar el link de pago":
 * las cuatro MP_* estaban en el .env pero no en el compose.
 */
function requerida(nombre: string, valor: string): string {
  if (!valor) throw Conflict(`Mercado Pago no está configurado: falta la variable ${nombre} en el backend`);
  return valor;
}

function client(): MercadoPagoConfig {
  const env = getEnv();
  return new MercadoPagoConfig({ accessToken: requerida('MP_ACCESS_TOKEN', env.MP_ACCESS_TOKEN) });
}

export const mercadoPagoService = {
  async crearPreferencia(reserva: { id: string; montoSena: number; canchaNombre: string }): Promise<{ preferenceId: string; checkoutUrl: string }> {
    const env = getEnv();
    // Las tres son obligatorias. BACKEND_PUBLIC_URL no se validaba: sin ella, notification_url
    // quedaba en "/webhooks/mercadopago" y Mercado Pago rechazaba la preferencia con un error
    // opaco ("At least one policy returned UNAUTHORIZED") imposible de diagnosticar.
    const reservasUrl = requerida('RESERVAS_PUBLIC_URL', env.RESERVAS_PUBLIC_URL);
    const backendUrl = requerida('BACKEND_PUBLIC_URL', env.BACKEND_PUBLIC_URL);
    const preference = new Preference(client());
    const result = await preference.create({
      body: {
        items: [
          { id: reserva.id, title: `Seña reserva - ${reserva.canchaNombre}`, quantity: 1, unit_price: reserva.montoSena, currency_id: 'ARS' },
        ],
        back_urls: {
          success: `${reservasUrl}/reservar/pago/exito?external_reference=${reserva.id}`,
          pending: `${reservasUrl}/reservar/pago/pendiente?external_reference=${reserva.id}`,
          failure: `${reservasUrl}/reservar/pago/pendiente?external_reference=${reserva.id}`,
        },
        auto_return: 'approved',
        external_reference: reserva.id,
        notification_url: `${backendUrl}/webhooks/mercadopago`,
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

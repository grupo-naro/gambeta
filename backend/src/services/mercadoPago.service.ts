import { MercadoPagoConfig, Preference, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError } from 'mercadopago';
import { getEnv } from '../config/env.js';
import { Conflict } from '../utils/errors.js';
import { mercadoPagoOauthService } from './mercadoPagoOauth.service.js';

/**
 * Falla nombrando la variable que falta.
 *
 * OJO al desplegar: `docker-compose.vm.yml` **enumera** las variables que entran al contenedor,
 * no usa `env_file`. Si una variable no está declarada ahí, NO llega al backend aunque esté
 * cargada en el `.env` de la VM. Ese fue el origen real de "no se pudo generar el link de pago":
 * las MP_CLIENT_ID/MP_CLIENT_SECRET/MP_ENCRYPTION_KEY/PANEL_PUBLIC_URL estaban en el .env pero
 * no en el compose.
 */
function requerida(nombre: string, valor: string): string {
  if (!valor) throw Conflict(`Mercado Pago no está configurado: falta la variable ${nombre} en el backend`);
  return valor;
}

/** El token es el del vendedor (cuenta vinculada por OAuth), no uno fijo de variable de entorno:
 * cada complejo cobra a su propia cuenta de Mercado Pago. */
async function client(): Promise<MercadoPagoConfig> {
  return new MercadoPagoConfig({ accessToken: await mercadoPagoOauthService.tokenDeAcceso() });
}

export const mercadoPagoService = {
  async crearPreferencia(reserva: { id: string; montoSena: number; canchaNombre: string }): Promise<{ preferenceId: string; checkoutUrl: string }> {
    const env = getEnv();
    // Las tres son obligatorias. BACKEND_PUBLIC_URL no se validaba: sin ella, notification_url
    // quedaba en "/webhooks/mercadopago" y Mercado Pago rechazaba la preferencia con un error
    // opaco ("At least one policy returned UNAUTHORIZED") imposible de diagnosticar.
    const reservasUrl = requerida('RESERVAS_PUBLIC_URL', env.RESERVAS_PUBLIC_URL);
    const backendUrl = requerida('BACKEND_PUBLIC_URL', env.BACKEND_PUBLIC_URL);
    const preference = new Preference(await client());
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
        // Solo plata en cuenta o tarjeta. Rapipago, Pago Fácil y los cajeros ('ticket' y 'atm')
        // se acreditan horas o días después, y la reserva se libera sola a los 30 minutos: el
        // cliente pagaría en el kiosco para encontrarse con que el turno ya se vendió.
        payment_methods: {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }],
        },
      },
    });
    // `init_point` PRIMERO: Mercado Pago devuelve los dos campos, y elegir el de sandbox manda
    // a todos los clientes a un checkout de prueba donde no entra un peso. Estaba al revés
    // desde la integración original, cuando el token era de prueba y daba igual; con la cuenta
    // del complejo vinculada por OAuth, es plata real que no se cobra.
    const checkoutUrl = result.init_point ?? result.sandbox_init_point;
    if (!result.id || !checkoutUrl) throw Conflict('Mercado Pago no devolvió una preferencia válida');
    return { preferenceId: result.id, checkoutUrl };
  },

  async obtenerPago(paymentId: string): Promise<{ id: string; status: string; externalReference: string | null; montoAprobado: number }> {
    // El pago pertenece a la cuenta del vendedor: con otro token no se puede consultar y el
    // webhook quedaría ciego.
    const payment = new Payment(await client());
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

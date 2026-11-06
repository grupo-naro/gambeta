'use server';
import { cookies } from 'next/headers';
import { apiReservas } from './api';
import { COOKIE_ORIGEN, etiquetaDeReserva } from './origen';
import type { Deporte, EstadoPagoReserva, Grilla, MetodoSena, MetodosPago, PreferenciaPago, ReservaCreada, Resultado } from './types';

// Default del backend cuando `SENA_TIMEOUT_MINUTOS` no está seteado (ver `src/config/env.ts`).
// Se usa acá si el backend es viejo y no manda `senaTimeoutMinutos` en absoluto.
const SENA_TIMEOUT_MINUTOS_DEFAULT = 30;
// Default cuando el backend no responde o es viejo y no manda `diasAnticipacionMax`.
const DIAS_ANTICIPACION_DEFAULT = 7;

export async function getGrilla(deporte: Deporte, fecha: string): Promise<Resultado<Grilla>> {
  try {
    const data = await apiReservas<Grilla>(`/disponibilidad/grilla?deporte=${deporte}&fecha=${fecha}`);
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}

/**
 * Qué métodos de pago puede ofrecer el sitio, con los datos que la pantalla de transferencia
 * necesita. Antes esto era `getCobrosOnline()` y devolvía un booleano: sin Mercado Pago el sitio
 * no tomaba ninguna reserva. Ya no es cierto — con CBU cargado se puede cobrar igual.
 *
 * Ante cualquier error devuelve todo en falso, y el sitio manda a reservar por WhatsApp. Es
 * deliberado: preferimos eso antes que tomar una reserva que después no vamos a poder cobrar.
 */
export async function getMetodosPago(): Promise<MetodosPago> {
  const vacio: MetodosPago = {
    mercadoPago: false, transferencia: false,
    cbu: '', alias: '', titular: '', adminWhatsapp: '', senaTimeoutMinutos: SENA_TIMEOUT_MINUTOS_DEFAULT,
    diasAnticipacionMax: DIAS_ANTICIPACION_DEFAULT,
    reservasDesde: '',
  };
  try {
    const d = await apiReservas<{
      cobrosOnline?: boolean; transferenciaDisponible?: boolean;
      cbu?: string; alias?: string; titular?: string;
      adminWhatsapp?: string; senaTimeoutMinutos?: number; diasAnticipacionMax?: number;
      reservasDesde?: string;
    }>('/config/sena');
    return {
      mercadoPago: d.cobrosOnline === true,
      transferencia: d.transferenciaDisponible === true,
      cbu: d.cbu ?? '', alias: d.alias ?? '', titular: d.titular ?? '',
      adminWhatsapp: d.adminWhatsapp ?? '',
      // Si el backend es viejo y no manda el plazo, cae al default del backend.
      senaTimeoutMinutos: d.senaTimeoutMinutos ?? SENA_TIMEOUT_MINUTOS_DEFAULT,
      // Default 7 y no 0: si el backend no contesta o es viejo, el sitio se cae a la ventana
      // esperada en vez de apagar el calendario entero. `??` no alcanza acá: un 0 (o un negativo,
      // cargado a mano en la DB) no es nullish y pasaría derecho, dejando el selector con un solo
      // chip o sin ninguna fecha elegible. Por eso el chequeo es explícito por positividad.
      diasAnticipacionMax: d.diasAnticipacionMax != null && d.diasAnticipacionMax > 0 ? d.diasAnticipacionMax : DIAS_ANTICIPACION_DEFAULT,
      // Backend viejo (sin el campo) o valor raro: sin restricción, y el backend sigue siendo
      // quien rechaza lo que no corresponde.
      reservasDesde: /^\d{4}-\d{2}-\d{2}$/.test(d.reservasDesde ?? '') ? d.reservasDesde! : '',
    };
  } catch (e) {
    console.error('[config] no se pudieron consultar los métodos de pago', { error: e instanceof Error ? e.message : e });
    return vacio;
  }
}

export async function crearReserva(input: { canchaId: string; fecha: string; horaInicio: string; nombre: string; telefono: string; duracionMin?: number; metodoSena?: MetodoSena }): Promise<Resultado<ReservaCreada>> {
  try {
    // Last-touch: el último link por el que pasó el cliente, dentro de los 30 días de la
    // cookie. No se manda nada si no hay cookie — el backend deja las columnas en null.
    const origenEtiqueta = etiquetaDeReserva((await cookies()).get(COOKIE_ORIGEN)?.value);
    const data = await apiReservas<ReservaCreada>('/reservas', {
      method: 'POST',
      body: JSON.stringify({
        canchaId: input.canchaId,
        whatsapp: input.telefono,
        nombreCliente: input.nombre,
        fecha: input.fecha,
        horaInicio: input.horaInicio,
        esContacto: false,
        ...(input.duracionMin != null ? { duracionMin: input.duracionMin } : {}),
        ...(input.metodoSena ? { metodoSena: input.metodoSena } : {}),
        ...(origenEtiqueta ? { origenEtiqueta } : {}),
      }),
    });
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}

/**
 * Cuánto es la seña y si la reserva todavía espera el pago. Devuelve null ante cualquier error: la
 * pantalla de pago fallido sigue sirviendo sin esto (solo que no puede ofrecer la transferencia).
 */
export async function getEstadoPago(reservaId: string): Promise<EstadoPagoReserva | null> {
  try {
    return await apiReservas<EstadoPagoReserva>(`/pagos/reserva/${encodeURIComponent(reservaId)}`);
  } catch (e) {
    console.error('[pago] no se pudo consultar el estado de la reserva', { reservaId, error: e instanceof Error ? e.message : e });
    return null;
  }
}

export async function crearPreferenciaPago(reservaId: string): Promise<Resultado<PreferenciaPago>> {
  try {
    const data = await apiReservas<PreferenciaPago>('/pagos/mercadopago/preferencia', {
      method: 'POST',
      body: JSON.stringify({ reservaId }),
    });
    return { ok: true, data };
  } catch (e) {
    // Al cliente se le muestra un texto amable, pero el motivo real tiene que quedar en algún
    // lado: sin esto, un problema de configuración de Mercado Pago se ve como "no pudimos
    // generar el link de pago" y no hay forma de saber cuál de las variables falta.
    console.error('[pago] no se pudo crear la preferencia de Mercado Pago', { reservaId, error: e instanceof Error ? e.message : e });
    return { ok: false, error: e instanceof Error ? e.message : 'Error' };
  }
}

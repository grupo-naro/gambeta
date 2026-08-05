'use server';
import { apiReservas } from './api';
import type { Deporte, Grilla, PreferenciaPago, ReservaCreada, Resultado } from './types';

export async function getGrilla(deporte: Deporte, fecha: string): Promise<Resultado<Grilla>> {
  try {
    const data = await apiReservas<Grilla>(`/disponibilidad/grilla?deporte=${deporte}&fecha=${fecha}`);
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}

export async function crearReserva(input: { canchaId: string; fecha: string; horaInicio: string; nombre: string; telefono: string; duracionMin?: number }): Promise<Resultado<ReservaCreada>> {
  try {
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
      }),
    });
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}

export async function crearPreferenciaPago(reservaId: string): Promise<Resultado<PreferenciaPago>> {
  try {
    const data = await apiReservas<PreferenciaPago>('/pagos/mercadopago/preferencia', {
      method: 'POST',
      body: JSON.stringify({ reservaId }),
    });
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}

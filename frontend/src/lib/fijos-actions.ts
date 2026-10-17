'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError, type Reserva } from './types';

type Result = { ok: true } | { ok: false; error: string };

// Un turno fijo (y sus liberaciones/excepciones) se ve en varias vistas: hay que revalidarlas todas,
// si no la vista queda con datos cacheados (ej. liberar una fecha no se reflejaba en calendario/hoy/reservas).
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath('/turnos-fijos');
    revalidatePath('/calendario');
    revalidatePath('/hoy');
    revalidatePath('/reservas');
    return { ok: true };
  }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

type FijoInput = {
  canchaId: string; clienteNombre: string; whatsapp: string; diaSemana: number; horaInicio: string; horaFin: string;
  // Los cuatro van juntos: el llamador solo los incluye si el abono está activado.
  vigenciaDesde?: string; vigenciaHasta?: string; montoAbono?: number; medioAbono?: 'EFECTIVO' | 'TRANSFERENCIA';
  // Cuánto pagó ahora del abono. Sin él el backend asume que pagó el total.
  montoPagado?: number;
};

export async function crearTurnoFijo(i: FijoInput): Promise<Result> {
  return run(() => apiFetch('/turnos-fijos', { method: 'POST', body: JSON.stringify(i) }));
}

type CambiosFijo = Partial<{
  canchaId: string; clienteNombre: string; whatsapp: string; diaSemana: number; horaInicio: string; horaFin: string;
  // Solo para fijos con abono. El medio de pago no se edita: es el de un cobro ya asentado.
  vigenciaDesde: string; vigenciaHasta: string; montoAbono: number;
}>;

// Devuelve cuántos turnos futuros ya generados se cancelaron por haber cambiado el horario, y cuánto
// quedó cobrado de más si el nuevo monto del abono es menor a lo ya cobrado.
export async function editarTurnoFijo(id: string, cambios: CambiosFijo): Promise<{ ok: true; turnosCancelados: number; cobradoDeMas: number } | { ok: false; error: string }> {
  try {
    const r = await apiFetch<{ turnosCancelados?: number; cobradoDeMas?: number }>(`/turnos-fijos/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
    revalidatePath('/turnos-fijos'); revalidatePath('/calendario'); revalidatePath('/hoy'); revalidatePath('/reservas');
    return { ok: true, turnosCancelados: r.turnosCancelados ?? 0, cobradoDeMas: r.cobradoDeMas ?? 0 };
  } catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function eliminarTurnoFijo(id: string): Promise<Result> {
  return run(() => apiFetch(`/turnos-fijos/${id}`, { method: 'DELETE' }));
}

export async function desactivarTurnoFijo(id: string): Promise<Result> {
  return run(() => apiFetch(`/turnos-fijos/${id}/desactivar`, { method: 'POST' }));
}

export async function agregarExcepcion(id: string, fecha: string): Promise<Result> {
  return run(() => apiFetch(`/turnos-fijos/${id}/excepciones`, { method: 'POST', body: JSON.stringify({ fecha }) }));
}

export async function quitarExcepcion(id: string, fecha: string): Promise<Result> {
  return run(() => apiFetch(`/turnos-fijos/${id}/excepciones/${fecha}`, { method: 'DELETE' }));
}

export async function materializarFijo(id: string, fecha: string): Promise<{ ok: true; reserva: Reserva } | { ok: false; error: string }> {
  try {
    const reserva = await apiFetch<Reserva>(`/turnos-fijos/${id}/materializar`, { method: 'POST', body: JSON.stringify({ fecha }) });
    revalidatePath('/hoy'); revalidatePath('/reservas'); revalidatePath('/calendario');
    return { ok: true, reserva };
  } catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

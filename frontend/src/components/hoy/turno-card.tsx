'use client';
import { useState } from 'react';
import type { Reserva, Cancha } from '@/lib/types';
import { fmtHora } from '@/lib/fecha';
import { colorDeCancha, nombreCancha } from '@/lib/calendario';
import { PagoChip } from './pago-chip';
import { cn } from '@/lib/utils';

export function TurnoCard({ reserva, canchas, fecha, onClick }: { reserva: Reserva; canchas: Cancha[]; fecha: string; onClick: () => void }) {
  const [ahora] = useState(() => Date.now());
  const pasado = new Date(reserva.fechaFin).getTime() < ahora;
  const col = colorDeCancha(reserva.canchaId, canchas);
  // Vencido = el abono terminó antes del día que se está mirando. Se compara contra la fecha
  // mostrada y no contra hoy, para que al revisar otro día el aviso siga siendo correcto.
  const abonoVencido = reserva.abonoHasta != null && reserva.abonoHasta < fecha;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left transition active:scale-[0.99] min-h-16',
        pasado && 'opacity-60',
      )}
    >
      <span className="w-14 shrink-0 text-center">
        <span className="block text-lg font-semibold leading-none tabular-nums">{fmtHora(reserva.fechaInicio)}</span>
        <span className="block text-xs font-normal text-neutral-500">{fmtHora(reserva.fechaFin)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{reserva.cliente?.nombre ?? '—'}</span>
        <span className={cn('mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium', col.bg, col.text)}>{nombreCancha(reserva.cancha?.nombre)}</span>
        {reserva.turnoFijoId && <span className="mt-1 ml-1 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">Fijo</span>}
        {abonoVencido && (
          <span className="mt-1 ml-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">
            ABONO VENCIDO — RENOVAR
          </span>
        )}
      </span>
      <PagoChip reserva={reserva} />
    </button>
  );
}

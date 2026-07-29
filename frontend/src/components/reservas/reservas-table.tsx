'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EstadoBadge } from '@/components/estado-badge';
import { fmtFechaHora } from '@/lib/fecha';
import type { Reserva, FijoAgenda, Bloqueo } from '@/lib/types';
import { AccionReservaSheet } from '@/components/reservas/accion-reserva-sheet';
import { ReprogramarDialog } from './reprogramar-dialog';

const money = (n: number | null) => (n == null ? '—' : '$' + Number(n).toLocaleString('es-AR'));

export function ReservasTable({ reservas, fijos, bloqueos }: { reservas: Reserva[]; fijos?: FijoAgenda[]; bloqueos?: Bloqueo[] }) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Reserva | null>(null);
  const [reprogramarId, setReprogramarId] = useState<string | null>(null);

  if (reservas.length === 0) return (
    <>
      <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay reservas para este filtro.</p>
      {((fijos?.length ?? 0) > 0 || (bloqueos?.length ?? 0) > 0) && (
        <div className="mt-4 space-y-1 rounded-lg border bg-white p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">También este día</p>
          {fijos?.map((f) => (
            <div key={f.turnoFijoId} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
              <span>{f.horaInicio}–{f.horaFin} · {f.cancha.nombre} · {f.clienteNombre}</span>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">Fijo · ${Number(f.precio).toLocaleString('es-AR')}</span>
            </div>
          ))}
          {bloqueos?.map((b) => (
            <div key={b.id} className="flex items-center justify-between border-b py-2 text-sm text-neutral-600 last:border-0">
              <span>{b.horaInicio}–{b.horaFin} · {b.cancha?.nombre ?? 'Cancha'} · {b.nota ?? b.motivo}</span>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">Bloqueo</span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Cliente</TableHead><TableHead>Cancha</TableHead><TableHead>Fecha/Hora</TableHead><TableHead>Estado</TableHead><TableHead>Seña</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {reservas.map((r) => (
              <TableRow key={r.id} onClick={() => setSeleccion(r)} className="cursor-pointer hover:bg-neutral-50">
                <TableCell>{r.cliente?.nombre ?? '—'}<div className="text-xs text-neutral-500">{r.cliente?.whatsapp}</div></TableCell>
                <TableCell>{r.cancha?.nombre ?? '—'}</TableCell>
                <TableCell>{fmtFechaHora(r.fechaInicio)}</TableCell>
                <TableCell><EstadoBadge estado={r.estado} /></TableCell>
                <TableCell>{money(r.montoSena)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {reservas.map((r) => (
          <button key={r.id} type="button" onClick={() => setSeleccion(r)} className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]">
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{r.cliente?.nombre ?? '—'}</span>
                {r.cliente?.whatsapp && <span className="block text-xs text-neutral-500">{r.cliente.whatsapp}</span>}
              </span>
              <EstadoBadge estado={r.estado} />
            </span>
            <span className="mt-2 block space-y-1 text-sm text-neutral-600">
              <span className="block"><span className="text-xs text-neutral-500">Cancha</span> {r.cancha?.nombre ?? '—'}</span>
              <span className="block"><span className="text-xs text-neutral-500">Fecha/Hora</span> {fmtFechaHora(r.fechaInicio)}</span>
              <span className="block"><span className="text-xs text-neutral-500">Seña</span> {money(r.montoSena)}</span>
            </span>
          </button>
        ))}
      </div>

      <AccionReservaSheet
        reserva={seleccion}
        open={seleccion !== null}
        onOpenChange={(o) => { if (!o) setSeleccion(null); }}
        onReprogramar={(id) => setReprogramarId(id)}
      />
      <ReprogramarDialog
        id={reprogramarId}
        open={reprogramarId !== null}
        onOpenChange={(o) => { if (!o) { setReprogramarId(null); router.refresh(); } }}
      />
      {((fijos?.length ?? 0) > 0 || (bloqueos?.length ?? 0) > 0) && (
        <div className="mt-4 space-y-1 rounded-lg border bg-white p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">También este día</p>
          {fijos?.map((f) => (
            <div key={f.turnoFijoId} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
              <span>{f.horaInicio}–{f.horaFin} · {f.cancha.nombre} · {f.clienteNombre}</span>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">Fijo · ${Number(f.precio).toLocaleString('es-AR')}</span>
            </div>
          ))}
          {bloqueos?.map((b) => (
            <div key={b.id} className="flex items-center justify-between border-b py-2 text-sm text-neutral-600 last:border-0">
              <span>{b.horaInicio}–{b.horaFin} · {b.cancha?.nombre ?? 'Cancha'} · {b.nota ?? b.motivo}</span>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">Bloqueo</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

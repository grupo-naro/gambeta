'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, CalendarDays, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NuevaReservaDialog } from '@/components/reservas/nueva-reserva-dialog';
import { ReprogramarDialog } from '@/components/reservas/reprogramar-dialog';
import { TurnoCard } from './turno-card';
import { FijoCard } from './fijo-card';
import { BloqueoCard } from './bloqueo-card';
import { AccionReservaSheet } from '@/components/reservas/accion-reserva-sheet';
import { EditarReservaDialog } from '@/components/reservas/editar-reserva-dialog';
import { materializarFijo } from '@/lib/fijos-actions';
import { addDias, esHoy, fmtFechaLarga, hoyAR } from '@/lib/fecha';
import { colorDeCancha, nombreCancha } from '@/lib/calendario';
import { cn } from '@/lib/utils';
import type { AgendaDia, CajaReporte, Cancha, Reserva } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function AgendaHoy({ agenda, canchas, fecha, totalCobrado, porMedio, senaMontoFijo }: { agenda: AgendaDia; canchas: Cancha[]; fecha: string; totalCobrado: number; porMedio: CajaReporte['porMedio']; senaMontoFijo: number }) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Reserva | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reprogramarId, setReprogramarId] = useState<string | null>(null);
  const [editando, setEditando] = useState<Reserva | null>(null);
  const [pending, start] = useTransition();
  const [canchaFiltro, setCanchaFiltro] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const norm = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const buscando = q.trim() !== '';
  const matchNombre = (nombre?: string | null) => !buscando || norm(nombre ?? '').includes(norm(q));

  const coincide = (canchaId: string) => !canchaFiltro || canchaId === canchaFiltro;
  const reservas = agenda.reservas.filter((r) => r.estado !== 'CANCELADA' && coincide(r.canchaId) && matchNombre(r.cliente?.nombre));
  const fijos = agenda.fijos.filter((f) => coincide(f.canchaId) && matchNombre(f.clienteNombre));
  const bloqueos = agenda.bloqueos.filter((b) => coincide(b.canchaId) && !buscando);
  const canchasOrden = [...canchas].sort((a, b) => a.id.localeCompare(b.id));
  const vacio = reservas.length === 0 && fijos.length === 0 && bloqueos.length === 0;
  const irA = (ymd: string) => router.push(`/hoy?fecha=${ymd}`);

  function abrir(r: Reserva) { setSeleccion(r); setSheetOpen(true); }

  function cobrarFijo(turnoFijoId: string) {
    start(async () => {
      const res = await materializarFijo(turnoFijoId, fecha);
      if (!res.ok) { toast.error(res.error); return; }
      setSeleccion(res.reserva); setSheetOpen(true);
    });
  }

  return (
    <div className="space-y-4">
      <header className="sticky top-0 z-10 -mx-4 bg-neutral-50/95 px-4 pb-3 pt-1 backdrop-blur supports-backdrop-filter:bg-neutral-50/80">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{esHoy(fecha) ? 'Hoy' : 'Agenda'}</h1>
            <p className="text-sm capitalize text-neutral-600">{fmtFechaLarga(fecha)}</p>
          </div>
          <div className="shrink-0 rounded-xl bg-emerald-50 px-3 py-2 text-right ring-1 ring-inset ring-emerald-600/20">
            <p className="text-xs font-medium text-emerald-700">Cobrado</p>
            <p className="text-lg font-semibold leading-tight text-emerald-800 tabular-nums">{money(totalCobrado)}</p>
            <p className="mt-0.5 text-xs text-emerald-700 tabular-nums">Efectivo {money(porMedio.EFECTIVO)}</p>
            <p className="text-xs text-emerald-700 tabular-nums">Transferencia {money(porMedio.TRANSFERENCIA)}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => irA(addDias(fecha, -1))} aria-label="Día anterior"><ChevronLeft className="h-4 w-4" /></Button>
          {!esHoy(fecha) && <Button variant="outline" size="sm" onClick={() => irA(hoyAR())}>Hoy</Button>}
          <Button variant="outline" size="icon" onClick={() => irA(addDias(fecha, 1))} aria-label="Día siguiente"><ChevronRight className="h-4 w-4" /></Button>
          <div className="ml-auto"><NuevaReservaDialog canchas={canchas} senaMontoFijo={senaMontoFijo} /></div>
        </div>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre…"
          className="w-full rounded-lg border bg-white py-2 pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        {buscando && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setCanchaFiltro(null)}
          className={cn('shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap', canchaFiltro === null ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700')}
        >
          Todas
        </button>
        {canchasOrden.map((c) => {
          const col = colorDeCancha(c.id, canchas);
          const activa = canchaFiltro === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCanchaFiltro(c.id)}
              className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm whitespace-nowrap', activa ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700')}
            >
              <span className={cn('inline-block h-2 w-2 rounded-full', col.dot)} />
              {nombreCancha(c.nombre)}
            </button>
          );
        })}
      </div>

      {vacio ? (
        <div className="rounded-xl border border-dashed bg-white py-12 text-center">
          <CalendarDays className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm text-neutral-600">{buscando ? `No se encontró ninguna reserva para «${q}».` : canchaFiltro ? 'No hay turnos en esa cancha para este día.' : 'No hay turnos para este día.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reservas.map((r) => <TurnoCard key={r.id} reserva={r} canchas={canchas} fecha={fecha} onClick={() => abrir(r)} />)}
          {fijos.map((f) => <FijoCard key={f.turnoFijoId} fijo={f} canchas={canchas} fecha={fecha} onClick={() => { if (!pending) cobrarFijo(f.turnoFijoId); }} />)}
          {bloqueos.map((b) => <BloqueoCard key={b.id} bloqueo={b} canchas={canchas} />)}
        </div>
      )}

      <AccionReservaSheet reserva={seleccion} open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) { setSeleccion(null); router.refresh(); } }} onReprogramar={(id) => setReprogramarId(id)} onEditar={(r) => setEditando(r)} />
      {editando && <EditarReservaDialog key={editando.id} reserva={editando} open onOpenChange={(o) => { if (!o) { setEditando(null); router.refresh(); } }} />}
      <ReprogramarDialog id={reprogramarId} open={reprogramarId !== null} onOpenChange={(o) => { if (!o) { setReprogramarId(null); router.refresh(); } }} />
    </div>
  );
}

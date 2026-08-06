'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import type { Cancha, TurnoFijo } from '@/lib/types';
import { TurnoFijoDialog } from './turno-fijo-dialog';
import { ExcepcionDialog } from './excepcion-dialog';
import { eliminarTurnoFijo, desactivarTurnoFijo } from '@/lib/fijos-actions';
import { hoyAR } from '@/lib/fecha';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Vencido = el abono terminó antes de hoy. Acá no hay una fecha "que se está mirando" como en
// la agenda: la lista de fijos siempre se compara contra el día real.
function abonoVencido(t: TurnoFijo): boolean {
  return t.vigenciaHasta != null && t.vigenciaHasta < hoyAR();
}

function BadgeAbonoVencido() {
  return (
    <span className="ml-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">
      ABONO VENCIDO — RENOVAR
    </span>
  );
}

export function TurnosFijosTable({ fijos, canchas }: { fijos: TurnoFijo[]; canchas: Cancha[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [excepcionOpen, setExcepcionOpen] = useState(false);
  const [selectedTurno, setSelectedTurno] = useState<TurnoFijo | null>(null);
  const [seleccion, setSeleccion] = useState<TurnoFijo | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function abrirExcepcion(t: TurnoFijo) { setSeleccion(null); setSelectedTurno(t); setExcepcionOpen(true); }
  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => { const r = await fn(); if (r.ok) { toast.success(okMsg); if (close) setSeleccion(null); } else { toast.error(r.error ?? 'Error'); } });
  }
  async function eliminar(t: TurnoFijo) {
    if (await confirm({ title: '¿Eliminar el turno fijo?', description: `Vas a eliminar el turno fijo de ${t.clienteNombre}. No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
      act(() => eliminarTurnoFijo(t.id), 'Turno fijo eliminado', true);
    }
  }
  async function desactivar(t: TurnoFijo) {
    // Un fijo con abono cobrado no se puede borrar (dejaría el cobro sin destino): se desactiva
    // en vez de eliminarlo, y eso libera el horario para renovar con un fijo nuevo.
    if (await confirm({ title: '¿Desactivar el turno fijo?', description: `Vas a desactivar el turno fijo de ${t.clienteNombre}. Deja de mostrarse y libera el horario, pero no se borra.`, confirmLabel: 'Desactivar', destructive: true })) {
      act(() => desactivarTurnoFijo(t.id), 'Turno fijo desactivado', true);
    }
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Turnos fijos</h1>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo turno fijo</Button>
      </div>

      {fijos.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay turnos fijos todavía.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Cliente</TableHead><TableHead>Cancha</TableHead><TableHead>Día</TableHead><TableHead>Horario</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {fijos.map((t) => (
                  <TableRow key={t.id} onClick={() => setSeleccion(t)} className="cursor-pointer hover:bg-neutral-50">
                    <TableCell className="font-medium">{t.clienteNombre}{abonoVencido(t) && <BadgeAbonoVencido />}</TableCell>
                    <TableCell className="text-neutral-600">{t.cancha?.nombre ?? '—'}</TableCell>
                    <TableCell>{DIAS[t.diaSemana] ?? t.diaSemana}</TableCell>
                    <TableCell>{t.horaInicio}–{t.horaFin}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden space-y-3">
            {fijos.map((t) => (
              <button key={t.id} type="button" onClick={() => setSeleccion(t)} className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]">
                <span className="block text-sm font-medium">{t.clienteNombre}{abonoVencido(t) && <BadgeAbonoVencido />}</span>
                <span className="mt-2 block space-y-1 text-sm text-neutral-600">
                  <span className="block"><span className="text-xs text-neutral-500">Cancha</span> {t.cancha?.nombre ?? '—'}</span>
                  <span className="block"><span className="text-xs text-neutral-500">Día</span> {DIAS[t.diaSemana] ?? t.diaSemana}</span>
                  <span className="block"><span className="text-xs text-neutral-500">Horario</span> {t.horaInicio}–{t.horaFin}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <Sheet open={seleccion !== null} onOpenChange={(o) => { if (!o) setSeleccion(null); }}>
        {seleccion && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{seleccion.clienteNombre}{abonoVencido(seleccion) && <BadgeAbonoVencido />}</SheetTitle>
              <p className="text-sm text-neutral-600">{seleccion.cancha?.nombre ?? '—'} · {DIAS[seleccion.diaSemana] ?? seleccion.diaSemana} {seleccion.horaInicio}–{seleccion.horaFin}</p>
            </SheetHeader>
            <div className="flex flex-col gap-2">
              <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => abrirExcepcion(seleccion)}>Liberar fecha</Button>
              {seleccion.activo && (
                <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => desactivar(seleccion)}>Desactivar</Button>
              )}
              <Button variant="ghost" className="h-11 w-full text-red-600" disabled={pending} onClick={() => eliminar(seleccion)}>Eliminar</Button>
            </div>
          </SheetContent>
        )}
      </Sheet>

      <TurnoFijoDialog open={dialogOpen} onOpenChange={setDialogOpen} canchas={canchas} />
      <ExcepcionDialog key={selectedTurno?.id ?? 'none'} open={excepcionOpen} onOpenChange={setExcepcionOpen} turno={selectedTurno} />
    </>
  );
}

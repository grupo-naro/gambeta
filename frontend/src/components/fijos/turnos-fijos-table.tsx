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
import { CobrosDialog } from '@/components/reservas/cobros-dialog';
import { EditarTurnoFijoDialog } from './editar-turno-fijo-dialog';
import { eliminarTurnoFijo, desactivarTurnoFijo } from '@/lib/fijos-actions';
import { hoyAR } from '@/lib/fecha';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Vencido = el abono terminó antes de hoy. Acá no hay una fecha "que se está mirando" como en
// la agenda: la lista de fijos siempre se compara contra el día real.
function abonoVencido(t: TurnoFijo): boolean {
  return t.vigenciaHasta != null && t.vigenciaHasta < hoyAR();
}

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

// Lo que falta cobrar del abono. null si el fijo no tiene abono o ya está todo pago.
function saldoAbono(t: TurnoFijo): number | null {
  if (t.montoAbono == null) return null;
  const saldo = Math.max(0, Number(t.montoAbono) - Number(t.abonoPagado ?? 0));
  return saldo > 0 ? saldo : null;
}

function BadgeDebeAbono({ saldo }: { saldo: number }) {
  return (
    <span className="ml-1 inline-block rounded bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-white">
      DEBE {money(saldo)}
    </span>
  );
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
  const [cobrosFijoId, setCobrosFijoId] = useState<string | null>(null);
  const [editando, setEditando] = useState<TurnoFijo | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function abrirExcepcion(t: TurnoFijo) { setSeleccion(null); setSelectedTurno(t); setExcepcionOpen(true); }
  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => { const r = await fn(); if (r.ok) { toast.success(okMsg); if (close) setSeleccion(null); } else { toast.error(r.error ?? 'Error'); } });
  }
  async function eliminar(t: TurnoFijo) {
    if (await confirm({ title: '¿Eliminar el turno fijo?', description: `Vas a eliminar el turno fijo de ${t.clienteNombre}. No se puede deshacer.${t.montoAbono != null ? ' El abono ya cobrado se conserva en la caja.' : ''}`, confirmLabel: 'Eliminar', destructive: true })) {
      act(() => eliminarTurnoFijo(t.id), 'Turno fijo eliminado', true);
    }
  }
  async function desactivar(t: TurnoFijo) {
    // Desactivar oculta el fijo y libera el horario sin borrarlo (útil para renovar con un fijo
    // nuevo). Eliminar también se puede con abono: el cobro se conserva en la caja.
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
                    <TableCell className="font-medium">{t.clienteNombre}{abonoVencido(t) && <BadgeAbonoVencido />}{saldoAbono(t) != null && <BadgeDebeAbono saldo={saldoAbono(t)!} />}</TableCell>
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
                <span className="block text-sm font-medium">{t.clienteNombre}{abonoVencido(t) && <BadgeAbonoVencido />}{saldoAbono(t) != null && <BadgeDebeAbono saldo={saldoAbono(t)!} />}</span>
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
              {seleccion.montoAbono != null && (
                <p className="text-sm text-neutral-600">
                  Abono {money(seleccion.montoAbono)} · pagado {money(Number(seleccion.abonoPagado ?? 0))}
                  {saldoAbono(seleccion) != null
                    ? <> · <span className="font-medium text-amber-700">debe {money(saldoAbono(seleccion)!)}</span></>
                    : Number(seleccion.abonoPagado ?? 0) > Number(seleccion.montoAbono)
                      ? <> · <span className="font-medium text-red-600">cobrado de más {money(Number(seleccion.abonoPagado) - Number(seleccion.montoAbono))}</span></>
                      : ' · al día'}
                </p>
              )}
            </SheetHeader>
            <div className="flex flex-col gap-2">
              {seleccion.montoAbono != null && (
                <Button className="h-11 w-full" disabled={pending} onClick={() => { setCobrosFijoId(seleccion.id); setSeleccion(null); }}>Cobros del abono</Button>
              )}
              <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => { setEditando(seleccion); setSeleccion(null); }}>Editar</Button>
              <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => abrirExcepcion(seleccion)}>Liberar fecha</Button>
              {seleccion.activo && (
                <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => desactivar(seleccion)}>Desactivar</Button>
              )}
              <Button variant="ghost" className="h-11 w-full text-red-600" disabled={pending} onClick={() => eliminar(seleccion)}>Eliminar</Button>
            </div>
          </SheetContent>
        )}
      </Sheet>

      <CobrosDialog fijoId={cobrosFijoId} open={cobrosFijoId !== null} onOpenChange={(o) => { if (!o) setCobrosFijoId(null); }} />
      {editando && <EditarTurnoFijoDialog key={editando.id} turno={editando} canchas={canchas} onClose={() => setEditando(null)} />}
      <TurnoFijoDialog open={dialogOpen} onOpenChange={setDialogOpen} canchas={canchas} />
      <ExcepcionDialog key={selectedTurno?.id ?? 'none'} open={excepcionOpen} onOpenChange={setExcepcionOpen} turno={selectedTurno} />
    </>
  );
}

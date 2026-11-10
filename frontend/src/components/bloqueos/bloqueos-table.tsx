'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import type { Bloqueo, Cancha } from '@/lib/types';
import { BloqueoDialog } from './bloqueo-dialog';
import { ExcepcionBloqueoDialog } from './excepcion-bloqueo-dialog';
import { eliminarBloqueo } from '@/lib/bloqueos-actions';
import { CobrosDialog } from '@/components/reservas/cobros-dialog';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MOTIVO_LABEL: Record<string, string> = { TORNEO: 'Torneo', ENTRENAMIENTO: 'Entrenamiento', MANTENIMIENTO: 'Mantenimiento', OTRO: 'Otro' };

export function BloqueosTable({ bloqueos, canchas }: { bloqueos: Bloqueo[]; canchas: Cancha[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seleccion, setSeleccion] = useState<Bloqueo | null>(null);
  const [excepcionOpen, setExcepcionOpen] = useState(false);
  const [bloqueoExc, setBloqueoExc] = useState<Bloqueo | null>(null);
  function abrirExcepcion(b: Bloqueo) { setSeleccion(null); setBloqueoExc(b); setExcepcionOpen(true); }
  const [cobrosId, setCobrosId] = useState<string | null>(null);
  const [editando, setEditando] = useState<Bloqueo | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => { const r = await fn(); if (r.ok) { toast.success(okMsg); if (close) setSeleccion(null); } else { toast.error(r.error ?? 'Error'); } });
  }
  function programaLabel(b: Bloqueo) {
    if (b.recurrente) {
      const dmy = (ymd: string) => ymd.split('-').reverse().join('/');
      const periodo = b.vigenciaDesde && b.vigenciaHasta ? ` · del ${dmy(b.vigenciaDesde)} al ${dmy(b.vigenciaHasta)}`
        : b.vigenciaHasta ? ` · hasta el ${dmy(b.vigenciaHasta)}`
        : b.vigenciaDesde ? ` · desde el ${dmy(b.vigenciaDesde)}` : '';
      return `Recurrente: ${DIAS[b.diaSemana ?? 0] ?? b.diaSemana}${periodo}`;
    }
    return `Puntual: ${b.fecha?.slice(0, 10) ?? '—'}`;
  }
  function plataLabel(b: Bloqueo) {
    if (b.valor == null) return null;
    // Entrenamiento recurrente: el valor es mensual y la deuda se ve mes por mes.
    if (b.recurrente) return `${money(b.valor)} por mes`;
    return (b.saldo ?? 0) > 0 ? `${money(b.valor)} · DEBE ${money(b.saldo ?? 0)}` : `${money(b.valor)} · Pago`;
  }
  async function eliminar(b: Bloqueo) {
    if (await confirm({ title: '¿Eliminar el bloqueo?', description: `Vas a eliminar el bloqueo de ${b.cancha?.nombre ?? 'esta cancha'}. No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
      act(() => eliminarBloqueo(b.id), 'Bloqueo eliminado', true);
    }
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bloqueos</h1>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo bloqueo</Button>
      </div>

      {bloqueos.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay bloqueos todavía.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Cancha</TableHead><TableHead>Motivo</TableHead><TableHead>Programa</TableHead><TableHead>Horario</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {bloqueos.map((b) => (
                  <TableRow key={b.id} onClick={() => setSeleccion(b)} className="cursor-pointer hover:bg-neutral-50">
                    <TableCell className="font-medium">{b.cancha?.nombre ?? '—'}</TableCell>
                    <TableCell className="text-neutral-600">{MOTIVO_LABEL[b.motivo] ?? b.motivo}{plataLabel(b) && <span className={`ml-2 text-xs font-medium ${(b.saldo ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{plataLabel(b)}</span>}</TableCell>
                    <TableCell>{programaLabel(b)}</TableCell>
                    <TableCell>{b.horaInicio}–{b.horaFin}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden space-y-3">
            {bloqueos.map((b) => (
              <button key={b.id} type="button" onClick={() => setSeleccion(b)} className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]">
                <span className="block text-sm font-medium">{b.cancha?.nombre ?? '—'}</span>
                <span className="mt-2 block space-y-1 text-sm text-neutral-600">
                  <span className="block"><span className="text-xs text-neutral-500">Motivo</span> {MOTIVO_LABEL[b.motivo] ?? b.motivo}</span>
                  <span className="block"><span className="text-xs text-neutral-500">Programa</span> {programaLabel(b)}</span>
                  <span className="block"><span className="text-xs text-neutral-500">Horario</span> {b.horaInicio}–{b.horaFin}</span>
                  {plataLabel(b) && <span className={`block font-medium ${(b.saldo ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{plataLabel(b)}</span>}
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
              <SheetTitle>{seleccion.cancha?.nombre ?? 'Bloqueo'}</SheetTitle>
              <p className="text-sm text-neutral-600">{MOTIVO_LABEL[seleccion.motivo] ?? seleccion.motivo} · {programaLabel(seleccion)} · {seleccion.horaInicio}–{seleccion.horaFin}</p>
            </SheetHeader>
            <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => { setEditando(seleccion); setSeleccion(null); }}>Editar{seleccion.valor == null && (!seleccion.recurrente || seleccion.motivo === 'ENTRENAMIENTO') ? ' / poner precio' : ''}</Button>
            {seleccion.valor != null && !seleccion.recurrente && (
              <Button className="h-11 w-full" disabled={pending} onClick={() => { setCobrosId(seleccion.id); setSeleccion(null); }}>Cobros del evento ({plataLabel(seleccion)})</Button>
            )}
            {seleccion.recurrente && (
              <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => abrirExcepcion(seleccion)}>Liberar fecha</Button>
            )}
            <Button variant="ghost" className="h-11 w-full text-red-600" disabled={pending} onClick={() => eliminar(seleccion)}>Eliminar</Button>
          </SheetContent>
        )}
      </Sheet>

      {editando && <BloqueoDialog key={editando.id} bloqueo={editando} open onOpenChange={(o) => { if (!o) setEditando(null); }} canchas={canchas} />}
      <CobrosDialog bloqueoId={cobrosId} open={cobrosId !== null} onOpenChange={(o) => { if (!o) setCobrosId(null); }} />
      <ExcepcionBloqueoDialog key={bloqueoExc?.id ?? 'none'} open={excepcionOpen} onOpenChange={setExcepcionOpen} bloqueo={bloqueoExc} />
      <BloqueoDialog open={dialogOpen} onOpenChange={setDialogOpen} canchas={canchas} />
    </>
  );
}

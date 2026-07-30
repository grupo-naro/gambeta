'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import type { EstadoSuscripcionVista, Suscripcion } from '@/lib/types';
import { SocioDialog } from './socio-dialog';
import { RenovarDialog } from './renovar-dialog';
import { cancelarSuscripcion } from '@/lib/suscripciones-actions';

const TONO: Record<EstadoSuscripcionVista, string> = {
  ACTIVA: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  VENCIDA: 'bg-neutral-100 text-neutral-600 ring-neutral-500/20',
  CANCELADA: 'bg-red-50 text-red-700 ring-red-600/20',
};
const LABEL: Record<EstadoSuscripcionVista, string> = { ACTIVA: 'Activa', VENCIDA: 'Vencida', CANCELADA: 'Cancelada' };

function EstadoBadge({ estado }: { estado: EstadoSuscripcionVista }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', TONO[estado])}>
      {LABEL[estado]}
    </span>
  );
}

/** '2026-08-01' → '01/08/2026' sin pasar por Date (evita corrimientos de zona horaria). */
function fmt(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export function SociosTable({ socios }: { socios: Suscripcion[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [renovarOpen, setRenovarOpen] = useState(false);
  const [seleccion, setSeleccion] = useState<Suscripcion | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  /**
   * Todos los períodos del cliente seleccionado, del más nuevo al más viejo.
   * `GET /suscripciones` ya devuelve todos los períodos de todos los clientes, así que el
   * historial se arma con lo que ya está en memoria — sin una segunda llamada al backend.
   */
  const historial = seleccion
    ? socios.filter((x) => x.clienteId === seleccion.clienteId).sort((a, b) => b.inicio.localeCompare(a.inicio))
    : [];

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMsg); setSeleccion(null); }
      else { toast.error(r.error ?? 'Error'); }
    });
  }

  async function cancelar(s: Suscripcion) {
    if (await confirm({
      title: '¿Cancelar la suscripción?',
      description: `${s.cliente.nombre} va a dejar de tener turnos bonificados a partir de ahora. Los turnos que ya reservó siguen bonificados: eso no cambia.`,
      confirmLabel: 'Cancelar suscripción',
      destructive: true,
    })) {
      act(() => cancelarSuscripcion(s.id), 'Suscripción cancelada');
    }
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Socios</h1>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo socio</Button>
      </div>

      {socios.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay socios todavía.</p>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Turnos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {socios.map((s) => (
                  <TableRow key={s.id} onClick={() => setSeleccion(s)} className="cursor-pointer hover:bg-neutral-50">
                    <TableCell className="font-medium">{s.cliente.nombre}</TableCell>
                    <TableCell className="text-neutral-600">{s.cliente.whatsapp}</TableCell>
                    <TableCell>{fmt(s.inicio)} – {fmt(s.vencimiento)}</TableCell>
                    <TableCell><EstadoBadge estado={s.estadoVista} /></TableCell>
                    <TableCell>{s.turnosBonificados}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {socios.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSeleccion(s)}
                className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.cliente.nombre}</span>
                  <EstadoBadge estado={s.estadoVista} />
                </div>
                <p className="mt-2 text-sm text-neutral-600">{fmt(s.inicio)} – {fmt(s.vencimiento)}</p>
                <p className="text-xs text-neutral-500">{s.turnosBonificados} turnos bonificados</p>
              </button>
            ))}
          </div>
        </>
      )}

      <Sheet open={seleccion !== null} onOpenChange={(o) => { if (!o) setSeleccion(null); }}>
        {seleccion && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{seleccion.cliente.nombre}</SheetTitle>
              <p className="text-sm text-neutral-600">
                Vigencia: {fmt(seleccion.inicio)} – {fmt(seleccion.vencimiento)}
              </p>
              <p className="text-sm text-neutral-600">{seleccion.turnosBonificados} turnos bonificados</p>
            </SheetHeader>
            {historial.length > 1 && (
              <div className="mb-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Historial de períodos</p>
                <ul className="space-y-1">
                  {historial.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className={cn('text-neutral-600', p.id === seleccion.id && 'font-medium text-neutral-900')}>
                        {fmt(p.inicio)} – {fmt(p.vencimiento)}
                      </span>
                      <EstadoBadge estado={p.estadoVista} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button
                className="h-11 w-full"
                disabled={pending}
                onClick={() => setRenovarOpen(true)}
              >
                Renovar un mes
              </Button>
              {seleccion.estado === 'ACTIVA' && (
                <Button
                  variant="ghost"
                  className="h-11 w-full text-red-600"
                  disabled={pending}
                  onClick={() => cancelar(seleccion)}
                >
                  Cancelar suscripción
                </Button>
              )}
            </div>
          </SheetContent>
        )}
      </Sheet>

      <RenovarDialog
        suscripcion={seleccion}
        open={renovarOpen}
        onOpenChange={setRenovarOpen}
        onRenovada={() => setSeleccion(null)}
      />

      <SocioDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

'use client';
import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtHora } from '@/lib/fecha';
import { cobroSchema } from '@/lib/validators';
import type { Reserva, CobrosReserva, MedioPago } from '@/lib/types';
import { getCobros, registrarCobro, anularCobro } from '@/lib/cobros-actions';
import { cancelarReserva, aprobarSena, rechazarSena } from '@/lib/reservas-actions';
import { etiquetaMetodoSena } from '@/lib/metodo-sena';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/ui/confirm';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function AccionReservaSheet({
  reserva,
  open,
  onOpenChange,
  onReprogramar,
}: {
  reserva: Reserva | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onReprogramar: (id: string) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<CobrosReserva | null>(null);
  const [monto, setMonto] = useState('');
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  useEffect(() => {
    if (!open || !reserva) return;
    let cancelled = false;
    getCobros(reserva.id)
      .then((d) => { if (!cancelled) { setData(d); setMonto(String(d.saldo)); } })
      .catch(() => { if (!cancelled) toast.error('No pude cargar los cobros'); });
    return () => { cancelled = true; };
  }, [open, reserva]);

  function handleOpenChange(next: boolean) {
    if (!next) { setData(null); setMonto(''); }
    onOpenChange(next);
  }

  function refrescar() {
    if (reserva) getCobros(reserva.id).then((d) => { setData(d); setMonto(String(d.saldo)); }).catch(() => {});
    router.refresh();
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMsg); if (close) { router.refresh(); handleOpenChange(false); } else refrescar(); }
      else toast.error(r.error ?? 'Error');
    });
  }

  function cobrar() {
    if (!reserva) return;
    const parsed = cobroSchema.safeParse({ monto, medio });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await registrarCobro(reserva.id, parsed.data);
      if (r.ok) { toast.success('Cobro registrado'); refrescar(); } else toast.error(r.error);
    });
  }

  if (!reserva) return null;
  const esEspera = reserva.estado === 'ESPERANDO_SENA';

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{reserva.cliente?.nombre ?? 'Turno'}</SheetTitle>
          <p className="text-sm text-neutral-600">{reserva.cancha?.nombre} · {fmtHora(reserva.fechaInicio)} a {fmtHora(reserva.fechaFin)}</p>
        </SheetHeader>

        {!data ? (
          <p className="text-sm text-neutral-600">Cargando…</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-neutral-50 p-3 text-center text-sm">
              <div><span className="block text-xs text-neutral-500">Total</span><span className="font-semibold">{money(data.monto)}</span></div>
              <div><span className="block text-xs text-neutral-500">Pagado</span><span className="font-semibold text-emerald-700">{money(data.pagado)}</span></div>
              <div><span className="block text-xs text-neutral-500">Saldo</span><span className="font-semibold text-amber-700">{money(data.saldo)}</span></div>
            </div>

            {esEspera ? (
              <div className="space-y-2">
                {etiquetaMetodoSena(reserva.metodoSena) && (
                  <p className="mb-2 text-sm text-neutral-600">
                    El cliente eligió pagar por <b>{etiquetaMetodoSena(reserva.metodoSena)}</b>.
                    {reserva.metodoSena === 'TRANSFERENCIA' && ' Esperá el comprobante por WhatsApp.'}
                  </p>
                )}
                <Button className="h-12 w-full text-base" disabled={pending} onClick={() => act(() => aprobarSena(reserva.id), 'Seña aprobada', true)}>
                  Aprobar seña
                </Button>
                <Button variant="outline" className="w-full" disabled={pending} onClick={() => act(() => rechazarSena(reserva.id), 'Seña rechazada', true)}>
                  Rechazar seña
                </Button>
              </div>
            ) : reserva.estado === 'CANCELADA' ? (
              <div className="rounded-xl bg-neutral-100 py-4 text-center text-sm font-medium text-neutral-600">Reserva cancelada</div>
            ) : data.saldo > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {(['EFECTIVO', 'TRANSFERENCIA'] as MedioPago[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMedio(m)}
                      className={cn(
                        'h-12 rounded-xl border text-sm font-medium transition',
                        medio === m ? 'border-primary bg-primary/10 text-primary' : 'bg-white text-neutral-600',
                      )}
                    >
                      {m === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}
                    </button>
                  ))}
                </div>
                <Input type="number" min="0" inputMode="numeric" aria-label="Monto a cobrar" value={monto} onChange={(e) => setMonto(e.target.value)} className="h-12 text-center text-lg" />
                <Button className="h-14 w-full text-base" disabled={pending} onClick={cobrar}>
                  Cobrar {money(Number(monto) || 0)}
                </Button>
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-50 py-4 text-center font-medium text-emerald-700">Pagado ✓</div>
            )}

            {data.cobros.length > 0 && (
              <ul className="space-y-1 border-t pt-3 text-sm">
                {data.cobros.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span>{money(c.monto)} · {c.medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}{c.origen === 'SENA' ? ' (seña)' : ''}</span>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={async () => {
                      if (await confirm({ title: '¿Anular el cobro?', description: `Vas a anular este cobro de ${money(c.monto)}. Se vuelve a sumar al saldo.`, confirmLabel: 'Anular cobro', destructive: true })) {
                        act(() => anularCobro(c.id), 'Cobro anulado');
                      }
                    }}>Anular</Button>
                  </li>
                ))}
              </ul>
            )}

            {(reserva.estado === 'CONFIRMADA' || reserva.estado === 'ESPERANDO_SENA') && (
              <div className="flex gap-2 border-t pt-3">
                <Button variant="outline" className="flex-1" disabled={pending} onClick={() => { handleOpenChange(false); onReprogramar(reserva.id); }}>
                  Reprogramar
                </Button>
                <Button variant="ghost" className="flex-1 text-red-600" disabled={pending} onClick={async () => {
                  if (await confirm({
                    title: '¿Cancelar la reserva?',
                    description: `Vas a cancelar la reserva de ${reserva.cliente?.nombre ?? 'el cliente'} (${fmtHora(reserva.fechaInicio)}). El cliente pierde el turno.`,
                    confirmLabel: 'Cancelar turno',
                    destructive: true,
                  })) {
                    act(() => cancelarReserva(reserva.id), 'Reserva cancelada', true);
                  }
                }}>
                  Cancelar
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

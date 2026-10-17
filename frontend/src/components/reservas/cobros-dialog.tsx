'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CobrosReserva, MedioPago } from '@/lib/types';
import { cobroSchema } from '@/lib/validators';
import { getCobros, registrarCobro, anularCobro, getCobrosFijo, registrarCobroFijo } from '@/lib/cobros-actions';
import { useConfirm } from '@/components/ui/confirm';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/**
 * Cobros de una reserva o, si se pasa `fijoId`, del abono de un turno fijo: las dos cosas tienen
 * total / pagado / saldo y se cobran en partes, así que comparten pantalla.
 */
export function CobrosDialog({ reservaId, fijoId, open, onOpenChange }: { reservaId?: string | null; fijoId?: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const esFijo = !!fijoId;
  const destinoId = fijoId ?? reservaId ?? null;
  const cargar = esFijo ? getCobrosFijo : getCobros;
  const cobrar = esFijo ? registrarCobroFijo : registrarCobro;
  const [data, setData] = useState<CobrosReserva | null>(null);
  const [monto, setMonto] = useState('');
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  useEffect(() => {
    if (!open || !destinoId) return;
    let cancelled = false;
    cargar(destinoId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) toast.error('No pude cargar los cobros'); });
    return () => { cancelled = true; };
  }, [open, destinoId, cargar]);

  function handleOpenChange(next: boolean) {
    if (!next) { setData(null); setMonto(''); }
    onOpenChange(next);
  }

  function refrescar() { if (destinoId) cargar(destinoId).then(setData).catch(() => {}); router.refresh(); }

  function registrar() {
    const parsed = cobroSchema.safeParse({ monto, medio });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      if (!destinoId) return;
      const r = await cobrar(destinoId, parsed.data);
      if (r.ok) { toast.success('Cobro registrado'); setMonto(''); refrescar(); } else toast.error(r.error);
    });
  }
  function anular(id: string) {
    start(async () => { const r = await anularCobro(id); if (r.ok) { toast.success('Cobro anulado'); refrescar(); } else toast.error(r.error); });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{esFijo ? 'Cobros del abono' : 'Cobros'}</DialogTitle></DialogHeader>
        {data ? (
          <div className="space-y-3 text-sm">
            <div className="flex gap-4 rounded-lg bg-neutral-50 p-3">
              <div>Total<br /><span className="font-semibold">{money(data.monto)}</span></div>
              <div>Pagado<br /><span className="font-semibold text-emerald-700">{money(data.pagado)}</span></div>
              <div>Saldo<br /><span className="font-semibold text-amber-700">{money(data.saldo)}</span></div>
            </div>
            <ul className="space-y-1">
              {data.cobros.length === 0 && <li className="text-neutral-600">Sin cobros.</li>}
              {data.cobros.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b py-1">
                  <span>{money(c.monto)} · {c.medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}{c.origen === 'SENA' ? ' (seña)' : ''} <span className="text-neutral-500">— {c.registradoPor}</span></span>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={async () => {
                    if (await confirm({ title: '¿Anular el cobro?', description: `Vas a anular este cobro de ${money(c.monto)}. Se vuelve a sumar al saldo.`, confirmLabel: 'Anular cobro', destructive: true })) {
                      anular(c.id);
                    }
                  }}>Anular</Button>
                </li>
              ))}
            </ul>
            <div className="flex items-end gap-2 border-t pt-3">
              <div className="space-y-1"><Label htmlFor="cb-monto">Monto</Label><Input id="cb-monto" type="number" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder={String(data.saldo)} /></div>
              <div className="space-y-1"><Label htmlFor="cb-medio">Medio</Label>
                <select id="cb-medio" value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)} className="rounded-md border px-2 py-1.5">
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                </select>
              </div>
              <Button disabled={pending} onClick={registrar}>Registrar</Button>
            </div>
          </div>
        ) : <p className="text-sm text-neutral-600">Cargando…</p>}
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}

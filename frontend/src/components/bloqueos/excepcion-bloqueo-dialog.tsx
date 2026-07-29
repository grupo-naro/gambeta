'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Bloqueo } from '@/lib/types';
import { agregarExcepcionBloqueo, quitarExcepcionBloqueo } from '@/lib/bloqueos-actions';

export function ExcepcionBloqueoDialog({
  open,
  onOpenChange,
  bloqueo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bloqueo: Bloqueo | null;
}) {
  const [fecha, setFecha] = useState('');
  const [excs, setExcs] = useState<{ id: string; fecha: string }[]>(bloqueo?.excepciones ?? []);
  const [pending, start] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) { setFecha(''); setExcs(bloqueo?.excepciones ?? []); }
    onOpenChange(nextOpen);
  }

  function liberar() {
    if (!bloqueo || !fecha) { toast.error('Ingresá una fecha'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { toast.error('Fecha inválida'); return; }
    start(async () => {
      const r = await agregarExcepcionBloqueo(bloqueo.id, fecha);
      if (r.ok) {
        toast.success('Fecha liberada');
        setExcs((p) => (p.some((e) => e.fecha.slice(0, 10) === fecha) ? p : [...p, { id: fecha, fecha }]));
        setFecha('');
      } else toast.error(r.error);
    });
  }

  function quitar(fechaExc: string) {
    if (!bloqueo) return;
    const fechaStr = fechaExc.slice(0, 10);
    start(async () => {
      const r = await quitarExcepcionBloqueo(bloqueo.id, fechaStr);
      if (r.ok) {
        toast.success('Excepción removida');
        setExcs((p) => p.filter((e) => e.fecha.slice(0, 10) !== fechaStr));
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Liberar fecha — {bloqueo?.cancha?.nombre ?? 'Bloqueo'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="exc-bloqueo-fecha">Fecha a liberar</Label>
            <Input id="exc-bloqueo-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <Button onClick={liberar} disabled={pending} variant="outline" className="w-full">
            {pending ? 'Guardando…' : 'Liberar esa fecha'}
          </Button>
          {excs.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-neutral-600">Fechas liberadas</p>
              <ul className="space-y-1">
                {excs.map((exc) => (
                  <li key={exc.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                    <span>{exc.fecha.slice(0, 10)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => quitar(exc.fecha)}
                      className="h-6 px-2 text-xs text-red-600 hover:text-red-700"
                    >
                      Quitar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

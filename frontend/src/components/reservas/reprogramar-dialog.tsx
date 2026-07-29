'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { HoraInput } from '@/components/ui/hora-input';
import { normalizeHora } from '@/lib/hora';
import { reprogramarReserva } from '@/lib/reservas-actions';
import { reprogramarSchema } from '@/lib/validators';

interface ReprogramarDialogProps {
  id: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function ReprogramarDialog({ id, open, onOpenChange }: ReprogramarDialogProps) {
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [pending, start] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setFecha('');
      setHora('');
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    const horaNorm = normalizeHora(hora) ?? hora;
    const parsed = reprogramarSchema.safeParse({ fecha, horaInicio: horaNorm });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      if (!id) return;
      const r = await reprogramarReserva(id, fecha, horaNorm);
      if (r.ok) { toast.success('Reserva reprogramada'); handleOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reprogramar reserva</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reprogramar-fecha">Fecha</Label>
            <input id="reprogramar-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-md border px-2 py-1.5" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reprogramar-hora">Hora</Label>
            <HoraInput id="reprogramar-hora" value={hora} onChange={setHora} />
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : 'Reprogramar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HoraInput } from '@/components/ui/hora-input';
import { normalizeHora } from '@/lib/hora';
import { Label } from '@/components/ui/label';
import type { Cancha } from '@/lib/types';
import { turnoFijoSchema } from '@/lib/validators';
import { crearTurnoFijo } from '@/lib/fijos-actions';
import { previewWhatsapp } from '@/lib/whatsapp';
import { useClienteAutocomplete } from '@/lib/use-cliente-autocomplete';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function TurnoFijoDialog({
  open,
  onOpenChange,
  canchas,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canchas: Cancha[];
}) {
  const [canchaId, setCanchaId] = useState(canchas[0]?.id ?? '');
  const [diaSemana, setDiaSemana] = useState('1');
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFin, setHoraFin] = useState('');
  const [clienteNombre, setClienteNombre] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const clienteEncontrado = useClienteAutocomplete(whatsapp, setClienteNombre);
  const [pending, start] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setCanchaId(canchas[0]?.id ?? '');
      setDiaSemana('1');
      setHoraInicio('');
      setHoraFin('');
      setClienteNombre('');
      setWhatsapp('');
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    const hi = normalizeHora(horaInicio);
    const hf = normalizeHora(horaFin);
    if (!hi || !hf) { toast.error('Hora inválida. Usá formato 24h, ej: 21:00'); return; }
    const parsed = turnoFijoSchema.safeParse({ canchaId, clienteNombre, whatsapp, diaSemana, horaInicio: hi, horaFin: hf });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await crearTurnoFijo(parsed.data);
      if (r.ok) { toast.success('Turno fijo creado'); onOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo turno fijo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="tf-cancha">Cancha</Label>
            <select id="tf-cancha" value={canchaId} onChange={(e) => setCanchaId(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              {canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tf-dia">Día</Label>
            <select id="tf-dia" value={diaSemana} onChange={(e) => setDiaSemana(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              {DIAS.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="tf-inicio">Hora inicio</Label>
              <HoraInput id="tf-inicio" value={horaInicio} onChange={setHoraInicio} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tf-fin">Hora fin</Label>
              <HoraInput id="tf-fin" value={horaFin} onChange={setHoraFin} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tf-whatsapp">WhatsApp</Label>
            <Input id="tf-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
            {whatsapp.trim() !== '' && (
              previewWhatsapp(whatsapp)
                ? <p className="text-xs text-muted-foreground">Se guardará como: {previewWhatsapp(whatsapp)}</p>
                : <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="tf-cliente">Cliente</Label>
            <Input id="tf-cliente" value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} placeholder="Nombre del cliente" />
            {clienteEncontrado && <p className="text-xs text-emerald-600">Cliente existente</p>}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : 'Crear turno fijo'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

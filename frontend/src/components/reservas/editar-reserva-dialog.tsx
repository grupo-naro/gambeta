'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtHora } from '@/lib/fecha';
import type { Reserva } from '@/lib/types';
import { editarReserva, getPrecioSugerido } from '@/lib/reservas-actions';
import { cambiosDeEdicion, duracionesPosibles, etiquetaDuracion, minutosDeReserva } from '@/lib/editar-reserva';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/**
 * Edita una reserva suelta: alargar o acortar el turno (de a 30 min), el monto total y una nota.
 * Al cambiar la duración propone el precio de la tarifa; se puede corregir a mano antes de guardar.
 * Lo ya cobrado no se toca y el monto no puede quedar por debajo de eso. El padre lo monta con
 * `key={reserva.id}` y solo cuando hay una reserva para editar, así el estado arranca con sus datos.
 */
export function EditarReservaDialog({ reserva, open, onOpenChange }: { reserva: Reserva; open: boolean; onOpenChange: (o: boolean) => void }) {
  const durActual = minutosDeReserva(reserva.fechaInicio, reserva.fechaFin);
  const [duracion, setDuracion] = useState(durActual);
  const [monto, setMonto] = useState(String(Number(reserva.monto)));
  const [notas, setNotas] = useState(reserva.notas ?? '');
  const [pending, start] = useTransition();
  const [sugiriendo, setSugiriendo] = useState(false);
  const esDeFijo = !!reserva.turnoFijoId;
  const pagado = Number(reserva.pagado ?? 0);
  const montoNum = Number(monto);
  const saldo = Math.max(0, (Number.isFinite(montoNum) ? montoNum : 0) - pagado);

  async function cambiarDuracion(n: number) {
    setDuracion(n);
    if (n === durActual) { setMonto(String(Number(reserva.monto))); return; }
    setSugiriendo(true);
    const sugerido = await getPrecioSugerido(reserva.id, n);
    setSugiriendo(false);
    if (sugerido != null) setMonto(String(sugerido));
  }

  function guardar() {
    const cambios = cambiosDeEdicion(
      { duracionMin: durActual, monto: Number(reserva.monto), notas: reserva.notas ?? '' },
      { duracionMin: duracion, monto: montoNum, notas },
    );
    if (!cambios.ok) { toast.error(cambios.error); return; }
    if (cambios.cambios.monto != null && cambios.cambios.monto < pagado) {
      toast.error(`El monto no puede ser menor a lo ya cobrado (${money(pagado)}). Si hay que bajarlo, anulá primero un cobro.`);
      return;
    }
    start(async () => {
      const r = await editarReserva(reserva.id, cambios.cambios);
      if (r.ok) { toast.success('Reserva actualizada'); onOpenChange(false); } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar reserva</DialogTitle>
          <p className="text-sm text-neutral-600">{reserva.cliente?.nombre} · {reserva.cancha?.nombre} · {fmtHora(reserva.fechaInicio)} a {fmtHora(reserva.fechaFin)}</p>
        </DialogHeader>
        <div className="space-y-3">
          {esDeFijo && (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              Este turno viene de un turno fijo: el monto y la duración se editan en el turno fijo. Acá solo se puede poner una nota.
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="er-duracion">Duración</Label>
            <select id="er-duracion" value={duracion} disabled={esDeFijo || pending} onChange={(e) => void cambiarDuracion(Number(e.target.value))} className="w-full rounded-md border px-2 py-1.5 disabled:opacity-60">
              {duracionesPosibles(durActual).map((d) => <option key={d} value={d}>{etiquetaDuracion(d)}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">Empieza igual a las {fmtHora(reserva.fechaInicio)}; cambia la hora de fin. Si el horario siguiente está ocupado, no deja alargar.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="er-monto">Monto total {sugiriendo && <span className="text-xs text-neutral-500">(calculando…)</span>}</Label>
            <Input id="er-monto" type="number" min={pagado} inputMode="numeric" value={monto} disabled={esDeFijo || pending} onChange={(e) => setMonto(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Ya cobrado: {money(pagado)} · Quedaría por cobrar: <b>{money(saldo)}</b>
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="er-nota">Nota (opcional)</Label>
            <Input id="er-nota" value={notas} maxLength={500} disabled={pending} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: Clase de pádel" />
          </div>
        </div>
        <DialogFooter><Button onClick={guardar} disabled={pending || sugiriendo}>{pending ? 'Guardando…' : 'Guardar cambios'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

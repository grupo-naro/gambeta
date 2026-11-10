'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HoraInput } from '@/components/ui/hora-input';
import { Label } from '@/components/ui/label';
import { normalizeHora } from '@/lib/hora';
import { bloqueoSchema } from '@/lib/validators';
import { crearBloqueo, editarBloqueo } from '@/lib/bloqueos-actions';
import type { Bloqueo, Cancha } from '@/lib/types';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Crear o editar una clase de la academia. Por debajo es un entrenamiento recurrente: ocupa la cancha
 * ese día y horario cada semana. El padre lo monta con key={id} al editar, así el estado arranca con sus datos.
 */
export function ClaseDialog({ open, onOpenChange, canchas, clase }: { open: boolean; onOpenChange: (o: boolean) => void; canchas: Cancha[]; clase?: Bloqueo }) {
  const editando = !!clase;
  const [nombre, setNombre] = useState(clase?.nota ?? '');
  const [canchaId, setCanchaId] = useState(clase?.canchaId ?? canchas[0]?.id ?? '');
  const [diaSemana, setDiaSemana] = useState(String(clase?.diaSemana ?? 1));
  const [horaInicio, setHoraInicio] = useState(clase?.horaInicio ?? '');
  const [horaFin, setHoraFin] = useState(clase?.horaFin ?? '');
  const [valor, setValor] = useState(clase?.valor != null ? String(clase.valor) : '');
  const [desde, setDesde] = useState(clase?.vigenciaDesde ?? '');
  const [hasta, setHasta] = useState(clase?.vigenciaHasta ?? '');
  const [pending, start] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next && !editando) {
      setNombre(''); setCanchaId(canchas[0]?.id ?? ''); setDiaSemana('1'); setHoraInicio(''); setHoraFin(''); setValor(''); setDesde(''); setHasta('');
    }
    onOpenChange(next);
  }

  function submit() {
    if (!nombre.trim()) { toast.error('Ponele un nombre a la clase'); return; }
    const hi = normalizeHora(horaInicio);
    const hf = normalizeHora(horaFin);
    if (!hi || !hf) { toast.error('Hora inválida. Usá formato 24h, ej: 21:00'); return; }
    const parsed = bloqueoSchema.safeParse({
      canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana, horaInicio: hi, horaFin: hf, nota: nombre.trim(),
      vigenciaDesde: desde || undefined, vigenciaHasta: hasta || undefined, valor: valor ? Number(valor) : undefined,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    const d = parsed.data;
    start(async () => {
      const r = clase
        ? await editarBloqueo(clase.id, { canchaId: d.canchaId, horaInicio: d.horaInicio, horaFin: d.horaFin, nota: d.nota ?? '', diaSemana: d.diaSemana, vigenciaDesde: d.vigenciaDesde ?? null, vigenciaHasta: d.vigenciaHasta ?? null, valor: d.valor ?? null })
        : await crearBloqueo(d);
      if (r.ok) { toast.success(clase ? 'Clase actualizada' : 'Clase creada'); onOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editando ? 'Editar clase' : 'Nueva clase'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ac-nombre">Nombre</Label>
            <Input id="ac-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Clase Nahuel" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ac-cancha">Cancha</Label>
            <select id="ac-cancha" value={canchaId} onChange={(e) => setCanchaId(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              {canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ac-dia">Día</Label>
            <select id="ac-dia" value={diaSemana} onChange={(e) => setDiaSemana(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              {DIAS.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ac-inicio">Hora inicio</Label>
              <HoraInput id="ac-inicio" value={horaInicio} onChange={setHoraInicio} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ac-fin">Hora fin</Label>
              <HoraInput id="ac-fin" value={horaFin} onChange={setHoraFin} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ac-valor">Valor por mes</Label>
            <Input id="ac-valor" type="number" min="0" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="50000" />
            <p className="text-xs text-muted-foreground">Lo que se paga por mes por esta clase. Sin valor no se puede cobrar.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ac-desde">Desde (opcional)</Label>
              <Input id="ac-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ac-hasta">Hasta (opcional)</Label>
              <Input id="ac-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">La clase ocupa la cancha ese día cada semana. Para pausarla o cerrarla, poné la fecha &quot;Hasta&quot;.</p>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear clase'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

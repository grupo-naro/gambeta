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
import { bloqueoSchema } from '@/lib/validators';
import { crearBloqueo } from '@/lib/bloqueos-actions';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MOTIVOS = [
  { value: 'TORNEO', label: 'Torneo' },
  { value: 'ENTRENAMIENTO', label: 'Entrenamiento' },
  { value: 'MANTENIMIENTO', label: 'Mantenimiento' },
  { value: 'OTRO', label: 'Otro' },
];

export function BloqueoDialog({
  open,
  onOpenChange,
  canchas,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canchas: Cancha[];
}) {
  const [canchaId, setCanchaId] = useState(canchas[0]?.id ?? '');
  const [motivo, setMotivo] = useState('TORNEO');
  const [tipo, setTipo] = useState<'puntual' | 'recurrente'>('puntual');
  const [fecha, setFecha] = useState('');
  const [diaSemana, setDiaSemana] = useState('1');
  // Período del bloqueo recurrente ("todos los jueves desde X hasta Y"). Vacío = sin límite.
  const [vigenciaDesde, setVigenciaDesde] = useState('');
  const [vigenciaHasta, setVigenciaHasta] = useState('');
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFin, setHoraFin] = useState('');
  const [nota, setNota] = useState('');
  // Evento con plata (cumpleaños): valor total y seña cobrada ahora. Vacío = bloqueo sin plata.
  const [valor, setValor] = useState('');
  const [sena, setSena] = useState('');
  const [medioPago, setMedioPago] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');
  const [pending, start] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setCanchaId(canchas[0]?.id ?? '');
      setMotivo('TORNEO');
      setTipo('puntual');
      setFecha('');
      setDiaSemana('1');
      setVigenciaDesde('');
      setVigenciaHasta('');
      setHoraInicio('');
      setHoraFin('');
      setNota('');
      setValor('');
      setSena('');
      setMedioPago('EFECTIVO');
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    const recurrente = tipo === 'recurrente';
    const hi = normalizeHora(horaInicio);
    const hf = normalizeHora(horaFin);
    if (!hi || !hf) { toast.error('Hora inválida. Usá formato 24h, ej: 21:00'); return; }
    const parsed = bloqueoSchema.safeParse({
      canchaId,
      motivo,
      recurrente,
      diaSemana: recurrente ? diaSemana : undefined,
      fecha: recurrente ? undefined : fecha,
      horaInicio: hi,
      horaFin: hf,
      nota: nota || undefined,
      // Solo los recurrentes tienen período: el backend rechaza mandarlo en un puntual.
      vigenciaDesde: recurrente && vigenciaDesde ? vigenciaDesde : undefined,
      vigenciaHasta: recurrente && vigenciaHasta ? vigenciaHasta : undefined,
      // El valor solo existe en eventos de una fecha.
      valor: !recurrente && valor ? Number(valor) : undefined,
      montoPagado: !recurrente && valor && sena ? Number(sena) : undefined,
      medioPago: !recurrente && valor && sena ? medioPago : undefined,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await crearBloqueo(parsed.data);
      if (r.ok) { toast.success('Bloqueo creado'); onOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo bloqueo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="bl-cancha">Cancha</Label>
            <select id="bl-cancha" value={canchaId} onChange={(e) => setCanchaId(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              {canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bl-motivo">Motivo</Label>
            <select id="bl-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              {MOTIVOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bl-tipo">Tipo</Label>
            <select id="bl-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as 'puntual' | 'recurrente')} className="w-full rounded-md border px-2 py-1.5">
              <option value="puntual">Puntual (fecha específica)</option>
              <option value="recurrente">Recurrente (mismo día cada semana)</option>
            </select>
          </div>
          {tipo === 'puntual' ? (
            <div className="space-y-1">
              <Label htmlFor="bl-fecha">Fecha</Label>
              <Input id="bl-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="bl-dia">Día</Label>
                <select id="bl-dia" value={diaSemana} onChange={(e) => setDiaSemana(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                  {DIAS.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="bl-desde">Desde (opcional)</Label>
                  <Input id="bl-desde" type="date" value={vigenciaDesde} onChange={(e) => setVigenciaDesde(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bl-hasta">Hasta (opcional)</Label>
                  <Input id="bl-hasta" type="date" value={vigenciaHasta} onChange={(e) => setVigenciaHasta(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                El bloqueo se repite ese día cada semana dentro del período (ambos días inclusive). Sin &quot;Hasta&quot; no termina nunca.
              </p>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bl-inicio">Hora inicio</Label>
              <HoraInput id="bl-inicio" value={horaInicio} onChange={setHoraInicio} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bl-fin">Hora fin</Label>
              <HoraInput id="bl-fin" value={horaFin} onChange={setHoraFin} />
            </div>
          </div>
          {tipo === 'puntual' && (
            <div className="space-y-3 rounded-lg border bg-neutral-50 p-3">
              <p className="text-xs text-muted-foreground">Si es un evento que se cobra (ej. cumpleaños), cargá el valor y la seña. El resto se cobra ese día y todo entra en la caja.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="bl-valor">Valor del evento (opcional)</Label>
                  <Input id="bl-valor" type="number" min="0" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="50000" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bl-sena">Seña cobrada ahora</Label>
                  <Input id="bl-sena" type="number" min="0" value={sena} onChange={(e) => setSena(e.target.value)} placeholder="25000" disabled={!valor} />
                </div>
              </div>
              {valor && sena && (
                <div className="space-y-1">
                  <Label htmlFor="bl-medio">Medio de la seña</Label>
                  <select id="bl-medio" value={medioPago} onChange={(e) => setMedioPago(e.target.value as 'EFECTIVO' | 'TRANSFERENCIA')} className="w-full rounded-md border px-2 py-1.5">
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="TRANSFERENCIA">Transferencia</option>
                  </select>
                </div>
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="bl-nota">Nota (opcional)</Label>
            <Input id="bl-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Descripción adicional" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : 'Crear bloqueo'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

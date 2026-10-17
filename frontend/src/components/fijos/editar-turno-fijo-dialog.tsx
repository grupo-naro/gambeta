'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HoraInput } from '@/components/ui/hora-input';
import { Label } from '@/components/ui/label';
import { normalizeHora } from '@/lib/hora';
import { turnoFijoSchema } from '@/lib/validators';
import { editarTurnoFijo } from '@/lib/fijos-actions';
import { previewWhatsapp } from '@/lib/whatsapp';
import type { Cancha, TurnoFijo } from '@/lib/types';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Corrige un turno fijo ya cargado sin eliminarlo y rehacerlo. Se monta con `key={turno.id}` para
 * que el estado arranque con los datos del fijo elegido. Los pagos del abono NO se editan acá:
 * van por "Cobros del abono".
 */
export function EditarTurnoFijoDialog({
  turno, canchas, onClose,
}: {
  turno: TurnoFijo;
  canchas: Cancha[];
  onClose: () => void;
}) {
  const tieneAbono = turno.montoAbono != null;
  const [canchaId, setCanchaId] = useState(turno.canchaId);
  const [diaSemana, setDiaSemana] = useState(String(turno.diaSemana));
  const [horaInicio, setHoraInicio] = useState(turno.horaInicio);
  const [horaFin, setHoraFin] = useState(turno.horaFin);
  const [clienteNombre, setClienteNombre] = useState(turno.clienteNombre);
  const [whatsapp, setWhatsapp] = useState(turno.whatsapp ?? '');
  const [vigenciaDesde, setVigenciaDesde] = useState(turno.vigenciaDesde ?? '');
  const [vigenciaHasta, setVigenciaHasta] = useState(turno.vigenciaHasta ?? '');
  const [montoAbono, setMontoAbono] = useState(turno.montoAbono != null ? String(turno.montoAbono) : '');
  const [pending, start] = useTransition();

  function submit() {
    const hi = normalizeHora(horaInicio);
    const hf = normalizeHora(horaFin);
    if (!hi || !hf) { toast.error('Hora inválida. Usá formato 24h, ej: 21:00'); return; }
    const parsed = turnoFijoSchema.safeParse({ canchaId, clienteNombre, whatsapp, diaSemana, horaInicio: hi, horaFin: hf });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (tieneAbono) {
      if (!vigenciaDesde || !vigenciaHasta) { toast.error('Completá el período del abono'); return; }
      if (vigenciaDesde > vigenciaHasta) { toast.error('El período del abono está invertido'); return; }
      if (!(Number(montoAbono) > 0)) { toast.error('Ingresá el monto del abono'); return; }
    }
    start(async () => {
      // Solo se mandan los campos del abono si el fijo lo tiene: el backend rechaza editarlos si no.
      const abono = tieneAbono ? { vigenciaDesde, vigenciaHasta, montoAbono: Number(montoAbono) } : {};
      const r = await editarTurnoFijo(turno.id, { ...parsed.data, ...abono });
      if (r.ok) {
        toast.success(r.turnosCancelados > 0
          ? `Turno fijo actualizado. Se cancelaron ${r.turnosCancelados} turno(s) futuro(s) que tenían el horario anterior.`
          : 'Turno fijo actualizado');
        // El monto nuevo quedó por debajo de lo cobrado: se permite (suele ser un error de carga), pero
        // el cobro de más sigue en caja hasta que alguien lo anule.
        if (r.cobradoDeMas > 0) {
          toast.warning(`Ya se cobró $${r.cobradoDeMas.toLocaleString('es-AR')} de más que el nuevo monto. Revisá "Cobros del abono" y anulá el cobro que sobre.`, { duration: 10000 });
        }
        onClose();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar turno fijo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ef-cancha">Cancha</Label>
            <select id="ef-cancha" value={canchaId} onChange={(e) => setCanchaId(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              {canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ef-dia">Día</Label>
            <select id="ef-dia" value={diaSemana} onChange={(e) => setDiaSemana(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              {DIAS.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ef-inicio">Hora inicio</Label>
              <HoraInput id="ef-inicio" value={horaInicio} onChange={setHoraInicio} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ef-fin">Hora fin</Label>
              <HoraInput id="ef-fin" value={horaFin} onChange={setHoraFin} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ef-whatsapp">WhatsApp</Label>
            <Input id="ef-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
            {whatsapp.trim() !== '' && (
              previewWhatsapp(whatsapp)
                ? <p className="text-xs text-muted-foreground">Se guardará como: {previewWhatsapp(whatsapp)}</p>
                : <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="ef-cliente">Cliente</Label>
            <Input id="ef-cliente" value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} />
          </div>
          {tieneAbono && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                Abono. Corregir el monto no modifica lo ya cobrado: los pagos se ven, se registran y se anulan en &quot;Cobros del abono&quot;. Podés bajarlo aunque ya se haya cobrado más.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="ef-desde">Desde</Label>
                  <input id="ef-desde" type="date" value={vigenciaDesde} onChange={(e) => setVigenciaDesde(e.target.value)} className="w-full rounded-md border px-2 py-1.5" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ef-hasta">Hasta</Label>
                  <input id="ef-hasta" type="date" value={vigenciaHasta} onChange={(e) => setVigenciaHasta(e.target.value)} className="w-full rounded-md border px-2 py-1.5" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ef-monto">Monto del abono</Label>
                <Input id="ef-monto" type="number" min={1} value={montoAbono} onChange={(e) => setMontoAbono(e.target.value)} />
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Si cambiás el horario, los turnos futuros de este fijo que ya estaban generados se cancelan y se vuelven a generar con el horario nuevo.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : 'Guardar cambios'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

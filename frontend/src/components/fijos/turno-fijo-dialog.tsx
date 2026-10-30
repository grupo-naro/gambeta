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
  inicial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canchas: Cancha[];
  /** Valores con los que arranca (p. ej. al venir de la pantalla de disponibilidad). El padre cambia el `key` para reiniciarlos. */
  inicial?: { canchaId: string; diaSemana: number; horaInicio: string; horaFin: string };
}) {
  const [canchaId, setCanchaId] = useState(inicial?.canchaId ?? canchas[0]?.id ?? '');
  const [diaSemana, setDiaSemana] = useState(String(inicial?.diaSemana ?? 1));
  const [horaInicio, setHoraInicio] = useState(inicial?.horaInicio ?? '');
  const [horaFin, setHoraFin] = useState(inicial?.horaFin ?? '');
  const [clienteNombre, setClienteNombre] = useState('');
  const [nota, setNota] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const clienteEncontrado = useClienteAutocomplete(whatsapp, setClienteNombre);
  const [conAbono, setConAbono] = useState(false);
  const [vigenciaDesde, setVigenciaDesde] = useState('');
  const [vigenciaHasta, setVigenciaHasta] = useState('');
  const [montoAbono, setMontoAbono] = useState('');
  const [medioAbono, setMedioAbono] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');
  // Por defecto paga todo el abono. Si no, se carga cuánto pagó ahora y el resto queda de saldo.
  const [pagoParcial, setPagoParcial] = useState(false);
  const [montoPagado, setMontoPagado] = useState('');
  const [pending, start] = useTransition();
  const saldoAbono = Math.max(0, Number(montoAbono || 0) - Number(montoPagado || 0));

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setCanchaId(inicial?.canchaId ?? canchas[0]?.id ?? '');
      setDiaSemana(String(inicial?.diaSemana ?? 1));
      setHoraInicio(inicial?.horaInicio ?? '');
      setHoraFin(inicial?.horaFin ?? '');
      setClienteNombre('');
      setNota('');
      setWhatsapp('');
      setConAbono(false);
      setVigenciaDesde('');
      setVigenciaHasta('');
      setMontoAbono('');
      setMedioAbono('EFECTIVO');
      setPagoParcial(false);
      setMontoPagado('');
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    const hi = normalizeHora(horaInicio);
    const hf = normalizeHora(horaFin);
    if (!hi || !hf) { toast.error('Hora inválida. Usá formato 24h, ej: 21:00'); return; }
    const parsed = turnoFijoSchema.safeParse({ canchaId, clienteNombre, whatsapp, diaSemana, horaInicio: hi, horaFin: hf, nota: nota.trim() || undefined });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (conAbono) {
      if (!vigenciaDesde || !vigenciaHasta) { toast.error('Completá el período del abono'); return; }
      if (vigenciaDesde > vigenciaHasta) { toast.error('El período del abono está invertido'); return; }
      const monto = Number(montoAbono);
      if (!montoAbono || !(monto > 0)) { toast.error('Ingresá el monto del abono'); return; }
      if (pagoParcial) {
        // Vacío no vale: "no pagó nada" se carga como 0 a propósito, para no confundirlo con un olvido.
        if (montoPagado.trim() === '' || !(Number(montoPagado) >= 0)) { toast.error('Ingresá cuánto pagó ahora (0 si todavía no pagó)'); return; }
        if (Number(montoPagado) > monto) { toast.error('Lo pagado no puede superar el monto del abono'); return; }
      }
    }
    start(async () => {
      // Los cuatro campos van juntos y solo si el abono está activado: mandarlos vacíos hace
      // fallar el validador del backend, que exige los cuatro o ninguno.
      const abono = conAbono
        ? {
            vigenciaDesde, vigenciaHasta, montoAbono: Number(montoAbono), medioAbono,
            // Sin montoPagado el backend asume que pagó el total.
            ...(pagoParcial ? { montoPagado: Number(montoPagado) } : {}),
          }
        : {};
      const r = await crearTurnoFijo({ ...parsed.data, ...abono });
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
          <div className="space-y-1">
            <Label htmlFor="tf-nota">Nota (opcional)</Label>
            <textarea id="tf-nota" value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={500}
              placeholder="Ej: paga siempre en efectivo, trae su pelota…" className="w-full rounded-md border px-2 py-1.5 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={conAbono} onChange={(e) => setConAbono(e.target.checked)} />
            Cobrar un abono por período
          </label>
          {conAbono && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                Los turnos de este fijo van a salir $0. El abono se registra como cobro al guardar.
              </p>
              <p className="text-xs text-muted-foreground">
                El turno solo figura dentro de este período: pasado el &quot;Hasta&quot; (inclusive) deja de
                aparecer y el horario queda libre. Para seguir, renovalo cargando un fijo nuevo.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="abono-desde">Desde</Label>
                  <input id="abono-desde" type="date" value={vigenciaDesde} onChange={(e) => setVigenciaDesde(e.target.value)} className="w-full rounded-md border px-2 py-1.5" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="abono-hasta">Hasta</Label>
                  <input id="abono-hasta" type="date" value={vigenciaHasta} onChange={(e) => setVigenciaHasta(e.target.value)} className="w-full rounded-md border px-2 py-1.5" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="abono-monto">Monto del abono</Label>
                  <Input id="abono-monto" type="number" min={1} value={montoAbono} onChange={(e) => setMontoAbono(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="abono-medio">Medio</Label>
                  <select id="abono-medio" value={medioAbono} onChange={(e) => setMedioAbono(e.target.value as 'EFECTIVO' | 'TRANSFERENCIA')} className="w-full rounded-md border px-2 py-1.5">
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="TRANSFERENCIA">Transferencia</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={pagoParcial} onChange={(e) => setPagoParcial(e.target.checked)} />
                Pagó solo una parte (el resto lo paga después)
              </label>
              {pagoParcial && (
                <div className="space-y-1">
                  <Label htmlFor="abono-pagado">Pagó ahora</Label>
                  <Input id="abono-pagado" type="number" min={0} value={montoPagado} onChange={(e) => setMontoPagado(e.target.value)} placeholder="0 si todavía no pagó" />
                  <p className="text-xs text-muted-foreground">
                    Saldo pendiente: ${saldoAbono.toLocaleString('es-AR')}. Después lo registrás desde el turno fijo, en &quot;Cobros del abono&quot;.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : 'Crear turno fijo'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

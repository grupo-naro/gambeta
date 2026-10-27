'use client';
import { useState, useTransition, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Cancha, Slot } from '@/lib/types';
import { crearReserva, getDisponibilidad } from '@/lib/reservas-actions';
import { nuevaReservaSchema } from '@/lib/validators';
import { previewWhatsapp } from '@/lib/whatsapp';
import { useClienteAutocomplete } from '@/lib/use-cliente-autocomplete';

/**
 * Por defecto trae su propio botón "Nueva reserva". Con `controlado` lo abre y cierra el padre (sin
 * botón), y con `inicial` arranca con cancha, fecha y hora ya cargadas (p. ej. al tocar un horario
 * libre en Disponibilidad). El padre cambia el `key` para reiniciarlo con otro `inicial`.
 */
export function NuevaReservaDialog({ canchas, senaMontoFijo, controlado, inicial }: {
  canchas: Cancha[]; senaMontoFijo: number;
  controlado?: { open: boolean; onOpenChange: (o: boolean) => void };
  inicial?: { canchaId: string; fecha: string; horaInicio: string };
}) {
  const [openInterno, setOpenInterno] = useState(false);
  const open = controlado ? controlado.open : openInterno;
  const setOpen = controlado ? controlado.onOpenChange : setOpenInterno;
  const [canchaId, setCanchaId] = useState(inicial?.canchaId ?? '');
  const [fecha, setFecha] = useState(inicial?.fecha ?? '');
  const [horaInicio, setHora] = useState('');
  const [duracionMin, setDuracionMin] = useState(60);
  const [nombreCliente, setNombre] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const clienteEncontrado = useClienteAutocomplete(whatsapp, setNombre);
  const [cobro, setCobro] = useState<'ninguno' | 'sena' | 'total'>('sena');
  const [medioCobro, setMedioCobro] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(!!inicial); // con `inicial` los horarios se piden al montar
  const [montoSena, setMontoSena] = useState('');
  const [pending, start] = useTransition();
  const requestIdRef = useRef(0);

  const canchaSel = canchas.find((c) => c.id === canchaId);
  const senaDefault = (c?: Cancha) => { const propio = Number(c?.senaMonto ?? 0); return propio > 0 ? propio : senaMontoFijo; };

  useEffect(() => {
    if (cobro === 'sena') setMontoSena(String(senaDefault(canchas.find((c) => c.id === canchaId))));
  }, [canchaId, cobro]);

  // Con valores iniciales, trae los horarios de esa cancha y fecha y deja elegido el pedido.
  useEffect(() => {
    if (!inicial) return;
    const { canchaId: c, fecha: f, horaInicio: h } = inicial;
    requestIdRef.current += 1;
    const esta = requestIdRef.current;
    getDisponibilidad(c, f).then((r) => {
      if (requestIdRef.current !== esta) return;
      setSlots(r);
      setSlotsLoading(false);
      if (r.some((s) => s.horaInicio === h)) setHora(h);
    });
    // Solo al montar: el padre cambia el key para cada selección nueva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setCanchaId('');
    setFecha('');
    setHora('');
    setDuracionMin(60);
    setNombre('');
    setWhatsapp('');
    setCobro('sena');
    setMedioCobro('EFECTIVO');
    setSlots([]);
    setSlotsLoading(false);
    setMontoSena('');
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetForm();
    setOpen(nextOpen);
  }

  async function cargarSlots(cId: string, f: string) {
    setHora('');
    if (cId && f) {
      requestIdRef.current += 1;
      const thisRequest = requestIdRef.current;
      setSlotsLoading(true);
      const result = await getDisponibilidad(cId, f);
      if (requestIdRef.current === thisRequest) {
        setSlots(result);
        setSlotsLoading(false);
      }
    } else {
      setSlots([]);
      setSlotsLoading(false);
    }
  }

  function submit() {
    const parsed = nuevaReservaSchema.safeParse({ canchaId, nombreCliente, whatsapp, fecha, horaInicio });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (cobro === 'sena') {
      const def = senaDefault(canchaSel);
      const m = Number(montoSena);
      if (!m || m < def) { toast.error(`La seña no puede ser menor a $${def.toLocaleString('es-AR')}`); return; }
    }
    start(async () => {
      const r = await crearReserva({ canchaId, whatsapp, nombreCliente, fecha, horaInicio, duracionMin, cobroInicial: cobro, medioCobro, montoCobro: cobro === 'sena' ? Number(montoSena) : undefined });
      if (r.ok) {
        if (r.cobroOmitido) {
          toast.success('Reserva creada', { description: 'Socio: turno bonificado, no se cobró nada.' });
        } else {
          toast.success('Reserva creada');
        }
        handleOpenChange(false);
      }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!controlado && <DialogTrigger render={<Button />}><Plus className="mr-1 h-4 w-4" /> Nueva reserva</DialogTrigger>}
      <DialogContent>
        <DialogHeader><DialogTitle>Nueva reserva</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="nueva-cancha">Cancha</Label>
            <select id="nueva-cancha" value={canchaId} className="w-full rounded-md border px-2 py-1.5"
              onChange={(e) => { setCanchaId(e.target.value); cargarSlots(e.target.value, fecha); }}>
              <option value="">Elegí una cancha</option>
              {canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="nueva-fecha">Fecha</Label>
            <input id="nueva-fecha" type="date" value={fecha} className="w-full rounded-md border px-2 py-1.5"
              onChange={(e) => { setFecha(e.target.value); cargarSlots(canchaId, e.target.value); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nueva-hora">Hora</Label>
            <select id="nueva-hora" value={horaInicio} onChange={(e) => { setHora(e.target.value); setDuracionMin(60); }} className="w-full rounded-md border px-2 py-1.5" disabled={slotsLoading || !slots.length}>
              <option value="">
                {slotsLoading ? 'Cargando horarios…' : slots.length ? 'Elegí un horario' : 'Elegí cancha y fecha'}
              </option>
              {slots.map((s) => <option key={s.horaInicio} value={s.horaInicio}>{s.horaInicio}</option>)}
            </select>
          </div>
          {(() => {
            const slotSel = slots.find((s) => s.horaInicio === horaInicio);
            const opciones = slotSel?.duraciones ?? [];
            if (opciones.length < 2) return null;
            return (
              <div className="space-y-1">
                <Label htmlFor="nueva-duracion">Duración</Label>
                <select id="nueva-duracion" value={duracionMin} onChange={(e) => setDuracionMin(Number(e.target.value))} className="w-full rounded-md border px-2 py-1.5">
                  {opciones.map((d) => (
                    <option key={d.min} value={d.min}>
                      {d.min === 60 ? '1 hora' : d.min === 90 ? '1½ horas' : `${d.min / 60} horas`} — hasta {d.horaFin} — ${d.precio.toLocaleString('es-AR')}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="nueva-whatsapp">WhatsApp</Label>
              <Input id="nueva-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
              {whatsapp.trim() !== '' && (
                previewWhatsapp(whatsapp)
                  ? <p className="text-xs text-muted-foreground">Se guardará como: {previewWhatsapp(whatsapp)}</p>
                  : <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="nueva-cliente">Cliente</Label>
              <Input id="nueva-cliente" value={nombreCliente} onChange={(e) => setNombre(e.target.value)} />
              {clienteEncontrado && <p className="text-xs text-emerald-600">Cliente existente</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="nueva-cobro">Cobro</Label>
              <select id="nueva-cobro" value={cobro} onChange={(e) => setCobro(e.target.value as 'ninguno' | 'sena' | 'total')} className="w-full rounded-md border px-2 py-1.5">
                <option value="ninguno">Nada</option>
                <option value="sena">Seña</option>
                <option value="total">Total</option>
              </select>
            </div>
            {cobro !== 'ninguno' && (
              <div className="space-y-1">
                <Label htmlFor="nueva-medio">Medio</Label>
                <select id="nueva-medio" value={medioCobro} onChange={(e) => setMedioCobro(e.target.value as 'EFECTIVO' | 'TRANSFERENCIA')} className="w-full rounded-md border px-2 py-1.5">
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                </select>
              </div>
            )}
          </div>
          {cobro === 'sena' && (
            <div className="space-y-1">
              <Label htmlFor="nueva-monto-sena">Monto de la seña</Label>
              <Input id="nueva-monto-sena" type="number" min={senaDefault(canchaSel)} value={montoSena} onChange={(e) => setMontoSena(e.target.value)} />
              <p className="text-xs text-muted-foreground">Mínimo (seña de la cancha): ${senaDefault(canchaSel).toLocaleString('es-AR')}</p>
            </div>
          )}
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Creando…' : 'Crear reserva'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

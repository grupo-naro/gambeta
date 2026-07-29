'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClienteAutocomplete } from '@/lib/use-cliente-autocomplete';
import { buscarClientePorWhatsapp, crearCliente } from '@/lib/clientes-actions';
import { crearSuscripcion } from '@/lib/suscripciones-actions';

/** Hoy en formato YYYY-MM-DD, tomando la fecha local del navegador (el negocio opera en AR). */
function hoyYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Suma un mes recortando al último día del mes destino (31/01 → 28/02).
 * Duplica a propósito sumarUnMes del backend: son paquetes separados sin librería
 * compartida, y acá solo se usa para calcular el valor por defecto del selector de
 * fecha (que el admin puede pisar) — el backend igual valida el valor final.
 */
function sumarUnMes(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const anio = m === 12 ? y + 1 : y;
  const mes = m === 12 ? 1 : m + 1;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function SocioDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [whatsapp, setWhatsapp] = useState('');
  const [nombre, setNombre] = useState('');
  const [inicio, setInicio] = useState(hoyYmd);
  const [vencimiento, setVencimiento] = useState(() => sumarUnMes(hoyYmd()));
  const [precio, setPrecio] = useState('');
  const [medio, setMedio] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');
  const [pending, start] = useTransition();

  const encontrado = useClienteAutocomplete(whatsapp, setNombre);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setWhatsapp('');
      setNombre('');
      const hoy = hoyYmd();
      setInicio(hoy);
      setVencimiento(sumarUnMes(hoy));
      setPrecio('');
      setMedio('EFECTIVO');
    }
    onOpenChange(nextOpen);
  }

  function guardar() {
    if (!whatsapp.trim() || !nombre.trim()) { toast.error('Completá WhatsApp y nombre'); return; }
    start(async () => {
      // El alta de socio necesita un clienteId: si el cliente no existe todavía, se crea primero.
      let cliente = await buscarClientePorWhatsapp(whatsapp);
      if (!cliente) {
        const alta = await crearCliente({ nombre, whatsapp, confiable: false });
        if (!alta.ok) { toast.error(alta.error); return; }
        cliente = await buscarClientePorWhatsapp(whatsapp);
      }
      if (!cliente) { toast.error('No se pudo resolver el cliente'); return; }

      const monto = precio.trim() === '' ? undefined : Number(precio);
      const r = await crearSuscripcion({
        clienteId: cliente.id,
        inicio,
        vencimiento,
        // El backend rechaza un precio sin medio de pago: un cobro sin medio no tiene sentido en la Caja.
        ...(monto != null && monto > 0 ? { precio: monto, medio } : {}),
      });
      if (r.ok) {
        toast.success('Socio dado de alta');
        onOpenChange(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo socio</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="socio-whatsapp">WhatsApp</Label>
            <Input id="socio-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
            {encontrado && <p className="text-xs text-emerald-600">Cliente existente</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="socio-nombre">Nombre</Label>
            <Input id="socio-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del cliente" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="socio-inicio">Inicio</Label>
              <Input id="socio-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="socio-vto">Vencimiento</Label>
              <Input id="socio-vto" type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="socio-precio">Cuota (opcional)</Label>
              <Input id="socio-precio" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="20000" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="socio-medio">Medio</Label>
              <select
                id="socio-medio"
                value={medio}
                onChange={(e) => setMedio(e.target.value as 'EFECTIVO' | 'TRANSFERENCIA')}
                className="w-full rounded-md border px-2 py-1.5"
              >
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={guardar} disabled={pending}>{pending ? 'Guardando…' : 'Dar de alta'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

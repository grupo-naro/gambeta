'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renovarSuscripcion } from '@/lib/suscripciones-actions';
import { parseCuota } from '@/lib/monto';
import type { Suscripcion } from '@/lib/types';

/**
 * Renovación de la suscripción de un socio.
 *
 * El diálogo existe porque la renovación tiene que poder **registrar la cuota en la Caja**,
 * igual que el alta. Antes el panel renovaba con el cuerpo vacío, así que la cuota de un
 * socio entraba a Caja una sola vez en su vida (en el alta) y todos los meses siguientes
 * quedaban sin registrar.
 *
 * El monto arranca precargado con el de la suscripción que se está renovando, para que en
 * el caso normal el staff solo confirme.
 */
export function RenovarDialog({
  suscripcion,
  open,
  onOpenChange,
  onRenovada,
}: {
  suscripcion: Suscripcion | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRenovada: () => void;
}) {
  const [precio, setPrecio] = useState('');
  const [medio, setMedio] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');
  const [pending, start] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    // Al abrir, precargar con la cuota del período que se renueva (si tenía una).
    if (nextOpen) {
      setPrecio(suscripcion?.precio != null ? String(suscripcion.precio) : '');
      setMedio('EFECTIVO');
    }
    onOpenChange(nextOpen);
  }

  function renovar() {
    if (!suscripcion) return;
    const cuota = parseCuota(precio);
    if (!cuota.ok) { toast.error('El monto de la cuota no es un número válido'); return; }
    start(async () => {
      const monto = cuota.monto;
      // Dejar el monto vacío es válido: renueva la vigencia sin registrar cobro, para
      // cuando la cuota se cobró por fuera del sistema.
      const r = await renovarSuscripcion(suscripcion.id, monto != null && monto > 0 ? { precio: monto, medio } : {});
      if (r.ok) {
        toast.success(monto != null && monto > 0 ? 'Suscripción renovada y cuota registrada' : 'Suscripción renovada');
        onOpenChange(false);
        onRenovada();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renovar un mes{suscripcion ? ` — ${suscripcion.cliente.nombre}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Se crea un período nuevo a continuación del actual. El período que vence no se modifica.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="renovar-precio">Cuota (opcional)</Label>
              <Input id="renovar-precio" type="number" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="20000" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="renovar-medio">Medio</Label>
              <select
                id="renovar-medio"
                value={medio}
                onChange={(e) => setMedio(e.target.value as 'EFECTIVO' | 'TRANSFERENCIA')}
                className="w-full rounded-md border px-2 py-1.5"
              >
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            Si dejás la cuota vacía, se renueva la vigencia sin registrar ningún cobro en la caja.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={renovar} disabled={pending}>{pending ? 'Renovando…' : 'Renovar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

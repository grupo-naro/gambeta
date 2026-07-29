'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearCliente } from '@/lib/clientes-actions';
import { previewWhatsapp, aCanonico } from '@/lib/whatsapp';

export function ClienteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [nombre, setNombre] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [confiable, setConfiable] = useState(false);
  const [pending, start] = useTransition();

  function handleOpenChange(next: boolean) {
    if (!next) { setNombre(''); setWhatsapp(''); setConfiable(false); }
    onOpenChange(next);
  }
  function submit() {
    if (nombre.trim().length < 1) { toast.error('Completá el nombre'); return; }
    if (aCanonico(whatsapp) === null) { toast.error('WhatsApp inválido (ej: 11 3662 0274)'); return; }
    start(async () => {
      const r = await crearCliente({ nombre: nombre.trim(), whatsapp: whatsapp.trim(), confiable });
      if (r.ok) { toast.success('Cliente creado'); handleOpenChange(false); } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo cliente</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="ncl-nombre">Nombre</Label><Input id="ncl-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div className="space-y-1">
            <Label htmlFor="ncl-wa">WhatsApp</Label>
            <Input id="ncl-wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
            {whatsapp.trim() !== '' && (
              previewWhatsapp(whatsapp)
                ? <p className="text-xs text-muted-foreground">Se guardará como: {previewWhatsapp(whatsapp)}</p>
                : <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>
            )}
          </div>
          <label className="flex items-center gap-2 pt-1 text-sm">
            <input type="checkbox" checked={confiable} onChange={(e) => setConfiable(e.target.checked)} className="h-4 w-4" />
            De confianza (reserva sin seña)
          </label>
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Creando…' : 'Crear cliente'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ArticuloAlquiler } from '@/lib/types';
import { crearArticulo, actualizarArticulo } from '@/lib/alquiler-admin-actions';

export function ArticuloDialog({
  open, onOpenChange, articulo,
}: { open: boolean; onOpenChange: (o: boolean) => void; articulo: ArticuloAlquiler | null }) {
  const [nombre, setNombre] = useState(articulo?.nombre ?? '');
  const [precio, setPrecio] = useState(articulo ? String(Number(articulo.precio)) : '');
  const [stockInicial, setStockInicial] = useState('0');
  const [activo, setActivo] = useState(articulo?.activo ?? true);
  const [pending, start] = useTransition();
  const editando = !!articulo;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNombre(articulo?.nombre ?? '');
      setPrecio(articulo ? String(Number(articulo.precio)) : '');
      setStockInicial('0');
      setActivo(articulo?.activo ?? true);
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    if (!nombre.trim()) { toast.error('Ingresá el nombre'); return; }
    const precioNum = Number(precio);
    if (!precioNum || precioNum <= 0) { toast.error('El precio debe ser mayor a 0'); return; }
    // El stock solo se carga al crear: después se mueve por "Ajustar stock", que es el único
    // camino que respeta lo que está prestado.
    const input = { nombre: nombre.trim(), precio: precioNum, activo, ...(editando ? {} : { stock: Number(stockInicial) || 0 }) };
    start(async () => {
      const r = editando ? await actualizarArticulo(articulo!.id, input) : await crearArticulo(input);
      if (r.ok) { toast.success(editando ? 'Artículo actualizado' : 'Artículo creado'); onOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editando ? 'Editar artículo' : 'Nuevo artículo'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="aa-nombre">Nombre</Label>
            <Input id="aa-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Raqueta de pádel" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aa-precio">Precio del alquiler</Label>
            <Input id="aa-precio" type="number" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </div>
          {!editando && (
            <div className="space-y-1">
              <Label htmlFor="aa-stock">Unidades que hay</Label>
              <Input id="aa-stock" type="number" min="0" value={stockInicial} onChange={(e) => setStockInicial(e.target.value)} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo (aparece en el mostrador)
          </label>
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={submit}>{editando ? 'Guardar' : 'Crear'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

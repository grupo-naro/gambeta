'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProductoBuffet } from '@/lib/types';
import { crearProducto, actualizarProducto } from '@/lib/buffet-admin-actions';

export function ProductoDialog({
  open,
  onOpenChange,
  producto,
  mostradorId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  producto: ProductoBuffet | null;
  /** Si el producto es de un catálogo propio (el tercero), a quién pertenece al crearlo. */
  mostradorId?: string;
}) {
  const [nombre, setNombre] = useState(producto?.nombre ?? '');
  const [codigoBarra, setCodigoBarra] = useState(producto?.codigoBarra ?? '');
  const [precio, setPrecio] = useState(producto ? String(Number(producto.precio)) : '');
  const [stockInicial, setStockInicial] = useState('0');
  const [stockMinimo, setStockMinimo] = useState(producto ? String(producto.stockMinimo) : '5');
  const [enBotonera, setEnBotonera] = useState(producto?.enBotonera ?? true);
  const [activo, setActivo] = useState(producto?.activo ?? true);
  const [pending, start] = useTransition();
  const editing = !!producto;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNombre(producto?.nombre ?? '');
      setCodigoBarra(producto?.codigoBarra ?? '');
      setPrecio(producto ? String(Number(producto.precio)) : '');
      setStockInicial('0');
      setStockMinimo(producto ? String(producto.stockMinimo) : '5');
      setEnBotonera(producto?.enBotonera ?? true);
      setActivo(producto?.activo ?? true);
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    if (!nombre.trim()) { toast.error('Ingresá el nombre'); return; }
    const precioNum = Number(precio);
    if (!precioNum || precioNum <= 0) { toast.error('El precio debe ser mayor a 0'); return; }
    const stockMinimoNum = Number(stockMinimo);
    if (!Number.isFinite(stockMinimoNum) || stockMinimoNum < 0) { toast.error('Stock mínimo inválido'); return; }
    const input = {
      nombre: nombre.trim(),
      codigoBarra: codigoBarra.trim() || null,
      precio: precioNum,
      stockMinimo: stockMinimoNum,
      enBotonera,
      activo,
      ...(editing ? {} : { stock: Number(stockInicial) || 0, ...(mostradorId ? { mostradorId } : {}) }),
    };
    start(async () => {
      const r = editing ? await actualizarProducto(producto!.id, input) : await crearProducto(input);
      if (r.ok) { toast.success(editing ? 'Producto actualizado' : 'Producto creado'); onOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Editar producto' : 'Nuevo producto'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pd-nombre">Nombre</Label>
            <Input id="pd-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Agua mineral 500ml" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pd-codigo">Código de barras (opcional)</Label>
            <Input id="pd-codigo" value={codigoBarra} onChange={(e) => setCodigoBarra(e.target.value)} placeholder="7791234567890" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pd-precio">Precio</Label>
            <Input id="pd-precio" type="number" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="1500" />
          </div>
          {!editing && (
            <div className="space-y-1">
              <Label htmlFor="pd-stock-inicial">Stock inicial</Label>
              <Input id="pd-stock-inicial" type="number" min="0" value={stockInicial} onChange={(e) => setStockInicial(e.target.value)} placeholder="0" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="pd-stock-minimo">Stock mínimo (alerta)</Label>
            <Input id="pd-stock-minimo" type="number" min="0" value={stockMinimo} onChange={(e) => setStockMinimo(e.target.value)} placeholder="5" />
          </div>
          <label className="flex items-center gap-2 pt-1 text-sm">
            <input type="checkbox" checked={enBotonera} onChange={(e) => setEnBotonera(e.target.checked)} className="h-4 w-4" />
            Mostrar en la botonera del mostrador
          </label>
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-4 w-4" />
              Producto activo
            </label>
          )}
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : (editing ? 'Guardar' : 'Crear producto')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

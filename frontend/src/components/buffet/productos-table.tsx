'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProductoBuffet } from '@/lib/types';
import { ProductoDialog } from './producto-dialog';
import { reponerStock } from '@/lib/buffet-admin-actions';

const money = (n: number | string) => '$' + Number(n || 0).toLocaleString('es-AR');

export function ProductosTable({ productos }: { productos: ProductoBuffet[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductoBuffet | null>(null);
  const [seleccion, setSeleccion] = useState<ProductoBuffet | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [pending, start] = useTransition();

  function nuevo() { setEditing(null); setDialogOpen(true); }
  function editar(p: ProductoBuffet) { setSeleccion(null); setEditing(p); setDialogOpen(true); }
  function abrir(p: ProductoBuffet) { setCantidad(''); setSeleccion(p); }

  function reponer() {
    if (!seleccion) return;
    const n = Number(cantidad);
    if (!n || n <= 0) { toast.error('Ingresá una cantidad mayor a 0'); return; }
    start(async () => {
      const r = await reponerStock(seleccion.id, n);
      if (r.ok) { toast.success('Stock repuesto'); setSeleccion(null); }
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-end">
        <Button onClick={nuevo}><Plus className="mr-1 h-4 w-4" /> Nuevo producto</Button>
      </div>

      {productos.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay productos todavía.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nombre</TableHead><TableHead>Código de barras</TableHead><TableHead>Precio</TableHead><TableHead>Stock</TableHead><TableHead>Botonera</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {productos.map((p) => {
                  const bajo = p.stock <= p.stockMinimo;
                  return (
                    <TableRow key={p.id} onClick={() => abrir(p)} className={`cursor-pointer hover:bg-neutral-50 ${p.activo ? '' : 'opacity-60'}`}>
                      <TableCell className="font-medium">{p.nombre}</TableCell>
                      <TableCell className="text-neutral-600">{p.codigoBarra || '—'}</TableCell>
                      <TableCell>{money(p.precio)}</TableCell>
                      <TableCell className={bajo ? 'font-medium text-red-600' : ''}>{p.stock}</TableCell>
                      <TableCell className="text-neutral-600">{p.enBotonera ? 'Sí' : 'No'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden space-y-3">
            {productos.map((p) => {
              const bajo = p.stock <= p.stockMinimo;
              return (
                <button key={p.id} type="button" onClick={() => abrir(p)} className={`block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]${p.activo ? '' : ' opacity-60'}`}>
                  <span className="block text-sm font-medium">{p.nombre}</span>
                  <span className="mt-2 block space-y-1 text-sm text-neutral-600">
                    <span className="block"><span className="text-xs text-neutral-500">Código</span> {p.codigoBarra || '—'}</span>
                    <span className="block"><span className="text-xs text-neutral-500">Precio</span> {money(p.precio)}</span>
                    <span className="block"><span className="text-xs text-neutral-500">Stock</span> <span className={bajo ? 'font-medium text-red-600' : ''}>{p.stock}</span></span>
                    <span className="block"><span className="text-xs text-neutral-500">Botonera</span> {p.enBotonera ? 'Sí' : 'No'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <Sheet open={seleccion !== null} onOpenChange={(o) => { if (!o) setSeleccion(null); }}>
        {seleccion && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{seleccion.nombre}</SheetTitle>
              <p className="text-sm text-neutral-600">{seleccion.codigoBarra || '—'} · {money(seleccion.precio)} · Stock {seleccion.stock}</p>
            </SheetHeader>
            <div className="flex flex-col gap-3">
              <Button className="h-11 w-full" disabled={pending} onClick={() => editar(seleccion)}>Editar</Button>
              <div className="space-y-1">
                <Label htmlFor="pb-cantidad">Reponer stock</Label>
                <div className="flex gap-2">
                  <Input id="pb-cantidad" type="number" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Cantidad" />
                  <Button variant="outline" disabled={pending} onClick={reponer}>Reponer</Button>
                </div>
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>

      <ProductoDialog key={editing?.id ?? 'new'} open={dialogOpen} onOpenChange={setDialogOpen} producto={editing} />
    </>
  );
}

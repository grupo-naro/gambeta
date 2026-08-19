'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ArticuloAlquiler } from '@/lib/types';
import { ArticuloDialog } from './articulo-dialog';
import { ajustarStockArticulo } from '@/lib/alquiler-admin-actions';

const money = (n: number | string) => '$' + Number(n || 0).toLocaleString('es-AR');

export function ArticulosTable({ articulos }: { articulos: ArticuloAlquiler[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<ArticuloAlquiler | null>(null);
  const [seleccion, setSeleccion] = useState<ArticuloAlquiler | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [pending, start] = useTransition();

  function ajustar() {
    if (!seleccion) return;
    const n = Number(cantidad);
    if (!n) { toast.error('Ingresá una cantidad distinta de 0'); return; }
    start(async () => {
      const r = await ajustarStockArticulo(seleccion.id, n);
      if (r.ok) { toast.success('Stock ajustado'); setSeleccion(null); }
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-end">
        <Button onClick={() => { setEditando(null); setDialogOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Nuevo artículo
        </Button>
      </div>

      {articulos.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay artículos todavía.</p>
      ) : (
        <>
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead><TableHead>Precio</TableHead>
                  <TableHead>Disponible</TableHead><TableHead>Afuera</TableHead><TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articulos.map((a) => (
                  <TableRow key={a.id} onClick={() => { setCantidad(''); setSeleccion(a); }}
                    className={`cursor-pointer hover:bg-neutral-50 ${a.activo ? '' : 'opacity-60'}`}>
                    <TableCell className="font-medium">{a.nombre}</TableCell>
                    <TableCell>{money(a.precio)}</TableCell>
                    <TableCell className={a.disponible === 0 ? 'font-medium text-red-600' : ''}>{a.disponible}</TableCell>
                    <TableCell className="text-neutral-600">{a.prestado}</TableCell>
                    <TableCell className="text-neutral-600">{a.stock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {articulos.map((a) => (
              <button key={a.id} type="button" onClick={() => { setCantidad(''); setSeleccion(a); }}
                className={`block w-full rounded-lg border bg-white p-3 text-left${a.activo ? '' : ' opacity-60'}`}>
                <span className="block text-sm font-medium">{a.nombre}</span>
                <span className="mt-1 block text-sm text-neutral-600">
                  {money(a.precio)} · {a.disponible} disponibles · {a.prestado} afuera
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <Sheet open={seleccion !== null} onOpenChange={(o) => { if (!o) setSeleccion(null); }}>
        {seleccion && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{seleccion.nombre}</SheetTitle>
              <p className="text-sm text-neutral-600">
                {money(seleccion.precio)} · {seleccion.disponible} disponibles · {seleccion.prestado} afuera
              </p>
            </SheetHeader>
            <div className="flex flex-col gap-3">
              <Button className="h-11 w-full" disabled={pending}
                onClick={() => { setSeleccion(null); setEditando(seleccion); setDialogOpen(true); }}>
                Editar
              </Button>
              <div className="space-y-1">
                <Label htmlFor="aa-ajuste">Ajustar stock (negativo para dar de baja)</Label>
                <div className="flex gap-2">
                  <Input id="aa-ajuste" type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="+3 / -1" />
                  <Button variant="outline" disabled={pending} onClick={ajustar}>Ajustar</Button>
                </div>
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>

      <ArticuloDialog key={editando?.id ?? 'new'} open={dialogOpen} onOpenChange={setDialogOpen} articulo={editando} />
    </>
  );
}

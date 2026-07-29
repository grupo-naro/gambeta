'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm';
import type { Cancha } from '@/lib/types';
import { CanchaDialog } from './cancha-dialog';
import { setActivaCancha, eliminarCancha } from '@/lib/canchas-actions';
import { tipoLabel, tamanoLabel } from '@/lib/canchas-catalogo';

const money = (n: number | string) => '$' + Number(n || 0).toLocaleString('es-AR');

function sortCanchas(canchas: Cancha[]): Cancha[] {
  return [...canchas].sort((a, b) => {
    const keyA = (a.grupoId ?? a.id) + (a.esEntera ? '0' : '1');
    const keyB = (b.grupoId ?? b.id) + (b.esEntera ? '0' : '1');
    return keyA.localeCompare(keyB);
  });
}

export function CanchasTable({ canchas }: { canchas: Cancha[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Cancha | null>(null);
  const [seleccion, setSeleccion] = useState<Cancha | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function nueva() { setEditing(null); setDialogOpen(true); }
  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => { const r = await fn(); if (r.ok) { toast.success(okMsg); if (close) setSeleccion(null); } else { toast.error(r.error ?? 'Error'); } });
  }
  function editar(c: Cancha) { setSeleccion(null); setEditing(c); setDialogOpen(true); }
  async function eliminar(c: Cancha) {
    const description = c.grupoId
      ? `Esto elimina la cancha divisible COMPLETA (la entera y todas sus partes), no solo "${c.nombre}". No se puede deshacer.`
      : `Vas a eliminar la cancha "${c.nombre}". No se puede deshacer.`;
    if (await confirm({ title: '¿Eliminar la cancha?', description, confirmLabel: 'Eliminar', destructive: true })) {
      act(() => eliminarCancha(c.id), 'Cancha eliminada', true);
    }
  }

  const sorted = sortCanchas(canchas);

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Canchas</h1>
        <Button onClick={nueva}><Plus className="mr-1 h-4 w-4" /> Nueva cancha</Button>
      </div>

      {canchas.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay canchas todavía.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Tamaño</TableHead><TableHead>Precio/hora</TableHead><TableHead>Estado</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => {
                  const isParte = !!c.grupoId && !c.esEntera;
                  return (
                    <TableRow key={c.id} onClick={() => setSeleccion(c)} className={`cursor-pointer hover:bg-neutral-50 ${c.activa ? '' : 'opacity-60'}`}>
                      <TableCell className="font-medium">
                        <span className={isParte ? 'pl-5 text-neutral-600' : ''}>
                          {c.nombre}
                          {c.esEntera && c.grupoId && (<Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-800 hover:bg-blue-100">Divisible</Badge>)}
                          {c.destacada && (<Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">Destacada</Badge>)}
                          {isParte && (<span className="ml-1 text-xs text-neutral-500">parte</span>)}
                        </span>
                      </TableCell>
                      <TableCell className="text-neutral-600">{tipoLabel(c.tipo)}</TableCell>
                      <TableCell className="text-neutral-600">{tamanoLabel(c.jugadores)}</TableCell>
                      <TableCell>{money(c.precioHora)}</TableCell>
                      <TableCell>
                        {c.activa
                          ? <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">Activa</Badge>
                          : <Badge variant="secondary" className="bg-neutral-200 text-neutral-600 hover:bg-neutral-200">Inactiva</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden space-y-3">
            {sorted.map((c) => {
              const isParte = !!c.grupoId && !c.esEntera;
              return (
                <button key={c.id} type="button" onClick={() => setSeleccion(c)} className={`block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]${c.activa ? '' : ' opacity-60'}`}>
                  <span className="flex items-start justify-between gap-2">
                    <span className={`text-sm font-medium${isParte ? ' pl-4 text-neutral-600' : ''}`}>
                      {c.nombre}
                      {c.esEntera && c.grupoId && (<Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-800 hover:bg-blue-100">Divisible</Badge>)}
                      {c.destacada && (<Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">Destacada</Badge>)}
                      {isParte && (<span className="ml-1 text-xs text-neutral-500">parte</span>)}
                    </span>
                    {c.activa
                      ? <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">Activa</Badge>
                      : <Badge variant="secondary" className="bg-neutral-200 text-neutral-600 hover:bg-neutral-200">Inactiva</Badge>}
                  </span>
                  <span className="mt-2 block space-y-1 text-sm text-neutral-600">
                    <span className="block"><span className="text-xs text-neutral-500">Tipo</span> {tipoLabel(c.tipo)}</span>
                    <span className="block"><span className="text-xs text-neutral-500">Tamaño</span> {tamanoLabel(c.jugadores)}</span>
                    <span className="block"><span className="text-xs text-neutral-500">Precio/hora</span> {money(c.precioHora)}</span>
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
              <p className="text-sm text-neutral-600">{tamanoLabel(seleccion.jugadores)} · {money(seleccion.precioHora)}/h · {seleccion.activa ? 'Activa' : 'Inactiva'}</p>
            </SheetHeader>
            <div className="flex flex-col gap-2">
              <Button className="h-11 w-full" disabled={pending} onClick={() => editar(seleccion)}>Editar</Button>
              <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => act(() => setActivaCancha(seleccion.id, !seleccion.activa), seleccion.activa ? 'Cancha desactivada' : 'Cancha activada', true)}>
                {seleccion.activa ? 'Desactivar' : 'Activar'}
              </Button>
              <Button variant="ghost" className="h-11 w-full text-red-600" disabled={pending} onClick={() => eliminar(seleccion)}>Eliminar</Button>
            </div>
          </SheetContent>
        )}
      </Sheet>

      <CanchaDialog key={editing?.id ?? 'new'} open={dialogOpen} onOpenChange={setDialogOpen} cancha={editing} />
    </>
  );
}

'use client';
import { useState, useTransition } from 'react';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { Cliente } from '@/lib/types';
import { ClienteDialog } from './cliente-dialog';
import { editarConfianza, editarNombreCliente, editarWhatsappCliente, eliminarCliente } from '@/lib/clientes-actions';
import { previewWhatsapp } from '@/lib/whatsapp';
import { useConfirm } from '@/components/ui/confirm';

export function ClientesTable({ clientes }: { clientes: Cliente[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seleccion, setSeleccion] = useState<Cliente | null>(null);
  const [nombre, setNombre] = useState('');
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [whatsapp, setWhatsapp] = useState('');
  const [q, setQ] = useState('');

  const qd = q.replace(/\D/g, '');
  const qt = q.trim().toLowerCase();
  const visibles = q.trim() === ''
    ? clientes
    : clientes.filter((c) => (qd !== '' && c.whatsapp.replace(/\D/g, '').includes(qd)) || c.nombre.toLowerCase().includes(qt));

  function abrir(c: Cliente) { setSeleccion(c); setNombre(c.nombre); setWhatsapp(c.whatsapp); }
  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => { const r = await fn(); if (r.ok) { toast.success(okMsg); if (close) setSeleccion(null); } else toast.error(r.error ?? 'Error'); });
  }
  const badge = (c: Pick<Cliente, 'confianza'>) => c.confianza
    ? <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">De confianza</Badge>
    : <Badge variant="secondary" className="bg-neutral-200 text-neutral-600 hover:bg-neutral-200">Pide seña</Badge>;

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="mt-1 text-sm text-neutral-600">Los de confianza reservan sin seña.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo cliente</Button>
      </div>

      {clientes.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay clientes todavía.</p>
      ) : (
        <>
          <div className="relative mb-3 max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por teléfono o nombre…" className="pl-8" />
          </div>
          {visibles.length === 0 ? (
            <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">Nada coincide con la búsqueda.</p>
          ) : (
          <>
          {/* Desktop */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nombre</TableHead><TableHead>WhatsApp</TableHead><TableHead>Reservas</TableHead><TableHead>Confianza</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((c) => (
                  <TableRow key={c.id} onClick={() => abrir(c)} className="cursor-pointer hover:bg-neutral-50">
                    <TableCell className="font-medium">{c.nombre}</TableCell>
                    <TableCell className="text-neutral-600">{c.whatsapp}</TableCell>
                    <TableCell className="text-neutral-600">{c.cumplidas}</TableCell>
                    <TableCell>{badge(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {visibles.map((c) => (
              <button key={c.id} type="button" onClick={() => abrir(c)} className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.nombre}</span>
                    <span className="block text-xs text-neutral-500">{c.whatsapp}</span>
                  </span>
                  {badge(c)}
                </span>
                <span className="mt-2 block text-sm text-neutral-600"><span className="text-xs text-neutral-500">Reservas</span> {c.cumplidas}</span>
              </button>
            ))}
          </div>
          </>
          )}
        </>
      )}

      <Sheet open={seleccion !== null} onOpenChange={(o) => { if (!o) setSeleccion(null); }}>
        {seleccion && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{seleccion.nombre}</SheetTitle>
              <p className="text-sm text-neutral-600">{seleccion.whatsapp} · {seleccion.cumplidas} reservas</p>
            </SheetHeader>
            <div className="space-y-1">
              <label htmlFor="cl-nombre" className="text-xs text-neutral-600">Nombre</label>
              <div className="flex gap-2">
                <Input id="cl-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                <Button variant="outline" disabled={pending || !nombre.trim() || nombre.trim() === seleccion.nombre} onClick={() => act(() => editarNombreCliente(seleccion.id, nombre.trim()), 'Nombre actualizado')}>Guardar</Button>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="cl-whatsapp" className="text-xs text-neutral-600">WhatsApp</label>
              <div className="flex gap-2">
                <Input id="cl-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
                <Button variant="outline" disabled={pending || !previewWhatsapp(whatsapp) || previewWhatsapp(whatsapp) === seleccion.whatsapp} onClick={() => act(() => editarWhatsappCliente(seleccion.id, whatsapp.trim()), 'WhatsApp actualizado')}>Guardar</Button>
              </div>
              {whatsapp.trim() !== '' && !previewWhatsapp(whatsapp) && <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>}
            </div>
            <Button className="h-11 w-full" disabled={pending} onClick={() => act(() => editarConfianza(seleccion.id, !seleccion.confiable), seleccion.confiable ? 'Quitado de confianza' : 'Marcado de confianza', true)}>
              {seleccion.confiable ? 'Quitar de confianza' : 'Marcar de confianza'}
            </Button>
            <Button
              variant="destructive"
              className="h-11 w-full"
              disabled={pending}
              onClick={async () => {
                if (await confirm({ title: 'Eliminar cliente', description: `Vas a eliminar a ${seleccion.nombre}. No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
                  act(() => eliminarCliente(seleccion.id), 'Cliente eliminado', true);
                }
              }}
            >
              Eliminar cliente
            </Button>
          </SheetContent>
        )}
      </Sheet>

      <ClienteDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

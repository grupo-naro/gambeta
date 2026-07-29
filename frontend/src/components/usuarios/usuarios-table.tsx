'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm';
import type { Usuario } from '@/lib/types';
import { UsuarioDialog } from './usuario-dialog';
import { cambiarRolUsuario, eliminarUsuario, cambiarExpiracionUsuario } from '@/lib/usuarios-actions';

export function UsuariosTable({ usuarios, currentEmail }: { usuarios: Usuario[]; currentEmail: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seleccion, setSeleccion] = useState<Usuario | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => { const r = await fn(); if (r.ok) { toast.success(okMsg); if (close) setSeleccion(null); } else toast.error('error' in r ? r.error : 'Error'); });
  }
  async function eliminar(u: Usuario) {
    if (await confirm({ title: '¿Eliminar el usuario?', description: `Vas a eliminar a ${u.nombre} (${u.email}). No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
      act(() => eliminarUsuario(u.id), 'Usuario eliminado', true);
    }
  }
  const rolBadge = (u: Usuario) => u.rol === 'ADMIN'
    ? <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">Admin</Badge>
    : <Badge variant="secondary" className="bg-neutral-200 text-neutral-600 hover:bg-neutral-200">Recepcionista</Badge>;
  const vencInfo = (u: Usuario) => {
    if (!u.expiraEn) return { vencido: false, label: '—' };
    const t = new Date(u.expiraEn).getTime();
    if (t <= Date.now()) return { vencido: true, label: 'Vencido' };
    return { vencido: false, label: 'Vence ' + new Date(u.expiraEn).toLocaleDateString('es-AR') };
  };
  const vencBadge = (u: Usuario) => {
    const v = vencInfo(u);
    if (v.vencido) return <Badge variant="secondary" className="bg-red-100 text-red-800 hover:bg-red-100">Vencido</Badge>;
    return <span className="text-sm text-neutral-600">{v.label}</span>;
  };
  const extender = (u: Usuario, dias: 1 | 2 | 7 | 30 | null) =>
    act(() => cambiarExpiracionUsuario(u.id, dias), dias ? 'Vencimiento actualizado' : 'Vencimiento quitado', true);

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
          <p className="mt-1 text-sm text-neutral-600">Administrá quién puede entrar al panel y con qué rol.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo usuario</Button>
      </div>

      {usuarios.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay usuarios todavía.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Email</TableHead><TableHead>Nombre</TableHead><TableHead>Rol</TableHead><TableHead>Vencimiento</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {usuarios.map((u) => (
                  <TableRow key={u.id} onClick={() => setSeleccion(u)} className="cursor-pointer hover:bg-neutral-50">
                    <TableCell className="font-medium">
                      {u.email}
                      {u.esDefault && (<Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">default</Badge>)}
                    </TableCell>
                    <TableCell className="text-neutral-600">{u.nombre}</TableCell>
                    <TableCell>{rolBadge(u)}</TableCell>
                    <TableCell>{vencBadge(u)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden space-y-3">
            {usuarios.map((u) => (
              <button key={u.id} type="button" onClick={() => setSeleccion(u)} className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{u.email}{u.esDefault && (<Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">default</Badge>)}</span>
                    <span className="mt-0.5 block text-sm text-neutral-600">{u.nombre}</span>
                    <span className="mt-0.5 block text-xs">{vencBadge(u)}</span>
                  </span>
                  {rolBadge(u)}
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
              <SheetTitle>{seleccion.email}</SheetTitle>
              <p className="text-sm text-neutral-600">{seleccion.nombre} · {seleccion.rol === 'ADMIN' ? 'Admin' : 'Recepcionista'}</p>
            </SheetHeader>
            {!seleccion.esDefault && seleccion.email !== currentEmail ? (
              <div className="flex flex-col gap-2">
                <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => act(() => cambiarRolUsuario(seleccion.id, seleccion.rol === 'ADMIN' ? 'RECEPCIONISTA' : 'ADMIN'), 'Rol actualizado', true)}>
                  {seleccion.rol === 'ADMIN' ? 'Hacer recepcionista' : 'Hacer administrador'}
                </Button>
                <div className="rounded-md border p-2">
                  <p className="mb-1 text-sm text-neutral-600">Vencimiento: {vencInfo(seleccion).label}</p>
                  <p className="mb-2 text-xs text-neutral-500">Fijar vencimiento a partir de hoy:</p>
                  <div className="flex flex-wrap gap-2">
                    {([1, 2, 7, 30] as const).map((d) => (
                      <Button key={d} variant="outline" size="sm" disabled={pending} onClick={() => extender(seleccion, d)}>{d === 1 ? '1 día' : `${d} días`}</Button>
                    ))}
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => extender(seleccion, null)}>Sin vencimiento</Button>
                  </div>
                </div>
                <Button variant="ghost" className="h-11 w-full text-red-600" disabled={pending} onClick={() => eliminar(seleccion)}>Eliminar</Button>
              </div>
            ) : (
              <p className="text-sm text-neutral-600">Este usuario no se puede modificar desde acá.</p>
            )}
          </SheetContent>
        )}
      </Sheet>

      <UsuarioDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

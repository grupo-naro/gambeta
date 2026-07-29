# Hoja de acción en tablas de admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En Canchas, Usuarios, Bloqueos y Turnos fijos, reemplazar el menú de 3 puntos por "tocar la fila → hoja inferior con datos clave + botones de acción", reusando `ui/sheet` y `useConfirm`.

**Architecture:** Cada tabla agrega un estado `seleccion`, vuelve tocables sus filas/tarjetas, y monta una `Sheet` inline con la info + botones (que llaman a las server actions ya existentes). Se reusan los diálogos de crear/editar. Solo frontend.

**Tech Stack:** Next 16, React 19, Tailwind 4, Base UI, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-16-sheet-admin-tables-design.md`

**Gotchas:** Base UI `<button>` solo admite contenido en línea → tarjetas mobile con `<span className="block">` (no `<div>`/`<p>`); `Badge` ya renderiza `<span>` (ok dentro de button). `useConfirm` y las actions ya existen. `pnpm lint` + `pnpm build` obligatorios. Cada tarea reemplaza el archivo COMPLETO con el contenido dado.

> Rama: `cd frontend && git checkout master && git checkout -b feat/sheet-admin-tables`.

---

### Task 1: Canchas

**Files:** Reemplazar TODO `src/components/canchas/canchas-table.tsx` por:

```tsx
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
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-500">No hay canchas todavía.</p>
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
                          {isParte && (<span className="ml-1 text-xs text-neutral-400">parte</span>)}
                        </span>
                      </TableCell>
                      <TableCell className="text-neutral-500">{c.tipo}</TableCell>
                      <TableCell className="text-neutral-600">Fútbol {c.jugadores}</TableCell>
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
                      {isParte && (<span className="ml-1 text-xs text-neutral-400">parte</span>)}
                    </span>
                    {c.activa
                      ? <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">Activa</Badge>
                      : <Badge variant="secondary" className="bg-neutral-200 text-neutral-600 hover:bg-neutral-200">Inactiva</Badge>}
                  </span>
                  <span className="mt-2 block space-y-1 text-sm text-neutral-600">
                    <span className="block"><span className="text-xs text-neutral-400">Tipo</span> {c.tipo}</span>
                    <span className="block"><span className="text-xs text-neutral-400">Tamaño</span> Fútbol {c.jugadores}</span>
                    <span className="block"><span className="text-xs text-neutral-400">Precio/hora</span> {money(c.precioHora)}</span>
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
              <p className="text-sm text-neutral-500">Fútbol {seleccion.jugadores} · {money(seleccion.precioHora)}/h · {seleccion.activa ? 'Activa' : 'Inactiva'}</p>
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
```

- [ ] **Step 1:** Reemplazar el archivo con el contenido de arriba.
- [ ] **Step 2:** `cd frontend && pnpm exec tsc --noEmit && pnpm lint` → 0 errores.
- [ ] **Step 3:** Commit:
```bash
git add src/components/canchas/canchas-table.tsx
git commit -m "feat(ux): hoja de accion en Canchas (saca el menu de 3 puntos)"
```

---

### Task 2: Usuarios

**Files:** Reemplazar TODO `src/components/usuarios/usuarios-table.tsx` por:

```tsx
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
import { cambiarRolUsuario, eliminarUsuario } from '@/lib/usuarios-actions';

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

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
          <p className="mt-1 text-sm text-neutral-500">Administrá quién puede entrar al panel y con qué rol.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo usuario</Button>
      </div>

      {usuarios.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-500">No hay usuarios todavía.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Email</TableHead><TableHead>Nombre</TableHead><TableHead>Rol</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {usuarios.map((u) => (
                  <TableRow key={u.id} onClick={() => setSeleccion(u)} className="cursor-pointer hover:bg-neutral-50">
                    <TableCell className="font-medium">
                      {u.email}
                      {u.esDefault && (<Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">default</Badge>)}
                    </TableCell>
                    <TableCell className="text-neutral-500">{u.nombre}</TableCell>
                    <TableCell>{rolBadge(u)}</TableCell>
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
                    <span className="mt-0.5 block text-sm text-neutral-500">{u.nombre}</span>
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
              <p className="text-sm text-neutral-500">{seleccion.nombre} · {seleccion.rol === 'ADMIN' ? 'Admin' : 'Recepcionista'}</p>
            </SheetHeader>
            {!seleccion.esDefault && seleccion.email !== currentEmail ? (
              <div className="flex flex-col gap-2">
                <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => act(() => cambiarRolUsuario(seleccion.id, seleccion.rol === 'ADMIN' ? 'RECEPCIONISTA' : 'ADMIN'), 'Rol actualizado', true)}>
                  {seleccion.rol === 'ADMIN' ? 'Hacer recepcionista' : 'Hacer administrador'}
                </Button>
                <Button variant="ghost" className="h-11 w-full text-red-600" disabled={pending} onClick={() => eliminar(seleccion)}>Eliminar</Button>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">Este usuario no se puede modificar desde acá.</p>
            )}
          </SheetContent>
        )}
      </Sheet>

      <UsuarioDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
```

- [ ] **Step 1:** Reemplazar el archivo.
- [ ] **Step 2:** `cd frontend && pnpm exec tsc --noEmit && pnpm lint` → 0 errores.
- [ ] **Step 3:** Commit:
```bash
git add src/components/usuarios/usuarios-table.tsx
git commit -m "feat(ux): hoja de accion en Usuarios"
```

---

### Task 3: Bloqueos

**Files:** Reemplazar TODO `src/components/bloqueos/bloqueos-table.tsx` por:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import type { Bloqueo, Cancha } from '@/lib/types';
import { BloqueoDialog } from './bloqueo-dialog';
import { eliminarBloqueo } from '@/lib/bloqueos-actions';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MOTIVO_LABEL: Record<string, string> = { TORNEO: 'Torneo', ENTRENAMIENTO: 'Entrenamiento', MANTENIMIENTO: 'Mantenimiento', OTRO: 'Otro' };

export function BloqueosTable({ bloqueos, canchas }: { bloqueos: Bloqueo[]; canchas: Cancha[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seleccion, setSeleccion] = useState<Bloqueo | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => { const r = await fn(); if (r.ok) { toast.success(okMsg); if (close) setSeleccion(null); } else { toast.error(r.error ?? 'Error'); } });
  }
  function programaLabel(b: Bloqueo) {
    if (b.recurrente) return `Recurrente: ${DIAS[b.diaSemana ?? 0] ?? b.diaSemana}`;
    return `Puntual: ${b.fecha?.slice(0, 10) ?? '—'}`;
  }
  async function eliminar(b: Bloqueo) {
    if (await confirm({ title: '¿Eliminar el bloqueo?', description: `Vas a eliminar el bloqueo de ${b.cancha?.nombre ?? 'esta cancha'}. No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
      act(() => eliminarBloqueo(b.id), 'Bloqueo eliminado', true);
    }
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bloqueos</h1>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo bloqueo</Button>
      </div>

      {bloqueos.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-500">No hay bloqueos todavía.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Cancha</TableHead><TableHead>Motivo</TableHead><TableHead>Programa</TableHead><TableHead>Horario</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {bloqueos.map((b) => (
                  <TableRow key={b.id} onClick={() => setSeleccion(b)} className="cursor-pointer hover:bg-neutral-50">
                    <TableCell className="font-medium">{b.cancha?.nombre ?? '—'}</TableCell>
                    <TableCell className="text-neutral-500">{MOTIVO_LABEL[b.motivo] ?? b.motivo}</TableCell>
                    <TableCell>{programaLabel(b)}</TableCell>
                    <TableCell>{b.horaInicio}–{b.horaFin}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden space-y-3">
            {bloqueos.map((b) => (
              <button key={b.id} type="button" onClick={() => setSeleccion(b)} className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]">
                <span className="block text-sm font-medium">{b.cancha?.nombre ?? '—'}</span>
                <span className="mt-2 block space-y-1 text-sm text-neutral-600">
                  <span className="block"><span className="text-xs text-neutral-400">Motivo</span> {MOTIVO_LABEL[b.motivo] ?? b.motivo}</span>
                  <span className="block"><span className="text-xs text-neutral-400">Programa</span> {programaLabel(b)}</span>
                  <span className="block"><span className="text-xs text-neutral-400">Horario</span> {b.horaInicio}–{b.horaFin}</span>
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
              <SheetTitle>{seleccion.cancha?.nombre ?? 'Bloqueo'}</SheetTitle>
              <p className="text-sm text-neutral-500">{MOTIVO_LABEL[seleccion.motivo] ?? seleccion.motivo} · {programaLabel(seleccion)} · {seleccion.horaInicio}–{seleccion.horaFin}</p>
            </SheetHeader>
            <Button variant="ghost" className="h-11 w-full text-red-600" disabled={pending} onClick={() => eliminar(seleccion)}>Eliminar</Button>
          </SheetContent>
        )}
      </Sheet>

      <BloqueoDialog open={dialogOpen} onOpenChange={setDialogOpen} canchas={canchas} />
    </>
  );
}
```

- [ ] **Step 1:** Reemplazar el archivo.
- [ ] **Step 2:** `cd frontend && pnpm exec tsc --noEmit && pnpm lint` → 0 errores.
- [ ] **Step 3:** Commit:
```bash
git add src/components/bloqueos/bloqueos-table.tsx
git commit -m "feat(ux): hoja de accion en Bloqueos"
```

---

### Task 4: Turnos fijos

**Files:** Reemplazar TODO `src/components/fijos/turnos-fijos-table.tsx` por:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import type { Cancha, TurnoFijo } from '@/lib/types';
import { TurnoFijoDialog } from './turno-fijo-dialog';
import { ExcepcionDialog } from './excepcion-dialog';
import { eliminarTurnoFijo } from '@/lib/fijos-actions';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const money = (n: number | string) => '$' + Number(n || 0).toLocaleString('es-AR');

export function TurnosFijosTable({ fijos, canchas }: { fijos: TurnoFijo[]; canchas: Cancha[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [excepcionOpen, setExcepcionOpen] = useState(false);
  const [selectedTurno, setSelectedTurno] = useState<TurnoFijo | null>(null);
  const [seleccion, setSeleccion] = useState<TurnoFijo | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function abrirExcepcion(t: TurnoFijo) { setSeleccion(null); setSelectedTurno(t); setExcepcionOpen(true); }
  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => { const r = await fn(); if (r.ok) { toast.success(okMsg); if (close) setSeleccion(null); } else { toast.error(r.error ?? 'Error'); } });
  }
  async function eliminar(t: TurnoFijo) {
    if (await confirm({ title: '¿Eliminar el turno fijo?', description: `Vas a eliminar el turno fijo de ${t.clienteNombre}. No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
      act(() => eliminarTurnoFijo(t.id), 'Turno fijo eliminado', true);
    }
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Turnos fijos</h1>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo turno fijo</Button>
      </div>

      {fijos.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-500">No hay turnos fijos todavía.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Cliente</TableHead><TableHead>Cancha</TableHead><TableHead>Día</TableHead><TableHead>Horario</TableHead><TableHead>Precio</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {fijos.map((t) => (
                  <TableRow key={t.id} onClick={() => setSeleccion(t)} className="cursor-pointer hover:bg-neutral-50">
                    <TableCell className="font-medium">{t.clienteNombre}</TableCell>
                    <TableCell className="text-neutral-500">{t.cancha?.nombre ?? '—'}</TableCell>
                    <TableCell>{DIAS[t.diaSemana] ?? t.diaSemana}</TableCell>
                    <TableCell>{t.horaInicio}–{t.horaFin}</TableCell>
                    <TableCell>{money(t.precio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden space-y-3">
            {fijos.map((t) => (
              <button key={t.id} type="button" onClick={() => setSeleccion(t)} className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]">
                <span className="block text-sm font-medium">{t.clienteNombre}</span>
                <span className="mt-2 block space-y-1 text-sm text-neutral-600">
                  <span className="block"><span className="text-xs text-neutral-400">Cancha</span> {t.cancha?.nombre ?? '—'}</span>
                  <span className="block"><span className="text-xs text-neutral-400">Día</span> {DIAS[t.diaSemana] ?? t.diaSemana}</span>
                  <span className="block"><span className="text-xs text-neutral-400">Horario</span> {t.horaInicio}–{t.horaFin}</span>
                  <span className="block"><span className="text-xs text-neutral-400">Precio</span> {money(t.precio)}</span>
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
              <SheetTitle>{seleccion.clienteNombre}</SheetTitle>
              <p className="text-sm text-neutral-500">{seleccion.cancha?.nombre ?? '—'} · {DIAS[seleccion.diaSemana] ?? seleccion.diaSemana} {seleccion.horaInicio}–{seleccion.horaFin} · {money(seleccion.precio)}</p>
            </SheetHeader>
            <div className="flex flex-col gap-2">
              <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => abrirExcepcion(seleccion)}>Liberar fecha</Button>
              <Button variant="ghost" className="h-11 w-full text-red-600" disabled={pending} onClick={() => eliminar(seleccion)}>Eliminar</Button>
            </div>
          </SheetContent>
        )}
      </Sheet>

      <TurnoFijoDialog open={dialogOpen} onOpenChange={setDialogOpen} canchas={canchas} />
      <ExcepcionDialog key={selectedTurno?.id ?? 'none'} open={excepcionOpen} onOpenChange={setExcepcionOpen} turno={selectedTurno} />
    </>
  );
}
```

- [ ] **Step 1:** Reemplazar el archivo.
- [ ] **Step 2:** `cd frontend && pnpm exec tsc --noEmit && pnpm lint` → 0 errores.
- [ ] **Step 3:** Commit:
```bash
git add src/components/fijos/turnos-fijos-table.tsx
git commit -m "feat(ux): hoja de accion en Turnos fijos"
```

---

### Task 5: Gate (lint + build) + QA + cierre

- [ ] **Step 1:** `cd frontend && pnpm test` → verde.
- [ ] **Step 2:** `cd frontend && pnpm lint` → 0 errores.
- [ ] **Step 3:** `cd frontend && pnpm build` → OK.
- [ ] **Step 4: QA manual (`pnpm dev`, mobile)**: en cada tabla, tocar fila/tarjeta abre la hoja; los botones hacen lo de antes (Editar abre el form en Canchas; Liberar fecha abre su diálogo en Turnos fijos); eliminar pide confirmación y cierra la hoja; en Usuarios el default/uno mismo muestra solo info; activar/desactivar una cancha cierra la hoja y la tabla refleja el cambio.
- [ ] **Step 5:** Commit si hubo ajustes de QA.
- [ ] **Step 6:** Cerrar la rama — invocar **superpowers:finishing-a-development-branch** → merge a `master` local.

---

## Notas
- Solo frontend, sin backend ni tipos nuevos. Cada acción reusa la server action existente (con `revalidatePath`) y `useConfirm` para lo destructivo.
- Las acciones que cambian o sacan la fila cierran la hoja (`close=true`) para no mostrar datos viejos.

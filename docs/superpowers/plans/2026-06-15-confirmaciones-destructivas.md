# Confirmaciones de acciones destructivas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que toda acción destructiva del panel (cancelar reserva, anular cobro, eliminar cancha/usuario/bloqueo/turno fijo) pase por un diálogo de confirmación de marca, mobile-friendly, reemplazando los `window.confirm()` nativos y agregando confirmación donde falta.

**Architecture:** Un `ConfirmProvider` + hook `useConfirm()` (promesa) montado una sola vez en `AppShell`, con un único `Dialog` de Base UI compartido. Cada call site destructivo hace `if (await confirm({...})) act(...)`. Solo frontend, aditivo, sin tocar las server actions ni el backend.

**Tech Stack:** Next 16, React 19, Tailwind 4, Base UI (`@base-ui/react`), pnpm.

**Spec:** `docs/superpowers/specs/2026-06-15-confirmaciones-destructivas-design.md`

**Gotchas:**
- `useConfirm()` debe llamarse en el nivel superior del componente (Rules of Hooks), nunca dentro de un `.map`.
- Clases Tailwind estáticas. No `any`.
- Al agregar `const confirm = useConfirm();` en los archivos que hoy usan `window.confirm()`, hay que reemplazar **todas** las llamadas nativas `confirm(...)` de ese archivo (si no, quedan pasándole un string al hook → error de tipos). Son 2 por archivo (desktop + mobile).
- `pnpm lint` + `pnpm build` obligatorios antes de merge.

---

## File Structure

- Create: `src/components/ui/confirm.tsx` — `ConfirmProvider`, `useConfirm`, `ConfirmOptions`, diálogo único.
- Modify: `src/components/app-shell.tsx` — montar `<ConfirmProvider>` alrededor de `children`.
- Modify (reemplazar `window.confirm`): `src/components/canchas/canchas-table.tsx`, `src/components/usuarios/usuarios-table.tsx`, `src/components/bloqueos/bloqueos-table.tsx`, `src/components/fijos/turnos-fijos-table.tsx`.
- Modify (agregar confirmación): `src/components/reservas/reservas-table.tsx`, `src/components/reservas/cobros-dialog.tsx`, `src/components/hoy/accion-turno-sheet.tsx`, `src/components/calendario/calendario-semana.tsx`.

> Rama: `cd frontend && git checkout master && git checkout -b feat/confirmaciones-panel`.

---

### Task 1: `ConfirmProvider` + `useConfirm` + montaje

**Files:**
- Create: `src/components/ui/confirm.tsx`
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: Crear `src/components/ui/confirm.tsx`**

```tsx
'use client';
import * as React from 'react';
import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>');
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    // Si había una confirmación pendiente, resolvela como cancelada.
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  function cerrar(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={opts !== null} onOpenChange={(o) => { if (!o) cerrar(false); }}>
        {opts && (
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>{opts.title}</DialogTitle></DialogHeader>
            {opts.description && <p className="text-sm text-neutral-600">{opts.description}</p>}
            <DialogFooter>
              <Button variant="outline" className="h-10" onClick={() => cerrar(false)}>
                {opts.cancelLabel ?? 'Volver'}
              </Button>
              <Button variant={opts.destructive ? 'destructive' : 'default'} className="h-10" onClick={() => cerrar(true)}>
                {opts.confirmLabel ?? 'Confirmar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}
```

(`Button` soporta `variant="outline" | "destructive" | "default"` — confirmado en `ui/button.tsx`. El `DialogContent` ya trae su botón X de cierre, que dispara `onOpenChange(false)` → `cerrar(false)`.)

- [ ] **Step 2: Montar el provider en `app-shell.tsx`**

En `src/components/app-shell.tsx`, importar el provider y envolver `children`.

Agregar el import (junto a los otros de `@/components`):
```tsx
import { ConfirmProvider } from '@/components/ui/confirm';
```
Y cambiar el `<main>` (actualmente `<main className="flex-1 p-6 lg:p-8">{children}</main>`) por:
```tsx
        <main className="flex-1 p-6 lg:p-8">
          <ConfirmProvider>{children}</ConfirmProvider>
        </main>
```

- [ ] **Step 3: Verificar tipos**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/confirm.tsx src/components/app-shell.tsx
git commit -m "feat(ux): ConfirmProvider + useConfirm (dialogo de confirmacion reusable)"
```

---

### Task 2: Reemplazar `window.confirm()` nativo en las 4 tablas de admin

**Files:** `canchas-table.tsx`, `usuarios-table.tsx`, `bloqueos-table.tsx`, `fijos/turnos-fijos-table.tsx`.

En cada archivo: (a) agregar el import `import { useConfirm } from '@/components/ui/confirm';`; (b) agregar `const confirm = useConfirm();` junto a los otros hooks (después de `const [pending, start] = useTransition();`); (c) reemplazar **las 2** llamadas `window.confirm(...)` (desktop + mobile) por el patrón `async`.

- [ ] **Step 1: `canchas-table.tsx`**

Agregar hook + import. Luego, en `canchas-table.tsx` hay un `const deleteConfirm = ...` calculado dentro de cada `.map` (2 veces) y un `onClick={() => { if (confirm(deleteConfirm)) act(() => eliminarCancha(c.id), 'Cancha eliminada'); }}`. **Eliminar** las dos declaraciones `const deleteConfirm = c.grupoId ? ... : ...;` y reemplazar **ambos** `onClick` del item "Eliminar" por:

```tsx
onClick={async () => {
  const description = c.grupoId
    ? `Esto elimina la cancha divisible COMPLETA (la entera y todas sus partes), no solo "${c.nombre}". No se puede deshacer.`
    : `Vas a eliminar la cancha "${c.nombre}". No se puede deshacer.`;
  if (await confirm({ title: '¿Eliminar la cancha?', description, confirmLabel: 'Eliminar', destructive: true })) {
    act(() => eliminarCancha(c.id), 'Cancha eliminada');
  }
}}
```

- [ ] **Step 2: `usuarios-table.tsx`** — reemplazar **ambos** `onClick` del "Eliminar" (hoy `if (confirm(\`¿Eliminar a ${u.nombre} (${u.email})?\`)) act(...)`) por:

```tsx
onClick={async () => {
  if (await confirm({ title: '¿Eliminar el usuario?', description: `Vas a eliminar a ${u.nombre} (${u.email}). No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
    act(() => eliminarUsuario(u.id), 'Usuario eliminado');
  }
}}
```

- [ ] **Step 3: `bloqueos-table.tsx`** — reemplazar **ambos** `onClick` del "Eliminar" por:

```tsx
onClick={async () => {
  if (await confirm({ title: '¿Eliminar el bloqueo?', description: `Vas a eliminar el bloqueo de ${b.cancha?.nombre ?? 'esta cancha'}. No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
    act(() => eliminarBloqueo(b.id), 'Bloqueo eliminado');
  }
}}
```

- [ ] **Step 4: `fijos/turnos-fijos-table.tsx`** — reemplazar **ambos** `onClick` del "Eliminar" por:

```tsx
onClick={async () => {
  if (await confirm({ title: '¿Eliminar el turno fijo?', description: `Vas a eliminar el turno fijo de ${t.clienteNombre}. No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
    act(() => eliminarTurnoFijo(t.id), 'Turno fijo eliminado');
  }
}}
```

- [ ] **Step 5: Verificar que no quedó ningún `window.confirm` nativo**

Run: `cd frontend && grep -rn "confirm(" src/components/canchas src/components/usuarios src/components/bloqueos src/components/fijos`
Expected: solo aparecen llamadas a `confirm({ ... })` (objeto, el hook), NINGUNA `confirm(` con un string. (Y `const confirm = useConfirm()` en cada archivo.)

- [ ] **Step 6: Verificar tipos + lint**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: 0 errores (sin variables `deleteConfirm` sin usar).

- [ ] **Step 7: Commit**

```bash
git add src/components/canchas/canchas-table.tsx src/components/usuarios/usuarios-table.tsx src/components/bloqueos/bloqueos-table.tsx src/components/fijos/turnos-fijos-table.tsx
git commit -m "feat(ux): reemplazar window.confirm por dialogo de confirmacion en tablas de admin"
```

---

### Task 3: Agregar confirmación a las acciones que hoy no confirman

**Files:** `reservas/reservas-table.tsx`, `reservas/cobros-dialog.tsx`, `hoy/accion-turno-sheet.tsx`, `calendario/calendario-semana.tsx`.

En cada uno: agregar `import { useConfirm } from '@/components/ui/confirm';` y `const confirm = useConfirm();` junto a los hooks existentes.

- [ ] **Step 1: `reservas-table.tsx`** (`fmtFechaHora` ya está importado). Reemplazar **ambos** `onClick` del item "Cancelar" (hoy `onClick={() => act(() => cancelarReserva(r.id), 'Reserva cancelada')}`) por:

```tsx
onClick={async () => {
  if (await confirm({
    title: '¿Cancelar la reserva?',
    description: `Vas a cancelar la reserva de ${r.cliente?.nombre ?? 'el cliente'} del ${fmtFechaHora(r.fechaInicio)}. El cliente pierde el turno.`,
    confirmLabel: 'Cancelar turno',
    destructive: true,
  })) {
    act(() => cancelarReserva(r.id), 'Reserva cancelada');
  }
}}
```

- [ ] **Step 2: `cobros-dialog.tsx`** (`money` ya existe). El item de anular hoy es `onClick={() => anular(c.id)}`. Reemplazar por:

```tsx
onClick={async () => {
  if (await confirm({ title: '¿Anular el cobro?', description: `Vas a anular este cobro de ${money(c.monto)}. Se vuelve a sumar al saldo.`, confirmLabel: 'Anular cobro', destructive: true })) {
    anular(c.id);
  }
}}
```

- [ ] **Step 3: `hoy/accion-turno-sheet.tsx`** (`fmtHora` y `money` ya existen). Dos cambios:

(a) El "Cancelar" secundario, hoy `onClick={() => act(() => cancelarReserva(reserva.id), 'Reserva cancelada', true)}` →
```tsx
onClick={async () => {
  if (await confirm({
    title: '¿Cancelar la reserva?',
    description: `Vas a cancelar la reserva de ${reserva.cliente?.nombre ?? 'el cliente'} (${fmtHora(reserva.fechaInicio)}). El cliente pierde el turno.`,
    confirmLabel: 'Cancelar turno',
    destructive: true,
  })) {
    act(() => cancelarReserva(reserva.id), 'Reserva cancelada', true);
  }
}}
```
(b) El "Anular" de cada cobro de la lista, hoy `onClick={() => act(() => anularCobro(c.id), 'Cobro anulado')}` →
```tsx
onClick={async () => {
  if (await confirm({ title: '¿Anular el cobro?', description: `Vas a anular este cobro de ${money(c.monto)}. Se vuelve a sumar al saldo.`, confirmLabel: 'Anular cobro', destructive: true })) {
    act(() => anularCobro(c.id), 'Cobro anulado');
  }
}}
```

- [ ] **Step 4: `calendario-semana.tsx`** (`selReserva` tiene `cliente?.nombre`). El botón "Cancelar" (línea ~172), hoy `onClick={() => act(() => cancelarReserva(selReserva.id), 'Reserva cancelada')}` →

```tsx
onClick={async () => {
  if (await confirm({
    title: '¿Cancelar la reserva?',
    description: `Vas a cancelar la reserva de ${selReserva.cliente?.nombre ?? 'el cliente'}. El cliente pierde el turno.`,
    confirmLabel: 'Cancelar turno',
    destructive: true,
  })) {
    act(() => cancelarReserva(selReserva.id), 'Reserva cancelada');
  }
}}
```

- [ ] **Step 5: Verificar tipos + lint**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: 0 errores. (Confirmar que `useConfirm` se llama en el top-level de cada componente, no dentro de un `.map`.)

- [ ] **Step 6: Commit**

```bash
git add src/components/reservas/reservas-table.tsx src/components/reservas/cobros-dialog.tsx src/components/hoy/accion-turno-sheet.tsx src/components/calendario/calendario-semana.tsx
git commit -m "feat(ux): confirmar cancelar reserva y anular cobro"
```

---

### Task 4: Gate (lint + build) + QA + cierre

- [ ] **Step 1: Suite unitaria** — `cd frontend && pnpm test` → todo verde (no se agregan tests; los existentes deben seguir pasando).

- [ ] **Step 2: Lint** — `cd frontend && pnpm lint` → 0 errores.

- [ ] **Step 3: Build (obligatorio)** — `cd frontend && pnpm build` → OK.

- [ ] **Step 4: QA manual (viewport mobile, `pnpm dev`)**
  - Eliminar cancha (simple y divisible: el texto debe avisar que borra el grupo), eliminar usuario/bloqueo/turno fijo → abre el diálogo de marca (no el nativo).
  - Cancelar reserva (desde Reservas, Hoy y Calendario) y anular cobro (desde Cobros y Hoy) → pide confirmación nombrando cliente/monto.
  - "Volver", Escape, click afuera y la X → NO ejecutan la acción. Confirmar → ejecuta y muestra el toast de siempre.

- [ ] **Step 5: Commit si hubo ajustes de QA**

```bash
cd frontend && git add -A && git commit -m "fix(ux): ajustes de QA confirmaciones"
```

- [ ] **Step 6: Cerrar la rama.** Anunciar e invocar **superpowers:finishing-a-development-branch** → merge a `master` local (sin push salvo indicación).

---

## Notas
- Solo frontend, aditivo. No se tocan server actions ni backend.
- El diálogo es uno solo (compartido por contexto); no hay estado de diálogo duplicado en las tablas.
- En `calendario` y `accion-turno-sheet` el diálogo de confirmación aparece sobre otro diálogo/hoja abierto; Base UI maneja el apilado por portales.

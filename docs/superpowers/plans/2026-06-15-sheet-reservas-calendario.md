# Hoja de acción en Reservas y Calendario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reusar la hoja de acción de Hoy en Reservas y Calendario: tocar el bloque de una reserva abre la hoja (cobros + estado + reprogramar/cancelar), reemplazando el menú de 3 puntos (Reservas) y el Dialog propio (Calendario).

**Architecture:** Se mueve la hoja a `components/reservas/accion-reserva-sheet.tsx` (export `AccionReservaSheet`), se le agrega gating por estado, y se monta en `reservas-table.tsx`, `calendario-semana.tsx` y (renombrada) en `agenda-hoy.tsx`. Solo frontend, sin cambios de tipos ni backend.

**Tech Stack:** Next 16, React 19, Tailwind 4, Base UI, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-15-sheet-reservas-calendario-design.md`

**Gotchas:** Base UI `<button>` solo admite contenido en línea → en las tarjetas mobile usar `<span className="block">` (no `<div>`/`<p>`). Tras quitar el dropdown/Dialog, eliminar imports/vars que queden sin uso (lint los marca como error). `pnpm lint` + `pnpm build` obligatorios.

> Rama: `cd frontend && git checkout master && git checkout -b feat/sheet-reservas-calendario`.

---

## File Structure
- Move: `components/hoy/accion-turno-sheet.tsx` → `components/reservas/accion-reserva-sheet.tsx` (rename export a `AccionReservaSheet`, + gating por estado).
- Modify: `components/hoy/agenda-hoy.tsx` (actualizar import/uso).
- Rewrite: `components/reservas/reservas-table.tsx` (filas/tarjetas tocables, montar la hoja, sacar dropdown + CobrosDialog).
- Modify: `components/calendario/calendario-semana.tsx` (reemplazar Dialog de reserva por la hoja + limpiar imports sin uso).

---

### Task 1: Mover + renombrar + gatear la hoja; actualizar Hoy

**Files:**
- Move: `src/components/hoy/accion-turno-sheet.tsx` → `src/components/reservas/accion-reserva-sheet.tsx`
- Modify: `src/components/hoy/agenda-hoy.tsx`

- [ ] **Step 1: Mover el archivo (preserva historia)**

```bash
cd frontend
git mv src/components/hoy/accion-turno-sheet.tsx src/components/reservas/accion-reserva-sheet.tsx
```

- [ ] **Step 2: Renombrar el export** en `src/components/reservas/accion-reserva-sheet.tsx`:

Reemplazar:
```tsx
export function AccionTurnoSheet({
```
por:
```tsx
export function AccionReservaSheet({
```
(El resto del archivo no cambia de nombre; los imports internos son `@/...` absolutos, así que el cambio de carpeta no rompe nada.)

- [ ] **Step 3: Gatear el cobro express (rama CANCELADA)** en el mismo archivo. Reemplazar la línea:
```tsx
            ) : data.saldo > 0 ? (
```
por:
```tsx
            ) : reserva.estado === 'CANCELADA' ? (
              <div className="rounded-xl bg-neutral-100 py-4 text-center text-sm font-medium text-neutral-500">Reserva cancelada</div>
            ) : data.saldo > 0 ? (
```

- [ ] **Step 4: Gatear las acciones secundarias** (Reprogramar/Cancelar solo si CONFIRMADA/ESPERANDO_SENA). Reemplazar el bloque:
```tsx
            <div className="flex gap-2 border-t pt-3">
              <Button variant="outline" className="flex-1" disabled={pending} onClick={() => { handleOpenChange(false); onReprogramar(reserva.id); }}>
                Reprogramar
              </Button>
              <Button variant="ghost" className="flex-1 text-red-600" disabled={pending} onClick={async () => {
                if (await confirm({
                  title: '¿Cancelar la reserva?',
                  description: `Vas a cancelar la reserva de ${reserva.cliente?.nombre ?? 'el cliente'} (${fmtHora(reserva.fechaInicio)}). El cliente pierde el turno.`,
                  confirmLabel: 'Cancelar turno',
                  destructive: true,
                })) {
                  act(() => cancelarReserva(reserva.id), 'Reserva cancelada', true);
                }
              }}>
                Cancelar
              </Button>
            </div>
```
por (el mismo bloque envuelto en una condición):
```tsx
            {(reserva.estado === 'CONFIRMADA' || reserva.estado === 'ESPERANDO_SENA') && (
              <div className="flex gap-2 border-t pt-3">
                <Button variant="outline" className="flex-1" disabled={pending} onClick={() => { handleOpenChange(false); onReprogramar(reserva.id); }}>
                  Reprogramar
                </Button>
                <Button variant="ghost" className="flex-1 text-red-600" disabled={pending} onClick={async () => {
                  if (await confirm({
                    title: '¿Cancelar la reserva?',
                    description: `Vas a cancelar la reserva de ${reserva.cliente?.nombre ?? 'el cliente'} (${fmtHora(reserva.fechaInicio)}). El cliente pierde el turno.`,
                    confirmLabel: 'Cancelar turno',
                    destructive: true,
                  })) {
                    act(() => cancelarReserva(reserva.id), 'Reserva cancelada', true);
                  }
                }}>
                  Cancelar
                </Button>
              </div>
            )}
```

- [ ] **Step 5: Actualizar `agenda-hoy.tsx`.** En `src/components/hoy/agenda-hoy.tsx`:
  - Reemplazar el import `import { AccionTurnoSheet } from './accion-turno-sheet';` por `import { AccionReservaSheet } from '@/components/reservas/accion-reserva-sheet';`
  - Reemplazar el uso JSX `<AccionTurnoSheet` por `<AccionReservaSheet` (mantener las mismas props).

- [ ] **Step 6: Typecheck** — `cd frontend && pnpm exec tsc --noEmit` → 0 errores.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(ux): mover AccionTurnoSheet a reservas/AccionReservaSheet + gating por estado"
```

---

### Task 2: Reservas — tocar la fila abre la hoja

**Files:**
- Rewrite: `src/components/reservas/reservas-table.tsx`

- [ ] **Step 1: Reemplazar TODO el contenido de `src/components/reservas/reservas-table.tsx`** por:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EstadoBadge } from '@/components/estado-badge';
import { fmtFechaHora } from '@/lib/fecha';
import type { Reserva } from '@/lib/types';
import { AccionReservaSheet } from '@/components/reservas/accion-reserva-sheet';
import { ReprogramarDialog } from './reprogramar-dialog';

const money = (n: number | null) => (n == null ? '—' : '$' + Number(n).toLocaleString('es-AR'));

export function ReservasTable({ reservas }: { reservas: Reserva[] }) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Reserva | null>(null);
  const [reprogramarId, setReprogramarId] = useState<string | null>(null);

  if (reservas.length === 0) return <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-500">No hay reservas para este filtro.</p>;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Cliente</TableHead><TableHead>Cancha</TableHead><TableHead>Fecha/Hora</TableHead><TableHead>Estado</TableHead><TableHead>Seña</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {reservas.map((r) => (
              <TableRow key={r.id} onClick={() => setSeleccion(r)} className="cursor-pointer hover:bg-neutral-50">
                <TableCell>{r.cliente?.nombre ?? '—'}<div className="text-xs text-neutral-400">{r.cliente?.whatsapp}</div></TableCell>
                <TableCell>{r.cancha?.nombre ?? '—'}</TableCell>
                <TableCell>{fmtFechaHora(r.fechaInicio)}</TableCell>
                <TableCell><EstadoBadge estado={r.estado} /></TableCell>
                <TableCell>{money(r.montoSena)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {reservas.map((r) => (
          <button key={r.id} type="button" onClick={() => setSeleccion(r)} className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]">
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{r.cliente?.nombre ?? '—'}</span>
                {r.cliente?.whatsapp && <span className="block text-xs text-neutral-400">{r.cliente.whatsapp}</span>}
              </span>
              <EstadoBadge estado={r.estado} />
            </span>
            <span className="mt-2 block space-y-1 text-sm text-neutral-600">
              <span className="block"><span className="text-xs text-neutral-400">Cancha</span> {r.cancha?.nombre ?? '—'}</span>
              <span className="block"><span className="text-xs text-neutral-400">Fecha/Hora</span> {fmtFechaHora(r.fechaInicio)}</span>
              <span className="block"><span className="text-xs text-neutral-400">Seña</span> {money(r.montoSena)}</span>
            </span>
          </button>
        ))}
      </div>

      <AccionReservaSheet
        reserva={seleccion}
        open={seleccion !== null}
        onOpenChange={(o) => { if (!o) setSeleccion(null); }}
        onReprogramar={(id) => setReprogramarId(id)}
      />
      <ReprogramarDialog
        id={reprogramarId}
        open={reprogramarId !== null}
        onOpenChange={(o) => { if (!o) { setReprogramarId(null); router.refresh(); } }}
      />
    </>
  );
}
```

(Saca el `DropdownMenu`/3 puntos, el `CobrosDialog`, el helper `act` y los imports de `reservas-actions` — todo eso ahora lo maneja la hoja. La columna de acciones del header se eliminó.)

- [ ] **Step 2: Typecheck + lint** — `cd frontend && pnpm exec tsc --noEmit && pnpm lint` → 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/reservas/reservas-table.tsx
git commit -m "feat(ux): tocar una reserva abre la hoja de accion (saca el menu de 3 puntos)"
```

---

### Task 3: Calendario — reemplazar el Dialog de reserva por la hoja

**Files:**
- Modify: `src/components/calendario/calendario-semana.tsx`

- [ ] **Step 1: Reemplazar el `Dialog` de reserva por la hoja.** Reemplazar el bloque completo que va desde el comentario `{/* Dialog reserva (con acciones) */}` hasta su `</Dialog>` de cierre (el `Dialog` con `open={!!selReserva}`, que incluye los botones Aprobar/Rechazar seña, Reprogramar y Cancelar) por:

```tsx
      {/* Hoja de acción de reserva (igual que en Hoy) */}
      <AccionReservaSheet
        reserva={selReserva}
        open={selReserva !== null}
        onOpenChange={(o) => { if (!o) setSelReserva(null); }}
        onReprogramar={(id) => setReprogId(id)}
      />
```

(NO tocar el `Dialog` de info de fijo/bloqueo —el de `selInfo`— ni el `ReprogramarDialog` del final.)

- [ ] **Step 2: Agregar el import** de la hoja, junto a los otros imports de `@/components`:
```tsx
import { AccionReservaSheet } from '@/components/reservas/accion-reserva-sheet';
```

- [ ] **Step 3: Eliminar imports y variables que quedaron sin uso** (al sacar el Dialog de reserva). En `calendario-semana.tsx`:
  - Del import de `@/components/ui/dialog`, quitar `Button`? — NO, `Button` viene de `@/components/ui/button` (import aparte): **eliminar** ese import `import { Button } from '@/components/ui/button';` (ya no se usa).
  - **Eliminar** el import `import { cancelarReserva, aprobarSena, rechazarSena } from '@/lib/reservas-actions';`
  - **Eliminar** el import `import { useConfirm } from '@/components/ui/confirm';`
  - **Eliminar** el import de `toast` (`import { toast } from 'sonner';`).
  - **Eliminar** la línea `const money = (n: number | null | undefined) => '$' + Number(n || 0).toLocaleString('es-AR');` (solo la usaba el Dialog de reserva).
  - **Eliminar** `const [pending, start] = useTransition();` y, del import de react, quitar `useTransition` (queda `import { useState } from 'react';`).
  - **Eliminar** `const confirm = useConfirm();`
  - **Eliminar** la función `act` completa (el `function act(...) { ... }`).
  - **Mantener:** `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter` (los usa el Dialog de fijo/bloqueo), `Link`, `useRouter`/`router` (lo usa el `ReprogramarDialog` al cerrar), `ReprogramarDialog`, `selReserva`/`setSelReserva`, `selInfo`/`setSelInfo`, `reprogId`/`setReprogId`, y todo lo de `@/lib/calendario`.

- [ ] **Step 4: Typecheck + lint** — `cd frontend && pnpm exec tsc --noEmit && pnpm lint` → 0 errores. (El lint confirma que no quedó ningún import/var sin usar. Si marca alguno, eliminarlo; si marca uno que SÍ se usa, no tocarlo.)

- [ ] **Step 5: Commit**

```bash
git add src/components/calendario/calendario-semana.tsx
git commit -m "feat(ux): calendario usa la hoja de accion de reserva (igual que Hoy)"
```

---

### Task 4: Gate (lint + build) + QA + cierre

- [ ] **Step 1: Tests** — `cd frontend && pnpm test` → verde (los existentes pasan).
- [ ] **Step 2: Lint** — `cd frontend && pnpm lint` → 0 errores.
- [ ] **Step 3: Build (obligatorio)** — `cd frontend && pnpm build` → OK.
- [ ] **Step 4: QA manual (`pnpm dev`, viewport mobile)**
  - **Reservas:** tocar una fila (desktop) y una tarjeta (mobile) abre la hoja con cobros; cobrar baja el saldo; Reprogramar y Cancelar funcionan; una reserva CANCELADA abre la hoja mostrando "Reserva cancelada" sin botones de cobro/cancelar; una COMPLETADA con saldo permite cobrar pero no muestra Reprogramar/Cancelar.
  - **Calendario:** tocar una reserva abre la misma hoja; un evento de turno fijo/bloqueo sigue abriendo el diálogo de info (solo lectura).
  - **Hoy:** sigue funcionando igual (no hay regresión por el rename).
- [ ] **Step 5: Commit si hubo ajustes de QA**

```bash
cd frontend && git add -A && git commit -m "fix(ux): ajustes de QA hoja reservas/calendario"
```

- [ ] **Step 6: Cerrar la rama.** Anunciar e invocar **superpowers:finishing-a-development-branch** → merge a `master` local (sin push salvo indicación).

---

## Notas
- Solo frontend. Depende del backend con `pagado`/`saldo` desplegado (igual que Hoy) para que el cobro express muestre montos reales.
- Pieza 2 (tablas de admin: canchas/usuarios/bloqueos/turnos fijos) = spec/plan aparte.

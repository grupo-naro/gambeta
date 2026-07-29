# Carga y errores consistentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skeleton de carga uniforme en todo el panel (un solo `(panel)/loading.tsx`) y un error boundary propio (`(panel)/error.tsx`) con "Reintentar", para que ninguna pantalla quede en blanco ni caiga en la pantalla de error cruda de Next.

**Architecture:** Next App Router usa el `loading.tsx`/`error.tsx` más cercano. Un `loading.tsx` y un `error.tsx` a nivel del grupo `(panel)` cubren todas las rutas hijas que no tengan el suyo. Solo frontend.

**Tech Stack:** Next 16, React 19, Tailwind 4, Base UI, pnpm. Reusa `@/components/ui/skeleton` y `@/components/ui/button`.

**Spec:** `docs/superpowers/specs/2026-06-15-carga-errores-panel-design.md`

**Gotchas:** `loading.tsx` es Server Component (sin `'use client'`); `error.tsx` DEBE ser `'use client'` y recibir `{ error, reset }`. Clases Tailwind estáticas. `pnpm lint` + `pnpm build` obligatorios.

> Rama: `cd frontend && git checkout master && git checkout -b feat/carga-errores-panel`.

---

## File Structure
- Create: `src/app/(panel)/loading.tsx` — skeleton default del panel.
- Create: `src/app/(panel)/error.tsx` — error boundary del panel con Reintentar.
- Delete: `src/app/(panel)/reservas/loading.tsx`, `src/app/(panel)/canchas/loading.tsx` (genéricos, los cubre el default).
- Keep: `src/app/(panel)/hoy/loading.tsx` (a medida).

---

### Task 1: Skeleton default del panel + limpieza

**Files:**
- Create: `src/app/(panel)/loading.tsx`
- Delete: `src/app/(panel)/reservas/loading.tsx`, `src/app/(panel)/canchas/loading.tsx`

- [ ] **Step 1: Crear `src/app/(panel)/loading.tsx`**

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
```

- [ ] **Step 2: Borrar los dos `loading.tsx` genéricos**

```bash
cd frontend
git rm "src/app/(panel)/reservas/loading.tsx" "src/app/(panel)/canchas/loading.tsx"
```

- [ ] **Step 3: Verificar tipos**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(panel)/loading.tsx"
git commit -m "feat(ux): skeleton de carga default para todo el panel"
```

(El `git rm` del Step 2 ya quedó staged; este commit lo incluye junto con el nuevo loading.)

---

### Task 2: Error boundary del panel

**Files:**
- Create: `src/app/(panel)/error.tsx`

- [ ] **Step 1: Crear `src/app/(panel)/error.tsx`**

```tsx
'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">Se nos complicó cargar esto</h1>
        <p className="mt-2 text-sm text-neutral-500">Hubo un problema al traer la información. Probá de nuevo en un momento.</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={() => reset()}>Reintentar</Button>
          <a href="/hoy" className="text-sm text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline">Volver al inicio</a>
        </div>
      </div>
    </div>
  );
}
```

(No se muestra `error.message` crudo al usuario; solo va a `console.error` para debug. `reset()` re-renderiza el segmento, reintentando el fetch del Server Component.)

- [ ] **Step 2: Verificar tipos**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(panel)/error.tsx"
git commit -m "feat(ux): error boundary del panel con Reintentar"
```

---

### Task 3: Gate (lint + build) + QA + cierre

- [ ] **Step 1: Lint** — `cd frontend && pnpm lint` → 0 errores.
- [ ] **Step 2: Tests** — `cd frontend && pnpm test` → verde (no se agregan; los existentes pasan).
- [ ] **Step 3: Build (obligatorio)** — `cd frontend && pnpm build` → OK. (Confirmar que `/reservas` y `/canchas` siguen listadas como rutas; el borrado de sus `loading.tsx` no las afecta.)
- [ ] **Step 4: QA manual (`pnpm dev`)**
  - Navegar a varias pantallas (caja, usuarios, calendario, configuración…) y ver el skeleton uniforme mientras cargan.
  - Cortar el backend (o forzar un 500) y abrir una pantalla que hace fetch → aparece el error boundary "Se nos complicó cargar esto" con "Reintentar"; al volver el backend, "Reintentar" carga bien.
  - Confirmar que reservas/canchas muestran el skeleton del default y que Hoy sigue con el suyo.
- [ ] **Step 5: Commit si hubo ajustes de QA**

```bash
cd frontend && git add -A && git commit -m "fix(ux): ajustes de QA carga/errores"
```

- [ ] **Step 6: Cerrar la rama.** Anunciar e invocar **superpowers:finishing-a-development-branch** → merge a `master` local (sin push salvo indicación).

---

## Notas
- Solo frontend, mínimo y aditivo (salvo el borrado de 2 `loading.tsx` reemplazados por el default).
- `(panel)/error.tsx` no captura errores del propio `(panel)/layout.tsx` (fuera de alcance; el layout solo hace `getSession()` y redirige a `/login`).

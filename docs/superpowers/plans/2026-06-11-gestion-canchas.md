# Gestión de Canchas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage canchas from the admin panel — list, create, edit, activate/deactivate, and delete (real delete only when the cancha has no reservations; otherwise 409 → deactivate).

**Architecture:** Two parts. **Part 1 (backend):** new `DELETE /canchas/:id` that 409s if the cancha has reservations, else deletes (horarios cascade). **Part 2 (frontend):** a `/canchas` page (Server Components + Server Actions, BFF) mirroring the Reservas screen.

**Tech Stack:** Backend: Express 5 + TS + Prisma 7 + Zod + Vitest/Supertest/Testcontainers. Frontend: Next 16 app router + React 19 + Tailwind 4 + shadcn(Base UI) + Zod + Vitest, pnpm.

---

# PART 1 — Backend: `DELETE /canchas/:id`

**Branch:** `feat/cancha-delete` (from `main`, in `c:/Users/Lautaro/Desktop/ortigoza/backend`). Run a single test file with `npx vitest run tests/integration/cancha-delete.test.ts`; typecheck with `npx tsc --noEmit`. Docker Desktop must be running (Testcontainers).

**Context for the implementer:**
- `cancha.service.ts` exports `canchaService` with `get/list/create/update/setActiva`. `get(id)` throws `NotFound` (404) if missing. Source: `src/services/cancha.service.ts`.
- `cancha.repo.ts` exports `canchaRepo` with `list/findById/create/update` (no delete). `src/repositories/cancha.repo.ts`.
- `reserva.repo.ts` exports `reservaRepo`. Errors helpers in `src/utils/errors.ts`: `NotFound`, `Conflict` (Conflict → HTTP 409).
- Routes in `src/routes/cancha.routes.ts` (authJwt for mutations). Validation via `validate(schema)` where schema has `body/query/params`.
- `Reserva.canchaId` references `Cancha`; deleting a cancha with reservas violates the FK. `HorarioDisponible` has `onDelete: Cascade`, so a cancha's horarios are removed automatically on delete.

## Task B1: DELETE endpoint (TDD)

**Files:**
- Modify: `src/repositories/reserva.repo.ts` (add `countByCancha`)
- Modify: `src/repositories/cancha.repo.ts` (add `delete`)
- Modify: `src/services/cancha.service.ts` (add `eliminar`)
- Modify: `src/validators/cancha.schema.ts` (add `idCanchaParamSchema`)
- Modify: `src/routes/cancha.routes.ts` (add DELETE route)
- Test: `tests/integration/cancha-delete.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/cancha-delete.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const admin = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: admin.id, email: admin.email });
});

async function crearCancha() {
  return getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol5', precioHora: 12000 } });
}

describe('DELETE /canchas/:id', () => {
  it('deletes a cancha with no reservations', async () => {
    const c = await crearCancha();
    const res = await supertest(app).delete(`/canchas/${c.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await getPrisma().cancha.findUnique({ where: { id: c.id } })).toBeNull();
  });

  it('409 when the cancha has reservations', async () => {
    const c = await crearCancha();
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    const inicio = new Date(Date.now() + 72 * 3600_000);
    await getPrisma().reserva.create({
      data: { canchaId: c.id, clienteId: cliente.id, estado: 'CONFIRMADA', esContacto: true, monto: 12000, montoSena: null, fechaInicio: inicio, fechaFin: new Date(inicio.getTime() + 3600_000) },
    });
    const res = await supertest(app).delete(`/canchas/${c.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(await getPrisma().cancha.findUnique({ where: { id: c.id } })).not.toBeNull();
  });

  it('404 when the cancha does not exist', async () => {
    const res = await supertest(app).delete('/canchas/nope').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('401 without auth', async () => {
    const c = await crearCancha();
    const res = await supertest(app).delete(`/canchas/${c.id}`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/integration/cancha-delete.test.ts`
Expected: FAIL — DELETE route returns 404 (route not registered) for all cases.

- [ ] **Step 3: Add `countByCancha` to `reserva.repo.ts`**

In `src/repositories/reserva.repo.ts`, add to the `reservaRepo` object (e.g. after `list`):

```ts
  countByCancha: (canchaId: string) => prisma.reserva.count({ where: { canchaId } }),
```

- [ ] **Step 4: Add `delete` to `cancha.repo.ts`**

In `src/repositories/cancha.repo.ts`, add to `canchaRepo`:

```ts
  delete: (id: string) => prisma.cancha.delete({ where: { id } }),
```

- [ ] **Step 5: Add `eliminar` to `cancha.service.ts`**

Import `reservaRepo` and `Conflict`, then add the method. Top of file becomes:

```ts
import { canchaRepo } from '../repositories/cancha.repo.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { NotFound, Conflict } from '../utils/errors.js';
```

Add to `canchaService` (after `setActiva`):

```ts
  eliminar: async (id: string) => {
    await canchaService.get(id); // 404 if missing
    const reservas = await reservaRepo.countByCancha(id);
    if (reservas > 0) throw Conflict('La cancha tiene reservas; desactivala en vez de eliminarla');
    await canchaRepo.delete(id);
    return { ok: true };
  },
```

- [ ] **Step 6: Add `idCanchaParamSchema` to `cancha.schema.ts`**

In `src/validators/cancha.schema.ts`, add:

```ts
export const idCanchaParamSchema = z.object({
  body: z.unknown(),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 7: Add the DELETE route**

In `src/routes/cancha.routes.ts`: add `idCanchaParamSchema` to the import from `../validators/cancha.schema.js`, then add (after the `/:id/activa` route):

```ts
canchaRoutes.delete('/:id', authJwt, validate(idCanchaParamSchema), async (req, res, next) => {
  try { res.json(await canchaService.eliminar(String(req.params.id))); } catch (e) { next(e); }
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/integration/cancha-delete.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all green, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/repositories/reserva.repo.ts src/repositories/cancha.repo.ts src/services/cancha.service.ts src/validators/cancha.schema.ts src/routes/cancha.routes.ts tests/integration/cancha-delete.test.ts
git commit -m "feat(canchas): DELETE /canchas/:id (409 si tiene reservas)"
```

## Part 1 completion

- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verify, merge `feat/cancha-delete` → `main`, push (deploy). The frontend (Part 2) needs this deployed to actually delete against the live backend, but Part 2 can be built/typechecked without it.

---

# PART 2 — Frontend: pantalla `/canchas`

**Branch:** `feat/canchas-admin` (from `master`, in `c:/Users/Lautaro/Desktop/ortigoza/frontend`). Commands: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec vitest run`, `API_URL=http://localhost:3000 pnpm build`.

**Context for the implementer:**
- BFF helpers: `apiFetch` in `src/lib/api.ts` (server-only, reads cookie, throws `ApiError`/`ApiAuthError`). `Cancha` type already in `src/lib/types.ts` (`{ id, nombre, tipo, precioHora, activa }`).
- Mirror the Reservas implementation: `src/lib/reservas-actions.ts` (Server Actions with a local `run()` helper + `revalidatePath`), `src/components/reservas/reservas-table.tsx` (client table + Base UI dropdown using `render={<Button/>}`, NOT `asChild`), `src/components/reservas/nueva-reserva-dialog.tsx` (client dialog with `useTransition`, Zod validate, toast). **Server-action modules (`'use server'`) must export ONLY `async function`s.**
- `precioHora` may arrive as a string (Prisma Decimal serialized) — coerce with `Number()` for display and in the Zod schema.
- shadcn UI components live under `src/components/ui/` (button, input, label, dialog, select, table, badge, dropdown-menu, card, sonner). Base UI dropdown/dialog triggers use the `render` prop.

## Task F1: `canchaSchema` validator (TDD)

**Files:**
- Modify: `src/lib/validators.ts`
- Test: `src/lib/validators.test.ts` (append)

- [ ] **Step 1: Append failing test to `src/lib/validators.test.ts`**

```ts
import { canchaSchema } from '@/lib/validators';

describe('canchaSchema', () => {
  it('accepts a valid cancha and coerces precioHora', () => {
    const r = canchaSchema.safeParse({ nombre: 'Cancha 1', tipo: 'futbol5', precioHora: '12000' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.precioHora).toBe(12000);
  });
  it('rejects empty nombre and non-positive precio', () => {
    expect(canchaSchema.safeParse({ nombre: '', tipo: 'futbol5', precioHora: '12000' }).success).toBe(false);
    expect(canchaSchema.safeParse({ nombre: 'X', tipo: 'futbol5', precioHora: '0' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm exec vitest run src/lib/validators.test.ts`
Expected: FAIL — `canchaSchema` not exported.

- [ ] **Step 3: Add `canchaSchema` to `src/lib/validators.ts`**

```ts
export const canchaSchema = z.object({
  nombre: z.string().min(1, 'Ingresá el nombre'),
  tipo: z.string().min(1, 'Elegí el tipo'),
  precioHora: z.coerce.number().positive('El precio debe ser mayor a 0'),
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run src/lib/validators.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validators.ts src/lib/validators.test.ts
git commit -m "feat(canchas): canchaSchema validator"
```

## Task F2: Server Actions

**Files:**
- Create: `src/lib/canchas-actions.ts`

- [ ] **Step 1: Create `src/lib/canchas-actions.ts`**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/canchas'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

type CanchaInput = { nombre: string; tipo: string; precioHora: number };

export async function crearCancha(input: CanchaInput): Promise<Result> {
  return run(() => apiFetch('/canchas', { method: 'POST', body: JSON.stringify(input) }));
}

export async function editarCancha(id: string, input: CanchaInput): Promise<Result> {
  return run(() => apiFetch(`/canchas/${id}`, { method: 'PATCH', body: JSON.stringify(input) }));
}

export async function setActivaCancha(id: string, activa: boolean): Promise<Result> {
  return run(() => apiFetch(`/canchas/${id}/activa`, { method: 'PATCH', body: JSON.stringify({ activa }) }));
}

export async function eliminarCancha(id: string): Promise<Result> {
  return run(() => apiFetch(`/canchas/${id}`, { method: 'DELETE' }));
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
```bash
git add src/lib/canchas-actions.ts
git commit -m "feat(canchas): server actions (crear/editar/setActiva/eliminar)"
```

## Task F3: Cancha dialog (create/edit) + table

**Files:**
- Create: `src/components/canchas/cancha-dialog.tsx`
- Create: `src/components/canchas/canchas-table.tsx`

- [ ] **Step 1: Create `src/components/canchas/cancha-dialog.tsx`**

Reusable for create and edit. Controlled `open`. `cancha` prop null → create mode.

```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Cancha } from '@/lib/types';
import { canchaSchema } from '@/lib/validators';
import { crearCancha, editarCancha } from '@/lib/canchas-actions';

const TIPOS = [
  { value: 'futbol5', label: 'Fútbol 5' },
  { value: 'futbol7', label: 'Fútbol 7' },
  { value: 'futbol11', label: 'Fútbol 11' },
  { value: 'otro', label: 'Otro' },
];

export function CanchaDialog({ open, onOpenChange, cancha }: { open: boolean; onOpenChange: (o: boolean) => void; cancha: Cancha | null }) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('futbol5');
  const [precio, setPrecio] = useState('');
  const [pending, start] = useTransition();
  const editing = !!cancha;

  useEffect(() => {
    if (open) {
      setNombre(cancha?.nombre ?? '');
      setTipo(cancha ? (TIPOS.some((t) => t.value === cancha.tipo) ? cancha.tipo : 'otro') : 'futbol5');
      setPrecio(cancha ? String(Number(cancha.precioHora)) : '');
    }
  }, [open, cancha]);

  function submit() {
    const parsed = canchaSchema.safeParse({ nombre, tipo, precioHora: precio });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = editing ? await editarCancha(cancha!.id, parsed.data) : await crearCancha(parsed.data);
      if (r.ok) { toast.success(editing ? 'Cancha actualizada' : 'Cancha creada'); onOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Editar cancha' : 'Nueva cancha'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="c-nombre">Nombre</Label>
            <Input id="c-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cancha 1" />
          </div>
          <div className="space-y-1"><Label htmlFor="c-tipo">Tipo</Label>
            <select id="c-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label htmlFor="c-precio">Precio por hora</Label>
            <Input id="c-precio" type="number" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="12000" />
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : (editing ? 'Guardar' : 'Crear cancha')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `src/components/canchas/canchas-table.tsx`**

Client table with the "Nueva cancha" button, the shared dialog (create + edit via `editing` state), and per-row actions.

```tsx
'use client';
import { useState, useTransition } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Cancha } from '@/lib/types';
import { CanchaDialog } from './cancha-dialog';
import { setActivaCancha, eliminarCancha } from '@/lib/canchas-actions';

const money = (n: number | string) => '$' + Number(n || 0).toLocaleString('es-AR');

export function CanchasTable({ canchas }: { canchas: Cancha[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Cancha | null>(null);
  const [pending, start] = useTransition();

  function nueva() { setEditing(null); setDialogOpen(true); }
  function editar(c: Cancha) { setEditing(c); setDialogOpen(true); }
  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    start(async () => { const r = await fn(); r.ok ? toast.success(okMsg) : toast.error(r.error ?? 'Error'); });
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Canchas</h1>
          <p className="mt-1 text-sm text-neutral-500">Administrá las canchas del complejo.</p>
        </div>
        <Button onClick={nueva}><Plus className="mr-1 h-4 w-4" /> Nueva cancha</Button>
      </div>

      {canchas.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-500">No hay canchas todavía.</p>
      ) : (
        <div className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Precio/hora</TableHead><TableHead>Estado</TableHead><TableHead className="w-10" /></TableRow>
            </TableHeader>
            <TableBody>
              {canchas.map((c) => (
                <TableRow key={c.id} className={c.activa ? '' : 'opacity-55'}>
                  <TableCell className="font-medium">{c.nombre}</TableCell>
                  <TableCell className="text-neutral-500">{c.tipo}</TableCell>
                  <TableCell>{money(c.precioHora)}</TableCell>
                  <TableCell>
                    {c.activa
                      ? <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">Activa</Badge>
                      : <Badge variant="secondary" className="bg-neutral-200 text-neutral-600 hover:bg-neutral-200">Inactiva</Badge>}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" disabled={pending}><MoreHorizontal className="h-4 w-4" /></Button>} />
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => editar(c)}>Editar</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => act(() => setActivaCancha(c.id, !c.activa), c.activa ? 'Cancha desactivada' : 'Cancha activada')}>
                          {c.activa ? 'Desactivar' : 'Activar'}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => { if (confirm(`¿Eliminar ${c.nombre}?`)) act(() => eliminarCancha(c.id), 'Cancha eliminada'); }}>
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CanchaDialog open={dialogOpen} onOpenChange={setDialogOpen} cancha={editing} />
    </>
  );
}
```

NOTE on the dropdown trigger/menu-item API: match the EXACT props used in `src/components/reservas/reservas-table.tsx` (this project's Base-UI shadcn build). If that file uses `onSelect` instead of `onClick`, or a different trigger prop than `render`, mirror it here. Read it first and copy the working pattern.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (will warn about the page not existing yet — fine)
```bash
git add src/components/canchas/cancha-dialog.tsx src/components/canchas/canchas-table.tsx
git commit -m "feat(canchas): tabla + dialog crear/editar + acciones de fila"
```

## Task F4: Page, loading, nav item

**Files:**
- Create: `src/app/(panel)/canchas/page.tsx`
- Create: `src/app/(panel)/canchas/loading.tsx`
- Modify: `src/components/app-shell.tsx` (add nav item)

- [ ] **Step 1: Create `src/app/(panel)/canchas/page.tsx`**

```tsx
import { apiFetch } from '@/lib/api';
import type { Cancha } from '@/lib/types';
import { CanchasTable } from '@/components/canchas/canchas-table';

export default async function CanchasPage() {
  const canchas = await apiFetch<Cancha[]>('/canchas');
  return <CanchasTable canchas={canchas} />;
}
```

- [ ] **Step 2: Create `src/app/(panel)/canchas/loading.tsx`**

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```

- [ ] **Step 3: Add the nav item in `src/components/app-shell.tsx`**

In the `nav` array, add a Canchas entry. Update the import to include the icon. Change:

```tsx
import { LayoutDashboard, CalendarDays, LogOut } from 'lucide-react';
```
to:
```tsx
import { LayoutDashboard, CalendarDays, LandPlot, LogOut } from 'lucide-react';
```
and:
```tsx
const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/reservas', label: 'Reservas', icon: CalendarDays },
  { href: '/canchas', label: 'Canchas', icon: LandPlot },
];
```

- [ ] **Step 4: Full verification**

Run: `pnpm exec tsc --noEmit` then `pnpm lint` then `pnpm exec vitest run` then `API_URL=http://localhost:3000 pnpm build`
Expected: all green; build succeeds and lists `/canchas` as a route. (The build does not render dynamic pages, so also do the manual smoke in Step 5.)

- [ ] **Step 5: Manual smoke (recommended)**

`pnpm dev` with `API_URL` pointing to the backend that has Part 1 deployed; log in, open Canchas, create one, edit it, deactivate/activate, and delete one with no reservations (and confirm a cancha with reservations shows the 409 toast).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(panel)/canchas/page.tsx" "src/app/(panel)/canchas/loading.tsx" src/components/app-shell.tsx
git commit -m "feat(canchas): página /canchas + loading + nav item"
```

## Part 2 completion

- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verify (`tsc`/`lint`/`vitest`/`build`), merge `feat/canchas-admin` → `master`.

---

## Out of scope
Clientes, Config de seña (resto de Fase 2); gestión de horarios por cancha; hard delete de canchas con reservas (bloqueado con 409 a propósito).

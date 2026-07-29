# Clientes de confianza (seña desde la DB) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El backend decide la seña: un cliente es "de confianza" (reserva sin seña) si está marcado `confiable` o tiene ≥2 reservas cumplidas. Panel `/clientes` para listar, marcar confianza, editar nombre y alta manual.

**Architecture:** Backend: columna `Cliente.confiable`, `reserva.crear` calcula confianza, endpoints de panel. Frontend: pantalla `/clientes` (tabla + hoja de acción + diálogo de alta). Bot: sin cambios.

**Tech Stack:** Backend Node/Express/Prisma 7/Zod, Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 + Base UI + pnpm.

**Spec:** `docs/superpowers/specs/2026-06-16-clientes-confianza-design.md`

**Gotchas:** tests aplican `prisma migrate deploy` → migración como archivo; tras editar schema `npx prisma generate`. Imports `.js`. Server actions = `async function`. Tailwind estático. `pnpm lint`+`pnpm build` obligatorios.

> Ramas: backend `feat/clientes-confianza` (de `main`); frontend `feat/clientes-panel` (de `master`).

---

# BACKEND — rama `feat/clientes-confianza`

> `cd backend && git checkout main && git pull && git checkout -b feat/clientes-confianza`. Docker para tests.

### Task 1: Migración `Cliente.confiable`

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20260616190000_add_confiable_cliente/migration.sql`.

- [ ] **Step 1:** En `model Cliente` agregar (debajo de `nombreConfirmado`):
```prisma
  confiable        Boolean   @default(false)
```
- [ ] **Step 2:** Crear `prisma/migrations/20260616190000_add_confiable_cliente/migration.sql`:
```sql
-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "confiable" BOOLEAN NOT NULL DEFAULT false;
```
- [ ] **Step 3:** `cd backend && npx prisma generate` (regenera el client con `confiable`).
- [ ] **Step 4:** Commit:
```bash
git add prisma/schema.prisma prisma/migrations/20260616190000_add_confiable_cliente/
git commit -m "feat(cliente): columna confiable"
```

### Task 2: Decisión de seña en `reserva.crear` (TDD)

**Files:** Modify `src/repositories/reserva.repo.ts`, `src/services/reserva.service.ts`. Test: `tests/integration/clientes-confianza.test.ts` (crear).

- [ ] **Step 1: Test que falla.** Crear `tests/integration/clientes-confianza.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id; });

const admin = () => signAdminToken({ adminId: 'a', email: 'a@b.com', rol: 'ADMIN' });
const fechaFutura = (d = 7) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const reservar = (over: Record<string, unknown> = {}) =>
  supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp: '+5491150000010', nombreCliente: 'Ana', esContacto: false,
    fecha: fechaFutura(), horaInicio: '18:00', ...over,
  });
// crea reservas CUMPLIDAS (CONFIRMADA) directas en la DB para el mismo cliente
async function cumplidas(n: number) {
  const cl = await getPrisma().cliente.upsert({ where: { whatsapp: '+5491150000010' }, create: { whatsapp: '+5491150000010', nombre: 'Ana' }, update: {} });
  for (let i = 0; i < n; i++) {
    await getPrisma().reserva.create({ data: { canchaId, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: false, monto: 10000, fechaInicio: new Date(Date.now() - (i + 1) * 86400000), fechaFin: new Date(Date.now() - (i + 1) * 86400000 + 3600000) } });
  }
  return cl;
}

describe('seña desde la DB (clientes de confianza)', () => {
  it('cliente nuevo → ESPERANDO_SENA', async () => {
    const r = await reservar();
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('ESPERANDO_SENA');
  });
  it('cliente con 2 reservas cumplidas → la siguiente CONFIRMADA (sin seña)', async () => {
    await cumplidas(2);
    const r = await reservar();
    expect(r.body.estado).toBe('CONFIRMADA');
    expect(r.body.montoSena == null || r.body.montoSena === 0).toBe(true);
  });
  it('cliente con 1 cumplida → ESPERANDO_SENA', async () => {
    await cumplidas(1);
    const r = await reservar();
    expect(r.body.estado).toBe('ESPERANDO_SENA');
  });
  it('cliente marcado confiable → CONFIRMADA aunque no tenga cumplidas', async () => {
    await getPrisma().cliente.create({ data: { whatsapp: '+5491150000011', nombre: 'Beto', confiable: true } });
    const r = await reservar({ whatsapp: '+5491150000011', nombreCliente: 'Beto' });
    expect(r.body.estado).toBe('CONFIRMADA');
  });
});
```

- [ ] **Step 2: Correr → FALLA.** `cd backend && npx vitest run tests/integration/clientes-confianza.test.ts` → FAIL (hoy depende de esContacto:false → todas ESPERANDO_SENA; el caso confiable y el de 2 cumplidas fallan).

- [ ] **Step 3: Implementar.**

En `src/repositories/reserva.repo.ts`, agregar al objeto `reservaRepo`:
```typescript
  contarCumplidasPorCliente: (clienteId: string) =>
    prisma.reserva.count({ where: { clienteId, estado: { in: ['CONFIRMADA', 'COMPLETADA'] } } }),
  cumplidasPorCliente: async () => {
    const rows = await prisma.reserva.groupBy({ by: ['clienteId'], where: { estado: { in: ['CONFIRMADA', 'COMPLETADA'] } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.clienteId, r._count._all]));
  },
```

En `src/services/reserva.service.ts`, dentro de `crear`, reemplazar la línea:
```typescript
    const estado: EstadoReserva = input.esContacto ? 'CONFIRMADA' : 'ESPERANDO_SENA';
```
por:
```typescript
    const clientePrevio = await prisma.cliente.findUnique({ where: { whatsapp: input.whatsapp } });
    const confianza = input.esContacto || (!!clientePrevio && (clientePrevio.confiable || (await reservaRepo.contarCumplidasPorCliente(clientePrevio.id)) >= 2));
    const estado: EstadoReserva = confianza ? 'CONFIRMADA' : 'ESPERANDO_SENA';
```
(Se mantiene `input.esContacto` como OR para no romper el contrato existente —tests y otros callers que mandan `esContacto:true` → CONFIRMADA—; en producción el bot y el panel mandan `esContacto:false`, así que la confianza desde la DB es la que decide. El resto queda igual: `montoSena` solo se calcula en ESPERANDO_SENA; el upsert del cliente con `nombreConfirmado` no cambia.)

- [ ] **Step 4: Correr → PASA.** `npx vitest run tests/integration/clientes-confianza.test.ts` → 4 passing.
- [ ] **Step 5: Regresión.** `npx vitest run tests/integration/reserva.routes.test.ts tests/integration/cliente-nombre.test.ts` → PASS. (NO incluir `sena.test.ts`: tiene 3 fallos **pre-existentes** por una fecha hardcodeada `2026-06-15` ya pasada — no es de este cambio; se verificó en baseline.)
- [ ] **Step 6: Commit:**
```bash
git add src/repositories/reserva.repo.ts src/services/reserva.service.ts tests/integration/clientes-confianza.test.ts
git commit -m "feat(reservas): decidir sena por confianza del cliente (confiable o >=2 cumplidas)"
```

### Task 3: Endpoints del panel (TDD)

**Files:** Modify `src/repositories/cliente.repo.ts`, `src/services/cliente.service.ts`, `src/validators/cliente.schema.ts`, `src/routes/cliente.routes.ts`. Test: agregar a `tests/integration/clientes-confianza.test.ts`.

- [ ] **Step 1: Agregar tests que fallan.** Al final de `tests/integration/clientes-confianza.test.ts`:
```typescript
describe('panel: GET /clientes + PATCH /clientes/:id', () => {
  it('GET /clientes devuelve cumplidas y confianza', async () => {
    const cl = await cumplidas(2);
    const r = await supertest(app).get('/clientes').set('authorization', `Bearer ${admin()}`);
    expect(r.status).toBe(200);
    const item = (r.body as any[]).find((c) => c.id === cl.id);
    expect(item.cumplidas).toBe(2);
    expect(item.confianza).toBe(true);
  });
  it('PATCH /clientes/:id actualiza confiable y nombre', async () => {
    const cl = await getPrisma().cliente.create({ data: { whatsapp: '+5491150000012', nombre: 'Caro' } });
    const r = await supertest(app).patch('/clientes/' + cl.id).set('authorization', `Bearer ${admin()}`).send({ confiable: true, nombre: 'Carolina' });
    expect(r.status).toBe(200);
    const after = await getPrisma().cliente.findUnique({ where: { id: cl.id } });
    expect(after!.confiable).toBe(true);
    expect(after!.nombre).toBe('Carolina');
    expect(after!.nombreConfirmado).toBe(true);
  });
  it('PATCH /clientes/:id inexistente → 404', async () => {
    const r = await supertest(app).patch('/clientes/noexiste').set('authorization', `Bearer ${admin()}`).send({ confiable: true });
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Correr → FALLA.** `npx vitest run tests/integration/clientes-confianza.test.ts` → los 3 nuevos fallan.

- [ ] **Step 3: Implementar.**

`src/repositories/cliente.repo.ts` — reemplazar el objeto por:
```typescript
import { prisma } from '../db/prisma.js';

export interface UpsertClienteInput { whatsapp: string; nombre: string; esContacto?: boolean; confiable?: boolean; nombreConfirmado?: boolean }

export const clienteRepo = {
  list: () => prisma.cliente.findMany({ orderBy: { creadoEn: 'desc' } }),
  findById: (id: string) => prisma.cliente.findUnique({ where: { id }, include: { reservas: true } }),
  findByWhatsapp: (whatsapp: string) => prisma.cliente.findUnique({ where: { whatsapp } }),
  update: (id: string, data: { nombre?: string; confiable?: boolean; nombreConfirmado?: boolean }) =>
    prisma.cliente.update({ where: { id }, data }),
  upsert: (i: UpsertClienteInput) =>
    prisma.cliente.upsert({
      where: { whatsapp: i.whatsapp },
      create: { whatsapp: i.whatsapp, nombre: i.nombre, esContacto: i.esContacto ?? false, confiable: i.confiable ?? false, nombreConfirmado: i.nombreConfirmado ?? false },
      update: {
        nombre: i.nombre,
        esContacto: i.esContacto ?? false,
        ...(i.confiable !== undefined ? { confiable: i.confiable } : {}),
        ...(i.nombreConfirmado ? { nombreConfirmado: true } : {}),
      },
    }),
};
```

`src/services/cliente.service.ts` — reemplazar por:
```typescript
import { clienteRepo, type UpsertClienteInput } from '../repositories/cliente.repo.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { NotFound } from '../utils/errors.js';

export const clienteService = {
  list: async () => {
    const [cs, counts] = await Promise.all([clienteRepo.list(), reservaRepo.cumplidasPorCliente()]);
    return cs.map((c) => {
      const cumplidas = counts.get(c.id) ?? 0;
      return { ...c, cumplidas, confianza: c.confiable || cumplidas >= 2 };
    });
  },
  get: async (id: string) => {
    const c = await clienteRepo.findById(id);
    if (!c) throw NotFound('Cliente', id);
    return c;
  },
  upsert: (input: UpsertClienteInput) => clienteRepo.upsert(input),
  editar: async (id: string, data: { nombre?: string; confiable?: boolean }) => {
    const c = await clienteRepo.findById(id);
    if (!c) throw NotFound('Cliente', id);
    const patch: { nombre?: string; confiable?: boolean; nombreConfirmado?: boolean } = {};
    if (data.nombre !== undefined) { patch.nombre = data.nombre; patch.nombreConfirmado = true; }
    if (data.confiable !== undefined) patch.confiable = data.confiable;
    return clienteRepo.update(id, patch);
  },
  buscarPorWhatsapp: async (whatsapp: string) => {
    const c = await clienteRepo.findByWhatsapp(whatsapp);
    return c ? { id: c.id, nombre: c.nombre, nombreConfirmado: c.nombreConfirmado } : null;
  },
};
```

`src/validators/cliente.schema.ts` — reemplazar por:
```typescript
import { z } from 'zod';
const empty = z.looseObject({});

export const upsertClienteSchema = z.object({
  body: z.object({
    whatsapp: z.string().min(5),
    nombre: z.string().min(1),
    esContacto: z.boolean().default(false),
    confiable: z.boolean().default(false),
    nombreConfirmado: z.boolean().optional(),
  }),
  query: empty, params: empty,
});

export const buscarClienteSchema = z.object({
  body: z.unknown(),
  query: z.object({ whatsapp: z.string().min(1) }),
  params: empty,
});

export const editarClienteSchema = z.object({
  body: z.object({ nombre: z.string().min(1).optional(), confiable: z.boolean().optional() }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
```

`src/routes/cliente.routes.ts` — reemplazar por:
```typescript
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { authAny } from '../middlewares/authAny.js';
import { clienteService } from '../services/cliente.service.js';
import { upsertClienteSchema, buscarClienteSchema, editarClienteSchema } from '../validators/cliente.schema.js';

export const clienteRoutes = Router();

clienteRoutes.get('/', authJwt, async (_req, res, next) => {
  try { res.json(await clienteService.list()); } catch (e) { next(e); }
});
clienteRoutes.get('/buscar', authAny, validate(buscarClienteSchema), async (req, res, next) => {
  try { res.json(await clienteService.buscarPorWhatsapp(String((req as any).valid.query.whatsapp))); } catch (e) { next(e); }
});
clienteRoutes.get('/:id', authJwt, async (req, res, next) => {
  try { res.json(await clienteService.get(String(req.params.id))); } catch (e) { next(e); }
});
clienteRoutes.post('/', authAny, validate(upsertClienteSchema), async (req, res, next) => {
  try { res.json(await clienteService.upsert((req as any).valid.body)); } catch (e) { next(e); }
});
clienteRoutes.patch('/:id', authJwt, validate(editarClienteSchema), async (req, res, next) => {
  try { res.json(await clienteService.editar(String(req.params.id), (req as any).valid.body)); } catch (e) { next(e); }
});
```

- [ ] **Step 4: Correr → PASA.** `npx vitest run tests/integration/clientes-confianza.test.ts tests/integration/cliente.routes.test.ts cliente-nombre.test.ts` → todo verde.
- [ ] **Step 5:** `npx tsc --noEmit` → 0 errores.
- [ ] **Step 6: Commit:**
```bash
git add src/repositories/cliente.repo.ts src/services/cliente.service.ts src/validators/cliente.schema.ts src/routes/cliente.routes.ts tests/integration/clientes-confianza.test.ts
git commit -m "feat(clientes): GET con confianza, PATCH editar confiable/nombre, upsert con confiable"
```

### Cierre backend
- [ ] **Step 7:** **superpowers:finishing-a-development-branch** → merge `main` + push. Deploy VM (usuario): `git fetch && reset --hard origin/main && up -d --build && migrate deploy`.

---

# FRONTEND — rama `feat/clientes-panel`

> `cd frontend && git checkout master && git checkout -b feat/clientes-panel`.

### Task 4: tipos + actions + nav

**Files:** Modify `src/lib/types.ts`, `src/components/nav-items.ts`; Create `src/lib/clientes-actions.ts`.

- [ ] **Step 1: `types.ts`** — reemplazar la interface `Cliente`:
```typescript
export interface Cliente { id: string; nombre: string; whatsapp: string; confiable: boolean; totalReservas: number; cumplidas: number; confianza: boolean }
```
(Si `Cliente` se usa en otro lado esperando solo `{id,nombre,whatsapp}`, los campos extra son aditivos — no rompe.)

- [ ] **Step 2: `clientes-actions.ts`** (nuevo):
```tsx
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/clientes'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function editarConfianza(id: string, confiable: boolean): Promise<Result> {
  return run(() => apiFetch(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify({ confiable }) }));
}
export async function editarNombreCliente(id: string, nombre: string): Promise<Result> {
  return run(() => apiFetch(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify({ nombre }) }));
}
export async function crearCliente(input: { nombre: string; whatsapp: string; confiable: boolean }): Promise<Result> {
  return run(() => apiFetch('/clientes', { method: 'POST', body: JSON.stringify({ ...input, nombreConfirmado: true }) }));
}
```

- [ ] **Step 3: `nav-items.ts`** — agregar `Contact` al import de lucide-react, e insertar (en el grupo de administración, después de Usuarios):
```typescript
  { href: '/clientes', label: 'Clientes', icon: Contact, roles: AMBOS },
```

- [ ] **Step 4:** `pnpm exec tsc --noEmit` → 0 errores. Commit:
```bash
git add src/lib/types.ts src/lib/clientes-actions.ts src/components/nav-items.ts
git commit -m "feat(clientes): tipos, actions y nav item"
```

### Task 5: pantalla `/clientes`

**Files:** Create `src/app/(panel)/clientes/page.tsx`, `src/components/clientes/clientes-table.tsx`, `src/components/clientes/cliente-dialog.tsx`.

- [ ] **Step 1: `page.tsx`** (Server Component):
```tsx
import { apiFetch } from '@/lib/api';
import type { Cliente } from '@/lib/types';
import { ClientesTable } from '@/components/clientes/clientes-table';

export default async function ClientesPage() {
  const clientes = await apiFetch<Cliente[]>('/clientes');
  return <ClientesTable clientes={clientes} />;
}
```

- [ ] **Step 2: `clientes-table.tsx`** (client; tabla desktop + cards mobile + hoja de acción + diálogo de alta):
```tsx
'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { Cliente } from '@/lib/types';
import { ClienteDialog } from './cliente-dialog';
import { editarConfianza, editarNombreCliente } from '@/lib/clientes-actions';

export function ClientesTable({ clientes }: { clientes: Cliente[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seleccion, setSeleccion] = useState<Cliente | null>(null);
  const [nombre, setNombre] = useState('');
  const [pending, start] = useTransition();

  function abrir(c: Cliente) { setSeleccion(c); setNombre(c.nombre); }
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
          <p className="mt-1 text-sm text-neutral-500">Los de confianza reservan sin seña (también automático a las 3 reservas).</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo cliente</Button>
      </div>

      {clientes.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-500">No hay clientes todavía.</p>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nombre</TableHead><TableHead>WhatsApp</TableHead><TableHead>Reservas</TableHead><TableHead>Confianza</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {clientes.map((c) => (
                  <TableRow key={c.id} onClick={() => abrir(c)} className="cursor-pointer hover:bg-neutral-50">
                    <TableCell className="font-medium">{c.nombre}</TableCell>
                    <TableCell className="text-neutral-500">{c.whatsapp}</TableCell>
                    <TableCell className="text-neutral-600">{c.cumplidas}</TableCell>
                    <TableCell>{badge(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {clientes.map((c) => (
              <button key={c.id} type="button" onClick={() => abrir(c)} className="block w-full rounded-lg border bg-white p-3 text-left transition active:scale-[0.99]">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.nombre}</span>
                    <span className="block text-xs text-neutral-400">{c.whatsapp}</span>
                  </span>
                  {badge(c)}
                </span>
                <span className="mt-2 block text-sm text-neutral-600"><span className="text-xs text-neutral-400">Reservas</span> {c.cumplidas}</span>
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
              <p className="text-sm text-neutral-500">{seleccion.whatsapp} · {seleccion.cumplidas} reservas</p>
            </SheetHeader>
            <div className="space-y-1">
              <label htmlFor="cl-nombre" className="text-xs text-neutral-500">Nombre</label>
              <div className="flex gap-2">
                <Input id="cl-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                <Button variant="outline" disabled={pending || !nombre.trim() || nombre.trim() === seleccion.nombre} onClick={() => act(() => editarNombreCliente(seleccion.id, nombre.trim()), 'Nombre actualizado')}>Guardar</Button>
              </div>
            </div>
            <Button className="h-11 w-full" disabled={pending} onClick={() => act(() => editarConfianza(seleccion.id, !seleccion.confiable), seleccion.confiable ? 'Quitado de confianza' : 'Marcado de confianza', true)}>
              {seleccion.confiable ? 'Quitar de confianza' : 'Marcar de confianza'}
            </Button>
            {!seleccion.confiable && seleccion.confianza && (
              <p className="text-center text-xs text-neutral-400">Ya es de confianza por tener 2+ reservas cumplidas.</p>
            )}
          </SheetContent>
        )}
      </Sheet>

      <ClienteDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
```

- [ ] **Step 3: `cliente-dialog.tsx`** (alta manual):
```tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearCliente } from '@/lib/clientes-actions';

export function ClienteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [nombre, setNombre] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [confiable, setConfiable] = useState(false);
  const [pending, start] = useTransition();

  function handleOpenChange(next: boolean) {
    if (!next) { setNombre(''); setWhatsapp(''); setConfiable(false); }
    onOpenChange(next);
  }
  function submit() {
    if (nombre.trim().length < 1 || whatsapp.trim().length < 5) { toast.error('Completá nombre y WhatsApp'); return; }
    start(async () => {
      const r = await crearCliente({ nombre: nombre.trim(), whatsapp: whatsapp.trim(), confiable });
      if (r.ok) { toast.success('Cliente creado'); handleOpenChange(false); } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo cliente</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="ncl-nombre">Nombre</Label><Input id="ncl-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="ncl-wa">WhatsApp</Label><Input id="ncl-wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+54911..." /></div>
          <label className="flex items-center gap-2 pt-1 text-sm">
            <input type="checkbox" checked={confiable} onChange={(e) => setConfiable(e.target.checked)} className="h-4 w-4" />
            De confianza (reserva sin seña)
          </label>
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Creando…' : 'Crear cliente'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4:** `pnpm exec tsc --noEmit && pnpm lint` → 0 errores. Commit:
```bash
git add "src/app/(panel)/clientes" src/components/clientes
git commit -m "feat(clientes): pantalla /clientes (lista, confianza, editar, alta manual)"
```

### Task 6: Gate + cierre
- [ ] **Step 1:** `cd frontend && pnpm test` → verde.
- [ ] **Step 2:** `pnpm lint` → 0 errores.
- [ ] **Step 3:** `pnpm build` → OK.
- [ ] **Step 4: QA** (`pnpm dev`): /clientes lista clientes con badge; tocar abre la hoja; togglear confianza y editar nombre andan; "Nuevo cliente" crea uno; (con backend deployado) un cliente de confianza reserva sin seña.
- [ ] **Step 5:** **superpowers:finishing-a-development-branch** → merge a `master` local.

---

## Notas
- Bot: **sin cambios** (el backend decide el estado; el bot ya responde según CONFIRMADA/ESPERANDO_SENA). El stopgap `esContacto:false` queda inocuo.
- Orden: deployar el backend antes del QA real de la seña. Frontend `/clientes` necesita el backend (GET con confianza/cumplidas) — usar con el backend deployado.

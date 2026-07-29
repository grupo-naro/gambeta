# Pagos y caja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar cobros (efectivo/transferencia) por reserva con saldo, y una caja con totales por día/cancha/medio; la seña aprobada cuenta como cobro de transferencia.

**Architecture:** Nuevo modelo `Cobro` (libro de cobros). `cobro.service`/`caja.service` + endpoints. `aprobarSena` crea un cobro `SENA` en su transacción. Frontend: diálogo de cobros por reserva + pantalla `/caja` gateada por rol.

**Tech Stack:** Backend Node+Express 5+TS, Prisma 7 (`../db/client.js`), Zod 4, Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 + React 19 + Tailwind 4 + Base UI + pnpm.

**Ramas:** backend `feat/pagos-caja-backend`, frontend `feat/pagos-caja-panel`. Bot sin cambios.

**Verificado:** `Pago` (seña) no cambia. `aprobarSena` usa `prisma.$transaction` con `pagoRepo`/`reservaRepo`/`auditLogRepo` y tiene `r = reservaService.get(id)` (trae `monto`/`montoSena`). `auditService.log(req,{...})` existe. `requireRole` existe (NO se usa acá — endpoints para logueados). `getSession()` (front) trae rol.

---

## Parte A — Backend (rama `feat/pagos-caja-backend`)

### Task A0: Rama
- [ ] **Step 1**
```bash
cd c:/Users/Lautaro/Desktop/ortigoza/backend && git checkout main && git pull && git checkout -b feat/pagos-caja-backend
```

---

### Task A1: Modelo `Cobro` + `MedioPago` + migración
**Files:** `prisma/schema.prisma`, migración

- [ ] **Step 1: Schema** — agregar el enum (junto a los otros) y el modelo, y las relaciones inversas:
```prisma
enum MedioPago {
  EFECTIVO
  TRANSFERENCIA
}

model Cobro {
  id              String     @id @default(cuid())
  reservaId       String
  reserva         Reserva    @relation(fields: [reservaId], references: [id], onDelete: Cascade)
  monto           Decimal    @db.Decimal(10, 2)
  medio           MedioPago
  origen          String     @default("MANUAL")
  registradoPorId String?
  registradoPor   AdminUser? @relation(fields: [registradoPorId], references: [id])
  creadoEn        DateTime   @default(now())

  @@index([creadoEn])
  @@index([reservaId])
}
```
En `model Reserva` agregar `cobros Cobro[]`. En `model AdminUser` agregar `cobros Cobro[]`.

- [ ] **Step 2: Migración**
```bash
npx prisma migrate dev --name add_cobros
```
Expected: `CREATE TYPE "MedioPago"` + `CREATE TABLE "Cobro"` + índices.

- [ ] **Step 3: tsc + commit**
```bash
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations && git commit -m "feat(caja): modelo Cobro + enum MedioPago"
```

---

### Task A2: repo + cobro.service + caja.service
**Files:** Create `src/repositories/cobro.repo.ts`, `src/services/cobro.service.ts`, `src/services/caja.service.ts`

- [ ] **Step 1: cobro.repo**

Crear `src/repositories/cobro.repo.ts`:
```ts
import { Prisma } from '../db/client.js';
import { prisma } from '../db/prisma.js';

export const cobroRepo = {
  create: (data: Prisma.CobroUncheckedCreateInput, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).cobro.create({ data }),
  listByReserva: (reservaId: string) =>
    prisma.cobro.findMany({ where: { reservaId }, orderBy: { creadoEn: 'asc' }, include: { registradoPor: { select: { nombre: true } } } }),
  findById: (id: string) => prisma.cobro.findUnique({ where: { id } }),
  remove: (id: string) => prisma.cobro.delete({ where: { id } }),
  sumByReserva: async (reservaId: string) => {
    const r = await prisma.cobro.aggregate({ where: { reservaId }, _sum: { monto: true } });
    return Number(r._sum.monto ?? 0);
  },
  listRange: (start: Date, end: Date) =>
    prisma.cobro.findMany({
      where: { creadoEn: { gte: start, lt: end } },
      orderBy: { creadoEn: 'desc' },
      include: {
        registradoPor: { select: { nombre: true } },
        reserva: { select: { cancha: { select: { id: true, nombre: true } }, cliente: { select: { nombre: true } } } },
      },
    }),
};
```

- [ ] **Step 2: cobro.service**

Crear `src/services/cobro.service.ts`:
```ts
import { cobroRepo } from '../repositories/cobro.repo.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { NotFound } from '../utils/errors.js';

async function saldoDe(reservaId: string, monto: number) {
  const pagado = await cobroRepo.sumByReserva(reservaId);
  return { pagado, saldo: Math.max(0, monto - pagado) };
}

export const cobroService = {
  async listByReserva(reservaId: string) {
    const r = await reservaRepo.findById(reservaId);
    if (!r) throw NotFound('Reserva', reservaId);
    const cobros = await cobroRepo.listByReserva(reservaId);
    const monto = Number(r.monto);
    const pagado = cobros.reduce((s, c) => s + Number(c.monto), 0);
    return {
      monto, pagado, saldo: Math.max(0, monto - pagado),
      cobros: cobros.map((c) => ({ id: c.id, monto: Number(c.monto), medio: c.medio, origen: c.origen, registradoPor: c.registradoPor?.nombre ?? 'Sistema', creadoEn: c.creadoEn })),
    };
  },
  async crear(reservaId: string, input: { monto: number; medio: 'EFECTIVO' | 'TRANSFERENCIA' }, registradoPorId: string | null) {
    const r = await reservaRepo.findById(reservaId);
    if (!r) throw NotFound('Reserva', reservaId);
    const cobro = await cobroRepo.create({ reservaId, monto: input.monto, medio: input.medio, origen: 'MANUAL', registradoPorId });
    const { pagado, saldo } = await saldoDe(reservaId, Number(r.monto));
    return { cobro: { id: cobro.id, monto: Number(cobro.monto), medio: cobro.medio }, pagado, saldo };
  },
  async eliminar(id: string) {
    const c = await cobroRepo.findById(id);
    if (!c) throw NotFound('Cobro', id);
    await cobroRepo.remove(id);
    return { ok: true, monto: Number(c.monto) };
  },
};
```
NOTA: confirmá que `reservaRepo.findById` existe (se usa en `reservaService.get`); si no, usar `reservaService.get`.

- [ ] **Step 3: caja.service**

Crear `src/services/caja.service.ts`:
```ts
import { getEnv } from '../config/env.js';
import { dayWindowUtc } from '../utils/tz.js';
import { cobroRepo } from '../repositories/cobro.repo.js';

export const cajaService = {
  async reporte(desde: string, hasta: string) {
    const tz = getEnv().TZ_NEGOCIO;
    const start = dayWindowUtc(desde, tz).start;
    const end = dayWindowUtc(hasta, tz).end;
    const rows = await cobroRepo.listRange(start, end);
    const porMedio = { EFECTIVO: 0, TRANSFERENCIA: 0 };
    const porCanchaMap = new Map<string, { canchaId: string; nombre: string; total: number }>();
    let total = 0;
    for (const c of rows) {
      const m = Number(c.monto);
      total += m;
      porMedio[c.medio] += m;
      const ca = c.reserva?.cancha;
      if (ca) {
        const e = porCanchaMap.get(ca.id) ?? { canchaId: ca.id, nombre: ca.nombre, total: 0 };
        e.total += m;
        porCanchaMap.set(ca.id, e);
      }
    }
    return {
      desde, hasta, total, porMedio,
      porCancha: [...porCanchaMap.values()].sort((a, b) => b.total - a.total),
      cobros: rows.map((c) => ({
        id: c.id, creadoEn: c.creadoEn, monto: Number(c.monto), medio: c.medio,
        cancha: c.reserva?.cancha?.nombre ?? '-', cliente: c.reserva?.cliente?.nombre ?? '-',
        registradoPor: c.registradoPor?.nombre ?? 'Sistema',
      })),
    };
  },
};
```

- [ ] **Step 4: Commit**
```bash
npx tsc --noEmit
git add src/repositories/cobro.repo.ts src/services/cobro.service.ts src/services/caja.service.ts && git commit -m "feat(caja): cobro y caja services + repo"
```

---

### Task A3: Endpoints + validadores + seña→cobro (TDD)
**Files:** Create `src/routes/cobro.routes.ts`, `src/routes/caja.routes.ts`, `src/validators/cobro.schema.ts`; Modify `src/routes/reserva.routes.ts`, `src/routes/index.ts`, `src/services/reserva.service.ts`; Test `tests/integration/caja.test.ts`

- [ ] **Step 1: Test que falla**

Crear `tests/integration/caja.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id;
});
const recep = () => signAdminToken({ adminId: 'r', email: 'r@r.com', rol: 'RECEPCIONISTA' });

async function nuevaReserva(monto = 10000) {
  const cl = await getPrisma().cliente.create({ data: { nombre: 'Juan', whatsapp: '+1' } });
  return getPrisma().reserva.create({ data: { canchaId, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto, fechaInicio: new Date(), fechaFin: new Date(Date.now() + 3600000) } });
}

describe('cobros y caja', () => {
  it('registrar cobro baja el saldo; GET cobros lo refleja', async () => {
    const r = await nuevaReserva(10000);
    const c = await supertest(app).post(`/reservas/${r.id}/cobros`).set('authorization', `Bearer ${recep()}`).send({ monto: 4000, medio: 'EFECTIVO' });
    expect(c.status).toBe(201);
    expect(c.body.saldo).toBe(6000);
    const list = await supertest(app).get(`/reservas/${r.id}/cobros`).set('authorization', `Bearer ${recep()}`);
    expect(list.body.pagado).toBe(4000);
    expect(list.body.saldo).toBe(6000);
    expect(list.body.cobros[0].medio).toBe('EFECTIVO');
  });

  it('anular cobro sube el saldo', async () => {
    const r = await nuevaReserva(10000);
    const c = await supertest(app).post(`/reservas/${r.id}/cobros`).set('authorization', `Bearer ${recep()}`).send({ monto: 4000, medio: 'EFECTIVO' });
    await supertest(app).delete(`/cobros/${c.body.cobro.id}`).set('authorization', `Bearer ${recep()}`);
    const list = await supertest(app).get(`/reservas/${r.id}/cobros`).set('authorization', `Bearer ${recep()}`);
    expect(list.body.saldo).toBe(10000);
  });

  it('caja agrega por medio y por cancha (cobros de hoy)', async () => {
    const r = await nuevaReserva(10000);
    await supertest(app).post(`/reservas/${r.id}/cobros`).set('authorization', `Bearer ${recep()}`).send({ monto: 4000, medio: 'EFECTIVO' });
    await supertest(app).post(`/reservas/${r.id}/cobros`).set('authorization', `Bearer ${recep()}`).send({ monto: 3000, medio: 'TRANSFERENCIA' });
    const res = await supertest(app).get('/caja').set('authorization', `Bearer ${recep()}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(7000);
    expect(res.body.porMedio.EFECTIVO).toBe(4000);
    expect(res.body.porMedio.TRANSFERENCIA).toBe(3000);
    expect(res.body.porCancha[0].total).toBe(7000);
  });

  it('aprobar seña crea un cobro de transferencia y la caja lo cuenta', async () => {
    const cl = await getPrisma().cliente.create({ data: { nombre: 'Ana', whatsapp: '+2' } });
    const r = await getPrisma().reserva.create({ data: { canchaId, clienteId: cl.id, estado: 'ESPERANDO_SENA', esContacto: false, monto: 10000, montoSena: 5000, fechaInicio: new Date(), fechaFin: new Date(Date.now() + 3600000) } });
    await getPrisma().pago.create({ data: { reservaId: r.id, estado: 'PENDIENTE' } });
    const ap = await supertest(app).patch(`/reservas/${r.id}/aprobar-sena`).set('x-api-key', 'svc').send({});
    expect(ap.status).toBe(200);
    const list = await supertest(app).get(`/reservas/${r.id}/cobros`).set('authorization', `Bearer ${recep()}`);
    expect(list.body.cobros.some((c: any) => c.medio === 'TRANSFERENCIA' && c.monto === 5000 && c.origen === 'SENA')).toBe(true);
    expect(list.body.saldo).toBe(5000);
  });

  it('monto inválido → 400', async () => {
    const r = await nuevaReserva();
    const res = await supertest(app).post(`/reservas/${r.id}/cobros`).set('authorization', `Bearer ${recep()}`).send({ monto: 0, medio: 'EFECTIVO' });
    expect(res.status).toBe(400);
  });
});
```
NOTA: confirmá el shape de `pago.create` (señas) y de `aprobar-sena` (acepta x-api-key 'svc'); ajustá si difiere. `getPrisma`/`resetTables` según helpers reales.

- [ ] **Step 2: Correr → falla**
```bash
npx vitest run tests/integration/caja.test.ts
```
Expected: FAIL (rutas no existen; seña no crea cobro).

- [ ] **Step 3: Validadores**

Crear `src/validators/cobro.schema.ts`:
```ts
import { z } from 'zod';
const empty = z.looseObject({});
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const crearCobroSchema = z.object({
  body: z.object({ monto: z.number().positive(), medio: z.enum(['EFECTIVO', 'TRANSFERENCIA']) }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const cajaSchema = z.object({
  query: z.object({ desde: ymd.optional(), hasta: ymd.optional() }),
  body: z.unknown(), params: empty,
});
```

- [ ] **Step 4: Rutas de cobro (anidadas en reservas + DELETE suelto)**

En `src/routes/reserva.routes.ts` agregar (importar `cobroService`, `auditService`, `crearCobroSchema`):
```ts
reservaRoutes.get('/:id/cobros', authJwt, async (req, res, next) => {
  try { res.json(await cobroService.listByReserva(String(req.params.id))); } catch (e) { next(e); }
});
reservaRoutes.post('/:id/cobros', authJwt, validate(crearCobroSchema), async (req, res, next) => {
  try {
    const me = req.principal?.kind === 'admin' ? req.principal.adminId : null;
    const out = await cobroService.crear(String(req.params.id), (req as any).valid.body, me);
    await auditService.log(req, { accion: 'CREAR', entidad: 'Cobro', entidadId: out.cobro.id, descripcion: 'Registró un cobro de $' + out.cobro.monto.toLocaleString('es-AR') + ' (' + out.cobro.medio.toLowerCase() + ')' });
    res.status(201).json(out);
  } catch (e) { next(e); }
});
```
Crear `src/routes/cobro.routes.ts` (DELETE):
```ts
import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { validate } from '../middlewares/validate.js';
import { z } from 'zod';
import { cobroService } from '../services/cobro.service.js';
import { auditService } from '../services/audit.service.js';

const idSchema = z.object({ body: z.unknown(), query: z.looseObject({}), params: z.object({ id: z.string().min(1) }) });
export const cobroRoutes = Router();
cobroRoutes.delete('/:id', authJwt, validate(idSchema), async (req, res, next) => {
  try {
    const out = await cobroService.eliminar(String(req.params.id));
    await auditService.log(req, { accion: 'ELIMINAR', entidad: 'Cobro', entidadId: String(req.params.id), descripcion: 'Anuló un cobro de $' + out.monto.toLocaleString('es-AR') });
    res.json(out);
  } catch (e) { next(e); }
});
```

- [ ] **Step 5: Ruta de caja**

Crear `src/routes/caja.routes.ts`:
```ts
import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { validate } from '../middlewares/validate.js';
import { cajaSchema } from '../validators/cobro.schema.js';
import { cajaService } from '../services/caja.service.js';
import { getEnv } from '../config/env.js';

function hoyEnTz(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: getEnv().TZ_NEGOCIO, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export const cajaRoutes = Router();
cajaRoutes.get('/', authJwt, validate(cajaSchema), async (req, res, next) => {
  try {
    const q = (req as any).valid.query as { desde?: string; hasta?: string };
    const hoy = hoyEnTz();
    res.json(await cajaService.reporte(q.desde ?? hoy, q.hasta ?? q.desde ?? hoy));
  } catch (e) { next(e); }
});
```
En `src/routes/index.ts`: importar y montar `apiRouter.use('/cobros', cobroRoutes); apiRouter.use('/caja', cajaRoutes);`.

- [ ] **Step 6: Seña → cobro (en `aprobarSena`)**

En `src/services/reserva.service.ts`, dentro del `prisma.$transaction` de `aprobarSena`, después del `auditLogRepo.record(...APROBAR_SENA...)` y antes de `return updated;`, agregar (importar `cobroRepo`):
```ts
      const montoSena = Number(r.montoSena ?? 0);
      if (montoSena > 0) {
        await cobroRepo.create({ reservaId: id, monto: montoSena, medio: 'TRANSFERENCIA', origen: 'SENA', registradoPorId: by.adminId ?? null }, tx);
      }
```

- [ ] **Step 7: Correr → pasa**
```bash
npx vitest run tests/integration/caja.test.ts
```
Expected: PASS (5 casos).

- [ ] **Step 8: Suite + commit**
```bash
npx vitest run && npx tsc --noEmit
git add src/routes/cobro.routes.ts src/routes/caja.routes.ts src/validators/cobro.schema.ts src/routes/reserva.routes.ts src/routes/index.ts src/services/reserva.service.ts tests/integration/caja.test.ts && git commit -m "feat(caja): endpoints cobros/caja + seña como cobro de transferencia"
```

---

## Parte B — Frontend (rama `feat/pagos-caja-panel`)

### Task B0: Rama
- [ ] **Step 1**
```bash
cd c:/Users/Lautaro/Desktop/ortigoza/frontend && git checkout master && git checkout -b feat/pagos-caja-panel
```

---

### Task B1: Tipos + actions + schema
**Files:** `src/lib/types.ts`, `src/lib/validators.ts`, Create `src/lib/cobros-actions.ts`

- [ ] **Step 1: Tipos** — en `src/lib/types.ts`:
```ts
export type MedioPago = 'EFECTIVO' | 'TRANSFERENCIA';
export interface Cobro { id: string; monto: number; medio: MedioPago; origen: string; registradoPor: string; creadoEn: string }
export interface CobrosReserva { monto: number; pagado: number; saldo: number; cobros: Cobro[] }
export interface CajaReporte {
  desde: string; hasta: string; total: number;
  porMedio: { EFECTIVO: number; TRANSFERENCIA: number };
  porCancha: { canchaId: string; nombre: string; total: number }[];
  cobros: { id: string; creadoEn: string; monto: number; medio: MedioPago; cancha: string; cliente: string; registradoPor: string }[];
}
```
- [ ] **Step 2: Schema** — en `src/lib/validators.ts`:
```ts
export const cobroSchema = z.object({
  monto: z.coerce.number().positive('El monto debe ser mayor a 0'),
  medio: z.enum(['EFECTIVO', 'TRANSFERENCIA']),
});
```
- [ ] **Step 3: Actions** — crear `src/lib/cobros-actions.ts`:
```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { CobrosReserva, MedioPago } from './types';

type Result = { ok: true } | { ok: false; error: string };
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/reservas'); revalidatePath('/caja'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function getCobros(reservaId: string): Promise<CobrosReserva> {
  return apiFetch<CobrosReserva>(`/reservas/${reservaId}/cobros`);
}
export async function registrarCobro(reservaId: string, input: { monto: number; medio: MedioPago }): Promise<Result> {
  return run(() => apiFetch(`/reservas/${reservaId}/cobros`, { method: 'POST', body: JSON.stringify(input) }));
}
export async function anularCobro(id: string): Promise<Result> {
  return run(() => apiFetch(`/cobros/${id}`, { method: 'DELETE' }));
}
```
- [ ] **Step 4: build + commit**
```bash
pnpm exec tsc --noEmit && pnpm build
git add src/lib/types.ts src/lib/validators.ts src/lib/cobros-actions.ts && git commit -m "feat(caja): tipos, schema y actions de cobros"
```

---

### Task B2: Diálogo de cobros en Reservas
**Files:** Create `src/components/reservas/cobros-dialog.tsx`; Modify `src/components/reservas/reservas-table.tsx`

- [ ] **Step 1: CobrosDialog** — crear `src/components/reservas/cobros-dialog.tsx`:
```tsx
'use client';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CobrosReserva, MedioPago } from '@/lib/types';
import { cobroSchema } from '@/lib/validators';
import { getCobros, registrarCobro, anularCobro } from '@/lib/cobros-actions';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function CobrosDialog({ reservaId, open, onOpenChange }: { reservaId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [data, setData] = useState<CobrosReserva | null>(null);
  const [monto, setMonto] = useState('');
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open && reservaId) { setData(null); getCobros(reservaId).then(setData).catch(() => toast.error('No pude cargar los cobros')); }
  }, [open, reservaId]);

  function refrescar() { if (reservaId) getCobros(reservaId).then(setData).catch(() => {}); router.refresh(); }

  function registrar() {
    const parsed = cobroSchema.safeParse({ monto, medio });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      if (!reservaId) return;
      const r = await registrarCobro(reservaId, parsed.data);
      if (r.ok) { toast.success('Cobro registrado'); setMonto(''); refrescar(); } else toast.error(r.error);
    });
  }
  function anular(id: string) {
    start(async () => { const r = await anularCobro(id); if (r.ok) { toast.success('Cobro anulado'); refrescar(); } else toast.error(r.error); });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Cobros</DialogTitle></DialogHeader>
        {data ? (
          <div className="space-y-3 text-sm">
            <div className="flex gap-4 rounded-lg bg-neutral-50 p-3">
              <div>Total<br /><span className="font-semibold">{money(data.monto)}</span></div>
              <div>Pagado<br /><span className="font-semibold text-emerald-700">{money(data.pagado)}</span></div>
              <div>Saldo<br /><span className="font-semibold text-amber-700">{money(data.saldo)}</span></div>
            </div>
            <ul className="space-y-1">
              {data.cobros.length === 0 && <li className="text-neutral-500">Sin cobros.</li>}
              {data.cobros.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b py-1">
                  <span>{money(c.monto)} · {c.medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}{c.origen === 'SENA' ? ' (seña)' : ''} <span className="text-neutral-400">— {c.registradoPor}</span></span>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => anular(c.id)}>Anular</Button>
                </li>
              ))}
            </ul>
            <div className="flex items-end gap-2 border-t pt-3">
              <div className="space-y-1"><Label htmlFor="cb-monto">Monto</Label><Input id="cb-monto" type="number" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder={String(data.saldo)} /></div>
              <div className="space-y-1"><Label htmlFor="cb-medio">Medio</Label>
                <select id="cb-medio" value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)} className="rounded-md border px-2 py-1.5">
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                </select>
              </div>
              <Button disabled={pending} onClick={registrar}>Registrar</Button>
            </div>
          </div>
        ) : <p className="text-sm text-neutral-500">Cargando…</p>}
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
```
- [ ] **Step 2: Engancharlo en `reservas-table.tsx`** — agregar estado `const [cobrosId, setCobrosId] = useState<string|null>(null);`, un ítem en el `DropdownMenu` por fila **y** en la card mobile: `<DropdownMenuItem onClick={() => setCobrosId(r.id)}>Cobros</DropdownMenuItem>` (Base UI usa `onClick`), y al final del componente `<CobrosDialog reservaId={cobrosId} open={!!cobrosId} onOpenChange={(o) => { if (!o) setCobrosId(null); }} />`. Importar `CobrosDialog`.
- [ ] **Step 3: build + commit**
```bash
pnpm exec tsc --noEmit && pnpm build
git add src/components/reservas/cobros-dialog.tsx src/components/reservas/reservas-table.tsx && git commit -m "feat(caja): diálogo de cobros por reserva"
```

---

### Task B3: Pantalla `/caja` + nav
**Files:** `src/components/nav-items.ts`, Create `src/app/(panel)/caja/page.tsx`, `src/components/caja/caja-reporte.tsx`

- [ ] **Step 1: Nav** — en `src/components/nav-items.ts`, importar `Wallet` de lucide y agregar (ambos roles), después de Reservas o Calendario:
```ts
  { href: '/caja', label: 'Caja', icon: Wallet, roles: AMBOS },
```
- [ ] **Step 2: Reporte (client)** — crear `src/components/caja/caja-reporte.tsx`:
```tsx
'use client';
import { Badge } from '@/components/ui/badge';
import type { CajaReporte } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function CajaReporteView({ caja }: { caja: CajaReporte }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-500">Total</div><div className="text-xl font-semibold">{money(caja.total)}</div></div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-500">Efectivo</div><div className="text-xl font-semibold">{money(caja.porMedio.EFECTIVO)}</div></div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-500">Transferencia</div><div className="text-xl font-semibold">{money(caja.porMedio.TRANSFERENCIA)}</div></div>
      </div>
      {caja.porCancha.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 text-xs text-neutral-500">Por cancha</div>
          <ul className="space-y-1 text-sm">{caja.porCancha.map((c) => <li key={c.canchaId} className="flex justify-between"><span>{c.nombre}</span><span className="font-medium">{money(c.total)}</span></li>)}</ul>
        </div>
      )}
      {/* Detalle */}
      <div className="hidden overflow-x-auto rounded-lg border bg-white md:block">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-neutral-500"><th className="p-3">Hora</th><th className="p-3">Cancha</th><th className="p-3">Cliente</th><th className="p-3">Medio</th><th className="p-3 text-right">Monto</th></tr></thead>
          <tbody>{caja.cobros.map((c) => (
            <tr key={c.id} className="border-b last:border-0"><td className="p-3 text-neutral-500">{fmt(c.creadoEn)}</td><td className="p-3">{c.cancha}</td><td className="p-3">{c.cliente}</td><td className="p-3"><Badge variant="secondary">{c.medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}</Badge></td><td className="p-3 text-right font-medium">{money(c.monto)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {caja.cobros.map((c) => (
          <div key={c.id} className="rounded-lg border bg-white p-3 text-sm">
            <div className="flex justify-between"><span className="font-medium">{money(c.monto)}</span><span className="text-xs text-neutral-400">{fmt(c.creadoEn)}</span></div>
            <div className="text-neutral-600">{c.cancha} · {c.cliente}</div>
            <Badge variant="secondary" className="mt-1">{c.medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}</Badge>
          </div>
        ))}
        {caja.cobros.length === 0 && <p className="rounded-lg border bg-white p-6 text-center text-sm text-neutral-500">Sin cobros.</p>}
      </div>
    </div>
  );
}
```
- [ ] **Step 3: Page (server, rol-aware)** — crear `src/app/(panel)/caja/page.tsx`:
```tsx
import { apiFetch } from '@/lib/api';
import { getSession } from '@/lib/session';
import type { CajaReporte } from '@/lib/types';
import { CajaReporteView } from '@/components/caja/caja-reporte';

function hoy() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export default async function CajaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const esAdmin = session.rol === 'ADMIN';
  const hoyYmd = hoy();
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const desde = esAdmin && sp.desde && re.test(sp.desde) ? sp.desde : hoyYmd;
  const hasta = esAdmin && sp.hasta && re.test(sp.hasta) ? sp.hasta : (esAdmin ? desde : hoyYmd);
  const caja = await apiFetch<CajaReporte>(`/caja?desde=${desde}&hasta=${hasta}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
          <p className="mt-1 text-sm text-neutral-500">{esAdmin ? `Del ${caja.desde} al ${caja.hasta}` : 'Cobros de hoy'}</p>
        </div>
        {esAdmin && (
          <form method="get" className="flex items-end gap-2 text-sm">
            <label className="flex flex-col">Desde<input type="date" name="desde" defaultValue={desde} className="mt-1 rounded-md border px-2 py-1.5" /></label>
            <label className="flex flex-col">Hasta<input type="date" name="hasta" defaultValue={hasta} className="mt-1 rounded-md border px-2 py-1.5" /></label>
            <button type="submit" className="rounded-md bg-neutral-900 px-3 py-2 text-white">Ver</button>
          </form>
        )}
      </div>
      <CajaReporteView caja={caja} />
    </div>
  );
}
```
- [ ] **Step 4: build + commit**
```bash
pnpm exec tsc --noEmit && pnpm build
git add src/components/nav-items.ts "src/app/(panel)/caja/page.tsx" src/components/caja/caja-reporte.tsx && git commit -m "feat(caja): pantalla /caja (recepcionista hoy, admin rango/por cancha)"
```

---

### Task B4: Verificación
- [ ] **Step 1**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build
```
Expected: todo verde. Manual: en una reserva, registrar un cobro efectivo (baja el saldo), anular uno; en /caja ver totales por medio (recepcionista: solo hoy; admin: rango + por cancha); aprobar una seña y verla como transferencia en la caja.

---

## Parte C — Cierre
- [ ] **Step 1: Backend** — finishing-a-development-branch en `feat/pagos-caja-backend`: tests verdes → merge `main` + push.
- [ ] **Step 2: Frontend** — finishing-a-development-branch en `feat/pagos-caja-panel`: merge `master` (local).

---

## Self-Review

**Spec coverage:** modelo `Cobro`+`MedioPago`+migración (A1) ✓; cobro/caja services+repo con saldo (A2) ✓; endpoints POST/GET cobros, DELETE /cobros/:id, GET /caja (A3) ✓; seña→cobro transferencia en `aprobarSena` tx (A3 Step 6) ✓; validación monto>0/medio (A3 Step 3) ✓; ambos roles (authJwt, sin requireRole) ✓; audit de registrar/anular (A3 Steps 4-5) ✓; tests saldo/anular/caja-agregada/seña/validación (A3 Step 1) ✓; frontend tipos+actions+schema (B1), diálogo cobros en Reservas (B2), pantalla /caja rol-aware + nav (B3) ✓; bot sin cambios ✓.

**Placeholder scan:** sin TBD. "NOTA: confirmá reservaRepo.findById / shape de pago.create / helpers" = verificación contra el código real.

**Type consistency:** `Cobro {id,monto,medio,origen,registradoPor,creadoEn}` y `CobrosReserva {monto,pagado,saldo,cobros}` y `CajaReporte {desde,hasta,total,porMedio,porCancha,cobros}` consistentes backend (service shapes) ↔ frontend (types). `MedioPago='EFECTIVO'|'TRANSFERENCIA'`. `cobroService.crear(reservaId,{monto,medio},registradoPorId)` / `.listByReserva` / `.eliminar`. `cajaService.reporte(desde,hasta)`. Endpoints: `POST/GET /reservas/:id/cobros`, `DELETE /cobros/:id`, `GET /caja?desde&hasta`.

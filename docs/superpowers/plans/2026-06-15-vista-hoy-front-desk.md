# Vista "Hoy" — Front desk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una pantalla "Hoy" mobile-first (home de la recepción) con la agenda del día y cobro express en pocos toques, apoyada en `pagado`/`saldo` por reserva que ahora devuelve el backend.

**Architecture:** Backend agrega `pagado`/`saldo` a la respuesta de `GET /reservas` (Σ cobros por `reservaId`, sin migración). Frontend (Next 16 / Base UI) suma una ruta `/hoy` (Server Component que trae reservas del día + total de caja del día) con una lista de tarjetas tocables y una hoja inferior de acción que reúne cobro + acciones, reusando los diálogos y server actions existentes.

**Tech Stack:** Backend: Node, Express 5, Prisma 7, Vitest + Supertest + Testcontainers (necesita Docker Desktop). Frontend: Next 16, React 19, Tailwind 4, Base UI (`@base-ui/react`), pnpm, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-15-vista-hoy-front-desk-design.md`

**Gotchas (leer antes de tocar frontend):**
- Módulos `'use server'`: **todos los exports deben ser `async function`** (no `const = async () =>`), o `next build` falla.
- Next 16: `searchParams` es `Promise`.
- Base UI: los triggers usan `render={<Button/>}`; `MenuItem` usa `onClick`; en diálogos se usa `<select>` nativo.
- Clases Tailwind **estáticas** (sin interpolación dinámica): mapear `tono → clase` con objeto literal.
- `pnpm build` es obligatorio antes de mergear (atrapa errores de límite RSC y de exports no-async).

---

## File Structure

**Backend (rama `feat/vista-hoy-backend`):**
- Modify: `backend/src/services/reserva.service.ts` — `list()` pasa a `async` y adjunta `pagado`/`saldo`.
- Test: `backend/tests/integration/reserva-saldo.test.ts` (nuevo).

**Frontend (rama `feat/vista-hoy-panel`):**
- Modify: `frontend/src/lib/types.ts` — `Reserva += pagado, saldo`.
- Create: `frontend/src/lib/pago.ts` — `estadoPago()` (lógica pura del chip).
- Test: `frontend/src/lib/pago.test.ts`.
- Modify: `frontend/src/lib/fecha.ts` — helpers `fmtHora`, `addDias`, `fmtFechaLarga`, `esHoy`.
- Create: `frontend/src/components/ui/sheet.tsx` — bottom sheet (variante del Dialog de Base UI).
- Create: `frontend/src/components/hoy/pago-chip.tsx` — chip de color (usa `estadoPago`).
- Create: `frontend/src/components/hoy/turno-card.tsx` — tarjeta tocable de un turno.
- Create: `frontend/src/components/hoy/accion-turno-sheet.tsx` — hoja de acción (cobro express + secundarias).
- Create: `frontend/src/components/hoy/agenda-hoy.tsx` — lista + stepper de días + estado del turno seleccionado.
- Create: `frontend/src/app/(panel)/hoy/page.tsx` — Server Component (fetch reservas + caja).
- Create: `frontend/src/app/(panel)/hoy/loading.tsx` — skeletons.
- Modify: `frontend/src/components/nav-items.ts` — agrega `/hoy` como primer ítem (AMBOS).
- Modify: `frontend/src/lib/auth.ts` — landing post-login a `/hoy` para ambos roles.

---

# BACKEND — rama `feat/vista-hoy-backend`

> Crear la rama antes de empezar: `cd backend && git checkout main && git pull && git checkout -b feat/vista-hoy-backend`. Requiere Docker Desktop corriendo para los tests (Testcontainers).

### Task 1: `pagado`/`saldo` por reserva en `GET /reservas`

**Files:**
- Modify: `backend/src/services/reserva.service.ts` (función `list`, líneas ~114-129)
- Test: `backend/tests/integration/reserva-saldo.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/reserva-saldo.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
let canchaId: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id;
});

const admin = () => signAdminToken({ adminId: 'a', email: 'a@b.com', rol: 'ADMIN' });

async function reservaHoy(monto = 10000) {
  const cl = await getPrisma().cliente.create({ data: { nombre: 'Juan', whatsapp: '+5491150000000' } });
  return getPrisma().reserva.create({
    data: {
      canchaId, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto,
      fechaInicio: new Date(), fechaFin: new Date(Date.now() + 3600000),
    },
  });
}

// rango que cubre "hoy" sin depender de la TZ exacta del día
const desde = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const hasta = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe('GET /reservas — pagado/saldo por reserva', () => {
  it('sin cobros: pagado 0 y saldo = monto', async () => {
    const r = await reservaHoy(10000);
    const res = await supertest(app)
      .get(`/reservas?desde=${desde()}&hasta=${hasta()}`)
      .set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    const item = (res.body as any[]).find((x) => x.id === r.id);
    expect(item.pagado).toBe(0);
    expect(item.saldo).toBe(10000);
  });

  it('con cobro parcial: pagado = Σ y saldo = monto - pagado', async () => {
    const r = await reservaHoy(10000);
    await supertest(app)
      .post(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${admin()}`)
      .send({ monto: 4000, medio: 'EFECTIVO' });
    const res = await supertest(app)
      .get(`/reservas?desde=${desde()}&hasta=${hasta()}`)
      .set('authorization', `Bearer ${admin()}`);
    const item = (res.body as any[]).find((x) => x.id === r.id);
    expect(item.pagado).toBe(4000);
    expect(item.saldo).toBe(6000);
  });

  it('pagado completo: saldo 0', async () => {
    const r = await reservaHoy(10000);
    await supertest(app)
      .post(`/reservas/${r.id}/cobros`)
      .set('authorization', `Bearer ${admin()}`)
      .send({ monto: 10000, medio: 'EFECTIVO' });
    const res = await supertest(app)
      .get(`/reservas?desde=${desde()}&hasta=${hasta()}`)
      .set('authorization', `Bearer ${admin()}`);
    const item = (res.body as any[]).find((x) => x.id === r.id);
    expect(item.pagado).toBe(10000);
    expect(item.saldo).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/reserva-saldo.test.ts`
Expected: FAIL — `item.pagado` es `undefined` (el endpoint todavía no devuelve esos campos).

- [ ] **Step 3: Implementar — `list` async con `pagado`/`saldo`**

En `backend/src/services/reserva.service.ts`, reemplazar el método `list` actual:

```typescript
  list: (filtros: { fecha?: string; desde?: string; hasta?: string; canchaId?: string; estado?: EstadoReserva; whatsapp?: string }) => {
    const where: Prisma.ReservaWhereInput = {};
    if (filtros.canchaId) where.canchaId = filtros.canchaId;
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.whatsapp) where.cliente = { whatsapp: filtros.whatsapp };
    const tz = getEnv().TZ_NEGOCIO;
    if (filtros.desde && filtros.hasta) {
      const start = dayWindowUtc(filtros.desde, tz).start;
      const end = dayWindowUtc(filtros.hasta, tz).end; // inicio del día siguiente a 'hasta'
      where.fechaInicio = { gte: start, lt: end };
    } else if (filtros.fecha) {
      const start = combineDateTimeUtc(filtros.fecha, '00:00', tz);
      where.fechaInicio = { gte: start, lt: new Date(start.getTime() + 86400000) };
    }
    return reservaRepo.list(where);
  },
```

por esta versión `async` que adjunta `pagado`/`saldo`:

```typescript
  async list(filtros: { fecha?: string; desde?: string; hasta?: string; canchaId?: string; estado?: EstadoReserva; whatsapp?: string }) {
    const where: Prisma.ReservaWhereInput = {};
    if (filtros.canchaId) where.canchaId = filtros.canchaId;
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.whatsapp) where.cliente = { whatsapp: filtros.whatsapp };
    const tz = getEnv().TZ_NEGOCIO;
    if (filtros.desde && filtros.hasta) {
      const start = dayWindowUtc(filtros.desde, tz).start;
      const end = dayWindowUtc(filtros.hasta, tz).end; // inicio del día siguiente a 'hasta'
      where.fechaInicio = { gte: start, lt: end };
    } else if (filtros.fecha) {
      const start = combineDateTimeUtc(filtros.fecha, '00:00', tz);
      where.fechaInicio = { gte: start, lt: new Date(start.getTime() + 86400000) };
    }
    const reservas = await reservaRepo.list(where);
    const ids = reservas.map((r) => r.id);
    const sums = ids.length
      ? await prisma.cobro.groupBy({ by: ['reservaId'], where: { reservaId: { in: ids } }, _sum: { monto: true } })
      : [];
    const pagadoPorId = new Map(sums.map((s) => [s.reservaId, Number(s._sum.monto ?? 0)]));
    return reservas.map((r) => {
      const pagado = pagadoPorId.get(r.id) ?? 0;
      const monto = Number(r.monto);
      return { ...r, pagado, saldo: Math.max(0, monto - pagado) };
    });
  },
```

(`prisma` ya está importado en este archivo, línea 2. No hace falta tocar el repo ni los demás consumidores — `misReservas`/`vencidasSena` llaman a `reservaRepo.list` directo y no cambian.)

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/reserva-saldo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Correr la suite de reservas para no romper nada**

Run: `cd backend && npx vitest run tests/integration/reserva.routes.test.ts tests/integration/caja.test.ts`
Expected: PASS (los filtros por rango/estado siguen verdes).

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/services/reserva.service.ts tests/integration/reserva-saldo.test.ts
git commit -m "feat(reservas): incluir pagado/saldo por reserva en GET /reservas"
```

### Cierre del backend

- [ ] **Finalizar la rama backend.** Anunciar e invocar **superpowers:finishing-a-development-branch** (verifica tests, merge a `main`, push). Luego deploy VM:

```bash
# en la VM
cd /opt/canchitas/canchitas-backend && git fetch origin && git reset --hard origin/main \
  && docker compose -f docker-compose.vm.yml up -d --build && sleep 12 \
  && docker exec canchitas-backend npx prisma migrate deploy
```

(No hay migración nueva ni cambios de auth; no requiere re-login. `migrate deploy` es no-op pero se corre por costumbre.)

---

# FRONTEND — rama `feat/vista-hoy-panel`

> Crear la rama antes de empezar: `cd frontend && git checkout master && git checkout -b feat/vista-hoy-panel`.

### Task 2: Tipos + lógica pura del chip de pago

**Files:**
- Modify: `frontend/src/lib/types.ts:6-11` (interface `Reserva`)
- Create: `frontend/src/lib/pago.ts`
- Test: `frontend/src/lib/pago.test.ts`

- [ ] **Step 1: Agregar `pagado`/`saldo` al tipo `Reserva`**

En `frontend/src/lib/types.ts`, reemplazar la interface `Reserva`:

```typescript
export interface Reserva {
  id: string; canchaId: string; clienteId: string;
  fechaInicio: string; fechaFin: string; estado: EstadoReserva;
  esContacto: boolean; monto: number; montoSena: number | null;
  pagado: number; saldo: number;
  cancha: Pick<Cancha, 'id' | 'nombre'>; cliente: Cliente;
}
```

- [ ] **Step 2: Escribir el test que falla**

Crear `frontend/src/lib/pago.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { estadoPago } from '@/lib/pago';

describe('estadoPago', () => {
  it('ESPERANDO_SENA → espera', () => {
    expect(estadoPago({ estado: 'ESPERANDO_SENA', monto: 10000, pagado: 0, saldo: 10000 }))
      .toEqual({ tono: 'espera', label: 'Espera seña' });
  });
  it('saldo 0 → pagado', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 10000, pagado: 10000, saldo: 0 }))
      .toEqual({ tono: 'pagado', label: 'Pagado' });
  });
  it('pago parcial → parcial (amarillo) con saldo', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 10000, pagado: 4000, saldo: 6000 }))
      .toEqual({ tono: 'parcial', label: 'Debe $6.000' });
  });
  it('sin pagar → debe (rojo) con saldo', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 10000, pagado: 0, saldo: 10000 }))
      .toEqual({ tono: 'debe', label: 'Debe $10.000' });
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd frontend && pnpm test src/lib/pago.test.ts`
Expected: FAIL — `Cannot find module '@/lib/pago'`.

- [ ] **Step 4: Implementar la lógica pura**

Crear `frontend/src/lib/pago.ts`:

```typescript
import type { EstadoReserva } from './types';

export type TonoPago = 'pagado' | 'parcial' | 'debe' | 'espera';
export interface PagoVista { tono: TonoPago; label: string }

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Lógica pura del chip de pago de un turno. */
export function estadoPago(r: { estado: EstadoReserva; monto: number; pagado: number; saldo: number }): PagoVista {
  if (r.estado === 'ESPERANDO_SENA') return { tono: 'espera', label: 'Espera seña' };
  if (r.saldo <= 0 && r.monto > 0) return { tono: 'pagado', label: 'Pagado' };
  if (r.pagado > 0) return { tono: 'parcial', label: 'Debe ' + money(r.saldo) };
  return { tono: 'debe', label: 'Debe ' + money(r.saldo) };
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd frontend && pnpm test src/lib/pago.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/lib/types.ts src/lib/pago.ts src/lib/pago.test.ts
git commit -m "feat(hoy): tipo Reserva con pagado/saldo + estadoPago puro"
```

### Task 3: Helpers de fecha para la agenda

**Files:**
- Modify: `frontend/src/lib/fecha.ts`
- Test: `frontend/src/lib/fecha.test.ts` (agregar casos)

- [ ] **Step 1: Agregar el test que falla**

Agregar al final de `frontend/src/lib/fecha.test.ts`:

```typescript
import { fmtHora, addDias, esHoy, fmtFechaLarga, hoyAR as _hoyAR } from '@/lib/fecha';

describe('helpers de agenda', () => {
  it('fmtHora devuelve HH:MM', () => {
    // 2026-06-15T18:30 hora Argentina = 21:30Z
    expect(fmtHora('2026-06-15T21:30:00.000Z')).toBe('18:30');
  });
  it('addDias suma/resta días sobre YYYY-MM-DD', () => {
    expect(addDias('2026-06-15', 1)).toBe('2026-06-16');
    expect(addDias('2026-06-01', -1)).toBe('2026-05-31');
  });
  it('esHoy compara contra hoy AR', () => {
    expect(esHoy(_hoyAR())).toBe(true);
    expect(esHoy('2000-01-01')).toBe(false);
  });
  it('fmtFechaLarga arma "<día> <n> de <mes>"', () => {
    expect(fmtFechaLarga('2026-06-15')).toMatch(/de junio$/);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd frontend && pnpm test src/lib/fecha.test.ts`
Expected: FAIL — `fmtHora`/`addDias`/`esHoy`/`fmtFechaLarga` no existen.

- [ ] **Step 3: Implementar los helpers**

Agregar al final de `frontend/src/lib/fecha.ts`:

```typescript
export function fmtHora(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** Suma n días a un 'YYYY-MM-DD' y devuelve 'YYYY-MM-DD' (sin corrimientos de TZ). */
export function addDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  return new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);
}

export function esHoy(ymd: string): boolean {
  return ymd === hoyAR();
}

/** "martes 15 de junio" */
export function fmtFechaLarga(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(base);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd frontend && pnpm test src/lib/fecha.test.ts`
Expected: PASS (incluye los casos viejos + los nuevos).

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/lib/fecha.ts src/lib/fecha.test.ts
git commit -m "feat(hoy): helpers fmtHora/addDias/esHoy/fmtFechaLarga"
```

### Task 4: Bottom sheet (`ui/sheet.tsx`)

**Files:**
- Create: `frontend/src/components/ui/sheet.tsx`

- [ ] **Step 1: Crear el componente**

Crear `frontend/src/components/ui/sheet.tsx` (variante inferior del Dialog de Base UI; en pantallas grandes igual queda anclado abajo, ancho acotado y centrado horizontalmente):

```tsx
'use client';
import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/30 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-popover p-4 pb-6 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none duration-150 data-open:animate-in data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:slide-out-to-bottom-4 sm:bottom-4 sm:rounded-2xl',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Cerrar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex flex-col gap-1', className)} {...props} />;
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title data-slot="sheet-title" className={cn('font-heading text-base font-medium', className)} {...props} />
  );
}

export { Sheet, SheetContent, SheetHeader, SheetTitle };
```

- [ ] **Step 2: Verificar tipos (build incremental rápido vía typecheck)**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: sin errores nuevos sobre `sheet.tsx`. (Si `size="icon-sm"` no existe en `Button`, usar `size="icon"`; verificar en `src/components/ui/button.tsx` los tamaños disponibles.)

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/components/ui/sheet.tsx
git commit -m "feat(ui): bottom sheet basado en Dialog de Base UI"
```

### Task 5: Chip de pago (`pago-chip.tsx`)

**Files:**
- Create: `frontend/src/components/hoy/pago-chip.tsx`

- [ ] **Step 1: Crear el componente** (clases Tailwind estáticas por `tono`)

Crear `frontend/src/components/hoy/pago-chip.tsx`:

```tsx
import { estadoPago, type TonoPago } from '@/lib/pago';
import type { Reserva } from '@/lib/types';
import { cn } from '@/lib/utils';

const TONO_CLASE: Record<TonoPago, string> = {
  pagado: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  parcial: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  debe: 'bg-red-50 text-red-700 ring-red-600/20',
  espera: 'bg-neutral-100 text-neutral-600 ring-neutral-500/20',
};

export function PagoChip({ reserva, className }: { reserva: Pick<Reserva, 'estado' | 'monto' | 'pagado' | 'saldo'>; className?: string }) {
  const { tono, label } = estadoPago(reserva);
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', TONO_CLASE[tono], className)}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd frontend
git add src/components/hoy/pago-chip.tsx
git commit -m "feat(hoy): PagoChip con colores por estado de pago"
```

### Task 6: Tarjeta de turno (`turno-card.tsx`)

**Files:**
- Create: `frontend/src/components/hoy/turno-card.tsx`

- [ ] **Step 1: Crear el componente** (tarjeta-botón tocable, hora grande, atenuada si ya pasó)

Crear `frontend/src/components/hoy/turno-card.tsx`:

```tsx
'use client';
import type { Reserva } from '@/lib/types';
import { fmtHora } from '@/lib/fecha';
import { PagoChip } from './pago-chip';
import { cn } from '@/lib/utils';

export function TurnoCard({ reserva, onClick }: { reserva: Reserva; onClick: () => void }) {
  const pasado = new Date(reserva.fechaFin).getTime() < Date.now();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left transition active:scale-[0.99] min-h-[64px]',
        pasado && 'opacity-60',
      )}
    >
      <span className="w-14 shrink-0 text-center">
        <span className="block text-lg font-semibold leading-none tabular-nums">{fmtHora(reserva.fechaInicio)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{reserva.cliente?.nombre ?? '—'}</span>
        <span className="block truncate text-sm text-neutral-500">{reserva.cancha?.nombre ?? '—'}</span>
      </span>
      <PagoChip reserva={reserva} />
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd frontend
git add src/components/hoy/turno-card.tsx
git commit -m "feat(hoy): TurnoCard tocable con hora, cliente, cancha y chip"
```

### Task 7: Hoja de acción + cobro express (`accion-turno-sheet.tsx`)

**Files:**
- Create: `frontend/src/components/hoy/accion-turno-sheet.tsx`

Reúne lo que hoy hace `cobros-dialog.tsx` + el dropdown de `reservas-table.tsx`, optimizado para tocar. Reusa `getCobros`/`registrarCobro`/`anularCobro` y `cancelarReserva`/`aprobarSena`/`rechazarSena`.

- [ ] **Step 1: Crear el componente**

Crear `frontend/src/components/hoy/accion-turno-sheet.tsx`:

```tsx
'use client';
import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtHora } from '@/lib/fecha';
import { cobroSchema } from '@/lib/validators';
import type { Reserva, CobrosReserva, MedioPago } from '@/lib/types';
import { getCobros, registrarCobro, anularCobro } from '@/lib/cobros-actions';
import { cancelarReserva, aprobarSena, rechazarSena } from '@/lib/reservas-actions';
import { cn } from '@/lib/utils';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function AccionTurnoSheet({
  reserva,
  open,
  onOpenChange,
  onReprogramar,
}: {
  reserva: Reserva | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onReprogramar: (id: string) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<CobrosReserva | null>(null);
  const [monto, setMonto] = useState('');
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !reserva) return;
    let cancelled = false;
    setData(null);
    getCobros(reserva.id)
      .then((d) => { if (!cancelled) { setData(d); setMonto(String(d.saldo)); } })
      .catch(() => { if (!cancelled) toast.error('No pude cargar los cobros'); });
    return () => { cancelled = true; };
  }, [open, reserva]);

  function refrescar() {
    if (reserva) getCobros(reserva.id).then((d) => { setData(d); setMonto(String(d.saldo)); }).catch(() => {});
    router.refresh();
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, close = false) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMsg); if (close) onOpenChange(false); else refrescar(); }
      else toast.error(r.error ?? 'Error');
    });
  }

  function cobrar() {
    if (!reserva) return;
    const parsed = cobroSchema.safeParse({ monto, medio });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await registrarCobro(reserva.id, parsed.data);
      if (r.ok) { toast.success('Cobro registrado'); refrescar(); } else toast.error(r.error);
    });
  }

  if (!reserva) return null;
  const esEspera = reserva.estado === 'ESPERANDO_SENA';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{reserva.cliente?.nombre ?? 'Turno'}</SheetTitle>
          <p className="text-sm text-neutral-500">{reserva.cancha?.nombre} · {fmtHora(reserva.fechaInicio)}</p>
        </SheetHeader>

        {!data ? (
          <p className="text-sm text-neutral-500">Cargando…</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-neutral-50 p-3 text-center text-sm">
              <div><span className="block text-xs text-neutral-400">Total</span><span className="font-semibold">{money(data.monto)}</span></div>
              <div><span className="block text-xs text-neutral-400">Pagado</span><span className="font-semibold text-emerald-700">{money(data.pagado)}</span></div>
              <div><span className="block text-xs text-neutral-400">Saldo</span><span className="font-semibold text-amber-700">{money(data.saldo)}</span></div>
            </div>

            {esEspera ? (
              <div className="space-y-2">
                <Button className="h-12 w-full text-base" disabled={pending} onClick={() => act(() => aprobarSena(reserva.id), 'Seña aprobada', true)}>
                  Aprobar seña
                </Button>
                <Button variant="outline" className="w-full" disabled={pending} onClick={() => act(() => rechazarSena(reserva.id), 'Seña rechazada', true)}>
                  Rechazar seña
                </Button>
              </div>
            ) : data.saldo > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {(['EFECTIVO', 'TRANSFERENCIA'] as MedioPago[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMedio(m)}
                      className={cn(
                        'h-12 rounded-xl border text-sm font-medium transition',
                        medio === m ? 'border-primary bg-primary/10 text-primary' : 'bg-white text-neutral-600',
                      )}
                    >
                      {m === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}
                    </button>
                  ))}
                </div>
                <Input type="number" min="0" inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value)} className="h-12 text-center text-lg" />
                <Button className="h-14 w-full text-base" disabled={pending} onClick={cobrar}>
                  Cobrar {money(Number(monto) || 0)}
                </Button>
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-50 py-4 text-center font-medium text-emerald-700">Pagado ✓</div>
            )}

            {data.cobros.length > 0 && (
              <ul className="space-y-1 border-t pt-3 text-sm">
                {data.cobros.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span>{money(c.monto)} · {c.medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}{c.origen === 'SENA' ? ' (seña)' : ''}</span>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => act(() => anularCobro(c.id), 'Cobro anulado')}>Anular</Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2 border-t pt-3">
              <Button variant="outline" className="flex-1" disabled={pending} onClick={() => { onOpenChange(false); onReprogramar(reserva.id); }}>
                Reprogramar
              </Button>
              <Button variant="ghost" className="flex-1 text-red-600" disabled={pending} onClick={() => act(() => cancelarReserva(reserva.id), 'Reserva cancelada', true)}>
                Cancelar
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: sin errores. (Confirmar que `cobroSchema` exporta `{ monto, medio }` y que `Button` acepta `variant="ghost"|"outline"` y `size="sm"` — ya se usan así en `cobros-dialog.tsx`/`reservas-table.tsx`.)

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/components/hoy/accion-turno-sheet.tsx
git commit -m "feat(hoy): hoja de accion con cobro express y acciones del turno"
```

### Task 8: Agenda del día (`agenda-hoy.tsx`)

**Files:**
- Create: `frontend/src/components/hoy/agenda-hoy.tsx`

Componente cliente que arma la pantalla: header pegajoso + stepper de días + botón Nuevo turno + lista de tarjetas (oculta CANCELADA) + estado vacío, y monta los diálogos/hoja.

- [ ] **Step 1: Crear el componente**

Crear `frontend/src/components/hoy/agenda-hoy.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NuevaReservaDialog } from '@/components/reservas/nueva-reserva-dialog';
import { ReprogramarDialog } from '@/components/reservas/reprogramar-dialog';
import { TurnoCard } from './turno-card';
import { AccionTurnoSheet } from './accion-turno-sheet';
import { addDias, esHoy, fmtFechaLarga } from '@/lib/fecha';
import type { Reserva, Cancha } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function AgendaHoy({
  reservas,
  canchas,
  fecha,
  totalCobrado,
}: {
  reservas: Reserva[];
  canchas: Cancha[];
  fecha: string;
  totalCobrado: number;
}) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Reserva | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reprogramarId, setReprogramarId] = useState<string | null>(null);

  const visibles = reservas.filter((r) => r.estado !== 'CANCELADA');
  const irA = (ymd: string) => router.push(`/hoy?fecha=${ymd}`);

  function abrir(r: Reserva) {
    setSeleccion(r);
    setSheetOpen(true);
  }

  return (
    <div className="space-y-4">
      <header className="sticky top-0 z-10 -mx-4 bg-neutral-50/95 px-4 pb-3 pt-1 backdrop-blur supports-backdrop-filter:bg-neutral-50/80">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{esHoy(fecha) ? 'Hoy' : 'Agenda'}</h1>
            <p className="text-sm capitalize text-neutral-500">{fmtFechaLarga(fecha)}</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            Cobrado: {money(totalCobrado)}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => irA(addDias(fecha, -1))} aria-label="Día anterior"><ChevronLeft className="h-4 w-4" /></Button>
          {!esHoy(fecha) && <Button variant="outline" size="sm" onClick={() => irA(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()))}>Hoy</Button>}
          <Button variant="outline" size="icon" onClick={() => irA(addDias(fecha, 1))} aria-label="Día siguiente"><ChevronRight className="h-4 w-4" /></Button>
          <div className="ml-auto">
            <NuevaReservaDialog canchas={canchas} />
          </div>
        </div>
      </header>

      {visibles.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white py-12 text-center">
          <CalendarDays className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm text-neutral-500">No hay turnos para este día.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibles.map((r) => <TurnoCard key={r.id} reserva={r} onClick={() => abrir(r)} />)}
        </div>
      )}

      <AccionTurnoSheet
        reserva={seleccion}
        open={sheetOpen}
        onOpenChange={(o) => { setSheetOpen(o); if (!o) setSeleccion(null); }}
        onReprogramar={(id) => setReprogramarId(id)}
      />
      <ReprogramarDialog
        id={reprogramarId}
        open={reprogramarId !== null}
        onOpenChange={(o) => { if (!o) setReprogramarId(null); }}
      />
    </div>
  );
}
```

> Nota: `NuevaReservaDialog` ya trae su propio botón "Nueva reserva" con `DialogTrigger render={<Button/>}`; en mobile queda a la derecha del stepper. Si se quiere a ancho completo, es un ajuste de Task 10 (build/QA), no bloqueante.

- [ ] **Step 2: Verificar tipos**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: sin errores. (Confirmar la firma de `ReprogramarDialog`: `{ id, open, onOpenChange }` — es la misma que usa `reservas-table.tsx`.)

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/components/hoy/agenda-hoy.tsx
git commit -m "feat(hoy): AgendaHoy con header, stepper de dias y lista de turnos"
```

### Task 9: Ruta `/hoy` (Server Component) + loading

**Files:**
- Create: `frontend/src/app/(panel)/hoy/page.tsx`
- Create: `frontend/src/app/(panel)/hoy/loading.tsx`

- [ ] **Step 1: Crear `page.tsx`** (fetch reservas del día + total de caja del día)

Crear `frontend/src/app/(panel)/hoy/page.tsx`:

```tsx
import { apiFetch } from '@/lib/api';
import type { Reserva, Cancha, CajaReporte } from '@/lib/types';
import { hoyAR } from '@/lib/fecha';
import { AgendaHoy } from '@/components/hoy/agenda-hoy';

export default async function HoyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const fecha = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : hoyAR();

  const [canchas, reservas, caja] = await Promise.all([
    apiFetch<Cancha[]>('/canchas'),
    apiFetch<Reserva[]>(`/reservas?fecha=${fecha}`),
    apiFetch<CajaReporte>(`/caja?desde=${fecha}&hasta=${fecha}`),
  ]);

  return <AgendaHoy reservas={reservas} canchas={canchas} fecha={fecha} totalCobrado={caja.total} />;
}
```

- [ ] **Step 2: Crear `loading.tsx`** (skeletons)

Crear `frontend/src/app/(panel)/hoy/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: sin errores. (Confirmar que `@/components/ui/skeleton` exporta `Skeleton` — existe el archivo `ui/skeleton.tsx`.)

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/app/\(panel\)/hoy/page.tsx src/app/\(panel\)/hoy/loading.tsx
git commit -m "feat(hoy): ruta /hoy (Server Component) + loading skeletons"
```

### Task 10: Navegación + landing post-login

**Files:**
- Modify: `frontend/src/components/nav-items.ts`
- Modify: `frontend/src/lib/auth.ts:30-31`

- [ ] **Step 1: Agregar `/hoy` como primer ítem del menú (AMBOS)**

En `frontend/src/components/nav-items.ts`, agregar `Sun` al import de `lucide-react` y el ítem al principio del array `nav`:

```typescript
import { Sun, LayoutDashboard, CalendarDays, CalendarRange, LandPlot, CalendarClock, Ban, Settings, Users, Activity, Wallet, type LucideIcon } from 'lucide-react';
```

```typescript
export const nav: NavItem[] = [
  { href: '/hoy', label: 'Hoy', icon: Sun, roles: AMBOS },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: SOLO_ADMIN },
  { href: '/reservas', label: 'Reservas', icon: CalendarDays, roles: AMBOS },
  // …resto igual…
```

- [ ] **Step 2: Mandar a `/hoy` después de loguear (ambos roles)**

En `frontend/src/lib/auth.ts`, cambiar el destino:

- Línea 20: `let destino = '/dashboard';` → `let destino = '/hoy';`
- Línea 31: `destino = data.admin?.rol === 'ADMIN' ? '/dashboard' : '/reservas';` → eliminar esa línea (el destino queda `/hoy` para todos).

- [ ] **Step 3: Verificar tipos**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/nav-items.ts src/lib/auth.ts
git commit -m "feat(hoy): /hoy como inicio del menu y landing post-login"
```

### Task 11: Build + suite completa (gate de merge)

**Files:** ninguno (verificación).

- [ ] **Step 1: Tests unitarios verdes**

Run: `cd frontend && pnpm test`
Expected: PASS (incluye `pago.test.ts`, `fecha.test.ts`, y los existentes).

- [ ] **Step 2: Lint**

Run: `cd frontend && pnpm lint`
Expected: sin errores (ojo con `@typescript-eslint/no-explicit-any`).

- [ ] **Step 3: Build (obligatorio)**

Run: `cd frontend && pnpm build`
Expected: build OK. Si falla por un export no-async en un módulo `'use server'`, corregir antes de seguir.

- [ ] **Step 4: QA manual mínimo** (mobile viewport)

`pnpm dev` y verificar en un viewport de celular: `/hoy` lista los turnos del día, el chip muestra el color correcto, tocar un turno abre la hoja, "Cobrar" baja el saldo y el chip cambia, el stepper ◀ Hoy ▶ navega, el estado vacío aparece en un día sin turnos. (Requiere el backend con `pagado/saldo` ya deployado, Task 1.)

- [ ] **Step 5: Commit final si hubo ajustes de QA**

```bash
cd frontend
git add -A
git commit -m "fix(hoy): ajustes de QA mobile"
```

### Cierre del frontend

- [ ] **Finalizar la rama frontend.** Anunciar e invocar **superpowers:finishing-a-development-branch** (verifica build/tests, merge a `master` local). No hay remoto en el frontend.

---

## Notas de coordinación

- **Orden:** el backend (Task 1) debe estar **deployado** antes de probar el frontend de verdad (el chip y la hoja dependen de `pagado`/`saldo`). El desarrollo del frontend puede avanzar en paralelo (los tipos ya contemplan los campos), pero el QA de Task 11 Step 4 necesita el backend en la VM.
- **Sin migración de DB.** El cambio backend es aditivo en la respuesta JSON.
- **Roles:** `/hoy` es para ADMIN y RECEPCIONISTA; `/dashboard` sigue siendo solo-admin.

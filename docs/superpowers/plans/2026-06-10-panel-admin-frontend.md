# Panel Admin Frontend (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Canchitas Ortigoza admin panel MVP (Login + Dashboard + Reservas) in Next.js, talking to the existing backend via a BFF pattern.

**Architecture:** Next 16 App Router. The browser only talks to Next. Server Components read data and Server Actions mutate, both calling the backend with the admin JWT stored in an httpOnly cookie. Backend base URL is the server-only env var `API_URL`.

**Tech Stack:** Next 16.2.9 (app router) · React 19 · Tailwind 4 · TypeScript · pnpm · shadcn/ui (Radix) · lucide-react · recharts · zod · Vitest.

---

## Context the implementer needs

- **Working dir:** `c:/Users/Lautaro/Desktop/ortigoza/frontend`. It is its own git repo. Work on branch `feat/admin-panel-mvp` (create from current; do NOT commit on the default branch).
- **Package manager is pnpm.** Use `pnpm add`, `pnpm dlx`, `pnpm exec`.
- **Commands:**
  - Typecheck: `pnpm exec tsc --noEmit`
  - Lint: `pnpm lint`
  - Unit tests: `pnpm exec vitest run`
  - Dev server (manual smoke): `pnpm dev`
- **Backend API shapes (verified against source):**
  - `POST /auth/login` body `{email,password}` → `{ token, admin: { id, email, nombre } }`. 401 → `{ error: { message } }` (error envelope; see below).
  - Backend error envelope on failures: JSON with an `error.message` string (the app's error middleware). When a call fails, read `body?.error?.message` for the user message.
  - `GET /reservas?fecha=YYYY-MM-DD&canchaId=&estado=` (JWT) → array of Reserva. Reserva shape: `{ id, canchaId, clienteId, fechaInicio, fechaFin, estado, esContacto, monto, montoSena, cancha: { id, nombre }, cliente: { id, nombre, whatsapp } }`. `estado` ∈ `CONFIRMADA|ESPERANDO_SENA|CANCELADA|COMPLETADA`. Ordered by fechaInicio asc.
  - `POST /reservas` body `{ canchaId, whatsapp, nombreCliente, esContacto, fecha:"YYYY-MM-DD", horaInicio:"HH:MM" }`. 409 = slot taken, 422 = invalid/past.
  - `PATCH /reservas/:id/cancelar` · `/reprogramar` (body `{fecha,horaInicio}`) · `/aprobar-sena` · `/rechazar-sena` (JWT/authAny).
  - `GET /canchas` (JWT) → `[{ id, nombre, tipo, precioHora, activa }]`.
  - `GET /disponibilidad?canchaId=&fecha=YYYY-MM-DD` → `{ slots: [{ horaInicio:"HH:MM", inicioUtc }] }`.
  - `GET /analytics/ingresos` → `{ total: number }`. `GET /analytics/canchas-top` → `[{ canchaId, reservas:number }]` (NO name — resolve via /canchas). `GET /analytics/horarios-pico` → `[{ hora:number, reservas }]` (reservas may arrive as string/number from a bigint; coerce with Number()). `GET /analytics/ocupacion` → `[{ dia, hora, reservas }]`.
  - **Caveat:** horarios-pico/ocupacion come from raw COUNT(*) (bigint) and may 500 on serialization. Treat those two as best-effort: if the call fails, the chart/card shows a local "no disponible" state, never breaks the page.
- **TZ:** business timezone is America/Argentina/Buenos_Aires. For "today" in date filters, compute the local date string in that TZ (helper provided in Task 5).

---

## File Structure

```
src/
  app/
    layout.tsx                 # root: fonts + <Toaster/> (modify existing)
    globals.css                # tailwind + shadcn tokens (exists)
    login/page.tsx             # login form (client) + calls login action
    (panel)/
      layout.tsx               # protected app shell (sidebar + topbar)
      dashboard/page.tsx       # metrics + charts (server component)
      reservas/page.tsx        # filters + table (server component)
      reservas/loading.tsx     # skeleton
  middleware.ts                # redirect unauthenticated -> /login
  lib/
    api.ts                     # apiFetch (BFF, reads cookie, calls API_URL)
    auth.ts                    # login()/logout() server actions + cookie consts
    types.ts                   # API TS types
    fecha.ts                   # TZ date helpers + filter parsing
    validators.ts              # zod schemas for forms
  components/
    ui/                        # shadcn/ui generated components
    app-shell.tsx              # sidebar + topbar
    estado-badge.tsx           # reserva estado -> badge
    reservas/
      reservas-table.tsx       # table (client) with row actions
      reprogramar-dialog.tsx
      nueva-reserva-dialog.tsx
    dashboard/
      metric-card.tsx
      horarios-chart.tsx       # recharts bar (client)
```

---

## Task 0: Project setup (deps, shadcn, vitest, env, branch)

**Files:**
- Modify: `package.json` (deps + scripts via tooling)
- Create: `.env.local`, `.env.example`, `vitest.config.ts`, `src/lib/` dir
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/admin-panel-mvp
```

- [ ] **Step 2: Install runtime deps**

```bash
pnpm add zod lucide-react recharts
```

- [ ] **Step 3: Install dev deps for tests**

```bash
pnpm add -D vitest
```

- [ ] **Step 4: Initialize shadcn/ui**

Run (accept defaults; base color = Neutral, CSS variables = yes):

```bash
pnpm dlx shadcn@latest init -d -b neutral
```

Then add the components used by the MVP:

```bash
pnpm dlx shadcn@latest add button input label card table badge dialog select sonner skeleton dropdown-menu
```

Expected: components created under `src/components/ui/`. If the CLI asks about Tailwind v4, accept.

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
```

- [ ] **Step 6: Add the test script to `package.json`**

In `package.json` `"scripts"`, add: `"test": "vitest run"`.

- [ ] **Step 7: Create env files**

`.env.example`:
```
# Base URL of the Canchitas backend API (server-side only, no NEXT_PUBLIC_).
# Dev: local/LAN backend. Prod: public VPS URL.
API_URL=http://localhost:3000
```

`.env.local` (not committed — confirm it's in `.gitignore`, Next's default ignores `.env*.local`):
```
API_URL=http://localhost:3000
```

- [ ] **Step 8: Add `<Toaster/>` to the root layout**

In `src/app/layout.tsx`, import and render the sonner Toaster inside `<body>` after `{children}`:

```tsx
import { Toaster } from '@/components/ui/sonner';
// ...inside <body>:
//   {children}
//   <Toaster richColors position="top-right" />
```

- [ ] **Step 9: Verify build tooling**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: setup deps, shadcn/ui, vitest, env, toaster"
```

---

## Task 1: API types + BFF fetch helper (TDD)

**Files:**
- Create: `src/lib/types.ts`, `src/lib/api.ts`, `src/lib/api.test.ts`

- [ ] **Step 1: Create `src/lib/types.ts`**

```ts
export type EstadoReserva = 'CONFIRMADA' | 'ESPERANDO_SENA' | 'CANCELADA' | 'COMPLETADA';

export interface Cancha { id: string; nombre: string; tipo: string; precioHora: number; activa: boolean }
export interface Cliente { id: string; nombre: string; whatsapp: string }
export interface Reserva {
  id: string; canchaId: string; clienteId: string;
  fechaInicio: string; fechaFin: string; estado: EstadoReserva;
  esContacto: boolean; monto: number; montoSena: number | null;
  cancha: Pick<Cancha, 'id' | 'nombre'>; cliente: Cliente;
}
export interface Slot { horaInicio: string; inicioUtc: string }
export interface LoginResult { token: string; admin: { id: string; email: string; nombre: string } }

// Thrown by apiFetch on non-2xx (except 401, which throws ApiAuthError).
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; } }
export class ApiAuthError extends ApiError { constructor(message = 'No autorizado') { super(401, message); this.name = 'ApiAuthError'; } }
```

- [ ] **Step 2: Write the failing test `src/lib/api.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseApiError } from '@/lib/api';

describe('parseApiError', () => {
  it('extracts error.message from the backend envelope', () => {
    expect(parseApiError({ error: { message: 'El horario ya está reservado' } }, 409))
      .toBe('El horario ya está reservado');
  });
  it('falls back to a generic message by status when no envelope', () => {
    expect(parseApiError(null, 500)).toMatch(/error/i);
  });
});
```

- [ ] **Step 2b: Run it to confirm it fails**

Run: `pnpm exec vitest run src/lib/api.test.ts`
Expected: FAIL — `parseApiError` not exported.

- [ ] **Step 3: Create `src/lib/api.ts`**

```ts
import 'server-only';
import { cookies } from 'next/headers';
import { ApiError, ApiAuthError } from './types';

export const TOKEN_COOKIE = 'token';

export function parseApiError(body: unknown, status: number): string {
  const msg = (body as { error?: { message?: string } } | null)?.error?.message;
  if (msg) return msg;
  if (status >= 500) return 'Error del servidor. Probá de nuevo en un rato.';
  return 'No se pudo completar la solicitud.';
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.API_URL;
  if (!base) throw new Error('API_URL no configurada');
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401) throw new ApiAuthError();
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, parseApiError(body, res.status));
  return body as T;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm exec vitest run src/lib/api.test.ts`
Expected: PASS (note: the test only imports `parseApiError`, a pure function, so `server-only`/`next/headers` are not exercised).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/types.ts src/lib/api.ts src/lib/api.test.ts
git commit -m "feat(lib): API types + BFF apiFetch with error parsing"
```

---

## Task 2: Auth (cookie, login/logout actions, login page, middleware)

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/validators.ts`, `src/lib/validators.test.ts`, `src/app/login/page.tsx`, `src/middleware.ts`

- [ ] **Step 1: Write failing test `src/lib/validators.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { loginSchema, nuevaReservaSchema } from '@/lib/validators';

describe('loginSchema', () => {
  it('accepts a valid email + password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'secret' }).success).toBe(true);
  });
  it('rejects a bad email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });
});

describe('nuevaReservaSchema', () => {
  it('requires fecha YYYY-MM-DD and hora HH:MM', () => {
    const ok = nuevaReservaSchema.safeParse({ canchaId: 'c1', nombreCliente: 'Juan', whatsapp: '+5491150000000', fecha: '2026-06-13', horaInicio: '20:00' });
    expect(ok.success).toBe(true);
    expect(nuevaReservaSchema.safeParse({ canchaId: 'c1', nombreCliente: 'Juan', whatsapp: '+5491150000000', fecha: '13/06', horaInicio: '20' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm exec vitest run src/lib/validators.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/validators.ts`**

```ts
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Ingresá la contraseña'),
});

export const nuevaReservaSchema = z.object({
  canchaId: z.string().min(1, 'Elegí una cancha'),
  nombreCliente: z.string().min(1, 'Ingresá el nombre'),
  whatsapp: z.string().min(5, 'Ingresá el WhatsApp'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
});

export const reprogramarSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
});
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm exec vitest run src/lib/validators.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/lib/auth.ts` (server actions)**

```ts
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TOKEN_COOKIE } from './api';
import type { LoginResult } from './types';

const MAX_AGE = 60 * 60 * 12; // 12h, matches backend JWT_EXPIRES_IN

export async function login(_prev: unknown, formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const base = process.env.API_URL;
  let token: string;
  try {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
    if (!res.ok) return { error: 'Credenciales inválidas' };
    const data = (await res.json()) as LoginResult;
    token = data.token;
  } catch {
    return { error: 'No se pudo conectar con el servidor' };
  }
  (await cookies()).set(TOKEN_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/', maxAge: MAX_AGE,
  });
  redirect('/dashboard');
}

export async function logout(): Promise<void> {
  (await cookies()).delete(TOKEN_COOKIE);
  redirect('/login');
}
```

- [ ] **Step 6: Create `src/app/login/page.tsx`**

```tsx
'use client';
import { useActionState } from 'react';
import { login } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle className="text-xl">Canchitas Ortigoza</CardTitle></CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 7: Create `src/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';

const TOKEN_COOKIE = 'token';

export function middleware(req: NextRequest) {
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  const { pathname } = req.nextUrl;
  const isLogin = pathname === '/login';
  if (!token && !isLogin) return NextResponse.redirect(new URL('/login', req.url));
  if (token && isLogin) return NextResponse.redirect(new URL('/dashboard', req.url));
  if (pathname === '/') return NextResponse.redirect(new URL(token ? '/dashboard' : '/login', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
```

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/auth.ts src/lib/validators.ts src/lib/validators.test.ts src/app/login/page.tsx src/middleware.ts
git commit -m "feat(auth): login/logout actions, login page, route protection middleware"
```

---

## Task 3: App shell (protected layout: sidebar + topbar)

**Files:**
- Create: `src/components/app-shell.tsx`, `src/app/(panel)/layout.tsx`

- [ ] **Step 1: Create `src/components/app-shell.tsx`**

```tsx
import Link from 'next/link';
import { LayoutDashboard, CalendarDays, LogOut } from 'lucide-react';
import { logout } from '@/lib/auth';
import { Button } from '@/components/ui/button';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/reservas', label: 'Reservas', icon: CalendarDays },
];

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside className="hidden w-60 flex-col border-r bg-white md:flex">
        <div className="px-5 py-4 text-lg font-semibold">Canchitas Ortigoza</div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100">
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-white px-6 py-3">
          <span className="text-sm text-neutral-500 md:hidden font-semibold">Canchitas</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-neutral-600">{email}</span>
            <form action={logout}>
              <Button variant="ghost" size="sm" type="submit"><LogOut className="mr-1 h-4 w-4" /> Salir</Button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(panel)/layout.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiAuthError } from '@/lib/types';
import { AppShell } from '@/components/app-shell';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  let email = '';
  try {
    const me = await apiFetch<{ email: string }>('/auth/me');
    email = me.email;
  } catch (e) {
    if (e instanceof ApiAuthError) redirect('/login');
    throw e;
  }
  return <AppShell email={email}>{children}</AppShell>;
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/components/app-shell.tsx "src/app/(panel)/layout.tsx"
git commit -m "feat(panel): protected app shell with sidebar + topbar + logout"
```

---

## Task 4: Dashboard

**Files:**
- Create: `src/components/dashboard/metric-card.tsx`, `src/components/dashboard/horarios-chart.tsx`, `src/app/(panel)/dashboard/page.tsx`, `src/lib/fecha.ts`, `src/lib/fecha.test.ts`

- [ ] **Step 1: Write failing test `src/lib/fecha.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { hoyAR, parseFiltros } from '@/lib/fecha';

describe('hoyAR', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(hoyAR()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseFiltros', () => {
  it('defaults fecha to today and leaves cancha/estado empty', () => {
    const f = parseFiltros({});
    expect(f.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.canchaId).toBe('');
    expect(f.estado).toBe('');
  });
  it('reads provided values', () => {
    const f = parseFiltros({ fecha: '2026-06-13', canchaId: 'c1', estado: 'CONFIRMADA' });
    expect(f).toEqual({ fecha: '2026-06-13', canchaId: 'c1', estado: 'CONFIRMADA' });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm exec vitest run src/lib/fecha.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/fecha.ts`**

```ts
const TZ = 'America/Argentina/Buenos_Aires';

export function hoyAR(): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(d);
  const h = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${f} ${h}`;
}

export interface Filtros { fecha: string; canchaId: string; estado: string }
export function parseFiltros(sp: Record<string, string | undefined>): Filtros {
  return {
    fecha: sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : hoyAR(),
    canchaId: sp.canchaId ?? '',
    estado: sp.estado ?? '',
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm exec vitest run src/lib/fecha.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/components/dashboard/metric-card.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function MetricCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-neutral-500">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Create `src/components/dashboard/horarios-chart.tsx`**

```tsx
'use client';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function HorariosChart({ data }: { data: { hora: string; reservas: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-500">Horarios pico</CardTitle></CardHeader>
      <CardContent className="h-64">
        {data.length === 0 ? (
          <p className="text-sm text-neutral-400">No disponible.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="hora" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip />
              <Bar dataKey="reservas" fill="#171717" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Create `src/app/(panel)/dashboard/page.tsx`**

```tsx
import { apiFetch } from '@/lib/api';
import type { Reserva, Cancha } from '@/lib/types';
import { hoyAR } from '@/lib/fecha';
import { MetricCard } from '@/components/dashboard/metric-card';
import { HorariosChart } from '@/components/dashboard/horarios-chart';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

export default async function DashboardPage() {
  const hoy = hoyAR();
  const [ingresos, reservasHoy, canchasTop, canchas, horarios] = await Promise.all([
    safe(apiFetch<{ total: number }>('/analytics/ingresos'), { total: 0 }),
    safe(apiFetch<Reserva[]>(`/reservas?fecha=${hoy}`), []),
    safe(apiFetch<{ canchaId: string; reservas: number }[]>('/analytics/canchas-top'), []),
    safe(apiFetch<Cancha[]>('/canchas'), []),
    safe(apiFetch<{ hora: number; reservas: number | string }[]>('/analytics/horarios-pico'), []),
  ]);

  const topNombre = canchasTop[0]
    ? (canchas.find((c) => c.id === canchasTop[0].canchaId)?.nombre ?? '—')
    : '—';
  const horariosData = horarios
    .map((h) => ({ hora: `${h.hora}:00`, reservas: Number(h.reservas) }))
    .sort((a, b) => parseInt(a.hora) - parseInt(b.hora));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard title="Ingresos" value={money(ingresos.total)} hint="Reservas confirmadas/completadas" />
        <MetricCard title="Reservas de hoy" value={String(reservasHoy.length)} hint={hoy} />
        <MetricCard title="Cancha más reservada" value={topNombre} />
      </div>
      <HorariosChart data={horariosData} />
    </div>
  );
}
```

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/fecha.ts src/lib/fecha.test.ts src/components/dashboard "src/app/(panel)/dashboard/page.tsx"
git commit -m "feat(dashboard): metrics cards + horarios chart with graceful degradation"
```

---

## Task 5: Reservas — list, filters, table, estado badge

**Files:**
- Create: `src/components/estado-badge.tsx`, `src/components/reservas/reservas-table.tsx`, `src/app/(panel)/reservas/page.tsx`, `src/app/(panel)/reservas/loading.tsx`

- [ ] **Step 1: Create `src/components/estado-badge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge';
import type { EstadoReserva } from '@/lib/types';

const MAP: Record<EstadoReserva, { label: string; className: string }> = {
  CONFIRMADA: { label: 'Confirmada', className: 'bg-green-100 text-green-800 hover:bg-green-100' },
  ESPERANDO_SENA: { label: 'Esperando seña', className: 'bg-amber-100 text-amber-800 hover:bg-amber-100' },
  CANCELADA: { label: 'Cancelada', className: 'bg-neutral-200 text-neutral-700 hover:bg-neutral-200' },
  COMPLETADA: { label: 'Completada', className: 'bg-blue-100 text-blue-800 hover:bg-blue-100' },
};

export function EstadoBadge({ estado }: { estado: EstadoReserva }) {
  const c = MAP[estado];
  return <Badge variant="secondary" className={c.className}>{c.label}</Badge>;
}
```

- [ ] **Step 2: Create `src/app/(panel)/reservas/loading.tsx`**

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```

- [ ] **Step 3: Create the filters bar + table shell `src/app/(panel)/reservas/page.tsx`**

Note: the page is a Server Component. Filters are plain `<form method="get">` controls (no client JS needed) that submit query params; changing them reloads the server component. The table with row actions is a client island (`ReservasTable`, built in Task 6 — for now render the rows read-only; Task 6 adds the action menu).

```tsx
import { apiFetch } from '@/lib/api';
import type { Reserva, Cancha } from '@/lib/types';
import { parseFiltros } from '@/lib/fecha';
import { ReservasTable } from '@/components/reservas/reservas-table';
import { NuevaReservaDialog } from '@/components/reservas/nueva-reserva-dialog';

const ESTADOS = ['', 'CONFIRMADA', 'ESPERANDO_SENA', 'CANCELADA', 'COMPLETADA'] as const;

export default async function ReservasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const f = parseFiltros(await searchParams);
  const canchas = await apiFetch<Cancha[]>('/canchas');
  const qs = new URLSearchParams({ fecha: f.fecha, ...(f.canchaId && { canchaId: f.canchaId }), ...(f.estado && { estado: f.estado }) });
  const reservas = await apiFetch<Reserva[]>(`/reservas?${qs.toString()}`);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reservas</h1>
        <NuevaReservaDialog canchas={canchas} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <label className="flex flex-col text-sm">Fecha
          <input type="date" name="fecha" defaultValue={f.fecha} className="mt-1 rounded-md border px-2 py-1.5" />
        </label>
        <label className="flex flex-col text-sm">Cancha
          <select name="canchaId" defaultValue={f.canchaId} className="mt-1 rounded-md border px-2 py-1.5">
            <option value="">Todas</option>
            {canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">Estado
          <select name="estado" defaultValue={f.estado} className="mt-1 rounded-md border px-2 py-1.5">
            {ESTADOS.map((e) => <option key={e} value={e}>{e === '' ? 'Todos' : e}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">Filtrar</button>
      </form>

      <ReservasTable reservas={reservas} canchas={canchas} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: errors only about the not-yet-created `ReservasTable` / `NuevaReservaDialog` imports — proceed to Task 6 which creates them. (If you want a green checkpoint now, temporarily stub those two components returning `null`.)

- [ ] **Step 5: Commit (after Task 6 components exist, or with stubs)**

```bash
git add src/components/estado-badge.tsx "src/app/(panel)/reservas/loading.tsx" "src/app/(panel)/reservas/page.tsx"
git commit -m "feat(reservas): list page with filters + estado badge + loading skeleton"
```

---

## Task 6: Reservas — row actions (cancel / reschedule / approve / reject seña)

**Files:**
- Create: `src/lib/reservas-actions.ts`, `src/components/reservas/reservas-table.tsx`, `src/components/reservas/reprogramar-dialog.tsx`

- [ ] **Step 1: Create server actions `src/lib/reservas-actions.ts`**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/reservas'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export const cancelarReserva = (id: string) =>
  run(() => apiFetch(`/reservas/${id}/cancelar`, { method: 'PATCH' }));

export const aprobarSena = (id: string) =>
  run(() => apiFetch(`/reservas/${id}/aprobar-sena`, { method: 'PATCH', body: '{}' }));

export const rechazarSena = (id: string) =>
  run(() => apiFetch(`/reservas/${id}/rechazar-sena`, { method: 'PATCH' }));

export const reprogramarReserva = (id: string, fecha: string, horaInicio: string) =>
  run(() => apiFetch(`/reservas/${id}/reprogramar`, { method: 'PATCH', body: JSON.stringify({ fecha, horaInicio }) }));
```

- [ ] **Step 2: Create `src/components/reservas/reprogramar-dialog.tsx`**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { reprogramarReserva } from '@/lib/reservas-actions';
import { reprogramarSchema } from '@/lib/validators';

export function ReprogramarDialog({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    const parsed = reprogramarSchema.safeParse({ fecha, horaInicio: hora });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await reprogramarReserva(id, fecha, hora);
      if (r.ok) { toast.success('Reserva reprogramada'); setOpen(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button className="w-full px-2 py-1.5 text-left text-sm hover:bg-neutral-100">Reprogramar</button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Reprogramar reserva</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Fecha</Label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-md border px-2 py-1.5" /></div>
          <div className="space-y-1"><Label>Hora</Label><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="w-full rounded-md border px-2 py-1.5" /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : 'Reprogramar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create `src/components/reservas/reservas-table.tsx`**

```tsx
'use client';
import { useTransition } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { EstadoBadge } from '@/components/estado-badge';
import { fmtFechaHora } from '@/lib/fecha';
import type { Reserva, Cancha } from '@/lib/types';
import { cancelarReserva, aprobarSena, rechazarSena } from '@/lib/reservas-actions';
import { ReprogramarDialog } from './reprogramar-dialog';

const money = (n: number | null) => (n == null ? '—' : '$' + Number(n).toLocaleString('es-AR'));

export function ReservasTable({ reservas }: { reservas: Reserva[]; canchas: Cancha[] }) {
  const [pending, start] = useTransition();
  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    start(async () => { const r = await fn(); r.ok ? toast.success(okMsg) : toast.error(r.error ?? 'Error'); });
  }
  if (reservas.length === 0) return <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-500">No hay reservas para este filtro.</p>;
  return (
    <div className="rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Cliente</TableHead><TableHead>Cancha</TableHead><TableHead>Fecha/Hora</TableHead><TableHead>Estado</TableHead><TableHead>Seña</TableHead><TableHead className="w-10" /></TableRow>
        </TableHeader>
        <TableBody>
          {reservas.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.cliente?.nombre ?? '—'}<div className="text-xs text-neutral-400">{r.cliente?.whatsapp}</div></TableCell>
              <TableCell>{r.cancha?.nombre ?? '—'}</TableCell>
              <TableCell>{fmtFechaHora(r.fechaInicio)}</TableCell>
              <TableCell><EstadoBadge estado={r.estado} /></TableCell>
              <TableCell>{money(r.montoSena)}</TableCell>
              <TableCell>
                {(r.estado === 'CONFIRMADA' || r.estado === 'ESPERANDO_SENA') && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={pending}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {r.estado === 'ESPERANDO_SENA' && <DropdownMenuItem onSelect={() => act(() => aprobarSena(r.id), 'Seña aprobada')}>Aprobar seña</DropdownMenuItem>}
                      {r.estado === 'ESPERANDO_SENA' && <DropdownMenuItem onSelect={() => act(() => rechazarSena(r.id), 'Seña rechazada')}>Rechazar seña</DropdownMenuItem>}
                      <ReprogramarDialog id={r.id} />
                      <DropdownMenuItem className="text-red-600" onSelect={() => act(() => cancelarReserva(r.id), 'Reserva cancelada')}>Cancelar</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/reservas-actions.ts src/components/reservas/reservas-table.tsx src/components/reservas/reprogramar-dialog.tsx
git commit -m "feat(reservas): row actions (cancel/reschedule/approve/reject sena) via server actions"
```

---

## Task 7: Nueva reserva (dialog + disponibilidad + create)

**Files:**
- Create: `src/components/reservas/nueva-reserva-dialog.tsx`
- Add to: `src/lib/reservas-actions.ts` (the `crearReserva` action)

- [ ] **Step 1: Add `crearReserva` to `src/lib/reservas-actions.ts`**

Append:

```ts
import type { Slot } from './types';

export async function getDisponibilidad(canchaId: string, fecha: string): Promise<Slot[]> {
  try { const r = await apiFetch<{ slots: Slot[] }>(`/disponibilidad?canchaId=${canchaId}&fecha=${fecha}`); return r.slots ?? []; }
  catch { return []; }
}

export const crearReserva = (input: { canchaId: string; whatsapp: string; nombreCliente: string; fecha: string; horaInicio: string }) =>
  run(() => apiFetch('/reservas', { method: 'POST', body: JSON.stringify({ ...input, esContacto: false }) }));
```

- [ ] **Step 2: Create `src/components/reservas/nueva-reserva-dialog.tsx`**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Cancha, Slot } from '@/lib/types';
import { crearReserva, getDisponibilidad } from '@/lib/reservas-actions';
import { nuevaReservaSchema } from '@/lib/validators';

export function NuevaReservaDialog({ canchas }: { canchas: Cancha[] }) {
  const [open, setOpen] = useState(false);
  const [canchaId, setCanchaId] = useState('');
  const [fecha, setFecha] = useState('');
  const [horaInicio, setHora] = useState('');
  const [nombreCliente, setNombre] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pending, start] = useTransition();

  async function cargarSlots(cId: string, f: string) {
    setHora('');
    if (cId && f) setSlots(await getDisponibilidad(cId, f)); else setSlots([]);
  }

  function submit() {
    const parsed = nuevaReservaSchema.safeParse({ canchaId, nombreCliente, whatsapp, fecha, horaInicio });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await crearReserva({ canchaId, whatsapp, nombreCliente, fecha, horaInicio });
      if (r.ok) { toast.success('Reserva creada'); setOpen(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" /> Nueva reserva</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nueva reserva</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Cancha</Label>
            <select value={canchaId} className="w-full rounded-md border px-2 py-1.5"
              onChange={(e) => { setCanchaId(e.target.value); cargarSlots(e.target.value, fecha); }}>
              <option value="">Elegí una cancha</option>
              {canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label>Fecha</Label>
            <input type="date" value={fecha} className="w-full rounded-md border px-2 py-1.5"
              onChange={(e) => { setFecha(e.target.value); cargarSlots(canchaId, e.target.value); }} />
          </div>
          <div className="space-y-1"><Label>Hora</Label>
            <select value={horaInicio} onChange={(e) => setHora(e.target.value)} className="w-full rounded-md border px-2 py-1.5" disabled={!slots.length}>
              <option value="">{slots.length ? 'Elegí un horario' : 'Elegí cancha y fecha'}</option>
              {slots.map((s) => <option key={s.horaInicio} value={s.horaInicio}>{s.horaInicio}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Cliente</Label><Input value={nombreCliente} onChange={(e) => setNombre(e.target.value)} /></div>
            <div className="space-y-1"><Label>WhatsApp</Label><Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+54911..." /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Creando…' : 'Crear reserva'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Full typecheck, lint, tests**

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm exec vitest run
```
Expected: all green (3 test files: api, validators, fecha).

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run `pnpm dev` with `API_URL` pointing to a running backend; log in, view dashboard, filter reservas, create/cancel one. Confirm toasts and that the table refreshes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservas-actions.ts src/components/reservas/nueva-reserva-dialog.tsx
git commit -m "feat(reservas): nueva reserva dialog with availability + create action"
```

---

## Completion

After all tasks pass (`tsc`, `lint`, `vitest` green):
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verify, then present merge/PR options for `feat/admin-panel-mvp`.

**Out of scope (Fase 2):** Canchas (ABM/precios/activar), Clientes (listado/detalle), Config de seña, dark mode, E2E (Playwright).

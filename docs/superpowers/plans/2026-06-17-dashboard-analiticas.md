# Analíticas del Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard con selector de período (Hoy/7/30 días) que afecta a todo: ingresos del período + tendencia diaria, horarios más pedidos, y ocupación (mapa de calor día×hora).

**Architecture:** Backend extiende `analytics.service`/rutas para aceptar `?desde&hasta` y suma `ingresos-por-dia`. Frontend reescribe el dashboard con un selector (searchParam) + 2 componentes nuevos (gráfico de ingresos diarios, heatmap de ocupación) reusando recharts y los endpoints.

**Tech Stack:** Backend Node/Express/Prisma 7 ($queryRaw), Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 + recharts + pnpm.

**Spec:** `docs/superpowers/specs/2026-06-17-dashboard-analiticas-design.md`

**Gotchas:** `$queryRaw` tagged template parametriza `${desde}`/`${hasta}` (Date) solo. `serializeBigInt` para queries con COUNT (bigint). `searchParams` es Promise en Next 16. El heatmap usa color dinámico por **inline style** (no clase Tailwind dinámica). `pnpm lint`+`pnpm build` obligatorios. Sin migración de DB.

> Ramas: backend `feat/dashboard-analytics` (de main); frontend `feat/dashboard-analytics-panel` (de master).

---

# BACKEND — rama `feat/dashboard-analytics`

> `cd backend && git checkout main && git pull && git checkout -b feat/dashboard-analytics`. Docker para tests.

### Task 1: analytics con rango + ingresos-por-dia (TDD)

**Files:** Modify `src/services/analytics.service.ts`, `src/routes/analytics.routes.ts`. Test: `tests/integration/analytics.test.ts` (agregar casos).

- [ ] **Step 1: Agregar tests que fallan.** Agregar dentro del `describe('analytics', ...)` en `tests/integration/analytics.test.ts`:
```typescript
  it('ingresos respeta el rango', async () => {
    const dentro = await supertest(app).get('/analytics/ingresos?desde=2026-06-10&hasta=2026-06-15').set('authorization', `Bearer ${token}`);
    expect(Number(dentro.body.total)).toBe(1000);
    const fuera = await supertest(app).get('/analytics/ingresos?desde=2026-01-01&hasta=2026-01-31').set('authorization', `Bearer ${token}`);
    expect(Number(fuera.body.total)).toBe(0);
  });
  it('ingresos-por-dia agrupa por dia (TZ Argentina)', async () => {
    const r = await supertest(app).get('/analytics/ingresos-por-dia?desde=2026-06-10&hasta=2026-06-15').set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    const dia = (r.body as any[]).find((x) => x.fecha === '2026-06-12');
    expect(dia).toBeTruthy();
    expect(Number(dia.total)).toBe(1000);
  });
  it('ocupacion respeta el rango', async () => {
    const dentro = await supertest(app).get('/analytics/ocupacion?desde=2026-06-10&hasta=2026-06-15').set('authorization', `Bearer ${token}`);
    expect(dentro.body.length).toBeGreaterThan(0);
    const fuera = await supertest(app).get('/analytics/ocupacion?desde=2026-01-01&hasta=2026-01-31').set('authorization', `Bearer ${token}`);
    expect(fuera.body.length).toBe(0);
  });
```

- [ ] **Step 2: Correr → FALLA.** `cd backend && npx vitest run tests/integration/analytics.test.ts` → FAIL (la ruta ignora el query; ingresos-por-dia no existe).

- [ ] **Step 3: Implementar — reemplazar TODO `src/services/analytics.service.ts`:**
```typescript
import { prisma } from '../db/prisma.js';

const ACTIVE = ['CONFIRMADA', 'COMPLETADA'] as const;

export const analyticsService = {
  async ingresos(desde: Date, hasta: Date) {
    const agg = await prisma.reserva.aggregate({
      _sum: { monto: true },
      where: { estado: { in: [...ACTIVE] }, fechaInicio: { gte: desde, lt: hasta } },
    });
    return { total: agg._sum.monto ?? 0 };
  },

  async canchasTop(desde: Date, hasta: Date) {
    const rows = await prisma.reserva.groupBy({
      by: ['canchaId'],
      where: { estado: { in: [...ACTIVE] }, fechaInicio: { gte: desde, lt: hasta } },
      _count: { canchaId: true },
      orderBy: { _count: { canchaId: 'desc' } },
    });
    return rows.map((r) => ({ canchaId: r.canchaId, reservas: r._count.canchaId }));
  },

  horariosPico(desde: Date, hasta: Date) {
    return prisma.$queryRaw<Array<{ hora: number; reservas: bigint }>>`
      SELECT EXTRACT(HOUR FROM "fechaInicio")::int AS hora, COUNT(*) AS reservas
      FROM "Reserva"
      WHERE estado IN ('CONFIRMADA','COMPLETADA') AND "fechaInicio" >= ${desde} AND "fechaInicio" < ${hasta}
      GROUP BY 1 ORDER BY reservas DESC`;
  },

  ocupacion(desde: Date, hasta: Date) {
    return prisma.$queryRaw<Array<{ dia: number; hora: number; reservas: bigint }>>`
      SELECT EXTRACT(DOW FROM "fechaInicio")::int AS dia, EXTRACT(HOUR FROM "fechaInicio")::int AS hora, COUNT(*) AS reservas
      FROM "Reserva"
      WHERE estado IN ('CONFIRMADA','COMPLETADA') AND "fechaInicio" >= ${desde} AND "fechaInicio" < ${hasta}
      GROUP BY 1,2 ORDER BY dia, hora`;
  },

  ingresosPorDia(desde: Date, hasta: Date) {
    return prisma.$queryRaw<Array<{ fecha: string; total: number }>>`
      SELECT to_char(("fechaInicio" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM-DD') AS fecha,
             SUM("monto")::float8 AS total
      FROM "Reserva"
      WHERE estado IN ('CONFIRMADA','COMPLETADA') AND "fechaInicio" >= ${desde} AND "fechaInicio" < ${hasta}
      GROUP BY 1 ORDER BY 1`;
  },
};
```

- [ ] **Step 4: Implementar — reemplazar TODO `src/routes/analytics.routes.ts`:**
```typescript
import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { analyticsService } from '../services/analytics.service.js';
import { getEnv } from '../config/env.js';
import { dayWindowUtc } from '../utils/tz.js';

export const analyticsRoutes = Router();
analyticsRoutes.use(authJwt, requireRole('ADMIN'));

function serializeBigInt(rows: any[]) {
  return rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])),
  );
}

// Parsea ?desde&hasta (YYYY-MM-DD) a ventana UTC; default últimos 30 días.
function rango(req: any): { desde: Date; hasta: Date } {
  const tz = getEnv().TZ_NEGOCIO;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const q = req.query || {};
  const hastaYmd = re.test(q.hasta) ? q.hasta : hoy;
  const desdeYmd = re.test(q.desde) ? q.desde : new Date(Date.now() - 29 * 86400000).toLocaleDateString('en-CA', { timeZone: tz });
  return { desde: dayWindowUtc(desdeYmd, tz).start, hasta: dayWindowUtc(hastaYmd, tz).end };
}

analyticsRoutes.get('/ingresos', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(await analyticsService.ingresos(desde, hasta)); } catch (e) { next(e); }
});
analyticsRoutes.get('/ingresos-por-dia', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(await analyticsService.ingresosPorDia(desde, hasta)); } catch (e) { next(e); }
});
analyticsRoutes.get('/canchas-top', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(await analyticsService.canchasTop(desde, hasta)); } catch (e) { next(e); }
});
analyticsRoutes.get('/horarios-pico', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(serializeBigInt(await analyticsService.horariosPico(desde, hasta))); } catch (e) { next(e); }
});
analyticsRoutes.get('/ocupacion', async (req, res, next) => {
  try { const { desde, hasta } = rango(req); res.json(serializeBigInt(await analyticsService.ocupacion(desde, hasta))); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Correr → PASA.** `npx vitest run tests/integration/analytics.test.ts` → todo verde (los 3 tests viejos siguen pasando: sin query usan el default últimos 30 días, que incluye la reserva del 2026-06-12).
- [ ] **Step 6:** `npx tsc --noEmit` → 0 errores.
- [ ] **Step 7: Commit:**
```bash
git add src/services/analytics.service.ts src/routes/analytics.routes.ts tests/integration/analytics.test.ts
git commit -m "feat(analytics): rango desde/hasta en todas + ingresos-por-dia"
```

### Cierre backend
- [ ] **Step 8:** **superpowers:finishing-a-development-branch** → merge main + push. Deploy VM (usuario).

---

# FRONTEND — rama `feat/dashboard-analytics-panel`

> `cd frontend && git checkout master && git checkout -b feat/dashboard-analytics-panel`.

### Task 2: tipos + componentes nuevos

**Files:** Modify `src/lib/types.ts`; Create `src/components/dashboard/periodo-selector.tsx`, `src/components/dashboard/ingresos-chart.tsx`, `src/components/dashboard/ocupacion-heatmap.tsx`.

- [ ] **Step 1: `types.ts`** — agregar:
```typescript
export interface IngresoDia { fecha: string; total: number }
export interface OcupacionCelda { dia: number; hora: number; reservas: number }
export interface HorarioPico { hora: number; reservas: number }
```

- [ ] **Step 2: `periodo-selector.tsx`** (cliente):
```tsx
'use client';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const OPCIONES: { v: string; label: string }[] = [
  { v: 'hoy', label: 'Hoy' },
  { v: '7', label: '7 días' },
  { v: '30', label: '30 días' },
];

export function PeriodoSelector({ periodo }: { periodo: string }) {
  const router = useRouter();
  return (
    <div className="inline-flex rounded-lg border bg-white p-0.5">
      {OPCIONES.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => router.push(`/dashboard?periodo=${o.v}`)}
          className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', periodo === o.v ? 'bg-primary text-primary-foreground' : 'text-neutral-600 hover:bg-neutral-100')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `ingresos-chart.tsx`** (cliente, recharts):
```tsx
'use client';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function IngresosChart({ data }: { data: { fecha: string; total: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-500">Ingresos por día</CardTitle></CardHeader>
      <CardContent className="h-64">
        {data.length === 0 ? (
          <p className="text-sm text-neutral-400">Sin ingresos en el período.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="fecha" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(f) => f.slice(8, 10) + '/' + f.slice(5, 7)} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => money(Number(v))} />
              <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(f) => String(f)} />
              <Bar dataKey="total" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: `ocupacion-heatmap.tsx`** (presentacional; color por inline style):
```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OcupacionCelda } from '@/lib/types';

const DIAS = [{ dow: 1, l: 'Lun' }, { dow: 2, l: 'Mar' }, { dow: 3, l: 'Mié' }, { dow: 4, l: 'Jue' }, { dow: 5, l: 'Vie' }, { dow: 6, l: 'Sáb' }, { dow: 0, l: 'Dom' }];

export function OcupacionHeatmap({ data, horaApertura, horaCierre }: { data: OcupacionCelda[]; horaApertura: string; horaCierre: string }) {
  const ini = Number(horaApertura.slice(0, 2));
  const fin = Number(horaCierre.slice(0, 2));
  const horas: number[] = [];
  for (let h = ini; h < fin; h++) horas.push(h);
  const byKey = new Map(data.map((c) => [`${c.dia}|${c.hora}`, c.reservas]));
  const max = data.reduce((m, c) => Math.max(m, c.reservas), 0);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-500">Ocupación (cuándo se llena)</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[420px]">
            <div className="grid text-center text-[11px] text-neutral-400" style={{ gridTemplateColumns: '40px repeat(7, 1fr)' }}>
              <div></div>
              {DIAS.map((d) => <div key={d.dow} className="pb-1 font-medium">{d.l}</div>)}
            </div>
            {horas.map((h) => (
              <div key={h} className="grid items-center" style={{ gridTemplateColumns: '40px repeat(7, 1fr)' }}>
                <div className="pr-1 text-right text-[11px] text-neutral-400">{String(h).padStart(2, '0')}</div>
                {DIAS.map((d) => {
                  const n = byKey.get(`${d.dow}|${h}`) ?? 0;
                  const alpha = max > 0 && n > 0 ? 0.15 + 0.85 * (n / max) : 0;
                  return (
                    <div key={d.dow} className="m-0.5 h-6 rounded" title={`${d.l} ${h}:00 · ${n} reservas`}
                      style={{ backgroundColor: n > 0 ? `rgba(22,163,74,${alpha})` : '#f1f5f9' }} />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">Más oscuro = más reservado.</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5:** `cd frontend && pnpm exec tsc --noEmit` → 0 errores. Commit:
```bash
git add src/lib/types.ts src/components/dashboard/periodo-selector.tsx src/components/dashboard/ingresos-chart.tsx src/components/dashboard/ocupacion-heatmap.tsx
git commit -m "feat(dashboard): selector de periodo, grafico ingresos/dia, heatmap ocupacion"
```

### Task 3: reescribir el dashboard

**Files:** Modify `src/app/(panel)/dashboard/page.tsx`.

- [ ] **Step 1: Reemplazar TODO `src/app/(panel)/dashboard/page.tsx`:**
```tsx
import { DollarSign, CalendarDays, Trophy } from 'lucide-react';
import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Reserva, Cancha, Config, IngresoDia, OcupacionCelda, HorarioPico } from '@/lib/types';
import { hoyAR, addDias } from '@/lib/fecha';
import { MetricCard } from '@/components/dashboard/metric-card';
import { HorariosChart } from '@/components/dashboard/horarios-chart';
import { IngresosChart } from '@/components/dashboard/ingresos-chart';
import { OcupacionHeatmap } from '@/components/dashboard/ocupacion-heatmap';
import { PeriodoSelector } from '@/components/dashboard/periodo-selector';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> { try { return await p; } catch { return fallback; } }

const PERIODOS: Record<string, number> = { hoy: 0, '7': 6, '30': 29 };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const periodo = sp.periodo && sp.periodo in PERIODOS ? sp.periodo : '30';
  const hasta = hoyAR();
  const desde = addDias(hasta, -PERIODOS[periodo]);
  const qs = `desde=${desde}&hasta=${hasta}`;

  const [ingresos, reservas, canchasTop, canchas, horarios, ingresosDia, ocupacion, config] = await Promise.all([
    safe(apiFetch<{ total: number }>(`/analytics/ingresos?${qs}`), { total: 0 }),
    safe(apiFetch<Reserva[]>(`/reservas?${qs}`), []),
    safe(apiFetch<{ canchaId: string; reservas: number }[]>(`/analytics/canchas-top?${qs}`), []),
    safe(apiFetch<Cancha[]>('/canchas'), []),
    safe(apiFetch<HorarioPico[]>(`/analytics/horarios-pico?${qs}`), []),
    safe(apiFetch<IngresoDia[]>(`/analytics/ingresos-por-dia?${qs}`), []),
    safe(apiFetch<OcupacionCelda[]>(`/analytics/ocupacion?${qs}`), []),
    safe(apiFetch<Config>('/config'), { horaApertura: '09:00', horaCierre: '23:00' } as Config),
  ]);

  const topNombre = canchasTop[0] ? (canchas.find((c) => c.id === canchasTop[0].canchaId)?.nombre ?? '—') : '—';
  const horariosData = horarios.map((h) => ({ hora: `${h.hora}:00`, reservas: Number(h.reservas) })).sort((a, b) => parseInt(a.hora) - parseInt(b.hora));
  const ingresosData = [...ingresosDia].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((d) => ({ fecha: d.fecha, total: Number(d.total) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-500">Resumen del complejo.</p>
        </div>
        <PeriodoSelector periodo={periodo} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard title="Ingresos del período" value={money(ingresos.total)} hint="Reservas confirmadas/completadas" Icon={DollarSign} />
        <MetricCard title="Reservas del período" value={String(reservas.length)} Icon={CalendarDays} />
        <MetricCard title="Cancha más reservada" value={topNombre} Icon={Trophy} />
      </div>
      <IngresosChart data={ingresosData} />
      <div className="grid gap-4 lg:grid-cols-2">
        <HorariosChart data={horariosData} />
        <OcupacionHeatmap data={ocupacion} horaApertura={config.horaApertura} horaCierre={config.horaCierre} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** Verificar que `addDias` existe en `src/lib/fecha.ts` (se agregó en la Vista Hoy: `addDias(ymd, n)`). Si no, usarlo igual (existe). `Config` type tiene `horaApertura`/`horaCierre` (existe en types.ts).
- [ ] **Step 3:** `pnpm exec tsc --noEmit && pnpm lint` → 0 errores (confirmar que se usó `className`, no `class`).
- [ ] **Step 4: Commit:**
```bash
git add "src/app/(panel)/dashboard/page.tsx"
git commit -m "feat(dashboard): periodo + ingresos/dia + horarios + ocupacion"
```

### Task 4: Gate + cierre
- [ ] **Step 1:** `cd frontend && pnpm test` → verde.
- [ ] **Step 2:** `pnpm lint` → 0 errores.
- [ ] **Step 3:** `pnpm build` → OK.
- [ ] **Step 4: QA** (`pnpm dev`, con backend deployado): cambiar Hoy/7/30 y ver que cambian ingresos (card + gráfico), reservas, cancha top, horarios y el heatmap.
- [ ] **Step 5:** **superpowers:finishing-a-development-branch** → merge a `master` local.

---

## Notas
- Sin migración de DB; las rutas leen query opcional (sin query → últimos 30 días, así no rompe los tests viejos ni otros consumidores).
- El heatmap usa `config` para las horas; `dia` de Postgres es 0=Dom..6=Sáb (el componente mapea Lun→Dom).
- Orden: deployar backend antes del QA real del dashboard.

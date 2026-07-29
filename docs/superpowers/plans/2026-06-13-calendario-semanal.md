# Calendario semanal de reservas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una vista de calendario semanal (estilo Google Calendar) en el panel para ver las reservas, con las canchas diferenciadas por color y click en cada reserva para ejecutar las acciones existentes.

**Architecture:** El backend suma un filtro por rango (`desde`/`hasta`) a `GET /reservas`. El frontend agrega la página `/calendario` (Server Component, patrón BFF) que calcula la semana, hace fetch del rango + canchas + config, y la renderiza con un componente cliente que dibuja una grilla CSS (7 días × horas), colorea cada reserva por cancha (paleta determinística) y abre un dialog de detalle reusando las acciones de `/reservas`.

**Tech Stack:** Backend Node+Express 5+TS, Prisma 7 (vía `../db/client.js`), Zod 4, Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 + React 19 + Tailwind 4 + Base UI + pnpm + Vitest.

**Ramas:** backend `feat/calendario-backend` (`c:/Users/Lautaro/Desktop/ortigoza/backend`), frontend `feat/calendario-panel` (`c:/Users/Lautaro/Desktop/ortigoza/frontend`).

---

## Parte A — Backend (rama `feat/calendario-backend`)

### Task A0: Crear la rama

- [ ] **Step 1**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/backend`):
```bash
git checkout main && git pull && git checkout -b feat/calendario-backend
```
Expected: `Switched to a new branch 'feat/calendario-backend'`

---

### Task A1: Filtro por rango `desde`/`hasta` en GET /reservas (TDD)

**Files:**
- Modify: `backend/src/validators/reserva.schema.ts` (listReservaSchema)
- Modify: `backend/src/services/reserva.service.ts:106-117` (list)
- Test: `backend/tests/integration/reserva.routes.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar este `describe` al final de `backend/tests/integration/reserva.routes.test.ts` (el archivo ya tiene `app`, `canchaId`, el `body()` helper y `signAdminToken` no hace falta acá porque GET /reservas es authJwt — mirá cómo el archivo arma el token admin; si no hay uno, usá `signAdminToken({ adminId:'x', email:'a@b.com' })` importado de `../../src/services/auth.service.js` y `Authorization: Bearer`):

```ts
import { signAdminToken } from '../../src/services/auth.service.js';

describe('GET /reservas — filtro por rango', () => {
  it('devuelve reservas dentro del rango y excluye las de afuera', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com' });
    // dentro: dentro de 3 días; fuera: dentro de 30 días
    const dentro = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const fuera = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true, fecha: dentro, horaInicio: '18:00' }));
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true, fecha: fuera, horaInicio: '18:00' }));
    const desde = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const res = await supertest(app).get(`/reservas?desde=${desde}&hasta=${hasta}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const fechas = (res.body as any[]).map((r) => r.fechaInicio.slice(0, 10));
    expect(fechas).toContain(dentro);
    expect(fechas).not.toContain(fuera);
  });

  it('combina rango con estado', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com' });
    const dentro = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    // una CONFIRMADA (contacto) y una ESPERANDO_SENA (no contacto)
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true, fecha: dentro, horaInicio: '18:00' }));
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: false, fecha: dentro, horaInicio: '19:00', montoSena: 500 }));
    const desde = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const res = await supertest(app).get(`/reservas?desde=${desde}&hasta=${hasta}&estado=CONFIRMADA`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body as any[]).every((r) => r.estado === 'CONFIRMADA')).toBe(true);
    expect((res.body as any[]).length).toBe(1);
  });
});
```

NOTA: revisá el principio del archivo — `body()` ya existe (usado por los tests `POST /reservas`) y usa una `fecha` futura dinámica por default. Pasale `fecha` y `horaInicio` explícitos como arriba. Confirmá la firma real de `signAdminToken` leyendo `src/services/auth.service.ts` (ya se usa en `cancha.routes.test.ts` como `signAdminToken({ adminId, email })`).

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
npx vitest run tests/integration/reserva.routes.test.ts -t "rango"
```
Expected: FAIL — al no existir el filtro de rango, el primer test trae también la reserva de `fuera` (`fechas` la contiene) → la aserción `not.toContain(fuera)` falla.

- [ ] **Step 3: Agregar `desde`/`hasta` al schema**

En `backend/src/validators/reserva.schema.ts`, dentro de `listReservaSchema.query`, agregar los dos campos (mismo regex que `fecha`):

```ts
export const listReservaSchema = z.object({
  query: z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    canchaId: z.string().optional(),
    estado: z.enum(['CONFIRMADA', 'ESPERANDO_SENA', 'CANCELADA', 'COMPLETADA']).optional(),
    whatsapp: z.string().optional(),
  }),
  body: z.unknown(),
  params: empty,
});
```

- [ ] **Step 4: Aplicar el rango en el service**

En `backend/src/services/reserva.service.ts`, reemplazar `list` (líneas ~106-117). Agregar `desde`/`hasta` a los filtros y usar `dayWindowUtc` (ya importado en el archivo junto con `combineDateTimeUtc`; si no, importarlo de `../utils/tz.js`):

```ts
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

Verificá los imports al tope del archivo: deben estar `dayWindowUtc` y `combineDateTimeUtc` desde `../utils/tz.js` y `getEnv` desde `../config/env.js`. `combineDateTimeUtc` y `getEnv` ya se usan; agregá `dayWindowUtc` al import si falta.

- [ ] **Step 5: Correr el test para verificar que pasa**

Run:
```bash
npx vitest run tests/integration/reserva.routes.test.ts -t "rango"
```
Expected: PASS (2 tests).

- [ ] **Step 6: Suite completa + commit**

Run:
```bash
npx vitest run && npx tsc --noEmit
```
Expected: todo verde. Luego:
```bash
git add src/validators/reserva.schema.ts src/services/reserva.service.ts tests/integration/reserva.routes.test.ts
git commit -m "feat(reservas): add desde/hasta range filter to GET /reservas"
```

---

## Parte B — Frontend (rama `feat/calendario-panel`)

### Task B0: Crear la rama

- [ ] **Step 1**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/frontend`):
```bash
git checkout master && git checkout -b feat/calendario-panel
```

---

### Task B1: Helpers puros del calendario + unit tests (TDD)

**Files:**
- Create: `frontend/src/lib/calendario.ts`
- Test: `frontend/src/lib/calendario.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/lib/calendario.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { semanaDe, colorDeCancha, PALETA, ubicarEnTz } from './calendario';

const dow = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay(); // 1 = lunes

describe('semanaDe', () => {
  it('devuelve 7 días empezando en lunes y conteniendo el ancla', () => {
    const { dias, lunes, domingo } = semanaDe('2026-06-13'); // sábado
    expect(dias).toHaveLength(7);
    expect(dow(dias[0])).toBe(1); // lunes
    expect(dow(dias[6])).toBe(0); // domingo
    expect(lunes).toBe(dias[0]);
    expect(domingo).toBe(dias[6]);
    expect(lunes <= '2026-06-13' && '2026-06-13' <= domingo).toBe(true);
  });
  it('un lunes se devuelve a sí mismo como inicio', () => {
    const { dias } = semanaDe('2026-06-08'); // lunes
    expect(dias[0]).toBe('2026-06-08');
  });
});

describe('colorDeCancha', () => {
  const canchas = [{ id: 'b' }, { id: 'a' }, { id: 'c' }]; // se ordena por id adentro
  it('es determinístico: misma cancha, mismo color', () => {
    expect(colorDeCancha('a', canchas)).toEqual(colorDeCancha('a', canchas));
  });
  it('asigna colores distintos por orden de id', () => {
    const ord = [...canchas].sort((x, y) => x.id.localeCompare(y.id)); // a,b,c
    expect(colorDeCancha('a', canchas)).toEqual(PALETA[0]);
    expect(colorDeCancha('b', canchas)).toEqual(PALETA[1]);
    expect(colorDeCancha('c', canchas)).toEqual(PALETA[2]);
    expect(ord[0].id).toBe('a');
  });
  it('id desconocido cae en el primer color', () => {
    expect(colorDeCancha('zzz', canchas)).toEqual(PALETA[0]);
  });
});

describe('ubicarEnTz', () => {
  it('ubica una fecha UTC en el día y hora de Argentina (UTC-3)', () => {
    // 2026-06-16T22:00:00Z = 19:00 ART del 16
    const r = ubicarEnTz('2026-06-16T22:00:00.000Z');
    expect(r.fecha).toBe('2026-06-16');
    expect(r.horaNum).toBe(19);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
pnpm vitest run src/lib/calendario.test.ts
```
Expected: FAIL — el módulo `./calendario` no existe.

- [ ] **Step 3: Implementar los helpers**

Crear `frontend/src/lib/calendario.ts`:

```ts
export const TZ = 'America/Argentina/Buenos_Aires';

// Paleta fija de colores por cancha. Clases Tailwind ESTÁTICAS (no generadas
// dinámicamente) para que el JIT no las purgue.
export interface ColorCancha { bg: string; text: string; border: string; dot: string }
export const PALETA: ColorCancha[] = [
  { bg: 'bg-blue-100', text: 'text-blue-900', border: 'border-blue-400', dot: 'bg-blue-500' },
  { bg: 'bg-emerald-100', text: 'text-emerald-900', border: 'border-emerald-400', dot: 'bg-emerald-500' },
  { bg: 'bg-amber-100', text: 'text-amber-900', border: 'border-amber-400', dot: 'bg-amber-500' },
  { bg: 'bg-violet-100', text: 'text-violet-900', border: 'border-violet-400', dot: 'bg-violet-500' },
  { bg: 'bg-rose-100', text: 'text-rose-900', border: 'border-rose-400', dot: 'bg-rose-500' },
  { bg: 'bg-cyan-100', text: 'text-cyan-900', border: 'border-cyan-400', dot: 'bg-cyan-500' },
  { bg: 'bg-orange-100', text: 'text-orange-900', border: 'border-orange-400', dot: 'bg-orange-500' },
  { bg: 'bg-lime-100', text: 'text-lime-900', border: 'border-lime-400', dot: 'bg-lime-500' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-900', border: 'border-fuchsia-400', dot: 'bg-fuchsia-500' },
  { bg: 'bg-teal-100', text: 'text-teal-900', border: 'border-teal-400', dot: 'bg-teal-500' },
];

export function colorDeCancha(canchaId: string, canchas: { id: string }[]): ColorCancha {
  const ordenadas = [...canchas].sort((a, b) => a.id.localeCompare(b.id));
  const idx = ordenadas.findIndex((c) => c.id === canchaId);
  return PALETA[(idx < 0 ? 0 : idx) % PALETA.length];
}

function toYMD(dateUtcMidnight: Date): string {
  return dateUtcMidnight.toISOString().slice(0, 10);
}

export function semanaDe(ancla: string): { lunes: string; domingo: string; dias: string[] } {
  const [y, m, d] = ancla.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const diffToMon = (base.getUTCDay() + 6) % 7; // días desde el lunes
  const lunesMs = base.getTime() - diffToMon * 86400000;
  const dias: string[] = [];
  for (let i = 0; i < 7; i++) dias.push(toYMD(new Date(lunesMs + i * 86400000)));
  return { lunes: dias[0], domingo: dias[6], dias };
}

export function ubicarEnTz(iso: string): { fecha: string; horaNum: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  let horaNum = Number(get('hour'));
  if (horaNum === 24) horaNum = 0;
  return { fecha: `${get('year')}-${get('month')}-${get('day')}`, horaNum };
}

// Lista de horas (números) de apertura..(cierre-1), una por turno de 1h.
export function horasDelDia(horaApertura: string, horaCierre: string): number[] {
  const ap = Number(horaApertura.slice(0, 2));
  const ci = Number(horaCierre.slice(0, 2));
  const out: number[] = [];
  for (let h = ap; h < ci; h++) out.push(h);
  return out;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run:
```bash
pnpm vitest run src/lib/calendario.test.ts
```
Expected: PASS (todos). Si `ubicarEnTz` falla por offset, revisar que el runner tenga datos de zona horaria (Node los trae); Argentina es UTC-3 fijo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendario.ts src/lib/calendario.test.ts
git commit -m "feat(calendario): pure helpers (semana, color por cancha, ubicar en TZ)"
```

---

### Task B2: Componente cliente `CalendarioSemana` (grilla + leyenda + detalle)

**Files:**
- Create: `frontend/src/components/calendario/calendario-semana.tsx`

- [ ] **Step 1: Crear el componente**

Crear `frontend/src/components/calendario/calendario-semana.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Reserva, Cancha } from '@/lib/types';
import { colorDeCancha, ubicarEnTz, horasDelDia } from '@/lib/calendario';
import { ReprogramarDialog } from '@/components/reservas/reprogramar-dialog';
import { cancelarReserva, aprobarSena, rechazarSena } from '@/lib/reservas-actions';

const DIAS_LBL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const money = (n: number | null | undefined) => '$' + Number(n || 0).toLocaleString('es-AR');

export function CalendarioSemana({
  reservas, canchas, dias, horaApertura, horaCierre, hoy,
}: {
  reservas: Reserva[]; canchas: Cancha[]; dias: string[];
  horaApertura: string; horaCierre: string; hoy: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Reserva | null>(null);
  const [reprogId, setReprogId] = useState<string | null>(null);

  const horas = horasDelDia(horaApertura, horaCierre);
  const visibles = reservas.filter((r) => r.estado !== 'CANCELADA');
  // index: clave `${fecha}|${horaNum}` -> reservas
  const porCelda = new Map<string, Reserva[]>();
  for (const r of visibles) {
    const { fecha, horaNum } = ubicarEnTz(r.fechaInicio);
    const k = `${fecha}|${horaNum}`;
    (porCelda.get(k) ?? porCelda.set(k, []).get(k)!).push(r);
  }

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    const r = await fn();
    if (r.ok) { toast.success(okMsg); setSel(null); router.refresh(); }
    else toast.error(r.error ?? 'Error');
  }

  return (
    <div className="space-y-3">
      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 rounded-lg border bg-white p-3 text-sm">
        {[...canchas].sort((a, b) => a.id.localeCompare(b.id)).map((c) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm ${colorDeCancha(c.id, canchas).dot}`} />
            {c.nombre}
          </span>
        ))}
      </div>

      {/* Grilla */}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <div className="grid min-w-[760px]" style={{ gridTemplateColumns: '64px repeat(7, 1fr)' }}>
          {/* encabezado */}
          <div className="border-b border-r bg-neutral-50 p-2" />
          {dias.map((d, i) => (
            <div key={d} className={`border-b border-r p-2 text-center text-xs font-medium ${d === hoy ? 'bg-primary/10 text-primary' : 'bg-neutral-50 text-neutral-600'}`}>
              {DIAS_LBL[i]} {Number(d.slice(8, 10))}
            </div>
          ))}
          {/* filas por hora */}
          {horas.map((h) => (
            <FilaHora key={h} h={h} dias={dias} porCelda={porCelda} canchas={canchas} onClick={setSel} />
          ))}
        </div>
      </div>

      {/* Dialog detalle */}
      <Dialog open={!!sel} onOpenChange={(o) => { if (!o) setSel(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reserva</DialogTitle></DialogHeader>
          {sel && (
            <div className="space-y-2 text-sm">
              <p><span className="text-neutral-500">Cancha:</span> {sel.cancha?.nombre}</p>
              <p><span className="text-neutral-500">Cliente:</span> {sel.cliente?.nombre} ({sel.cliente?.whatsapp})</p>
              <p><span className="text-neutral-500">Cuándo:</span> {new Date(sel.fechaInicio).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</p>
              <p><span className="text-neutral-500">Estado:</span> {sel.estado}</p>
              <p><span className="text-neutral-500">Monto:</span> {money(sel.monto)}{sel.montoSena ? ` · seña ${money(sel.montoSena)}` : ''}</p>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {sel?.estado === 'ESPERANDO_SENA' && (
              <>
                <Button variant="outline" onClick={() => act(() => aprobarSena(sel.id), 'Seña aprobada')}>Aprobar seña</Button>
                <Button variant="outline" onClick={() => act(() => rechazarSena(sel.id), 'Seña rechazada')}>Rechazar seña</Button>
              </>
            )}
            {sel && sel.estado !== 'CANCELADA' && sel.estado !== 'COMPLETADA' && (
              <>
                <Button variant="outline" onClick={() => { setReprogId(sel.id); }}>Reprogramar</Button>
                <Button variant="destructive" onClick={() => act(() => cancelarReserva(sel.id), 'Reserva cancelada')}>Cancelar</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReprogramarDialog
        id={reprogId}
        open={!!reprogId}
        onOpenChange={(o) => { if (!o) { setReprogId(null); setSel(null); router.refresh(); } }}
      />
    </div>
  );
}

function FilaHora({
  h, dias, porCelda, canchas, onClick,
}: {
  h: number; dias: string[]; porCelda: Map<string, Reserva[]>; canchas: Cancha[]; onClick: (r: Reserva) => void;
}) {
  return (
    <>
      <div className="border-b border-r bg-neutral-50 p-2 text-right text-xs text-neutral-400">{String(h).padStart(2, '0')}:00</div>
      {dias.map((d) => {
        const rs = porCelda.get(`${d}|${h}`) ?? [];
        return (
          <div key={d} className="min-h-[44px] border-b border-r p-1">
            <div className="flex flex-wrap gap-1">
              {rs.map((r) => {
                const col = colorDeCancha(r.cancha?.id ?? '', canchas);
                const esperando = r.estado === 'ESPERANDO_SENA';
                return (
                  <button
                    key={r.id}
                    onClick={() => onClick(r)}
                    className={`flex-1 truncate rounded border px-1.5 py-1 text-left text-[11px] leading-tight ${col.bg} ${col.text} ${col.border} ${esperando ? 'opacity-60' : ''}`}
                    title={`${r.cancha?.nombre} · ${r.cliente?.nombre}`}
                  >
                    <span className="block truncate font-medium">{r.cancha?.nombre}</span>
                    <span className="block truncate">{r.cliente?.nombre}{esperando ? ' (seña)' : ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: sin errores (o sólo el de la página, que se crea en B3). Si `porCelda.get(k) ?? porCelda.set(...)` se queja, está bien tipado; si molesta, reemplazá por: `const arr = porCelda.get(k) ?? []; arr.push(r); porCelda.set(k, arr);`.

- [ ] **Step 3: Commit**

```bash
git add src/components/calendario/calendario-semana.tsx
git commit -m "feat(calendario): week grid component with color-by-court and detail dialog"
```

---

### Task B3: Página `/calendario` (Server Component)

**Files:**
- Create: `frontend/src/app/(panel)/calendario/page.tsx`

- [ ] **Step 1: Crear la página**

Crear `frontend/src/app/(panel)/calendario/page.tsx`:

```tsx
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import type { Reserva, Cancha, Config } from '@/lib/types';
import { semanaDe, TZ } from '@/lib/calendario';
import { CalendarioSemana } from '@/components/calendario/calendario-semana';

function hoyYMD(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

export default async function CalendarioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ancla = sp.semana && /^\d{4}-\d{2}-\d{2}$/.test(sp.semana) ? sp.semana : hoyYMD();
  const { lunes, domingo, dias } = semanaDe(ancla);

  const [reservas, canchas, config] = await Promise.all([
    apiFetch<Reserva[]>(`/reservas?desde=${lunes}&hasta=${domingo}`),
    apiFetch<Cancha[]>('/canchas'),
    apiFetch<Config>('/config'),
  ]);

  const prev = addDays(lunes, -7);
  const next = addDays(lunes, 7);
  const linkCls = 'rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>
          <p className="mt-1 text-sm text-neutral-500">Semana del {lunes} al {domingo}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/calendario?semana=${prev}`} className={linkCls}>‹ Anterior</Link>
          <Link href="/calendario" className={linkCls}>Hoy</Link>
          <Link href={`/calendario?semana=${next}`} className={linkCls}>Siguiente ›</Link>
        </div>
      </div>

      <CalendarioSemana
        reservas={reservas}
        canchas={canchas}
        dias={dias}
        horaApertura={config.horaApertura}
        horaCierre={config.horaCierre}
        hoy={hoyYMD()}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(panel)/calendario/page.tsx"
git commit -m "feat(calendario): /calendario page with week navigation (BFF)"
```

---

### Task B4: Item "Calendario" en el nav

**Files:**
- Modify: `frontend/src/components/app-shell.tsx:1-14`

- [ ] **Step 1: Agregar el item al nav**

En `frontend/src/components/app-shell.tsx`, importar el icono `CalendarRange` y agregar el item después de "Reservas":

```tsx
import { LayoutDashboard, CalendarDays, LandPlot, Settings, LogOut, CalendarClock, Ban, CalendarRange } from 'lucide-react';
```
```tsx
const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/reservas', label: 'Reservas', icon: CalendarDays },
  { href: '/calendario', label: 'Calendario', icon: CalendarRange },
  { href: '/canchas', label: 'Canchas', icon: LandPlot },
  { href: '/turnos-fijos', label: 'Turnos fijos', icon: CalendarClock },
  { href: '/bloqueos', label: 'Bloqueos', icon: Ban },
  { href: '/configuracion', label: 'Configuración', icon: Settings },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat(calendario): add Calendario nav item"
```

---

### Task B5: Verificación frontend completa

- [ ] **Step 1: lint + tsc + tests + build**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build
```
Expected: todo verde. `pnpm build` obligatorio (atrapa errores de boundary RSC). Verificar que la ruta `/calendario` aparece en el output del build.

---

## Parte C — Cierre

### Task C1: Finalizar las ramas

- [ ] **Step 1: Backend — finishing-a-development-branch**

Anunciar "I'm using the finishing-a-development-branch skill to complete this work." en backend (`feat/calendario-backend`): tests verdes → merge a `main` + push. **Verificar el deploy** (auto-deploy no confiable): `docker exec canchitas-backend node -e "require('http').get('http://localhost:3000/reservas',r=>{console.log(r.statusCode);process.exit(0)})"` (401 = vivo) o redeploy manual.

- [ ] **Step 2: Frontend — finishing-a-development-branch**

Idem en frontend (`feat/calendario-panel`): merge a `master` (sin remote → queda local).

---

## Self-Review

**Spec coverage:**
- Backend filtro por rango `desde`/`hasta` (mantiene fecha/canchaId/estado/whatsapp) → Task A1 ✓
- Tests rango dentro/fuera + combinado con estado → Task A1 Step 1 ✓ (el "un solo extremo cae al comportamiento actual" está cubierto por la lógica `desde && hasta`; documentado en el service)
- Página `/calendario` Server Component BFF, lee `semana`, fetch rango+canchas+config → Task B3 ✓
- Navegación prev/hoy/next con Link `?semana=` → Task B3 ✓
- Grilla Tailwind 7 días × horas de config → Task B2 (`horasDelDia`) ✓
- Color determinístico por cancha + leyenda (clases estáticas) → Task B1 (`PALETA`, `colorDeCancha`) + B2 leyenda ✓
- Bloques coloreados, ESPERANDO_SENA opacidad + "(seña)", CANCELADA filtradas en memoria → Task B2 ✓
- Click → dialog con acciones existentes (cancelar/aprobar/rechazar/reprogramar reusando ReprogramarDialog) → Task B2 ✓
- Item Calendario en app-shell → Task B4 ✓
- Unit: colorDeCancha (determinismo) + semana (lunes/domingo) → Task B1 ✓
- TZ Argentina, fechas UTC → `ubicarEnTz` (B1) + render `toLocaleString` (B2) ✓

**Placeholder scan:** Sin TBD/TODO. Puntos "verificá": firma de `signAdminToken` (ya usado en cancha.routes.test.ts) e imports de tz en el service — instrucciones explícitas de confirmar, no placeholders de implementación.

**Type consistency:** `semanaDe` → `{lunes,domingo,dias}` usado igual en página y test. `colorDeCancha(id, canchas)` → `ColorCancha {bg,text,border,dot}` usado en B2. `ubicarEnTz(iso)` → `{fecha,horaNum}` usado en B2. `horasDelDia(ap,ci)` → number[]. `CalendarioSemana` props (reservas, canchas, dias, horaApertura, horaCierre, hoy) coinciden entre B2 (definición) y B3 (uso). Reusa `ReprogramarDialog {id,open,onOpenChange}` (firma real verificada) y `reservas-actions` (cancelar/aprobar/rechazar, firmas reales `(id)=>Promise<Result>`).

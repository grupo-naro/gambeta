# Reserva online — Web (Sub-proyecto A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una web pública (app `reservas/`) para reservar una cancha: deporte → fecha → grilla (horarios × canchas) → datos → crea la reserva (esperando seña). Sin Mercado Pago (eso es el sub-proyecto B).

**Architecture:** El backend suma `GET /disponibilidad/grilla?deporte&fecha` que arma la matriz de disponibilidad reusando `disponibilidadService.listar`. La app `reservas/` (Next.js) llama al backend del lado del server con `SERVICE_API_KEY` (header `x-api-key`), muestra el wizard y crea la reserva vía `POST /reservas`.

**Tech Stack:** Node 22, Express, Prisma 7 + Postgres, Zod, vitest + supertest + testcontainers (backend); Next.js 16 + React 19 + Tailwind v4 (app `reservas/`).

## Global Constraints

- Deporte → canchas: `futbol` = `tipo` (lower) empieza con `futbol`; `padel` = `tipo` (lower) === `padel`.
- La app `reservas/` habla con el backend SOLO del lado del server con `SERVICE_API_KEY` (header `x-api-key`); nunca en el navegador.
- Reserva creada desde la web: `esContacto: false` → queda `ESPERANDO_SENA`. `POST /reservas` devuelve `{ id, montoSena, estado, datosPago }`.
- Marca visible: **Grupo Naro**.
- `reservas/` usa **pnpm** (tiene `pnpm-lock.yaml`); no correr `npm install` ahí (crearía un lockfile duplicado y rompería la inferencia de raíz de Turbopack).
- Tests backend usan testcontainers; `SERVICE_API_KEY` en tests = `svc` (header `x-api-key`). Config de horarios: `configService.update({ horaApertura, horaCierre })`.
- No tocar `ortigoza/`.

---

## Task 1: Backend — endpoint de grilla de disponibilidad

**Files:**
- Modify: `backend/src/services/disponibilidad.service.ts`
- Modify: `backend/src/validators/disponibilidad.schema.ts`
- Modify: `backend/src/routes/disponibilidad.routes.ts`
- Test: `backend/tests/integration/disponibilidad-grilla.test.ts`

**Interfaces:**
- Produces:
  - `disponibilidadService.grilla(deporte: 'futbol'|'padel', fecha: string) → Promise<{ deporte; fecha; canchas: {id,nombre}[]; horas: string[]; libres: Record<string, Record<string, boolean>> }>`
  - Ruta `GET /disponibilidad/grilla?deporte=&fecha=` (authAny).

- [ ] **Step 1: Método `grilla` en el service**

En `backend/src/services/disponibilidad.service.ts`, importar el repo de canchas si no está (`import { canchaRepo } from '../repositories/cancha.repo.js';`) y agregar dentro de `disponibilidadService` (después de `listarPorTamano`):
```ts
  async grilla(deporte: 'futbol' | 'padel', fecha: string): Promise<{
    deporte: string; fecha: string;
    canchas: { id: string; nombre: string }[];
    horas: string[];
    libres: Record<string, Record<string, boolean>>;
  }> {
    const todas = await canchaRepo.list(true);
    const canchas = todas.filter((c) =>
      deporte === 'futbol' ? c.tipo.toLowerCase().startsWith('futbol') : c.tipo.toLowerCase() === 'padel',
    );
    const perCancha: { id: string; nombre: string; free: Set<string> }[] = [];
    const horasSet = new Set<string>();
    for (const c of canchas) {
      const { slots } = await this.listar(c.id, fecha);
      const free = new Set(slots.map((s) => s.horaInicio));
      perCancha.push({ id: c.id, nombre: c.nombre, free });
      for (const h of free) horasSet.add(h);
    }
    const horas = [...horasSet].sort();
    const libres: Record<string, Record<string, boolean>> = {};
    for (const pc of perCancha) {
      libres[pc.id] = {};
      for (const h of horas) libres[pc.id][h] = pc.free.has(h);
    }
    return { deporte, fecha, canchas: perCancha.map((pc) => ({ id: pc.id, nombre: pc.nombre })), horas, libres };
  },
```

- [ ] **Step 2: Validador `grillaSchema`**

En `backend/src/validators/disponibilidad.schema.ts`, agregar:
```ts
export const grillaSchema = z.object({
  query: z.object({
    deporte: z.enum(['futbol', 'padel']),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD'),
  }),
  body: z.unknown(), params: empty,
});
```

- [ ] **Step 3: Ruta**

En `backend/src/routes/disponibilidad.routes.ts`, sumar `grillaSchema` al import de validators y agregar (después del handler de `/por-tamano`):
```ts
disponibilidadRoutes.get('/grilla', authAny, validate(grillaSchema), async (req, res, next) => {
  try {
    const { deporte, fecha } = (req as any).valid.query;
    res.json(await disponibilidadService.grilla(deporte, fecha));
  } catch (e) { next(e); }
});
```

- [ ] **Step 4: Escribir el test (falla primero)**

Crear `backend/tests/integration/disponibilidad-grilla.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { configService } from '../../src/services/config.service.js';

let app: any;
let f1: string; let f2: string; let sectorF2: string;

beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const a = await getPrisma().cancha.create({ data: { nombre: 'Futbol 1', tipo: 'futbol5', precioHora: 1000, jugadores: 5 } });
  const b = await getPrisma().cancha.create({ data: { nombre: 'Futbol 2', tipo: 'futbol7', precioHora: 2000, jugadores: 7 } });
  await getPrisma().cancha.create({ data: { nombre: 'Padel 1', tipo: 'padel', precioHora: 800, jugadores: 4 } });
  f1 = a.id; f2 = b.id;
  for (const id of [f1, f2]) {
    const s = await getPrisma().sector.create({ data: { nombre: 's' + id } });
    if (id === f2) sectorF2 = s.id;
    await getPrisma().canchaSector.create({ data: { canchaId: id, sectorId: s.id } });
  }
  // Padel también necesita sector para que listar funcione
  const sp = await getPrisma().sector.create({ data: { nombre: 'sp' } });
  const padel = await getPrisma().cancha.findFirst({ where: { tipo: 'padel' } });
  await getPrisma().canchaSector.create({ data: { canchaId: padel!.id, sectorId: sp.id } });
  await configService.get();
  await configService.update({ horaApertura: '18:00', horaCierre: '21:00' }); // 18,19,20
});

const mostrador = (r: any) => r.set('x-api-key', 'svc');

describe('GET /disponibilidad/grilla', () => {
  it('futbol: incluye solo canchas de futbol, con horas y libres', async () => {
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=futbol&fecha=2026-06-12'));
    expect(res.status).toBe(200);
    expect(res.body.canchas.map((c: any) => c.nombre).sort()).toEqual(['Futbol 1', 'Futbol 2']);
    expect(res.body.horas).toEqual(['18:00', '19:00', '20:00']);
    expect(res.body.libres[f1]['18:00']).toBe(true);
  });

  it('una celda ocupada queda en false', async () => {
    const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    const r = await getPrisma().reserva.create({ data: { canchaId: f2, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto: 2000, fechaInicio: new Date('2026-06-12T21:00:00.000Z'), fechaFin: new Date('2026-06-12T22:00:00.000Z') } });
    await getPrisma().reservaSector.create({ data: { reservaId: r.id, sectorId: sectorF2, estado: 'CONFIRMADA', fechaInicio: new Date('2026-06-12T21:00:00.000Z'), fechaFin: new Date('2026-06-12T22:00:00.000Z') } });
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=futbol&fecha=2026-06-12'));
    expect(res.body.libres[f2]['18:00']).toBe(false); // 18:00 ART = 21:00 UTC, ocupado
    expect(res.body.libres[f1]['18:00']).toBe(true);  // la otra cancha libre
  });

  it('padel devuelve solo la cancha de padel', async () => {
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=padel&fecha=2026-06-12'));
    expect(res.body.canchas.map((c: any) => c.nombre)).toEqual(['Padel 1']);
  });

  it('deporte inválido devuelve 400', async () => {
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=tenis&fecha=2026-06-12'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 5: Correr el test**

```bash
cd backend && npm test -- disponibilidad-grilla
```
Expected: pasan los 4 casos.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/disponibilidad.service.ts backend/src/validators/disponibilidad.schema.ts backend/src/routes/disponibilidad.routes.ts backend/tests/integration/disponibilidad-grilla.test.ts
git commit -m "feat(disponibilidad): endpoint /grilla (matriz horarios x canchas por deporte)"
```

---

## Task 2: App `reservas/` — plumbing server-side + landing

**Files:**
- Modify: `reservas/next.config.ts`
- Modify: `reservas/src/app/layout.tsx`
- Modify: `reservas/src/app/page.tsx`
- Create: `reservas/src/lib/types.ts`
- Create: `reservas/src/lib/api.ts`
- Create: `reservas/src/lib/actions.ts`
- Create: `reservas/.env.example`
- Modify: `reservas/README.md`

**Interfaces:**
- Consumes: `GET /disponibilidad/grilla` y `POST /reservas` (Task 1 + backend existente).
- Produces (usados por Task 3):
  - `types.ts`: `Deporte = 'futbol'|'padel'`; `Grilla`; `Resultado<T>`; `ReservaCreada`.
  - `actions.ts`: `getGrilla(deporte, fecha)`, `crearReserva(input)`.

- [ ] **Step 1: Fijar `turbopack.root` (evita el bug de raíz de Turbopack)**

Reemplazar `reservas/next.config.ts` por:
```ts
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
```

- [ ] **Step 2: Instalar `server-only`**

```bash
cd reservas && pnpm add server-only
```
(Si `pnpm` no está, `corepack enable pnpm` primero. NO usar `npm install`.)

- [ ] **Step 3: Tipos**

Crear `reservas/src/lib/types.ts`:
```ts
export type Deporte = 'futbol' | 'padel';

export interface Grilla {
  deporte: Deporte;
  fecha: string;
  canchas: { id: string; nombre: string }[];
  horas: string[];
  libres: Record<string, Record<string, boolean>>;
}

export interface ReservaCreada { id: string; montoSena: number | null }

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };
```

- [ ] **Step 4: Cliente HTTP server-side**

Crear `reservas/src/lib/api.ts`:
```ts
import 'server-only';

export async function apiReservas<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.API_URL;
  const key = process.env.SERVICE_API_KEY;
  if (!base) throw new Error('API_URL no configurada');
  if (!key) throw new Error('SERVICE_API_KEY no configurada');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(msg ?? (res.status >= 500 ? 'Error del servidor. Probá de nuevo.' : 'No se pudo completar la solicitud.'));
  }
  return body as T;
}
```

- [ ] **Step 5: Server actions**

Crear `reservas/src/lib/actions.ts`:
```ts
'use server';
import { apiReservas } from './api';
import type { Deporte, Grilla, ReservaCreada, Resultado } from './types';

export async function getGrilla(deporte: Deporte, fecha: string): Promise<Resultado<Grilla>> {
  try {
    const data = await apiReservas<Grilla>(`/disponibilidad/grilla?deporte=${deporte}&fecha=${fecha}`);
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}

export async function crearReserva(input: { canchaId: string; fecha: string; horaInicio: string; nombre: string; telefono: string }): Promise<Resultado<ReservaCreada>> {
  try {
    const data = await apiReservas<ReservaCreada>('/reservas', {
      method: 'POST',
      body: JSON.stringify({
        canchaId: input.canchaId,
        whatsapp: input.telefono,
        nombreCliente: input.nombre,
        fecha: input.fecha,
        horaInicio: input.horaInicio,
        esContacto: false,
      }),
    });
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}
```

- [ ] **Step 6: Layout con marca**

Reemplazar el `metadata` de `reservas/src/app/layout.tsx` y el `lang`:
```ts
export const metadata: Metadata = {
  title: "Grupo Naro — Reservá tu cancha",
  description: "Reservá tu cancha de fútbol o pádel online.",
};
```
y en `<html lang="en" ...>` cambiar a `<html lang="es" ...>`.

- [ ] **Step 7: Landing con botón**

Reemplazar `reservas/src/app/page.tsx` por:
```tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 bg-emerald-50 p-6 text-center">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">Grupo Naro</p>
        <h1 className="mt-2 text-4xl font-bold text-emerald-900 sm:text-5xl">Reservá tu cancha</h1>
        <p className="mt-3 text-lg text-emerald-800/80">Fútbol o pádel, en segundos.</p>
      </div>
      <Link href="/reservar" className="rounded-2xl bg-emerald-600 px-8 py-4 text-2xl font-bold text-white shadow-lg shadow-emerald-600/30 active:scale-95">
        Reservá tu cancha
      </Link>
    </main>
  );
}
```

- [ ] **Step 8: `.env.example` y README**

Crear `reservas/.env.example`:
```dotenv
# Base del backend (mismo que usa el panel). Ej: https://api.tu-servidor
API_URL=http://localhost:3000
# Llave de servicio del backend (server-only, no se expone al navegador)
SERVICE_API_KEY=demo-service-key
```
En `reservas/README.md`, reemplazar el contenido por instrucciones cortas: qué es (web pública de reservas de Grupo Naro), cómo correr (`cp .env.example .env`, completar, `pnpm install`, `pnpm dev`), y que se despliega en Vercel con `API_URL` y `SERVICE_API_KEY` como env vars.

- [ ] **Step 9: Verificar build**

```bash
cd reservas && pnpm install && pnpm build
```
Expected: compila sin errores (landing + libs; el wizard llega en Task 3).

- [ ] **Step 10: Commit**

```bash
git add reservas/next.config.ts reservas/src/app/layout.tsx reservas/src/app/page.tsx reservas/src/lib reservas/.env.example reservas/README.md reservas/package.json reservas/pnpm-lock.yaml
git commit -m "feat(reservas): plumbing server-side + landing (Grupo Naro)"
```

---

## Task 3: App `reservas/` — wizard de reserva

**Files:**
- Create: `reservas/src/app/reservar/page.tsx`
- Create: `reservas/src/components/wizard-reserva.tsx`

**Interfaces:**
- Consumes: `getGrilla`, `crearReserva` (Task 2); tipos `Deporte`, `Grilla`.

- [ ] **Step 1: Página `/reservar`**

Crear `reservas/src/app/reservar/page.tsx`:
```tsx
import { WizardReserva } from "@/components/wizard-reserva";

export default function ReservarPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4">
      <WizardReserva />
    </main>
  );
}
```

- [ ] **Step 2: Componente `WizardReserva`**

Crear `reservas/src/components/wizard-reserva.tsx`:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { getGrilla, crearReserva } from '@/lib/actions';
import type { Deporte, Grilla } from '@/lib/types';

const money = (n: number | null) => (n == null ? '' : '$' + Number(n).toLocaleString('es-AR'));
const hoyISO = () => new Date().toISOString().slice(0, 10);

type Paso = 'deporte' | 'fecha' | 'grilla' | 'datos' | 'listo';

export function WizardReserva() {
  const [paso, setPaso] = useState<Paso>('deporte');
  const [deporte, setDeporte] = useState<Deporte>('futbol');
  const [fecha, setFecha] = useState(hoyISO());
  const [grilla, setGrilla] = useState<Grilla | null>(null);
  const [sel, setSel] = useState<{ canchaId: string; canchaNombre: string; hora: string } | null>(null);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [senia, setSenia] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  function elegirDeporte(d: Deporte) { setDeporte(d); setPaso('fecha'); }

  function verGrilla() {
    setError('');
    start(async () => {
      const r = await getGrilla(deporte, fecha);
      if (!r.ok) { setError(r.error); return; }
      setGrilla(r.data); setPaso('grilla');
    });
  }

  function elegirCelda(canchaId: string, canchaNombre: string, hora: string) {
    setSel({ canchaId, canchaNombre, hora }); setPaso('datos');
  }

  function confirmar() {
    if (!sel) return;
    if (nombre.trim().length < 2) { setError('Ingresá tu nombre'); return; }
    if (telefono.replace(/\D/g, '').length < 10) { setError('Ingresá un teléfono válido (10 dígitos)'); return; }
    setError('');
    start(async () => {
      const r = await crearReserva({ canchaId: sel.canchaId, fecha, horaInicio: sel.hora, nombre: nombre.trim(), telefono });
      if (!r.ok) { setError(r.error); setPaso('grilla'); return; }
      setSenia(r.data.montoSena); setPaso('listo');
    });
  }

  const paso1 = (
    <section className="flex flex-1 flex-col items-center justify-center gap-4">
      <h2 className="text-2xl font-bold text-emerald-900">¿Qué querés jugar?</h2>
      <div className="grid w-full max-w-sm grid-cols-2 gap-4">
        <button type="button" onClick={() => elegirDeporte('futbol')} className="rounded-2xl border-2 border-emerald-600 bg-white py-10 text-2xl font-bold text-emerald-800 active:scale-95">Fútbol</button>
        <button type="button" onClick={() => elegirDeporte('padel')} className="rounded-2xl border-2 border-emerald-600 bg-white py-10 text-2xl font-bold text-emerald-800 active:scale-95">Pádel</button>
      </div>
    </section>
  );

  const paso2 = (
    <section className="flex flex-1 flex-col items-center justify-center gap-4">
      <h2 className="text-2xl font-bold text-emerald-900">¿Para qué día?</h2>
      <input type="date" min={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)}
        className="rounded-xl border-2 border-neutral-300 p-3 text-xl" />
      <div className="flex gap-3">
        <button type="button" onClick={() => setPaso('deporte')} className="rounded-xl border-2 border-neutral-300 px-6 py-3 text-lg font-semibold">Atrás</button>
        <button type="button" disabled={pending} onClick={verGrilla} className="rounded-xl bg-emerald-600 px-6 py-3 text-lg font-bold text-white disabled:opacity-50">{pending ? 'Buscando…' : 'Ver horarios'}</button>
      </div>
    </section>
  );

  const paso3 = grilla && (
    <section className="flex flex-1 flex-col gap-3">
      <h2 className="text-center text-2xl font-bold text-emerald-900">Elegí horario y cancha</h2>
      {grilla.canchas.length === 0 || grilla.horas.length === 0 ? (
        <p className="p-6 text-center text-neutral-600">No hay disponibilidad para ese día.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-center">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white p-2 text-left">Hora</th>
                {grilla.canchas.map((c) => <th key={c.id} className="p-2 text-sm font-semibold">{c.nombre}</th>)}
              </tr>
            </thead>
            <tbody>
              {grilla.horas.map((h) => (
                <tr key={h}>
                  <td className="sticky left-0 bg-white p-2 text-left font-semibold tabular-nums">{h}</td>
                  {grilla.canchas.map((c) => {
                    const libre = grilla.libres[c.id]?.[h];
                    return (
                      <td key={c.id} className="p-1">
                        <button type="button" disabled={!libre}
                          onClick={() => elegirCelda(c.id, c.nombre, h)}
                          className={`h-12 w-full rounded-lg text-sm font-semibold ${libre ? 'bg-emerald-100 text-emerald-800 active:scale-95 hover:bg-emerald-200' : 'cursor-not-allowed bg-neutral-100 text-neutral-300'}`}>
                          {libre ? 'Libre' : '—'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="text-center text-red-600">{error}</p>}
      <button type="button" onClick={() => setPaso('fecha')} className="self-center rounded-xl border-2 border-neutral-300 px-6 py-3 text-lg font-semibold">Atrás</button>
    </section>
  );

  const paso4 = sel && (
    <section className="flex flex-1 flex-col items-center justify-center gap-4">
      <h2 className="text-2xl font-bold text-emerald-900">Tus datos</h2>
      <p className="text-neutral-600">{sel.canchaNombre} · {fecha} · {sel.hora}</p>
      <div className="w-full max-w-sm space-y-3">
        <input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-xl border-2 border-neutral-300 p-3 text-lg" />
        <input placeholder="Teléfono (ej: 11 3662 0274)" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="w-full rounded-xl border-2 border-neutral-300 p-3 text-lg" />
      </div>
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={() => setPaso('grilla')} className="rounded-xl border-2 border-neutral-300 px-6 py-3 text-lg font-semibold">Atrás</button>
        <button type="button" disabled={pending} onClick={confirmar} className="rounded-xl bg-emerald-600 px-6 py-3 text-lg font-bold text-white disabled:opacity-50">{pending ? 'Reservando…' : 'Confirmar reserva'}</button>
      </div>
    </section>
  );

  const paso5 = (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="text-6xl">✅</div>
      <h2 className="text-2xl font-bold text-emerald-900">¡Reserva registrada!</h2>
      {sel && <p className="text-neutral-600">{sel.canchaNombre} · {fecha} · {sel.hora}</p>}
      {senia != null && senia > 0
        ? <p className="text-lg">Para confirmarla, aboná la seña de <b>{money(senia)}</b>.</p>
        : <p className="text-lg">Te contactamos para confirmarla.</p>}
      <button type="button" onClick={() => { setPaso('deporte'); setSel(null); setNombre(''); setTelefono(''); setSenia(null); }}
        className="rounded-xl border-2 border-emerald-600 px-6 py-3 text-lg font-semibold text-emerald-800">Hacer otra reserva</button>
    </section>
  );

  return (
    <div className="flex flex-1 flex-col py-4">
      {paso === 'deporte' && paso1}
      {paso === 'fecha' && paso2}
      {paso === 'grilla' && paso3}
      {paso === 'datos' && paso4}
      {paso === 'listo' && paso5}
    </div>
  );
}
```

- [ ] **Step 3: Verificar build**

```bash
cd reservas && pnpm build
```
Expected: compila sin errores de tipo; ruta `/reservar` generada.

- [ ] **Step 4: Commit**

```bash
git add reservas/src/app/reservar reservas/src/components/wizard-reserva.tsx
git commit -m "feat(reservas): wizard de reserva (deporte, fecha, grilla, datos)"
```

---

## Notas de cierre

- El wizard es todo cliente; los datos entran por server actions (`getGrilla`/`crearReserva`) que
  usan la `SERVICE_API_KEY` del server. La llave nunca llega al navegador.
- La grilla muestra filas por hora donde AL MENOS una cancha del deporte está libre; las celdas
  ocupadas de esas filas se ven deshabilitadas ("—"). Horas totalmente ocupadas no generan fila
  (no hay nada que reservar ahí).
- La reserva queda `ESPERANDO_SENA`; la pantalla final informa la seña. El pago por Mercado Pago
  es el sub-proyecto B (reemplazará ese paso final por la redirección al checkout).
- El deporte se mapea por `tipo` (`futbol*` / `padel`); si aparecen otros tipos que deban contar
  como fútbol/pádel, se ajusta el filtro en `disponibilidadService.grilla`.

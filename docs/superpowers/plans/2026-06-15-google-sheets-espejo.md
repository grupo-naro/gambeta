# Espejo en Google Sheets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un Google Sheet que replica la grilla del Excel (horas×canchas, colores por estado de pago) y se actualiza solo con las reservas/cobros (espejo de solo lectura).

**Architecture:** Backend con `googleapis` + service account. Un builder PURO arma la grilla de la semana; un writer la escribe vía Sheets API; un servicio de sync la dispara con debounce best-effort en cada cambio. Sin credenciales = no-op. Frontend: sección en Configuración con link + "Sincronizar ahora".

**Tech Stack:** Backend Node+Express 5+TS, Prisma 7, Zod 4, googleapis, Vitest+Testcontainers. Frontend Next 16 + pnpm.

**Ramas:** backend `feat/sheets-backend`, frontend `feat/sheets-panel`.

**Verificado:** `env.ts` = zod schema + `getEnv()`. `reservaRepo.list(where)` incluye `cliente`+`cancha`. `cobroRepo.sumByReserva(reservaId)`. `dayWindowUtc`/`combineDateTimeUtc` en `utils/tz.ts`. `requireRole('ADMIN')` existe. `configService.get()` (horaApertura/Cierre). Reglas: nueva env → declararla en `environment:` del compose.

---

## Parte A — Backend (rama `feat/sheets-backend`)

### Task A0: Rama
- [ ] **Step 1**
```bash
cd c:/Users/Lautaro/Desktop/ortigoza/backend && git checkout main && git pull && git checkout -b feat/sheets-backend
```

---

### Task A1: Dependencia + envs
**Files:** `package.json`, `src/config/env.ts`

- [ ] **Step 1: Instalar googleapis**
```bash
npm install googleapis
```
- [ ] **Step 2: Envs** — en `src/config/env.ts`, agregar al `schema` (default '' = opcional → no-op):
```ts
  GOOGLE_SERVICE_ACCOUNT: z.string().default(''),
  SHEETS_SPREADSHEET_ID: z.string().default(''),
```
- [ ] **Step 3: tsc + commit**
```bash
npx tsc --noEmit
git add package.json package-lock.json src/config/env.ts && git commit -m "feat(sheets): googleapis dep + env vars (opcionales)"
```

---

### Task A2: Builder PURO de la grilla + unit tests (TDD)
**Files:** Create `src/services/sheets/grilla.ts`; Test `tests/unit/grilla.test.ts`

- [ ] **Step 1: Test que falla**

Crear `tests/unit/grilla.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { construirGrillaDia, COLORES, type ReservaCelda } from '../../src/services/sheets/grilla.js';

const canchas = [{ id: 'c1', nombre: 'Cancha 1' }, { id: 'c2', nombre: 'Cancha 2' }];
const horas = ['16:00', '17:00', '18:00'];

function celda(o: Partial<ReservaCelda>): ReservaCelda {
  return { canchaId: 'c1', hora: '17:00', cliente: 'Juan', monto: 10000, pagado: 0, ...o };
}

describe('construirGrillaDia', () => {
  it('ubica la reserva en (cancha, hora) y arma pares cliente|monto', () => {
    const g = construirGrillaDia(horas, canchas, [celda({ canchaId: 'c1', hora: '17:00', cliente: 'Juan', monto: 10000, pagado: 10000 })]);
    // encabezado: A=hora, luego Cancha 1 | $$, Cancha 2 | $$
    expect(g.header).toEqual(['Hora', 'Cancha 1', '$$', 'Cancha 2', '$$']);
    const fila17 = g.filas.find((f) => f.hora === '17:00')!;
    expect(fila17.celdas[0].texto).toBe('Juan');     // col cliente de Cancha 1
    expect(fila17.celdas[1].texto).toBe('$10.000');  // col $$
    expect(fila17.celdas[0].color).toBe(COLORES.PAGADO);
    expect(fila17.celdas[2].texto).toBe('');         // Cancha 2 vacía
  });

  it('color: pagado=verde, parcial=amarillo, sin pagar=rojo', () => {
    const g = construirGrillaDia(horas, canchas, [
      celda({ canchaId: 'c1', hora: '16:00', pagado: 10000, monto: 10000 }),
      celda({ canchaId: 'c2', hora: '16:00', pagado: 4000, monto: 10000 }),
      celda({ canchaId: 'c1', hora: '18:00', pagado: 0, monto: 10000 }),
    ]);
    const f16 = g.filas.find((f) => f.hora === '16:00')!;
    expect(f16.celdas[0].color).toBe(COLORES.PAGADO);
    expect(f16.celdas[2].color).toBe(COLORES.PARCIAL);
    const f18 = g.filas.find((f) => f.hora === '18:00')!;
    expect(f18.celdas[0].color).toBe(COLORES.SIN_PAGAR);
  });

  it('fila total = suma de montos del día', () => {
    const g = construirGrillaDia(horas, canchas, [
      celda({ hora: '16:00', monto: 10000 }), celda({ canchaId: 'c2', hora: '17:00', monto: 5000 }),
    ]);
    expect(g.total).toBe(15000);
    expect(g.filaTotal[0]).toBe('TOTAL $');
  });
});
```

- [ ] **Step 2: Correr → falla**
```bash
npx vitest run tests/unit/grilla.test.ts
```
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `grilla.ts`**

Crear `src/services/sheets/grilla.ts`:
```ts
export interface ColorRGB { red: number; green: number; blue: number }
export const COLORES = {
  PAGADO: { red: 0.78, green: 0.92, blue: 0.79 } as ColorRGB,
  PARCIAL: { red: 1, green: 0.95, blue: 0.7 } as ColorRGB,
  SIN_PAGAR: { red: 0.99, green: 0.85, blue: 0.85 } as ColorRGB,
  NINGUNO: null as ColorRGB | null,
};
export interface ReservaCelda { canchaId: string; hora: string; cliente: string; monto: number; pagado: number }
export interface Celda { texto: string; color: ColorRGB | null }
export interface FilaGrilla { hora: string; celdas: Celda[] }
export interface GrillaDia { header: string[]; filas: FilaGrilla[]; filaTotal: string[]; total: number }

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
function colorDe(monto: number, pagado: number): ColorRGB {
  if (pagado >= monto && monto > 0) return COLORES.PAGADO;
  if (pagado > 0) return COLORES.PARCIAL;
  return COLORES.SIN_PAGAR;
}

export function construirGrillaDia(horas: string[], canchas: { id: string; nombre: string }[], reservas: ReservaCelda[]): GrillaDia {
  const header = ['Hora', ...canchas.flatMap((c) => [c.nombre, '$$'])];
  const byKey = new Map<string, ReservaCelda>();
  for (const r of reservas) byKey.set(`${r.canchaId}|${r.hora}`, r);
  const filas: FilaGrilla[] = horas.map((hora) => {
    const celdas: Celda[] = [];
    for (const c of canchas) {
      const r = byKey.get(`${c.id}|${hora}`);
      if (r) {
        const col = colorDe(r.monto, r.pagado);
        celdas.push({ texto: r.cliente, color: col }, { texto: money(r.monto), color: col });
      } else {
        celdas.push({ texto: '', color: null }, { texto: '', color: null });
      }
    }
    return { hora, celdas };
  });
  const total = reservas.reduce((s, r) => s + Number(r.monto), 0);
  const filaTotal = ['TOTAL $', ...canchas.flatMap(() => ['', '']).slice(0, -1), money(total)];
  return { header, filas, filaTotal, total };
}
```
NOTA: `filaTotal` deja el total en la última columna; el detalle visual fino del Excel no se replica al 100% (fuera de alcance). Lo importante es header + grilla + colores + total.

- [ ] **Step 4: Correr → pasa**
```bash
npx vitest run tests/unit/grilla.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/services/sheets/grilla.ts tests/unit/grilla.test.ts && git commit -m "feat(sheets): builder puro de la grilla por día"
```

---

### Task A3: Datos de la semana + writer + servicio de sync
**Files:** Create `src/services/sheets/sheetsData.ts`, `src/services/sheets/sheetsClient.ts`, `src/services/sheets/sheetsSync.service.ts`

- [ ] **Step 1: sheetsData (semana actual)**

Crear `src/services/sheets/sheetsData.ts`:
```ts
import { getEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { canchaRepo } from '../../repositories/cancha.repo.js';
import { configService } from '../config.service.js';
import { dayWindowUtc } from '../../utils/tz.js';
import type { ReservaCelda } from './grilla.js';

const TZ = () => getEnv().TZ_NEGOCIO;
const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];

function ymd(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function partesEnTz(iso: Date): { fecha: string; hora: string } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(iso);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  let h = g('hour'); if (h === '24') h = '00';
  return { fecha: `${g('year')}-${g('month')}-${g('day')}`, hora: `${h}:${g('minute')}` };
}

export function diasSemanaActual(): { dia: string; fecha: string }[] {
  const hoy = ymd(new Date());
  const [y, m, d] = hoy.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const lunesMs = base.getTime() - ((base.getUTCDay() + 6) % 7) * 86400000;
  return DIAS.map((dia, i) => ({ dia, fecha: new Date(lunesMs + i * 86400000).toISOString().slice(0, 10) }));
}

export function horasDeConfig(horaApertura: string, horaCierre: string): string[] {
  const out: string[] = [];
  for (let h = Number(horaApertura.slice(0, 2)); h < Number(horaCierre.slice(0, 2)); h++) out.push(String(h).padStart(2, '0') + ':00');
  return out;
}

export async function dataSemana() {
  const dias = diasSemanaActual();
  const cfg = await configService.get();
  const horas = horasDeConfig(cfg.horaApertura, cfg.horaCierre);
  const canchas = (await canchaRepo.list(true)).map((c) => ({ id: c.id, nombre: c.nombre }));
  const start = dayWindowUtc(dias[0].fecha, TZ()).start;
  const end = dayWindowUtc(dias[6].fecha, TZ()).end;
  const reservas = await prisma.reserva.findMany({
    where: { fechaInicio: { gte: start, lt: end }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA', 'COMPLETADA'] } },
    include: { cliente: { select: { nombre: true } }, cobros: { select: { monto: true } } },
  });
  const celdas: ReservaCelda[] = reservas.map((r) => {
    const { fecha, hora } = partesEnTz(r.fechaInicio);
    return { canchaId: r.canchaId, fecha, hora, cliente: r.cliente?.nombre ?? '-', monto: Number(r.monto), pagado: r.cobros.reduce((s, c) => s + Number(c.monto), 0) };
  });
  return { dias, horas, canchas, celdas };
}
```
NOTA: requiere la relación `cobros` en `Reserva` (ya existe del feature de caja). Si `canchaRepo.list(true)` no filtra activas, usar el filtro que exista.

- [ ] **Step 2: sheetsClient (writer googleapis)**

Crear `src/services/sheets/sheetsClient.ts`:
```ts
import { google } from 'googleapis';
import { getEnv } from '../../config/env.js';
import type { GrillaDia, ColorRGB } from './grilla.js';

export function estaConfigurado(): boolean {
  const e = getEnv();
  return !!e.GOOGLE_SERVICE_ACCOUNT && !!e.SHEETS_SPREADSHEET_ID;
}
export function sheetUrl(): string | null {
  const id = getEnv().SHEETS_SPREADSHEET_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}` : null;
}

function sheetsApi() {
  const cred = JSON.parse(Buffer.from(getEnv().GOOGLE_SERVICE_ACCOUNT, 'base64').toString('utf8'));
  const auth = new google.auth.JWT({ email: cred.client_email, key: cred.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

const fondo = (c: ColorRGB | null) => (c ? { backgroundColor: c } : { backgroundColor: { red: 1, green: 1, blue: 1 } });
const txtCell = (t: string, c: ColorRGB | null) => ({ userEnteredValue: { stringValue: t }, userEnteredFormat: fondo(c) });

/** Reconstruye una pestaña (la crea si falta) con valores + colores. */
export async function escribirDia(dia: string, fecha: string, g: GrillaDia): Promise<void> {
  const sheets = sheetsApi();
  const spreadsheetId = getEnv().SHEETS_SPREADSHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  let hoja = meta.data.sheets?.find((s) => s.properties?.title === dia);
  if (!hoja) {
    const add = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: dia } } }] } });
    hoja = add.data.replies?.[0]?.addSheet ? { properties: add.data.replies[0].addSheet!.properties } : undefined;
  }
  const sheetId = hoja?.properties?.sheetId;
  if (sheetId == null) return;

  // Fila 0 = encabezado (con la fecha al final); luego filas de horas; luego total.
  const rows = [
    { values: [...g.header, '', `DIA ${fecha}`].map((t) => txtCell(t, null)) },
    ...g.filas.map((f) => ({ values: [txtCell(f.hora, null), ...f.celdas.map((c) => txtCell(c.texto, c.color))] })),
    { values: g.filaTotal.map((t) => txtCell(t, null)) },
  ];
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { updateCells: { rows, fields: 'userEnteredValue,userEnteredFormat.backgroundColor', start: { sheetId, rowIndex: 0, columnIndex: 0 } } },
      ],
    },
  });
}
```
NOTA: el `addSheet` deja la nueva hoja; el segundo `batchUpdate` escribe. Para limpiar contenido viejo cuando una grilla nueva tiene menos filas, está OK sobrescribir el rango usado (las reservas viejas en celdas que ya no se tocan podrían quedar; aceptable para MVP — si molesta, agregar un `updateCells` que limpie un rango fijo amplio antes). El detalle de "limpiar el resto" se documenta como mejora menor.

- [ ] **Step 3: sheetsSync.service (sincronizarTodo + marcarSucio debounce best-effort)**

Crear `src/services/sheets/sheetsSync.service.ts`:
```ts
import { logger } from '../../config/logger.js';
import { estaConfigurado, escribirDia } from './sheetsClient.js';
import { dataSemana } from './sheetsData.js';
import { construirGrillaDia } from './grilla.js';

const timers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 2500;

async function reconstruirDia(fecha: string): Promise<void> {
  const { dias, horas, canchas, celdas } = await dataSemana();
  const dia = dias.find((d) => d.fecha === fecha);
  if (!dia) return; // fecha fuera de la semana actual: no se refleja
  const g = construirGrillaDia(horas, canchas, celdas.filter((c) => c.fecha === fecha));
  await escribirDia(dia.dia, dia.fecha, g);
}

export const sheetsSync = {
  async sincronizarTodo(): Promise<void> {
    if (!estaConfigurado()) return;
    const { dias, horas, canchas, celdas } = await dataSemana();
    for (const d of dias) {
      const g = construirGrillaDia(horas, canchas, celdas.filter((c) => c.fecha === d.fecha));
      await escribirDia(d.dia, d.fecha, g);
    }
  },
  /** Best-effort, no bloqueante, con debounce por fecha. Nunca lanza. */
  marcarSucio(fecha: string): void {
    if (!estaConfigurado() || !fecha) return;
    const prev = timers.get(fecha);
    if (prev) clearTimeout(prev);
    timers.set(fecha, setTimeout(() => {
      timers.delete(fecha);
      reconstruirDia(fecha).catch((e) => logger.warn({ err: String(e) }, 'sheets sync falló'));
    }, DEBOUNCE_MS));
  },
};
```
NOTA: confirmá el import real del logger (`../../config/logger.js` o como esté); si no hay, usar `console.warn`.

- [ ] **Step 4: tsc + commit**
```bash
npx tsc --noEmit
git add src/services/sheets/ && git commit -m "feat(sheets): data semana, writer googleapis y servicio de sync (debounce/no-op)"
```

---

### Task A4: Endpoints + triggers (TDD para el no-op/roles)
**Files:** Create `src/routes/sheets.routes.ts`; Modify `src/routes/index.ts`, `src/services/reserva.service.ts`, `src/services/cobro.service.ts`; Test `tests/integration/sheets.test.ts`

- [ ] **Step 1: Test que falla**

Crear `tests/integration/sheets.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
const admin = () => signAdminToken({ adminId: 'a', email: 'a@a.com', rol: 'ADMIN' });
const recep = () => signAdminToken({ adminId: 'r', email: 'r@r.com', rol: 'RECEPCIONISTA' });

describe('sheets', () => {
  it('GET /sheets/info → configurado false en test (sin envs)', async () => {
    const res = await supertest(app).get('/sheets/info').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    expect(res.body.configurado).toBe(false);
    expect(res.body.url).toBeNull();
  });
  it('POST /sheets/sync sin config → 503', async () => {
    const res = await supertest(app).post('/sheets/sync').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(503);
  });
  it('RECEPCIONISTA no puede sincronizar → 403', async () => {
    const res = await supertest(app).post('/sheets/sync').set('authorization', `Bearer ${recep()}`);
    expect(res.status).toBe(403);
  });
});
```
(En el entorno de test las envs `GOOGLE_SERVICE_ACCOUNT`/`SHEETS_SPREADSHEET_ID` están vacías → `estaConfigurado()` false.)

- [ ] **Step 2: Correr → falla**
```bash
npx vitest run tests/integration/sheets.test.ts
```
Expected: FAIL (rutas no existen).

- [ ] **Step 3: Rutas**

Crear `src/routes/sheets.routes.ts`:
```ts
import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { estaConfigurado, sheetUrl } from '../services/sheets/sheetsClient.js';
import { sheetsSync } from '../services/sheets/sheetsSync.service.js';
import { ServiceUnavailable } from '../utils/errors.js';

export const sheetsRoutes = Router();
sheetsRoutes.use(authJwt, requireRole('ADMIN'));

sheetsRoutes.get('/info', (_req, res) => {
  res.json({ configurado: estaConfigurado(), url: sheetUrl() });
});
sheetsRoutes.post('/sync', async (_req, res, next) => {
  try {
    if (!estaConfigurado()) throw ServiceUnavailable('Google Sheets no está configurado');
    await sheetsSync.sincronizarTodo();
    res.json({ ok: true });
  } catch (e) { next(e); }
});
```
NOTA: si no existe un helper `ServiceUnavailable` (503) en `utils/errors.ts`, agregarlo siguiendo el patrón existente: `export const ServiceUnavailable = (message = 'No disponible') => new AppError(503, 'SERVICE_UNAVAILABLE', message);`. En `src/routes/index.ts`: `import { sheetsRoutes } from './sheets.routes.js';` y `apiRouter.use('/sheets', sheetsRoutes);`.

- [ ] **Step 4: Triggers (marcarSucio best-effort)**

Importar `sheetsSync` y la fecha-en-TZ donde haga falta. En `reserva.service.ts`: tras crear (`crear`), cancelar y reprogramar, llamar `sheetsSync.marcarSucio(<fecha YYYY-MM-DD de la reserva>)`. La fecha se obtiene del input (`input.fecha`) en `crear`; en cancelar/reprogramar/aprobarSena, de la reserva (`r`/`updated.fechaInicio` → derivar YYYY-MM-DD en TZ con un helper local `ymdEnTz(date)` o reusar el de sheetsData exportándolo). Reprogramar: marcar el día **viejo** y el **nuevo**. En `cobro.service.ts`: tras `crear` y `eliminar`, marcar la fecha de la reserva del cobro (obtener `reserva.fechaInicio`). En `aprobarSena`: marcar la fecha de `r`. Todas las llamadas son fire-and-forget (el método ya es no-bloqueante y no lanza).

Para la fecha desde un `Date` en TZ negocio, exportar de `sheetsData.ts` un helper `ymdEnTz(d: Date): string` (es el `ymd` interno) y usarlo. En `crear` ya está `input.fecha` (YYYY-MM-DD) → usar directo.

- [ ] **Step 5: Correr → pasa**
```bash
npx vitest run tests/integration/sheets.test.ts
```
Expected: PASS (3 casos).

- [ ] **Step 6: Suite + commit**
```bash
npx vitest run && npx tsc --noEmit
git add src/routes/sheets.routes.ts src/routes/index.ts src/utils/errors.ts src/services/reserva.service.ts src/services/cobro.service.ts src/services/sheets/sheetsData.ts tests/integration/sheets.test.ts && git commit -m "feat(sheets): endpoints info/sync + triggers de sync en reservas/cobros"
```

---

## Parte B — Frontend (rama `feat/sheets-panel`)

### Task B0: Rama
- [ ] **Step 1**
```bash
cd c:/Users/Lautaro/Desktop/ortigoza/frontend && git checkout master && git checkout -b feat/sheets-panel
```

---

### Task B1: Sección "Planilla de Google" en Configuración
**Files:** `src/lib/types.ts`, Create `src/lib/sheets-actions.ts`, `src/components/config/planilla-google.tsx`; Modify `src/app/(panel)/configuracion/page.tsx`

- [ ] **Step 1: Tipo** — en `src/lib/types.ts`:
```ts
export interface SheetsInfo { configurado: boolean; url: string | null }
```
- [ ] **Step 2: Actions** — crear `src/lib/sheets-actions.ts`:
```ts
'use server';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { SheetsInfo } from './types';

export async function getSheetsInfo(): Promise<SheetsInfo> {
  try { return await apiFetch<SheetsInfo>('/sheets/info'); } catch { return { configurado: false, url: null }; }
}
export async function sincronizarSheets(): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await apiFetch('/sheets/sync', { method: 'POST' }); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}
```
- [ ] **Step 3: Componente** — crear `src/components/config/planilla-google.tsx`:
```tsx
'use client';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { SheetsInfo } from '@/lib/types';
import { sincronizarSheets } from '@/lib/sheets-actions';

export function PlanillaGoogle({ info }: { info: SheetsInfo }) {
  const [pending, start] = useTransition();
  function sync() {
    start(async () => { const r = await sincronizarSheets(); if (r.ok) toast.success('Planilla actualizada'); else toast.error(r.error); });
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Planilla de Google</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {info.configurado ? (
          <>
            <p>La planilla se actualiza sola con cada cambio. <a href={info.url!} target="_blank" rel="noreferrer" className="text-primary underline">Abrir planilla</a></p>
            <Button variant="outline" disabled={pending} onClick={sync}>{pending ? 'Sincronizando…' : 'Sincronizar ahora'}</Button>
          </>
        ) : (
          <p className="text-neutral-500">No está configurada. Para activarla: crear una cuenta de servicio en Google Cloud, compartir el Sheet con su email, y setear <code>GOOGLE_SERVICE_ACCOUNT</code> (base64) y <code>SHEETS_SPREADSHEET_ID</code> en el servidor.</p>
        )}
      </CardContent>
    </Card>
  );
}
```
- [ ] **Step 4: Page** — en `src/app/(panel)/configuracion/page.tsx`, fetch info y renderizar la sección (la page ya tiene `requireAdmin` por Task de roles; si no, agregarlo). Agregar:
```tsx
import { getSheetsInfo } from '@/lib/sheets-actions';
import { PlanillaGoogle } from '@/components/config/planilla-google';
// dentro del componente, en paralelo al fetch de config:
const sheets = await getSheetsInfo();
// en el JSX, después del <ConfigForm/>:
<PlanillaGoogle info={sheets} />
```
- [ ] **Step 5: build + commit**
```bash
pnpm exec tsc --noEmit && pnpm build
git add src/lib/types.ts src/lib/sheets-actions.ts src/components/config/planilla-google.tsx "src/app/(panel)/configuracion/page.tsx" && git commit -m "feat(sheets): sección Planilla de Google en Configuración"
```

---

### Task B2: Verificación
- [ ] **Step 1**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build
```
Expected: verde. Manual (post-deploy con credenciales): en Configuración aparece la sección; "Sincronizar ahora" puebla las 7 pestañas; al crear/cobrar una reserva, la pestaña del día se actualiza en ~unos segundos.

---

## Parte C — Cierre + deploy
- [ ] **Step 1: Backend** — finishing-a-development-branch en `feat/sheets-backend`: merge `main` + push. **Deploy:** además del rebuild normal, hay que declarar `GOOGLE_SERVICE_ACCOUNT` y `SHEETS_SPREADSHEET_ID` en el bloque `environment:` de `docker-compose.vm.yml` y ponerlas en el `.env` de la VM (con el JSON en base64 y el id del Sheet). Sin eso, queda no-op (no rompe).
- [ ] **Step 2: Frontend** — finishing-a-development-branch en `feat/sheets-panel`: merge `master` (local).
- [ ] **Step 3 (usuario):** crear la service account en Google Cloud, habilitar Google Sheets API, compartir el Sheet con su email, cargar las envs, y tocar "Sincronizar ahora".

---

## Self-Review

**Spec coverage:** dep googleapis + envs opcionales (A1) ✓; builder puro con colores por saldo y total + tests (A2) ✓; data semana actual (reservas+pagado, horas de config, canchas activas) (A3 Step1) ✓; writer googleapis con service account, crea pestañas, valores+colores via updateCells (A3 Step2) ✓; sync sincronizarTodo + marcarSucio debounce/best-effort/no-op (A3 Step3) ✓; endpoints info/sync admin + 503 sin config + triggers en reservas/cobros/seña (A4) ✓; frontend sección Planilla con link + sincronizar + estado (B1) ✓; tabs = semana actual (DIAS lun-dom) ✓; sin credenciales = no-op ✓; deploy/envs en compose (C) ✓.

**Placeholder scan:** sin TBD. "NOTA: confirmá logger / ServiceUnavailable / canchaRepo.list(true)" = verificación contra el código real (con el fix indicado si falta).

**Type consistency:** `ReservaCelda {canchaId,hora,cliente,monto,pagado}` y `GrillaDia {header,filas,filaTotal,total}` y `COLORES` consistentes entre `grilla.ts` (A2), `sheetsData` (A3) y `sheetsClient` (A3). `sheetsSync.{sincronizarTodo,marcarSucio}` usado en rutas (A4) y triggers (A4). `estaConfigurado()/sheetUrl()` en client y rutas. `SheetsInfo {configurado,url}` = shape de `GET /sheets/info` (backend) ↔ frontend (B1).

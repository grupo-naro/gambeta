# Configuración editable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editar desde el panel (sin redeploy) horarios del complejo, teléfono del admin y datos de seña, guardados en una tabla singleton `Configuracion` que reemplaza a las variables `.env`.

**Architecture:** Tabla `Configuracion` de una fila (sembrada desde `.env`). `senaService` y `disponibilidad` leen de la DB. Endpoints `GET /config` (authAny) y `PATCH /config` (authJwt). El bot lee `adminWhatsapp`/horario de `GET /config`. Frontend Next 16 (BFF) con una página de configuración.

**Tech Stack:** Backend Express 5 + TS + Prisma 7 + Zod + Vitest/Supertest/Testcontainers. Frontend Next 16 + Tailwind 4 + shadcn(Base UI) + Zod + Vitest, pnpm.

---

# PART 1 — Backend (`feat/config-backend`)

**Branch:** `feat/config-backend` desde `main`, en `c:/Users/Lautaro/Desktop/ortigoza/backend`. Docker Desktop debe estar corriendo (Testcontainers + `prisma migrate dev` necesita el dev pg). Comandos: `npx vitest run`, `npx tsc --noEmit`.

**Contexto:**
- Rutas montadas en `src/routes/index.ts` (`/config` → `config.routes.ts`, que hoy solo tiene `GET /sena`).
- `senaService` (`src/services/sena.service.ts`) hoy lee de `getEnv()`; lo usan `reserva.service.ts:47` (`montoParaPrecio`) y `:89` (`datosPago`), y `config.routes.ts` (`/sena`).
- `disponibilidad.service.ts` hoy itera `HorarioDisponible`; usa `combineDateTimeUtc`, `dayWindowUtc` de `src/utils/tz.ts` y `getEnv().TZ_NEGOCIO`.
- Migraciones en `prisma/migrations/`; se generan con `npx prisma migrate dev --name <x>`.
- Errores: `src/utils/errors.ts` (`BusinessRule` → 422, `Conflict` → 409). Validación: `validate(schema)` con `body/query/params`; `const empty = z.looseObject({})`.
- Valor actual del teléfono admin (hoy en el bot): `5491159582039`.

## Task B1: Modelo `Configuracion` + migración + configService + seed

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/repositories/config.repo.ts`, `src/services/config.service.ts`
- Modify: `src/seed.ts`
- Test: `tests/integration/config.test.ts` (create)

- [ ] **Step 1: Agregar el modelo y enum a `prisma/schema.prisma`**

Al final del archivo:

```prisma
enum SenaModo {
  PORCENTAJE
  FIJO
}

model Configuracion {
  id             String   @id @default("default")
  horaApertura   String   @default("16:00")
  horaCierre     String   @default("23:00")
  adminWhatsapp  String   @default("")
  senaModo       SenaModo @default(PORCENTAJE)
  senaPorcentaje Int      @default(50)
  senaMontoFijo  Decimal  @default(5000) @db.Decimal(10, 2)
  cbu            String   @default("")
  alias          String   @default("")
  titular        String   @default("")
  actualizadoEn  DateTime @updatedAt
}
```

- [ ] **Step 2: Crear la migración**

Run: `npx prisma migrate dev --name configuracion`
Expected: crea `prisma/migrations/<ts>_configuracion/` y aplica la tabla. (Regenera el client.)

- [ ] **Step 3: Crear `src/repositories/config.repo.ts`**

```ts
import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';

const ID = 'default';

export const configRepo = {
  async getOrCreate() {
    const found = await prisma.configuracion.findUnique({ where: { id: ID } });
    if (found) return found;
    const env = getEnv();
    return prisma.configuracion.create({
      data: {
        id: ID,
        horaApertura: '16:00',
        horaCierre: '23:00',
        adminWhatsapp: '',
        senaModo: env.SENA_MODO === 'fijo' ? 'FIJO' : 'PORCENTAJE',
        senaPorcentaje: env.SENA_PORCENTAJE,
        senaMontoFijo: env.SENA_MONTO_FIJO,
        cbu: env.SENA_CBU,
        alias: env.SENA_ALIAS,
        titular: env.SENA_TITULAR,
      },
    });
  },
  update: (data: Record<string, unknown>) =>
    prisma.configuracion.update({ where: { id: ID }, data }),
};
```

- [ ] **Step 4: Crear `src/services/config.service.ts`**

```ts
import { configRepo } from '../repositories/config.repo.js';

export const configService = {
  get: () => configRepo.getOrCreate(),
  update: (patch: Record<string, unknown>) => configRepo.update(patch),
};
```

- [ ] **Step 5: Sembrar en `src/seed.ts`**

En `src/seed.ts`, antes del `console.log('Seed completo')`, agregar la creación idempotente de la config desde el admin number por defecto:

```ts
  const { configRepo } = await import('./repositories/config.repo.js');
  const cfg = await configRepo.getOrCreate();
  if (!cfg.adminWhatsapp) await configRepo.update({ adminWhatsapp: '5491159582039' });
```

- [ ] **Step 6: Test (TDD) — `tests/integration/config.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';
import { configService } from '../../src/services/config.service.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('configService', () => {
  it('crea la fila default si no existe y la devuelve', async () => {
    const c = await configService.get();
    expect(c.id).toBe('default');
    expect(c.horaApertura).toMatch(/^\d{2}:\d{2}$/);
    expect(c.horaCierre).toMatch(/^\d{2}:\d{2}$/);
  });
  it('update modifica y persiste', async () => {
    await configService.get();
    await configService.update({ alias: 'nuevo.alias', horaApertura: '09:00' });
    const c = await configService.get();
    expect(c.alias).toBe('nuevo.alias');
    expect(c.horaApertura).toBe('09:00');
  });
});
```

> Nota: `resetTables` debe truncar/limpiar también `Configuracion`. Verificar `tests/helpers/db.ts`; si limpia por lista de tablas, agregar `Configuracion`. Si hace `TRUNCATE ... CASCADE` dinámico sobre todas las tablas, ya está cubierto.

- [ ] **Step 7: Run + commit**

Run: `npx vitest run tests/integration/config.test.ts` → PASS. Luego `npx tsc --noEmit`.
```bash
git add prisma/schema.prisma prisma/migrations src/repositories/config.repo.ts src/services/config.service.ts src/seed.ts tests/integration/config.test.ts
git commit -m "feat(config): tabla Configuracion singleton + configService + seed"
```

## Task B2: Endpoints `GET /config` + `PATCH /config` + schema

**Files:**
- Create: `src/validators/config.schema.ts`
- Modify: `src/routes/config.routes.ts`
- Test: `tests/integration/config.test.ts` (append endpoint tests)

- [ ] **Step 1: Crear `src/validators/config.schema.ts`**

```ts
import { z } from 'zod';
const empty = z.looseObject({});
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida (HH:MM)');

export const updateConfigSchema = z.object({
  body: z.object({
    horaApertura: hhmm.optional(),
    horaCierre: hhmm.optional(),
    adminWhatsapp: z.string().min(8).optional(),
    senaModo: z.enum(['PORCENTAJE', 'FIJO']).optional(),
    senaPorcentaje: z.coerce.number().int().min(0).max(100).optional(),
    senaMontoFijo: z.coerce.number().nonnegative().optional(),
    cbu: z.string().optional(),
    alias: z.string().optional(),
    titular: z.string().optional(),
  }).refine(
    (b) => !(b.horaApertura && b.horaCierre) || b.horaApertura < b.horaCierre,
    { message: 'La apertura debe ser anterior al cierre', path: ['horaCierre'] },
  ),
  query: empty,
  params: empty,
});
```

- [ ] **Step 2: Actualizar `src/routes/config.routes.ts`**

```ts
import { Router } from 'express';
import { authAny } from '../middlewares/authAny.js';
import { authJwt } from '../middlewares/authJwt.js';
import { validate } from '../middlewares/validate.js';
import { senaService } from '../services/sena.service.js';
import { configService } from '../services/config.service.js';
import { updateConfigSchema } from '../validators/config.schema.js';

export const configRoutes = Router();

configRoutes.get('/', authAny, async (_req, res, next) => {
  try { res.json(await configService.get()); } catch (e) { next(e); }
});

configRoutes.patch('/', authJwt, validate(updateConfigSchema), async (req, res, next) => {
  try { res.json(await configService.update((req as any).valid.body)); } catch (e) { next(e); }
});

configRoutes.get('/sena', authAny, async (_req, res, next) => {
  try { res.json(await senaService.datosPago()); } catch (e) { next(e); }
});
```

> Nota: `/sena` ahora es async porque `senaService.datosPago()` pasa a async en B3. Si B3 todavía no se hizo, este `await` sobre una función sync igual funciona (await de un valor no-promesa es válido). El orden recomendado es B1→B2→B3.

- [ ] **Step 3: Tests de endpoint (append a `config.test.ts`)**

Agregar el setup de app + un admin token (mismo patrón que otros tests) y:

```ts
import supertest from 'supertest';
import { getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
// dentro del archivo: construir app en beforeAll con buildApp(), y token en beforeEach.

describe('GET/PATCH /config', () => {
  it('GET /config devuelve la config (authAny)', async () => {
    const res = await supertest(app).get('/config').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('default');
  });
  it('PATCH /config actualiza con JWT admin', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ alias: 'canchitas.mp', horaApertura: '09:00', horaCierre: '23:00' });
    expect(res.status).toBe(200);
    expect(res.body.alias).toBe('canchitas.mp');
  });
  it('PATCH /config 400 con HH:MM inválido', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ horaApertura: '9am' });
    expect(res.status).toBe(400);
  });
  it('PATCH /config 400 si apertura >= cierre', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ horaApertura: '23:00', horaCierre: '09:00' });
    expect(res.status).toBe(400);
  });
  it('PATCH /config 401 sin auth', async () => {
    const res = await supertest(app).patch('/config').send({ alias: 'x' });
    expect(res.status).toBe(401);
  });
});
```

(Reusar el `beforeAll`/`beforeEach` que ya tiene el archivo; agregar `let app; let token;` y construir como en `cancha-delete.test.ts`.)

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/integration/config.test.ts` → PASS; `npx tsc --noEmit`.
```bash
git add src/validators/config.schema.ts src/routes/config.routes.ts tests/integration/config.test.ts
git commit -m "feat(config): endpoints GET /config (authAny) + PATCH /config (authJwt)"
```

## Task B3: `senaService` lee de la DB (async)

**Files:**
- Modify: `src/services/sena.service.ts`, `src/services/reserva.service.ts`
- Test: `tests/integration/config.test.ts` (append)

- [ ] **Step 1: Test (TDD) — la seña sale de la config de DB**

Append:
```ts
import { senaService } from '../../src/services/sena.service.js';

describe('senaService desde DB', () => {
  it('monto fijo desde config', async () => {
    await configService.update({ senaModo: 'FIJO', senaMontoFijo: 7000 });
    expect(await senaService.montoParaPrecio(12000)).toBe(7000);
  });
  it('porcentaje desde config', async () => {
    await configService.update({ senaModo: 'PORCENTAJE', senaPorcentaje: 50 });
    expect(await senaService.montoParaPrecio(12000)).toBe(6000);
  });
  it('datosPago refleja alias de la config', async () => {
    await configService.update({ alias: 'pago.canchitas', cbu: '000', titular: 'Nahuel' });
    const dp = await senaService.datosPago();
    expect(dp.alias).toBe('pago.canchitas');
  });
});
```

- [ ] **Step 2: Run para verlo fallar**

Run: `npx vitest run tests/integration/config.test.ts` → FAIL (senaService aún lee env / no es async).

- [ ] **Step 3: Reescribir `src/services/sena.service.ts`**

```ts
import { configService } from './config.service.js';

export interface DatosPago {
  modo: 'porcentaje' | 'fijo';
  porcentaje: number;
  cbu: string;
  alias: string;
  titular: string;
}

export const senaService = {
  async montoParaPrecio(precioHora: number): Promise<number> {
    const c = await configService.get();
    if (c.senaModo === 'FIJO') return Math.round(Number(c.senaMontoFijo));
    return Math.round((precioHora * c.senaPorcentaje) / 100);
  },
  async datosPago(): Promise<DatosPago> {
    const c = await configService.get();
    return {
      modo: c.senaModo === 'FIJO' ? 'fijo' : 'porcentaje',
      porcentaje: c.senaPorcentaje,
      cbu: c.cbu,
      alias: c.alias,
      titular: c.titular,
    };
  },
};
```

- [ ] **Step 4: Ajustar el ripple en `src/services/reserva.service.ts`**

En `crear`, línea ~45-47 (cálculo de `montoSena`):
```ts
    const montoSena =
      estado === 'ESPERANDO_SENA'
        ? (input.montoSena ?? (await senaService.montoParaPrecio(Number(cancha.precioHora))))
        : null;
```
Y el return con datosPago (~línea 88-90):
```ts
    if (estado === 'ESPERANDO_SENA') {
      return { ...reserva, datosPago: await senaService.datosPago() };
    }
```
(`crear` ya es `async`, así que `await` es válido.)

- [ ] **Step 5: Run + tsc + commit**

Run: `npx vitest run tests/integration/config.test.ts` → PASS; `npx vitest run` (suite completa) → verde; `npx tsc --noEmit`.
```bash
git add src/services/sena.service.ts src/services/reserva.service.ts tests/integration/config.test.ts
git commit -m "feat(config): senaService lee de la DB (async) + ripple en reserva.crear"
```

## Task B4: `disponibilidad` usa el horario global

**Files:**
- Modify: `src/services/disponibilidad.service.ts`
- Test: `tests/integration/config.test.ts` (append) o el existente de disponibilidad

- [ ] **Step 1: Test (TDD)**

Append a `config.test.ts` (necesita una cancha; crear una vía `getPrisma().cancha.create`):
```ts
describe('disponibilidad usa horario global', () => {
  it('genera slots dentro de la apertura-cierre de la config', async () => {
    await configService.update({ horaApertura: '09:00', horaCierre: '12:00' });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
    const { disponibilidadService } = await import('../../src/services/disponibilidad.service.js');
    const fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const r = await disponibilidadService.listar(cancha.id, fecha);
    expect(r.slots.map((s) => s.horaInicio)).toEqual(['09:00', '10:00', '11:00']);
  });
});
```

- [ ] **Step 2: Reescribir el cuerpo de `disponibilidadService.listar`**

En `src/services/disponibilidad.service.ts`, reemplazar el uso de `horarioRepo.forCanchaAndDay` por el horario global de la config. El método queda:

```ts
import { getEnv } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { canchaService } from './cancha.service.js';
import { configService } from './config.service.js';
import { combineDateTimeUtc, dayWindowUtc } from '../utils/tz.js';

const SLOT_MIN = 60;
const pad = (n: number) => String(n).padStart(2, '0');
const toHHMM = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export interface Slot { horaInicio: string; horaFin: string; inicioUtc: string; finUtc: string; }

export const disponibilidadService = {
  async listar(canchaId: string, fecha: string): Promise<{ canchaId: string; fecha: string; slots: Slot[] }> {
    await canchaService.get(canchaId);
    const tz = getEnv().TZ_NEGOCIO;
    const cfg = await configService.get();
    const { start, end } = dayWindowUtc(fecha, tz);

    const reservas = await prisma.reserva.findMany({
      where: { canchaId, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] }, fechaInicio: { gte: start, lt: end } },
      select: { fechaInicio: true, fechaFin: true },
    });

    const slots: Slot[] = [];
    for (let t = fromHHMM(cfg.horaApertura); t + SLOT_MIN <= fromHHMM(cfg.horaCierre); t += SLOT_MIN) {
      const horaInicio = toHHMM(t);
      const horaFin = toHHMM(t + SLOT_MIN);
      const inicioUtc = combineDateTimeUtc(fecha, horaInicio, tz);
      const finUtc = combineDateTimeUtc(fecha, horaFin, tz);
      const taken = reservas.some((r) => r.fechaInicio < finUtc && inicioUtc < r.fechaFin);
      if (!taken) slots.push({ horaInicio, horaFin, inicioUtc: inicioUtc.toISOString(), finUtc: finUtc.toISOString() });
    }
    return { canchaId, fecha, slots };
  },
};
```

(Se elimina el import de `horarioRepo` y `dayOfWeekInTz` en este archivo.)

- [ ] **Step 3: Run + suite + tsc + commit**

Run: `npx vitest run` (toda la suite — verificar que los tests de disponibilidad/reserva existentes sigan verdes con el horario global; si alguno asumía 16–23, ya sigue siendo el default) ; `npx tsc --noEmit`.
```bash
git add src/services/disponibilidad.service.ts tests/integration/config.test.ts
git commit -m "feat(config): disponibilidad usa el horario global de la config"
```

## Part 1 completion
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verificar suite, merge `feat/config-backend` → `main`, push.

---

# PART 2 — Bot (n8n) — lo aplica el controlador con n8n MCP (no subagente)

No es una tarea de subagente (requiere las tools de n8n). Tras desplegar el backend:
1. **Cerebro** (rama de escalado de comprobante): reemplazar el `ADMIN` fijo por una lectura de `GET /config` (`adminWhatsapp`), con fallback al valor actual si falla.
2. **Prompt:** inyectar `horaApertura`–`horaCierre` desde `GET /config` (mismo patrón que la lista dinámica de canchas) en vez del texto fijo "16:00-23:00".
3. Validar el workflow y dejar nota en memoria.

---

# PART 3 — Frontend (`feat/config-panel`)

**Branch:** `feat/config-panel` desde `master`, en `c:/Users/Lautaro/Desktop/ortigoza/frontend`. Comandos: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec vitest run`, `API_URL=... pnpm build`.

**Contexto:** BFF (`apiFetch`, server actions con `run()`), shadcn sobre Base UI (triggers `render`, `Select` o `<select>` nativo como en los otros dialogs). Mirar `src/lib/canchas-actions.ts` y `src/components/canchas/cancha-dialog.tsx` para el patrón exacto.

## Task F1: tipo `Config` + `configSchema` (TDD)

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/validators.ts`, `src/lib/validators.test.ts`

- [ ] **Step 1: Tipo en `src/lib/types.ts`**
```ts
export interface Config {
  id: string;
  horaApertura: string; horaCierre: string;
  adminWhatsapp: string;
  senaModo: 'PORCENTAJE' | 'FIJO';
  senaPorcentaje: number; senaMontoFijo: number | string;
  cbu: string; alias: string; titular: string;
}
```

- [ ] **Step 2: Test (append a `validators.test.ts`)**
```ts
import { configSchema } from '@/lib/validators';
describe('configSchema', () => {
  it('acepta config válida', () => {
    expect(configSchema.safeParse({ horaApertura:'09:00', horaCierre:'23:00', adminWhatsapp:'5491159582039', senaModo:'PORCENTAJE', senaPorcentaje:'50', senaMontoFijo:'5000', cbu:'', alias:'pago.x', titular:'Juan' }).success).toBe(true);
  });
  it('rechaza apertura >= cierre', () => {
    expect(configSchema.safeParse({ horaApertura:'23:00', horaCierre:'09:00', adminWhatsapp:'5491159582039', senaModo:'PORCENTAJE', senaPorcentaje:'50', senaMontoFijo:'5000', cbu:'', alias:'', titular:'' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: `configSchema` en `src/lib/validators.ts`**
```ts
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida (HH:MM)');
export const configSchema = z.object({
  horaApertura: hhmm,
  horaCierre: hhmm,
  adminWhatsapp: z.string().min(8, 'WhatsApp inválido'),
  senaModo: z.enum(['PORCENTAJE', 'FIJO']),
  senaPorcentaje: z.coerce.number().int().min(0).max(100),
  senaMontoFijo: z.coerce.number().nonnegative(),
  cbu: z.string(),
  alias: z.string(),
  titular: z.string(),
}).refine((b) => b.horaApertura < b.horaCierre, { message: 'La apertura debe ser anterior al cierre', path: ['horaCierre'] });
```

- [ ] **Step 4: Run + commit**
Run: `pnpm exec vitest run src/lib/validators.test.ts` → PASS.
```bash
git checkout -b feat/config-panel
git add src/lib/types.ts src/lib/validators.ts src/lib/validators.test.ts
git commit -m "feat(config): tipo Config + configSchema"
```

## Task F2: server action

**Files:** Create `src/lib/config-actions.ts`

- [ ] **Step 1:**
```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

export async function guardarConfig(patch: Record<string, unknown>): Promise<Result> {
  try {
    await apiFetch('/config', { method: 'PATCH', body: JSON.stringify(patch) });
    revalidatePath('/configuracion');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}
```

- [ ] **Step 2: tsc + commit**
```bash
git add src/lib/config-actions.ts
git commit -m "feat(config): server action guardarConfig"
```

## Task F3: página + form + nav

**Files:**
- Create: `src/app/(panel)/configuracion/page.tsx`, `src/components/config/config-form.tsx`
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: `config-form.tsx` (client)**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Config } from '@/lib/types';
import { configSchema } from '@/lib/validators';
import { guardarConfig } from '@/lib/config-actions';

export function ConfigForm({ config }: { config: Config }) {
  const [f, setF] = useState({
    horaApertura: config.horaApertura, horaCierre: config.horaCierre,
    adminWhatsapp: config.adminWhatsapp, senaModo: config.senaModo,
    senaPorcentaje: String(config.senaPorcentaje), senaMontoFijo: String(Number(config.senaMontoFijo)),
    cbu: config.cbu, alias: config.alias, titular: config.titular,
  });
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  function guardar() {
    const parsed = configSchema.safeParse(f);
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await guardarConfig(parsed.data);
      if (r.ok) toast.success('Configuración guardada'); else toast.error(r.error);
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <CardHeader><CardTitle className="text-base">Horarios del complejo</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1"><Label htmlFor="ap">Apertura</Label><Input id="ap" type="time" value={f.horaApertura} onChange={(e) => set('horaApertura', e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="ci">Cierre</Label><Input id="ci" type="time" value={f.horaCierre} onChange={(e) => set('horaCierre', e.target.value)} /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Contacto</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1"><Label htmlFor="wa">WhatsApp del administrador</Label><Input id="wa" value={f.adminWhatsapp} onChange={(e) => set('adminWhatsapp', e.target.value)} placeholder="5491159582039" /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Pagos / Seña</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1"><Label htmlFor="modo">Modo</Label>
            <select id="modo" value={f.senaModo} onChange={(e) => set('senaModo', e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              <option value="PORCENTAJE">Porcentaje del total</option>
              <option value="FIJO">Monto fijo</option>
            </select>
          </div>
          {f.senaModo === 'PORCENTAJE'
            ? <div className="space-y-1"><Label htmlFor="pct">Porcentaje (%)</Label><Input id="pct" type="number" min="0" max="100" value={f.senaPorcentaje} onChange={(e) => set('senaPorcentaje', e.target.value)} /></div>
            : <div className="space-y-1"><Label htmlFor="fijo">Monto fijo</Label><Input id="fijo" type="number" min="0" value={f.senaMontoFijo} onChange={(e) => set('senaMontoFijo', e.target.value)} /></div>}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label htmlFor="alias">Alias</Label><Input id="alias" value={f.alias} onChange={(e) => set('alias', e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="cbu">CBU</Label><Input id="cbu" value={f.cbu} onChange={(e) => set('cbu', e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="tit">Titular</Label><Input id="tit" value={f.titular} onChange={(e) => set('titular', e.target.value)} /></div>
        </CardContent>
      </Card>
      <Button onClick={guardar} disabled={pending}>{pending ? 'Guardando…' : 'Guardar cambios'}</Button>
    </div>
  );
}
```

- [ ] **Step 2: `src/app/(panel)/configuracion/page.tsx`**
```tsx
import { apiFetch } from '@/lib/api';
import type { Config } from '@/lib/types';
import { ConfigForm } from '@/components/config/config-form';

export default async function ConfiguracionPage() {
  const config = await apiFetch<Config>('/config');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="mt-1 text-sm text-neutral-500">Horarios, contacto y datos de pago del complejo.</p>
      </div>
      <ConfigForm config={config} />
    </div>
  );
}
```

- [ ] **Step 3: Nav item en `src/components/app-shell.tsx`**

Importar `Settings` de lucide y agregar al array `nav`:
```tsx
import { LayoutDashboard, CalendarDays, LandPlot, Settings, LogOut } from 'lucide-react';
// ...
const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/reservas', label: 'Reservas', icon: CalendarDays },
  { href: '/canchas', label: 'Canchas', icon: LandPlot },
  { href: '/configuracion', label: 'Configuración', icon: Settings },
];
```

- [ ] **Step 4: Verificación**
Run: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec vitest run`, `API_URL=http://localhost:3000 pnpm build` → todo verde; `/configuracion` aparece como ruta.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(panel)/configuracion/page.tsx" src/components/config/config-form.tsx src/components/app-shell.tsx
git commit -m "feat(config): página /configuracion + form + nav"
```

## Part 3 completion
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verificar, merge `feat/config-panel` → `master`.

---

## Out of scope
`SENA_TIMEOUT_MINUTOS`, `CANCELACION_ANTICIPACION_HORAS` (siguen en `.env`); horario por día/cancha; multi-config.

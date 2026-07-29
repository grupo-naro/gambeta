# Seña Config (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The backend computes the deposit ("seña") amount when creating an `ESPERANDO_SENA` reservation and exposes the payment data (CBU/alias/titular), all configurable via env.

**Architecture:** A small `senaService` reads env config (mode `porcentaje`|`fijo`). `reservaService.crear` uses it to set `montoSena` and returns `datosPago` for ESPERANDO_SENA reservations. A `GET /config/sena` endpoint exposes the payment data.

**Tech Stack:** Node/Express 5/TypeScript, Prisma 7 (client via `../db/client.js` barrel), Zod 4, Vitest + Supertest + Testcontainers.

**Spec:** `docs/superpowers/specs/2026-06-10-sena-config-backend-design.md`

**Working dir:** `c:/Users/Lautaro/Desktop/ortigoza/backend` (its own git repo; ESM, `.js` import extensions). Run tests with `npx vitest run` (Docker required). Each commit: append blank line + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- Modify `src/config/env.ts` — add `SENA_*` vars (Zod).
- Create `src/services/sena.service.ts` — seña policy (one responsibility).
- Modify `src/services/reserva.service.ts` — compute `montoSena`, return `datosPago`.
- Create `src/routes/config.routes.ts` — `GET /config/sena`.
- Modify `src/routes/index.ts` — mount `/config`.
- Modify `tests/helpers/global-setup.ts` — set `SENA_*` for deterministic tests.
- Modify `.env.example`, `.env.vm.example`, `DEPLOY-VM.md` — document the new vars.
- Create `tests/unit/sena.service.test.ts`, `tests/integration/sena.test.ts`.

---

## Task 1: Env config for seña

**Files:**
- Modify: `src/config/env.ts`
- Modify: `tests/unit/env.test.ts`
- Modify: `tests/helpers/global-setup.ts`
- Modify: `.env.example`, `.env.vm.example`

- [ ] **Step 1: Add failing assertions to `tests/unit/env.test.ts`**

Add inside the `describe('parseEnv', ...)` block (the file already imports `parseEnv` and defines `base`):
```ts
  it('applies seña defaults', () => {
    const env = parseEnv(base);
    expect(env.SENA_MODO).toBe('porcentaje');
    expect(env.SENA_PORCENTAJE).toBe(50);
    expect(env.SENA_MONTO_FIJO).toBe(5000);
    expect(env.SENA_CBU).toBe('');
  });

  it('coerces seña overrides and rejects bad porcentaje', () => {
    const env = parseEnv({ ...base, SENA_MODO: 'fijo', SENA_PORCENTAJE: '30', SENA_MONTO_FIJO: '8000' });
    expect(env.SENA_MODO).toBe('fijo');
    expect(env.SENA_PORCENTAJE).toBe(30);
    expect(env.SENA_MONTO_FIJO).toBe(8000);
    expect(() => parseEnv({ ...base, SENA_PORCENTAJE: '150' })).toThrow();
  });
```

- [ ] **Step 2: Run test → FAIL**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: FAIL (`SENA_MODO` undefined / no throw on 150).

- [ ] **Step 3: Add the vars to the schema in `src/config/env.ts`**

Insert these lines into the `z.object({ ... })` (e.g., after `SENA_TIMEOUT_MINUTOS`):
```ts
  SENA_MODO: z.enum(['porcentaje', 'fijo']).default('porcentaje'),
  SENA_PORCENTAJE: z.coerce.number().int().min(0).max(100).default(50),
  SENA_MONTO_FIJO: z.coerce.number().nonnegative().default(5000),
  SENA_CBU: z.string().default(''),
  SENA_ALIAS: z.string().default(''),
  SENA_TITULAR: z.string().default(''),
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run tests/unit/env.test.ts` → PASS.

- [ ] **Step 5: Set deterministic seña env in `tests/helpers/global-setup.ts`**

Add after the existing `process.env['SENA_TIMEOUT_MINUTOS'] = '30';` line:
```ts
  process.env['SENA_MODO'] = 'porcentaje';
  process.env['SENA_PORCENTAJE'] = '50';
  process.env['SENA_MONTO_FIJO'] = '5000';
  process.env['SENA_CBU'] = '0000003100000000000001';
  process.env['SENA_ALIAS'] = 'canchitas.ortigoza';
  process.env['SENA_TITULAR'] = 'Canchitas Ortigoza';
```

- [ ] **Step 6: Document the vars**

Append to `.env.example` and `.env.vm.example`:
```
SENA_MODO=porcentaje
SENA_PORCENTAJE=50
SENA_MONTO_FIJO=5000
SENA_CBU=
SENA_ALIAS=
SENA_TITULAR=
```
And add a line in `DEPLOY-VM.md` step 3 noting: "Completar `SENA_CBU`, `SENA_ALIAS`, `SENA_TITULAR` (y opcionalmente `SENA_MODO`/`SENA_PORCENTAJE`/`SENA_MONTO_FIJO`)."

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add -A
git commit -m "feat(sena): seña config env vars (modo, porcentaje, monto fijo, datos de pago)"
```

---

## Task 2: `senaService`

**Files:**
- Create: `src/services/sena.service.ts`
- Create: `tests/unit/sena.service.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/sena.service.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/env.js', () => ({
  getEnv: vi.fn(),
}));

import { getEnv } from '../../src/config/env.js';
import { senaService } from '../../src/services/sena.service.js';

const mockEnv = (over: Record<string, unknown>) => {
  (getEnv as any).mockReturnValue({
    SENA_MODO: 'porcentaje', SENA_PORCENTAJE: 50, SENA_MONTO_FIJO: 5000,
    SENA_CBU: 'cbu1', SENA_ALIAS: 'alias1', SENA_TITULAR: 'Titular',
    ...over,
  });
};

describe('senaService.montoParaPrecio', () => {
  it('porcentaje: 50% of 12000 = 6000', () => {
    mockEnv({ SENA_MODO: 'porcentaje', SENA_PORCENTAJE: 50 });
    expect(senaService.montoParaPrecio(12000)).toBe(6000);
  });
  it('porcentaje: rounds to nearest peso (50% of 12345 = 6173)', () => {
    mockEnv({ SENA_MODO: 'porcentaje', SENA_PORCENTAJE: 50 });
    expect(senaService.montoParaPrecio(12345)).toBe(6173);
  });
  it('fijo: returns SENA_MONTO_FIJO regardless of price', () => {
    mockEnv({ SENA_MODO: 'fijo', SENA_MONTO_FIJO: 8000 });
    expect(senaService.montoParaPrecio(12000)).toBe(8000);
  });
});

describe('senaService.datosPago', () => {
  it('returns mode + payment fields', () => {
    mockEnv({});
    expect(senaService.datosPago()).toEqual({
      modo: 'porcentaje', porcentaje: 50, cbu: 'cbu1', alias: 'alias1', titular: 'Titular',
    });
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`Cannot find module sena.service.js`)

Run: `npx vitest run tests/unit/sena.service.test.ts`

- [ ] **Step 3: Implement `src/services/sena.service.ts`**

```ts
import { getEnv } from '../config/env.js';

export interface DatosPago {
  modo: 'porcentaje' | 'fijo';
  porcentaje: number;
  cbu: string;
  alias: string;
  titular: string;
}

export const senaService = {
  montoParaPrecio(precioHora: number): number {
    const env = getEnv();
    if (env.SENA_MODO === 'fijo') return env.SENA_MONTO_FIJO;
    return Math.round((precioHora * env.SENA_PORCENTAJE) / 100);
  },

  datosPago(): DatosPago {
    const env = getEnv();
    return {
      modo: env.SENA_MODO,
      porcentaje: env.SENA_PORCENTAJE,
      cbu: env.SENA_CBU,
      alias: env.SENA_ALIAS,
      titular: env.SENA_TITULAR,
    };
  },
};
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run tests/unit/sena.service.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/sena.service.ts tests/unit/sena.service.test.ts
git commit -m "feat(sena): senaService (montoParaPrecio + datosPago)"
```

---

## Task 3: Integrate into `reservaService.crear`

**Files:**
- Modify: `src/services/reserva.service.ts`
- Create: `tests/integration/sena.test.ts`

- [ ] **Step 1: Write the failing integration test `tests/integration/sena.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } })).id;
});

const body = (over: Partial<any> = {}) => ({
  canchaId, whatsapp: '+5491150000000', nombreCliente: 'Juan',
  esContacto: false, fecha: '2026-06-15', horaInicio: '18:00', ...over,
});

describe('seña on create', () => {
  it('new client (ESPERANDO_SENA) → montoSena computed (50% of 12000) + datosPago', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body());
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(res.body.montoSena)).toBe(6000);
    expect(res.body.datosPago).toMatchObject({ alias: 'canchitas.ortigoza', titular: 'Canchitas Ortigoza' });
    expect(res.body.datosPago.cbu).toBeTruthy();
  });

  it('known contact (CONFIRMADA) → montoSena null, no datosPago', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true, horaInicio: '19:00' }));
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(res.body.montoSena).toBeNull();
    expect(res.body.datosPago).toBeUndefined();
  });

  it('explicit montoSena is respected', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ horaInicio: '20:00', montoSena: 999 }));
    expect(Number(res.body.montoSena)).toBe(999);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`montoSena` null / no `datosPago`)

Run: `npx vitest run tests/integration/sena.test.ts`

- [ ] **Step 3: Modify `src/services/reserva.service.ts`**

Add the import near the top (with the other service imports):
```ts
import { senaService } from './sena.service.js';
```

Replace the body of `crear` from the `const estado` line through the `return prisma.$transaction(...)` block with:
```ts
    const estado: EstadoReserva = input.esContacto ? 'CONFIRMADA' : 'ESPERANDO_SENA';
    const montoSena =
      estado === 'ESPERANDO_SENA'
        ? (input.montoSena ?? senaService.montoParaPrecio(Number(cancha.precioHora)))
        : null;

    const reserva = await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.upsert({
        where: { whatsapp: input.whatsapp },
        create: {
          whatsapp: input.whatsapp,
          nombre: input.nombreCliente,
          esContacto: input.esContacto,
          primeraReserva: new Date(),
          totalReservas: 1,
        },
        update: {
          nombre: input.nombreCliente,
          esContacto: input.esContacto,
          totalReservas: { increment: 1 },
        },
      });

      const r = await reservaRepo.create(
        {
          canchaId: input.canchaId,
          clienteId: cliente.id,
          fechaInicio,
          fechaFin,
          estado,
          esContacto: input.esContacto,
          monto: Number(cancha.precioHora),
          montoSena,
          notas: input.notas ?? null,
        },
        tx,
      );

      if (estado === 'ESPERANDO_SENA') {
        await pagoRepo.upsertForReserva(r.id, { estado: 'PENDIENTE' }, tx);
      }
      return r;
    });

    if (estado === 'ESPERANDO_SENA') {
      return { ...reserva, datosPago: senaService.datosPago() };
    }
    return reserva;
```

(This preserves all existing behavior; it only computes `montoSena` from config when not provided, and attaches `datosPago` to the response for ESPERANDO_SENA.)

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run tests/integration/sena.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/reserva.service.ts tests/integration/sena.test.ts
git commit -m "feat(sena): compute montoSena from config + return datosPago on ESPERANDO_SENA"
```

---

## Task 4: `GET /config/sena`

**Files:**
- Create: `src/routes/config.routes.ts`
- Modify: `src/routes/index.ts`
- Modify: `tests/integration/sena.test.ts` (add a case)

- [ ] **Step 1: Add failing test to `tests/integration/sena.test.ts`**

Add a new describe block at the end of the file:
```ts
describe('GET /config/sena', () => {
  it('returns payment config for the bot (API key)', async () => {
    const res = await supertest(app).get('/config/sena').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      modo: 'porcentaje', porcentaje: 50, alias: 'canchitas.ortigoza', titular: 'Canchitas Ortigoza',
    });
    expect(res.body.cbu).toBeTruthy();
  });

  it('401 without auth', async () => {
    const res = await supertest(app).get('/config/sena');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (404, route not mounted)

Run: `npx vitest run tests/integration/sena.test.ts`

- [ ] **Step 3: Implement `src/routes/config.routes.ts`**

```ts
import { Router } from 'express';
import { authAny } from '../middlewares/authAny.js';
import { senaService } from '../services/sena.service.js';

export const configRoutes = Router();

configRoutes.get('/sena', authAny, (_req, res) => {
  res.json(senaService.datosPago());
});
```

- [ ] **Step 4: Mount in `src/routes/index.ts`**

Add the import with the others and mount it:
```ts
import { configRoutes } from './config.routes.js';
// ...
apiRouter.use('/config', configRoutes);
```

- [ ] **Step 5: Run test → PASS**

Run: `npx vitest run tests/integration/sena.test.ts` → PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx tsc --noEmit` → PASS. Run: `npx vitest run` → all green (existing + new seña tests).

- [ ] **Step 7: Commit**

```bash
git add src/routes/config.routes.ts src/routes/index.ts tests/integration/sena.test.ts
git commit -m "feat(sena): GET /config/sena endpoint"
```

---

## Self-Review (against the spec)

- **Env vars (§2)** → Task 1. ✅
- **senaService montoParaPrecio + datosPago (§3)** → Task 2. ✅
- **Integration in crear: compute montoSena + datosPago in response, CONFIRMADA null (§4)** → Task 3. ✅
- **GET /config/sena authAny (§5)** → Task 4. ✅
- **Errors: invalid config fails boot (§6)** → Task 1 Zod (`min(0).max(100)`, `nonnegative`), tested in Task 1 Step 1. ✅
- **Testing unit + integration (§7)** → Tasks 2, 3, 4. ✅
- **global-setup seña env (§7)** → Task 1 Step 5. ✅
- **Docs/.env (§8, §9)** → Task 1 Step 6. ✅

**Type consistency:** `senaService.montoParaPrecio(number): number`, `senaService.datosPago(): DatosPago`, `configRoutes`, env names `SENA_MODO/SENA_PORCENTAJE/SENA_MONTO_FIJO/SENA_CBU/SENA_ALIAS/SENA_TITULAR` — used consistently across tasks.

**No placeholders.** All steps have concrete code/commands.

**Deuda aceptada (de la spec):** config por env (no runtime-editable); verificación de comprobante y envío por WhatsApp fuera de alcance (lado n8n).

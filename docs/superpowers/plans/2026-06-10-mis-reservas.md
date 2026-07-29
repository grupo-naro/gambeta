# Mis Reservas (GET /reservas/mias) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scoped `GET /reservas/mias?whatsapp=<numero>` endpoint so the WhatsApp bot can list a client's upcoming active reservations.

**Architecture:** New service method `reservaService.misReservas(whatsapp)` that calls the existing `reservaRepo.list(where)` with a filter for `estado in [CONFIRMADA, ESPERANDO_SENA]` and `fechaInicio > now`. Exposed via a new `authAny` route registered before `/:id`. Validated by a new Zod schema requiring `whatsapp`.

**Tech Stack:** Node + Express 5 + TypeScript, Prisma 7 (driver adapter), Zod 4, Vitest + Supertest + Testcontainers (shared Postgres via globalSetup; Docker Desktop must be running).

---

## Context the implementer needs

- **Run a single test file:** `npx vitest run tests/integration/mis-reservas.test.ts`
- **Run the whole suite:** `npx vitest run`
- **Type-check:** `npx tsc --noEmit`
- **Branch:** work on `feat/mis-reservas` (create from `main`). Do NOT commit on `main`.
- **Prisma client import:** types come from `../db/client.js` (barrel re-export of the generated client), NOT `@prisma/client`. See existing imports in `src/services/reserva.service.ts:1`.
- **`authAny`** (`src/middlewares/authAny.js`) accepts either a JWT admin (`Authorization: Bearer`) or the service key (`x-api-key`). The service key value in tests is `'svc'` (see existing tests using `.set('x-api-key', 'svc')`).
- **`reservaRepo.list(where)`** already does `findMany({ where, include: { cliente: true, cancha: true }, orderBy: { fechaInicio: 'asc' } })` — so it returns `cancha` and ascending order for free. Source: `src/repositories/reserva.repo.ts:50-51`. **Do not modify the repo.**
- **Route shadowing:** parametric `GET /:id` would capture `/mias` if registered first. `/vencidas-sena` already solves this by being registered before `/:id` (`src/routes/reserva.routes.ts:35-42`). Register `/mias` the same way.
- **Validation pattern:** schemas are objects with `body`/`query`/`params` keys; `const empty = z.looseObject({})` is reused for the unused parts. See `src/validators/reserva.schema.ts:1-2` and `reprogramarSchema` at lines 39-46.
- **Test helpers:** `tests/integration/reprogramar.test.ts` shows the setup pattern — `setupTestDb`/`teardownTestDb`/`resetTables`/`getPrisma` from `../helpers/db.js`, and `signAdminToken` from `../../src/services/auth.service.js`. Reuse it.

---

## File Structure

- `tests/integration/mis-reservas.test.ts` — **Create.** Integration tests for the endpoint.
- `src/validators/reserva.schema.ts` — **Modify.** Add `misReservasSchema`.
- `src/services/reserva.service.ts` — **Modify.** Add `misReservas(whatsapp)` method.
- `src/routes/reserva.routes.ts` — **Modify.** Add `GET /mias` route before `/:id`, import the schema.

---

## Task 1: Service method `misReservas`

**Files:**
- Modify: `src/services/reserva.service.ts` (add method to the `reservaService` object, e.g. after `list` at lines 100-111)
- Test: `tests/integration/mis-reservas.test.ts` (create)

- [ ] **Step 1: Write the failing test (service-level, via repo data)**

Create `tests/integration/mis-reservas.test.ts` with the shared DB setup and the first test. This test seeds reservations directly and asserts the service returns only future active ones, ordered ascending.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { reservaService } from '../../src/services/reserva.service.js';

let app: any; let canchaId: string; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } })).id;
  const admin = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'Admin', passwordHash: 'x' } });
  token = signAdminToken({ adminId: admin.id, email: admin.email });
});

const WA = '+5491150000000';
// Create a reserva for a given whatsapp at `h` hours from now (negative = past), with estado.
async function seedReserva(whatsapp: string, h: number, estado: any = 'CONFIRMADA') {
  const cliente = await getPrisma().cliente.upsert({
    where: { whatsapp }, create: { whatsapp, nombre: 'Cli' }, update: {},
  });
  const inicio = new Date(Date.now() + h * 3600_000);
  const fin = new Date(inicio.getTime() + 3600_000);
  return getPrisma().reserva.create({
    data: { canchaId, clienteId: cliente.id, estado, esContacto: true, monto: 12000, montoSena: null, fechaInicio: inicio, fechaFin: fin },
  });
}

describe('reservaService.misReservas', () => {
  it('returns only future active reservations, ascending by fechaInicio', async () => {
    await seedReserva(WA, 72);             // future CONFIRMADA
    await seedReserva(WA, 24, 'ESPERANDO_SENA'); // future ESPERANDO_SENA (earlier)
    await seedReserva(WA, -24);            // past -> excluded
    await seedReserva(WA, 48, 'CANCELADA'); // cancelled -> excluded
    const res = await reservaService.misReservas(WA);
    expect(res.map((r: any) => r.estado)).toEqual(['ESPERANDO_SENA', 'CONFIRMADA']);
    expect((res[0] as any).cancha.nombre).toBe('C');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/mis-reservas.test.ts`
Expected: FAIL — `reservaService.misReservas is not a function`.

- [ ] **Step 3: Implement `misReservas`**

In `src/services/reserva.service.ts`, add this method to the `reservaService` object (place it right after the `list` method, before `aprobarSena`):

```ts
  misReservas: (whatsapp: string) =>
    reservaRepo.list({
      cliente: { whatsapp },
      estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] },
      fechaInicio: { gt: new Date() },
    }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/mis-reservas.test.ts`
Expected: PASS (1 passing).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `estado: { in: [...] }` complains about string literals, the array elements are already valid `EstadoReserva` strings since `EstadoReserva` is imported in this file at line 1; no cast needed.)

- [ ] **Step 6: Commit**

```bash
git add src/services/reserva.service.ts tests/integration/mis-reservas.test.ts
git commit -m "feat(reservas): misReservas service method (future active reservations)"
```

---

## Task 2: Validation schema `misReservasSchema`

**Files:**
- Modify: `src/validators/reserva.schema.ts` (add after `reprogramarSchema`, ~line 46)
- Test: covered by Task 3's route tests (the 400-without-whatsapp case)

- [ ] **Step 1: Add the schema**

In `src/validators/reserva.schema.ts`, after the `reprogramarSchema` block (line 46), add:

```ts
export const misReservasSchema = z.object({
  body: z.unknown(),
  query: z.object({ whatsapp: z.string().min(5) }),
  params: empty,
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/validators/reserva.schema.ts
git commit -m "feat(reservas): misReservasSchema (whatsapp query required)"
```

---

## Task 3: Route `GET /reservas/mias` + endpoint tests

**Files:**
- Modify: `src/routes/reserva.routes.ts` (import schema at lines 6-12; add route before the `/:id` route at line 44)
- Test: `tests/integration/mis-reservas.test.ts` (add the endpoint tests)

- [ ] **Step 1: Write the failing endpoint tests**

Append to `tests/integration/mis-reservas.test.ts`, inside the file (a new `describe` block after the existing one):

```ts
describe('GET /reservas/mias', () => {
  it('200 with the client\'s future active reservations via x-api-key', async () => {
    await seedReserva(WA, 72);
    const res = await supertest(app).get('/reservas/mias').query({ whatsapp: WA }).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].cancha.nombre).toBe('C');
  });

  it('isolates by whatsapp (does not return another client\'s reservations)', async () => {
    await seedReserva(WA, 72);
    await seedReserva('+5491159999999', 72);
    const res = await supertest(app).get('/reservas/mias').query({ whatsapp: WA }).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('200 [] when the client has no upcoming reservations', async () => {
    await seedReserva(WA, -24); // only a past one
    const res = await supertest(app).get('/reservas/mias').query({ whatsapp: WA }).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('400 when whatsapp is missing', async () => {
    const res = await supertest(app).get('/reservas/mias').set('x-api-key', 'svc');
    expect(res.status).toBe(400);
  });

  it('200 with JWT admin (authAny accepts JWT too)', async () => {
    await seedReserva(WA, 72);
    const res = await supertest(app).get('/reservas/mias').query({ whatsapp: WA }).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/integration/mis-reservas.test.ts`
Expected: FAIL — the `/reservas/mias` requests hit the `GET /:id` route (or 404/401), not the new handler. The 200 cases fail (wrong status / shape).

- [ ] **Step 3: Import the schema in the routes file**

In `src/routes/reserva.routes.ts`, add `misReservasSchema` to the existing import block (lines 6-12):

```ts
import {
  createReservaSchema,
  listReservaSchema,
  aprobarSenaSchema,
  reprogramarSchema,
  misReservasSchema,
  idParamSchema,
} from '../validators/reserva.schema.js';
```

- [ ] **Step 4: Add the route BEFORE `/:id`**

In `src/routes/reserva.routes.ts`, insert this block immediately after the `/vencidas-sena` route (after line 42, before the `GET /:id` route at line 44). It MUST be above `/:id`:

```ts
reservaRoutes.get('/mias', authAny, validate(misReservasSchema), async (req, res, next) => {
  try {
    res.json(await reservaService.misReservas(String((req as any).valid.query.whatsapp)));
  } catch (e) {
    next(e);
  }
});
```

- [ ] **Step 5: Run the endpoint tests to verify they pass**

Run: `npx vitest run tests/integration/mis-reservas.test.ts`
Expected: PASS (all tests in the file, 6 passing).

- [ ] **Step 6: Run the full suite + type-check**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all green (the previous 61 tests + 6 new = 67), no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/reserva.routes.ts tests/integration/mis-reservas.test.ts
git commit -m "feat(reservas): GET /reservas/mias endpoint (scoped, authAny)"
```

---

## Completion

After all tasks pass:
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verify tests, merge `feat/mis-reservas` → `main`, push (triggers VM deploy).

**Out of scope for this plan:** the n8n bot `mis_reservas` intent + Cerebro branch (separate change, wired in n8n directly like `reprogramar`).

# Canchitas Ortigoza Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Node.js/Express/TypeScript backend that is the source of truth for courts, availability, reservations and deposit ("seña") payments for the Canchitas Ortigoza WhatsApp reservation system.

**Architecture:** Layered (routes → middlewares → services → repositories → Prisma). Services hold business logic and the reservation state machine; repositories encapsulate Prisma and the raw-SQL exclusion constraint that makes double-booking impossible at the engine level. JWT auth for the admin panel, `x-api-key` for the n8n service.

**Tech Stack:** Node.js, Express, TypeScript, Prisma, PostgreSQL (`btree_gist`), Zod, JWT (jsonwebtoken), bcrypt, pino, dotenv. Tests: Vitest + Supertest + Testcontainers.

**Spec:** `docs/superpowers/specs/2026-06-08-canchitas-backend-design.md`

**Working directory:** `c:/Users/Lautaro/Desktop/ortigoza/backend` (currently empty).

> **Implementation notes — installed versions differ from this plan's assumptions.** The repo installed Prisma 7, Zod 4, Express 5, TypeScript 6. Adapt the plan's code to these APIs (behavior + passing tests/typecheck is the acceptance criterion):
> - **Prisma 7:** generator is `provider = "prisma-client"` with `output = "../src/generated/prisma"`; the datasource URL lives in `prisma.config.ts`, not `schema.prisma`. The generated client is NOT importable as `@prisma/client`. A barrel at `src/db/client.ts` (`export * from '../generated/prisma/client.js'`) is the single import point — all files import `PrismaClient`, `Prisma`, and enums from `../db/client.js` (adjust relative depth: `./client.js` within `src/db/`, `../../src/db/client.js` from `tests/helpers/`, `../src/db/client.js` from `prisma/seed.ts`).
> - **Zod 4:** `.passthrough()` → use `.loose()` or `z.looseObject({})`; `error.flatten()` → `z.flattenError(error)` (or `.flatten()` if still present). Verify against installed Zod.
> - **Express 5:** `req.query`/`req.params` are getters (read-only) — don't reassign them; assign parsed data to a new `req.valid` property (already the plan's approach). Async errors propagate, but keep the explicit `try/catch + next(e)` pattern for clarity.

---

## File Structure

```
backend/
  src/
    index.ts                       Bootstrap: load env, start HTTP server
    app.ts                         Express app factory (testable, no listen)
    config/
      env.ts                       Parse + validate env vars (Zod)
    db/
      prisma.ts                    PrismaClient singleton
    types/
      domain.ts                    Domain enums/types re-exported from Prisma
      express.d.ts                 Express Request augmentation (auth principal)
    utils/
      errors.ts                    AppError + factory helpers
      logger.ts                    pino logger
      password.ts                  bcrypt hash/compare
      tz.ts                        Timezone helpers (Argentina)
    middlewares/
      errorHandler.ts              Central error → JSON response
      validate.ts                  Zod request validation
      authJwt.ts                   JWT (admin) auth
      authApiKey.ts                Service (n8n) auth
      authAny.ts                   JWT OR API key
    validators/
      auth.schema.ts
      cancha.schema.ts
      cliente.schema.ts
      disponibilidad.schema.ts
      reserva.schema.ts
    repositories/
      cancha.repo.ts
      horario.repo.ts
      cliente.repo.ts
      reserva.repo.ts
      pago.repo.ts
      adminUser.repo.ts
      auditLog.repo.ts
    services/
      auth.service.ts
      cancha.service.ts
      cliente.service.ts
      disponibilidad.service.ts
      reserva.service.ts
      analytics.service.ts
    routes/
      index.ts                     Mount all routers
      auth.routes.ts
      cancha.routes.ts
      cliente.routes.ts
      disponibilidad.routes.ts
      reserva.routes.ts
      analytics.routes.ts
  prisma/
    schema.prisma
    migrations/                    Includes raw-SQL exclusion-constraint migration
    seed.ts
  tests/
    helpers/
      db.ts                        Testcontainers Postgres bootstrap
      app.ts                       Build app + supertest agent
    unit/
    integration/
  package.json
  tsconfig.json
  vitest.config.ts
  Dockerfile
  docker-compose.yml
  .env.example
  .dockerignore
  .gitignore
```

---

## Task 1: Project scaffold & tooling

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`, `backend/.gitignore`, `backend/.env.example`, `backend/.dockerignore`

- [ ] **Step 1: Initialize git and npm**

Run from `backend/`:
```bash
git init
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm i express zod jsonwebtoken bcrypt pino pino-http dotenv @prisma/client
npm i -D typescript tsx @types/node @types/express @types/jsonwebtoken @types/bcrypt prisma vitest supertest @types/supertest testcontainers @testcontainers/postgresql
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src", "prisma/seed.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000, // Testcontainers needs headroom on first pull
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // one Postgres container, serialized
  },
});
```

- [ ] **Step 5: Write `package.json` scripts**

Replace the `scripts` block:
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "prisma generate && tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules
dist
.env
*.log
```

- [ ] **Step 7: Write `.dockerignore`**

```
node_modules
dist
.env
tests
*.log
```

- [ ] **Step 8: Write `.env.example`**

```
DATABASE_URL=postgresql://canchitas:canchitas@localhost:5432/canchitas?schema=public
JWT_SECRET=change-me-32-chars-minimum-secret
JWT_EXPIRES_IN=12h
SERVICE_API_KEY=change-me-service-key
TZ_NEGOCIO=America/Argentina/Buenos_Aires
CANCELACION_ANTICIPACION_HORAS=12
SENA_TIMEOUT_MINUTOS=30
ADMIN_SEED_EMAIL=admin@canchitas.com
ADMIN_SEED_PASSWORD=change-me-admin
PORT=3000
```

- [ ] **Step 9: Verify toolchain**

Run: `npx tsc --noEmit` → Expected: PASS (no source files yet, no errors). Run: `npx vitest run` → Expected: "No test files found" (exit 0 or no failures).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "chore: scaffold backend project (ts, vitest, deps)"
```

---

## Task 2: Prisma schema

**Files:**
- Create: `backend/prisma/schema.prisma`

- [ ] **Step 1: Write `schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum EstadoReserva {
  CONFIRMADA
  ESPERANDO_SENA
  CANCELADA
  COMPLETADA
}

enum EstadoPago {
  PENDIENTE
  APROBADO
  RECHAZADO
}

enum VerificadoPor {
  IA
  HUMANO
}

model Cancha {
  id         String               @id @default(cuid())
  nombre     String
  tipo       String
  precioHora Decimal              @db.Decimal(10, 2)
  activa     Boolean              @default(true)
  creadoEn   DateTime             @default(now())
  reservas   Reserva[]
  horarios   HorarioDisponible[]

  @@index([activa])
}

model HorarioDisponible {
  id         String  @id @default(cuid())
  canchaId   String
  cancha     Cancha  @relation(fields: [canchaId], references: [id], onDelete: Cascade)
  diaSemana  Int     // 0 = domingo ... 6 = sábado
  horaInicio String  // "HH:MM" 24h, hora local Argentina
  horaFin    String  // "HH:MM"
  activo     Boolean @default(true)

  @@index([canchaId, diaSemana])
}

model Cliente {
  id             String    @id @default(cuid())
  nombre         String
  whatsapp       String    @unique
  esContacto     Boolean   @default(false)
  primeraReserva DateTime?
  totalReservas  Int       @default(0)
  creadoEn       DateTime  @default(now())
  reservas       Reserva[]
}

model Reserva {
  id          String        @id @default(cuid())
  canchaId    String
  cancha      Cancha        @relation(fields: [canchaId], references: [id])
  clienteId   String
  cliente     Cliente       @relation(fields: [clienteId], references: [id])
  fechaInicio DateTime      @db.Timestamptz(3)
  fechaFin    DateTime      @db.Timestamptz(3)
  estado      EstadoReserva
  esContacto  Boolean       // snapshot al momento de reservar
  monto       Decimal       @db.Decimal(10, 2)
  montoSena   Decimal?      @db.Decimal(10, 2)
  notas       String?
  creadoEn    DateTime      @default(now())
  pago        Pago?

  @@index([canchaId, fechaInicio])
  @@index([clienteId])
  @@index([estado])
}

model Pago {
  id             String         @id @default(cuid())
  reservaId      String         @unique
  reserva        Reserva        @relation(fields: [reservaId], references: [id], onDelete: Cascade)
  montoDetectado Decimal?       @db.Decimal(10, 2)
  comprobanteUrl String?
  verificadoPor  VerificadoPor?
  aprobadoPorId  String?
  aprobadoPor    AdminUser?     @relation(fields: [aprobadoPorId], references: [id])
  estado         EstadoPago     @default(PENDIENTE)
  creadoEn       DateTime       @default(now())
}

model AdminUser {
  id           String     @id @default(cuid())
  email        String     @unique
  passwordHash String
  nombre       String
  creadoEn     DateTime   @default(now())
  pagos        Pago[]
  auditLogs    AuditLog[]
}

model AuditLog {
  id        String     @id @default(cuid())
  adminId   String?
  admin     AdminUser? @relation(fields: [adminId], references: [id])
  accion    String
  entidad   String
  entidadId String?
  payload   Json?
  creadoEn  DateTime   @default(now())

  @@index([entidad, entidadId])
  @@index([creadoEn])
}
```

- [ ] **Step 2: Format & validate**

Run: `npx prisma format` then `npx prisma validate`
Expected: "The schema is valid 🎉"

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma && git commit -m "feat(db): prisma schema for canchitas backend"
```

---

## Task 3: Initial migration + exclusion constraint (raw SQL)

**Files:**
- Create: `backend/prisma/migrations/.../migration.sql` (generated), plus a follow-up migration for the constraint.

**Risk:** Prisma cannot express `EXCLUDE USING gist` or the `btree_gist` extension. We add a manual migration. The constraint is the single most important correctness guarantee — it is verified in Task 14.

- [ ] **Step 1: Generate the baseline migration (requires a running Postgres)**

Start a local Postgres (or use docker-compose from Task 17 early). With `DATABASE_URL` set:
```bash
npx prisma migrate dev --name init --create-only
```
This creates `prisma/migrations/<ts>_init/migration.sql` without applying it.

- [ ] **Step 2: Create the exclusion-constraint migration**

Create `prisma/migrations/<ts+1>_reserva_exclusion/migration.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Reserva"
  ADD CONSTRAINT reserva_no_overlap
  EXCLUDE USING gist (
    "canchaId" WITH =,
    tsrange("fechaInicio", "fechaFin") WITH &&
  )
  WHERE (estado IN ('CONFIRMADA', 'ESPERANDO_SENA'));
```

- [ ] **Step 3: Apply migrations**

```bash
npx prisma migrate dev
```
Expected: both migrations applied, `prisma generate` runs.

- [ ] **Step 4: Manually verify the constraint exists**

```bash
psql "$DATABASE_URL" -c "\d \"Reserva\"" 
```
Expected: shows `reserva_no_overlap` EXCLUDE constraint. (Automated verification is Task 14.)

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations && git commit -m "feat(db): exclusion constraint to prevent double booking"
```

---

## Task 4: Env config

**Files:**
- Create: `backend/src/config/env.ts`
- Test: `backend/tests/unit/env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

describe('parseEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'a'.repeat(32),
    SERVICE_API_KEY: 'svc',
    ADMIN_SEED_EMAIL: 'a@b.com',
    ADMIN_SEED_PASSWORD: 'pw',
  };

  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.TZ_NEGOCIO).toBe('America/Argentina/Buenos_Aires');
    expect(env.CANCELACION_ANTICIPACION_HORAS).toBe(12);
    expect(env.SENA_TIMEOUT_MINUTOS).toBe(30);
  });

  it('throws when JWT_SECRET too short', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'short' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`Cannot find module env.js`)

Run: `npx vitest run tests/unit/env.test.ts`

- [ ] **Step 3: Implement `src/config/env.ts`**

```ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('12h'),
  SERVICE_API_KEY: z.string().min(1),
  TZ_NEGOCIO: z.string().default('America/Argentina/Buenos_Aires'),
  CANCELACION_ANTICIPACION_HORAS: z.coerce.number().int().nonnegative().default(12),
  SENA_TIMEOUT_MINUTOS: z.coerce.number().int().positive().default(30),
  ADMIN_SEED_EMAIL: z.string().email(),
  ADMIN_SEED_PASSWORD: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return schema.parse(raw);
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 4: Run test → PASS**. Run: `npx vitest run tests/unit/env.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(config): env parsing with zod and defaults"
```

---

## Task 5: Error types

**Files:**
- Create: `backend/src/utils/errors.ts`
- Test: `backend/tests/unit/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { AppError, NotFound, Conflict, BusinessRule } from '../../src/utils/errors.js';

describe('AppError', () => {
  it('NotFound is 404', () => {
    const e = NotFound('Cancha', 'abc');
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
  });
  it('Conflict is 409', () => {
    expect(Conflict('overlap').status).toBe(409);
  });
  it('BusinessRule is 422', () => {
    expect(BusinessRule('past date').status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement `src/utils/errors.ts`**

```ts
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const BadRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const Unauthorized = (message = 'No autorizado') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const Forbidden = (message = 'Prohibido') =>
  new AppError(403, 'FORBIDDEN', message);
export const NotFound = (entidad: string, id?: string) =>
  new AppError(404, 'NOT_FOUND', `${entidad} no encontrado${id ? `: ${id}` : ''}`);
export const Conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);
export const BusinessRule = (message: string, details?: unknown) =>
  new AppError(422, 'BUSINESS_RULE', message, details);
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit** `git commit -am "feat(utils): typed AppError helpers"`

---

## Task 6: Logger, password hashing, TZ helpers

**Files:**
- Create: `backend/src/utils/logger.ts`, `backend/src/utils/password.ts`, `backend/src/utils/tz.ts`
- Test: `backend/tests/unit/password.test.ts`, `backend/tests/unit/tz.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/unit/password.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';

describe('password', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('secret');
    expect(hash).not.toBe('secret');
    expect(await verifyPassword('secret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
```

`tests/unit/tz.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { dayWindowUtc, dayOfWeekInTz, combineDateTimeUtc } from '../../src/utils/tz.js';

const TZ = 'America/Argentina/Buenos_Aires';

describe('tz', () => {
  it('combines a local date + HH:MM into the correct UTC instant', () => {
    // 2026-06-12 08:00 ART (UTC-3) === 11:00 UTC
    const utc = combineDateTimeUtc('2026-06-12', '08:00', TZ);
    expect(utc.toISOString()).toBe('2026-06-12T11:00:00.000Z');
  });

  it('returns day-of-week for the local date', () => {
    // 2026-06-12 is a Friday → 5
    expect(dayOfWeekInTz('2026-06-12', TZ)).toBe(5);
  });

  it('day window covers local midnight to midnight in UTC', () => {
    const { start, end } = dayWindowUtc('2026-06-12', TZ);
    expect(start.toISOString()).toBe('2026-06-12T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-13T03:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run tests → FAIL**

- [ ] **Step 3: Implement `src/utils/logger.ts`**

```ts
import pino from 'pino';
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
```

- [ ] **Step 4: Implement `src/utils/password.ts`**

```ts
import bcrypt from 'bcrypt';
const ROUNDS = 10;
export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
```

- [ ] **Step 5: Implement `src/utils/tz.ts`**

Argentina is UTC-3 with no DST. We compute the timezone offset generically via `Intl` so the helper stays correct if the TZ ever changes.

```ts
/** Offset (minutes) to ADD to a local wall-clock time to get UTC, for a given instant + TZ. */
function offsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  // asUTC is the local wall clock interpreted as if UTC; difference = -offset
  return (date.getTime() - asUTC) / 60000;
}

/** Combine a local date "YYYY-MM-DD" and "HH:MM" in `timeZone` into the matching UTC Date. */
export function combineDateTimeUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  // First guess assuming UTC, then correct by the TZ offset at that instant.
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const off = offsetMinutes(guess, timeZone);
  return new Date(guess.getTime() + off * 60000);
}

/** Day of week (0=Sun..6=Sat) of a local date string in `timeZone`. */
export function dayOfWeekInTz(date: string, timeZone: string): number {
  const noonUtc = combineDateTimeUtc(date, '12:00', timeZone);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(noonUtc);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

/** UTC [start, end) covering the full local day. */
export function dayWindowUtc(date: string, timeZone: string): { start: Date; end: Date } {
  const start = combineDateTimeUtc(date, '00:00', timeZone);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
```

- [ ] **Step 6: Run tests → PASS** (`npx vitest run tests/unit/password.test.ts tests/unit/tz.test.ts`)

- [ ] **Step 7: Commit** `git commit -am "feat(utils): logger, bcrypt, timezone helpers"`

---

## Task 7: Prisma singleton + domain types

**Files:**
- Create: `backend/src/db/prisma.ts`, `backend/src/types/domain.ts`, `backend/src/types/express.d.ts`

- [ ] **Step 1: Implement `src/db/prisma.ts`**

```ts
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
```

- [ ] **Step 2: Implement `src/types/domain.ts`**

```ts
export { EstadoReserva, EstadoPago, VerificadoPor } from '@prisma/client';

export type AuthPrincipal =
  | { kind: 'admin'; adminId: string; email: string }
  | { kind: 'service' };
```

- [ ] **Step 3: Implement `src/types/express.d.ts`**

```ts
import type { AuthPrincipal } from './domain.js';
declare global {
  namespace Express {
    interface Request {
      principal?: AuthPrincipal;
    }
  }
}
export {};
```

- [ ] **Step 4: Typecheck** Run: `npx tsc --noEmit` → Expected: PASS

- [ ] **Step 5: Commit** `git commit -am "feat(db): prisma singleton and domain types"`

---

## Task 8: Test infrastructure (Testcontainers)

**Files:**
- Create: `backend/tests/helpers/db.ts`, `backend/tests/helpers/app.ts`

**Risk:** Testcontainers requires Docker running locally. Document this in the README. First run pulls the Postgres image (slow) — timeouts in `vitest.config.ts` account for it.

- [ ] **Step 1: Implement `tests/helpers/db.ts`**

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

export async function setupTestDb(): Promise<PrismaClient> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('canchitas')
    .start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  // Apply all migrations (incl. the exclusion constraint) to the fresh container.
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  return prisma;
}

export async function teardownTestDb(): Promise<void> {
  await prisma?.$disconnect();
  await container?.stop();
}

export async function resetTables(): Promise<void> {
  // Order matters due to FKs.
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.pago.deleteMany(),
    prisma.reserva.deleteMany(),
    prisma.horarioDisponible.deleteMany(),
    prisma.cancha.deleteMany(),
    prisma.cliente.deleteMany(),
    prisma.adminUser.deleteMany(),
  ]);
}

export const getPrisma = () => prisma;
```

- [ ] **Step 2: Implement `tests/helpers/app.ts`** (used after Task 9 exists; file references `buildApp`)

```ts
import supertest from 'supertest';
import { buildApp } from '../../src/app.js';

export function agent() {
  return supertest(buildApp());
}
```

- [ ] **Step 3: Commit** `git commit -am "test: testcontainers postgres + supertest helpers"`

(Note: `tests/helpers/app.ts` will not import cleanly until Task 12 creates `app.ts`. That is fine — it is only imported by integration tests written from Task 13 onward.)

---

## Task 9: errorHandler + validate middlewares

**Files:**
- Create: `backend/src/middlewares/errorHandler.ts`, `backend/src/middlewares/validate.ts`
- Test: `backend/tests/unit/validate.test.ts`

- [ ] **Step 1: Write failing test for `validate`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validate } from '../../src/middlewares/validate.js';
import { AppError } from '../../src/utils/errors.js';

function run(mw: any, req: any) {
  return new Promise<{ err?: any }>((resolve) => {
    mw(req, {}, (err?: any) => resolve({ err }));
  });
}

describe('validate', () => {
  const schema = z.object({ body: z.object({ nombre: z.string() }) });

  it('passes valid request and assigns parsed data', async () => {
    const req: any = { body: { nombre: 'x' }, query: {}, params: {} };
    const { err } = await run(validate(schema), req);
    expect(err).toBeUndefined();
    expect(req.valid.body.nombre).toBe('x');
  });

  it('forwards a 400 AppError on invalid request', async () => {
    const req: any = { body: {}, query: {}, params: {} };
    const { err } = await run(validate(schema), req);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement `src/middlewares/validate.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { BadRequest } from '../utils/errors.js';

export function validate(schema: ZodSchema) {
  return (req: Request & { valid?: unknown }, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({ body: req.body, query: req.query, params: req.params });
      (req as Request & { valid: unknown }).valid = parsed;
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        next(BadRequest('Datos inválidos', e.flatten()));
      } else {
        next(e);
      }
    }
  };
}
```

- [ ] **Step 4: Implement `src/middlewares/errorHandler.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  logger.error({ err }, 'unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
}
```

- [ ] **Step 5: Run test → PASS**

- [ ] **Step 6: Commit** `git commit -am "feat(middleware): zod validate + central error handler"`

---

## Task 10: Auth — JWT + API key middlewares + auth service

**Files:**
- Create: `backend/src/middlewares/authJwt.ts`, `backend/src/middlewares/authApiKey.ts`, `backend/src/middlewares/authAny.ts`, `backend/src/services/auth.service.ts`, `backend/src/repositories/adminUser.repo.ts`
- Test: `backend/tests/unit/auth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../../src/config/env.js', () => ({
  getEnv: () => ({ JWT_SECRET: 'a'.repeat(32), JWT_EXPIRES_IN: '12h', SERVICE_API_KEY: 'svc' }),
}));

import { signAdminToken, verifyAdminToken } from '../../src/services/auth.service.js';
import { authApiKey } from '../../src/middlewares/authApiKey.js';
import { AppError } from '../../src/utils/errors.js';

describe('auth tokens', () => {
  it('signs and verifies an admin token', () => {
    const token = signAdminToken({ adminId: '1', email: 'a@b.com' });
    const p = verifyAdminToken(token);
    expect(p.adminId).toBe('1');
    expect(p.email).toBe('a@b.com');
  });
  it('rejects a tampered token', () => {
    expect(() => verifyAdminToken('garbage')).toThrow(AppError);
  });
});

function run(mw: any, req: any) {
  return new Promise<any>((resolve) => mw(req, {}, (err?: any) => resolve(err)));
}

describe('authApiKey', () => {
  it('accepts the right key', async () => {
    const req: any = { header: (h: string) => (h === 'x-api-key' ? 'svc' : undefined) };
    const err = await run(authApiKey, req);
    expect(err).toBeUndefined();
    expect(req.principal).toEqual({ kind: 'service' });
  });
  it('rejects a wrong key', async () => {
    const req: any = { header: () => 'nope' };
    const err = await run(authApiKey, req);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement `src/repositories/adminUser.repo.ts`**

```ts
import { prisma } from '../db/prisma.js';

export const adminUserRepo = {
  findByEmail: (email: string) => prisma.adminUser.findUnique({ where: { email } }),
  findById: (id: string) => prisma.adminUser.findUnique({ where: { id } }),
};
```

- [ ] **Step 4: Implement `src/services/auth.service.ts`**

```ts
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { verifyPassword } from '../utils/password.js';
import { Unauthorized } from '../utils/errors.js';

export interface AdminClaims { adminId: string; email: string; }

export function signAdminToken(claims: AdminClaims): string {
  const env = getEnv();
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function verifyAdminToken(token: string): AdminClaims {
  try {
    const decoded = jwt.verify(token, getEnv().JWT_SECRET) as jwt.JwtPayload;
    return { adminId: String(decoded.adminId), email: String(decoded.email) };
  } catch {
    throw Unauthorized('Token inválido');
  }
}

export async function login(email: string, password: string) {
  const admin = await adminUserRepo.findByEmail(email);
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    throw Unauthorized('Credenciales inválidas');
  }
  const token = signAdminToken({ adminId: admin.id, email: admin.email });
  return { token, admin: { id: admin.id, email: admin.email, nombre: admin.nombre } };
}
```

- [ ] **Step 5: Implement `src/middlewares/authJwt.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { verifyAdminToken } from '../services/auth.service.js';
import { Unauthorized } from '../utils/errors.js';

export function authJwt(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(Unauthorized('Falta token'));
  const claims = verifyAdminToken(header.slice(7));
  req.principal = { kind: 'admin', adminId: claims.adminId, email: claims.email };
  next();
}
```

- [ ] **Step 6: Implement `src/middlewares/authApiKey.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { getEnv } from '../config/env.js';
import { Unauthorized } from '../utils/errors.js';

export function authApiKey(req: Request, _res: Response, next: NextFunction) {
  if (req.header('x-api-key') !== getEnv().SERVICE_API_KEY) return next(Unauthorized('API key inválida'));
  req.principal = { kind: 'service' };
  next();
}
```

- [ ] **Step 7: Implement `src/middlewares/authAny.ts`** (JWT admin OR service key)

```ts
import type { Request, Response, NextFunction } from 'express';
import { verifyAdminToken } from '../services/auth.service.js';
import { getEnv } from '../config/env.js';
import { Unauthorized } from '../utils/errors.js';

export function authAny(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.header('x-api-key');
  if (apiKey && apiKey === getEnv().SERVICE_API_KEY) {
    req.principal = { kind: 'service' };
    return next();
  }
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const claims = verifyAdminToken(header.slice(7));
    req.principal = { kind: 'admin', adminId: claims.adminId, email: claims.email };
    return next();
  }
  return next(Unauthorized('Falta autenticación'));
}
```

- [ ] **Step 8: Run test → PASS**

- [ ] **Step 9: Commit** `git commit -am "feat(auth): jwt + api key middlewares and login service"`

---

## Task 11: Express app factory + auth routes + bootstrap

**Files:**
- Create: `backend/src/app.ts`, `backend/src/routes/index.ts`, `backend/src/routes/auth.routes.ts`, `backend/src/validators/auth.schema.ts`, `backend/src/index.ts`
- Test: `backend/tests/integration/auth.routes.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.SERVICE_API_KEY = 'svc';
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('POST /auth/login', () => {
  it('returns a token for valid credentials', async () => {
    await getPrisma().adminUser.create({
      data: { email: 'a@b.com', nombre: 'Admin', passwordHash: await hashPassword('pw') },
    });
    const res = await supertest(app).post('/auth/login').send({ email: 'a@b.com', password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('401 for wrong password', async () => {
    await getPrisma().adminUser.create({
      data: { email: 'a@b.com', nombre: 'Admin', passwordHash: await hashPassword('pw') },
    });
    const res = await supertest(app).post('/auth/login').send({ email: 'a@b.com', password: 'no' });
    expect(res.status).toBe(401);
  });

  it('400 for malformed body', async () => {
    const res = await supertest(app).post('/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement `src/validators/auth.schema.ts`**

```ts
import { z } from 'zod';
export const loginSchema = z.object({
  body: z.object({ email: z.string().email(), password: z.string().min(1) }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});
```

- [ ] **Step 4: Implement `src/routes/auth.routes.ts`**

```ts
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { loginSchema } from '../validators/auth.schema.js';
import { login } from '../services/auth.service.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { NotFound } from '../utils/errors.js';

export const authRoutes = Router();

authRoutes.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = (req as any).valid.body;
    res.json(await login(email, password));
  } catch (e) { next(e); }
});

authRoutes.get('/me', authJwt, async (req, res, next) => {
  try {
    const admin = await adminUserRepo.findById(req.principal!.kind === 'admin' ? req.principal!.adminId : '');
    if (!admin) throw NotFound('AdminUser');
    res.json({ id: admin.id, email: admin.email, nombre: admin.nombre });
  } catch (e) { next(e); }
});
```

- [ ] **Step 5: Implement `src/routes/index.ts`**

```ts
import { Router } from 'express';
import { authRoutes } from './auth.routes.js';

export const apiRouter = Router();
apiRouter.use('/auth', authRoutes);
// later: canchas, disponibilidad, reservas, clientes, analytics
```

- [ ] **Step 6: Implement `src/app.ts`**

```ts
import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';

export function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(apiRouter);
  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 7: Implement `src/index.ts`**

```ts
import 'dotenv/config';
import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './utils/logger.js';

const env = getEnv();
buildApp().listen(env.PORT, () => logger.info(`API on :${env.PORT}`));
```

- [ ] **Step 8: Run test → PASS** (`npx vitest run tests/integration/auth.routes.test.ts`)

- [ ] **Step 9: Commit** `git commit -am "feat(http): app factory, auth routes, bootstrap"`

---

## Task 12: Canchas — repo, service, routes

**Files:**
- Create: `backend/src/repositories/cancha.repo.ts`, `backend/src/services/cancha.service.ts`, `backend/src/routes/cancha.routes.ts`, `backend/src/validators/cancha.schema.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/cancha.routes.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => {
  await setupTestDb();
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.SERVICE_API_KEY = 'svc';
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com' });
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('canchas', () => {
  it('creates and lists a cancha (admin)', async () => {
    const create = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'Cancha 1', tipo: 'futbol5', precioHora: 10000 });
    expect(create.status).toBe(201);
    expect(create.body.id).toBeTruthy();

    const list = await supertest(app).get('/canchas').set('authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('rejects unauthenticated create', async () => {
    const res = await supertest(app).post('/canchas').send({ nombre: 'x', tipo: 'y', precioHora: 1 });
    expect(res.status).toBe(401);
  });

  it('soft-deletes via PATCH activa', async () => {
    const c = await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C', tipo: 'futbol5', precioHora: 5000 });
    const res = await supertest(app).patch(`/canchas/${c.body.id}/activa`)
      .set('authorization', `Bearer ${token}`).send({ activa: false });
    expect(res.status).toBe(200);
    expect(res.body.activa).toBe(false);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement `src/repositories/cancha.repo.ts`**

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';

export const canchaRepo = {
  list: (onlyActive?: boolean) =>
    prisma.cancha.findMany({ where: onlyActive ? { activa: true } : {}, orderBy: { nombre: 'asc' } }),
  findById: (id: string) => prisma.cancha.findUnique({ where: { id } }),
  create: (data: Prisma.CanchaCreateInput) => prisma.cancha.create({ data }),
  update: (id: string, data: Prisma.CanchaUpdateInput) => prisma.cancha.update({ where: { id }, data }),
};
```

- [ ] **Step 4: Implement `src/services/cancha.service.ts`**

```ts
import { canchaRepo } from '../repositories/cancha.repo.js';
import { NotFound } from '../utils/errors.js';

export const canchaService = {
  list: (onlyActive?: boolean) => canchaRepo.list(onlyActive),
  get: async (id: string) => {
    const c = await canchaRepo.findById(id);
    if (!c) throw NotFound('Cancha', id);
    return c;
  },
  create: (input: { nombre: string; tipo: string; precioHora: number }) => canchaRepo.create(input),
  update: async (id: string, input: Partial<{ nombre: string; tipo: string; precioHora: number }>) => {
    await canchaService.get(id);
    return canchaRepo.update(id, input);
  },
  setActiva: async (id: string, activa: boolean) => {
    await canchaService.get(id);
    return canchaRepo.update(id, { activa });
  },
};
```

- [ ] **Step 5: Implement `src/validators/cancha.schema.ts`**

```ts
import { z } from 'zod';
const empty = z.object({}).passthrough();

export const createCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1), tipo: z.string().min(1), precioHora: z.number().positive() }),
  query: empty, params: empty,
});
export const updateCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1).optional(), tipo: z.string().min(1).optional(), precioHora: z.number().positive().optional() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const setActivaSchema = z.object({
  body: z.object({ activa: z.boolean() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const listCanchaSchema = z.object({
  body: empty, params: empty,
  query: z.object({ activa: z.enum(['true', 'false']).optional() }),
});
```

- [ ] **Step 6: Implement `src/routes/cancha.routes.ts`**

```ts
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { authAny } from '../middlewares/authAny.js';
import { canchaService } from '../services/cancha.service.js';
import { createCanchaSchema, updateCanchaSchema, setActivaSchema, listCanchaSchema } from '../validators/cancha.schema.js';

export const canchaRoutes = Router();

canchaRoutes.get('/', authAny, validate(listCanchaSchema), async (req, res, next) => {
  try {
    const activa = (req as any).valid.query.activa;
    res.json(await canchaService.list(activa === 'true' ? true : undefined));
  } catch (e) { next(e); }
});

canchaRoutes.get('/:id', authAny, async (req, res, next) => {
  try { res.json(await canchaService.get(req.params.id)); } catch (e) { next(e); }
});

canchaRoutes.post('/', authJwt, validate(createCanchaSchema), async (req, res, next) => {
  try { res.status(201).json(await canchaService.create((req as any).valid.body)); } catch (e) { next(e); }
});

canchaRoutes.patch('/:id', authJwt, validate(updateCanchaSchema), async (req, res, next) => {
  try { res.json(await canchaService.update(req.params.id, (req as any).valid.body)); } catch (e) { next(e); }
});

canchaRoutes.patch('/:id/activa', authJwt, validate(setActivaSchema), async (req, res, next) => {
  try { res.json(await canchaService.setActiva(req.params.id, (req as any).valid.body.activa)); } catch (e) { next(e); }
});
```

- [ ] **Step 7: Mount in `src/routes/index.ts`** — add:

```ts
import { canchaRoutes } from './cancha.routes.js';
apiRouter.use('/canchas', canchaRoutes);
```

- [ ] **Step 8: Run test → PASS**

- [ ] **Step 9: Commit** `git commit -am "feat(canchas): repo, service, routes with soft delete"`

---

## Task 13: Clientes — repo (upsert), service, routes

**Files:**
- Create: `backend/src/repositories/cliente.repo.ts`, `backend/src/services/cliente.service.ts`, `backend/src/routes/cliente.routes.ts`, `backend/src/validators/cliente.schema.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/cliente.routes.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.SERVICE_API_KEY = 'svc';
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('clientes upsert (service key)', () => {
  it('creates then updates the same whatsapp without duplicating', async () => {
    const a = await supertest(app).post('/clientes').set('x-api-key', 'svc')
      .send({ nombre: 'Juan', whatsapp: '+5491150000000', esContacto: false });
    expect(a.status).toBe(200);

    const b = await supertest(app).post('/clientes').set('x-api-key', 'svc')
      .send({ nombre: 'Juan P', whatsapp: '+5491150000000', esContacto: true });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.esContacto).toBe(true);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement `src/repositories/cliente.repo.ts`**

```ts
import { prisma } from '../db/prisma.js';

export const clienteRepo = {
  list: () => prisma.cliente.findMany({ orderBy: { creadoEn: 'desc' } }),
  findById: (id: string) => prisma.cliente.findUnique({ where: { id }, include: { reservas: true } }),
  findByWhatsapp: (whatsapp: string) => prisma.cliente.findUnique({ where: { whatsapp } }),
  upsert: (whatsapp: string, nombre: string, esContacto: boolean) =>
    prisma.cliente.upsert({
      where: { whatsapp },
      create: { whatsapp, nombre, esContacto },
      update: { nombre, esContacto },
    }),
};
```

- [ ] **Step 4: Implement `src/services/cliente.service.ts`**

```ts
import { clienteRepo } from '../repositories/cliente.repo.js';
import { NotFound } from '../utils/errors.js';

export const clienteService = {
  list: () => clienteRepo.list(),
  get: async (id: string) => {
    const c = await clienteRepo.findById(id);
    if (!c) throw NotFound('Cliente', id);
    return c;
  },
  upsert: (input: { whatsapp: string; nombre: string; esContacto: boolean }) =>
    clienteRepo.upsert(input.whatsapp, input.nombre, input.esContacto),
};
```

- [ ] **Step 5: Implement `src/validators/cliente.schema.ts`**

```ts
import { z } from 'zod';
const empty = z.object({}).passthrough();
export const upsertClienteSchema = z.object({
  body: z.object({
    whatsapp: z.string().min(5),
    nombre: z.string().min(1),
    esContacto: z.boolean().default(false),
  }),
  query: empty, params: empty,
});
```

- [ ] **Step 6: Implement `src/routes/cliente.routes.ts`**

```ts
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { authAny } from '../middlewares/authAny.js';
import { clienteService } from '../services/cliente.service.js';
import { upsertClienteSchema } from '../validators/cliente.schema.js';

export const clienteRoutes = Router();

clienteRoutes.get('/', authJwt, async (_req, res, next) => {
  try { res.json(await clienteService.list()); } catch (e) { next(e); }
});
clienteRoutes.get('/:id', authJwt, async (req, res, next) => {
  try { res.json(await clienteService.get(req.params.id)); } catch (e) { next(e); }
});
clienteRoutes.post('/', authAny, validate(upsertClienteSchema), async (req, res, next) => {
  try { res.json(await clienteService.upsert((req as any).valid.body)); } catch (e) { next(e); }
});
```

- [ ] **Step 7: Mount in `src/routes/index.ts`**

```ts
import { clienteRoutes } from './cliente.routes.js';
apiRouter.use('/clientes', clienteRoutes);
```

- [ ] **Step 8: Run test → PASS**

- [ ] **Step 9: Commit** `git commit -am "feat(clientes): upsert by whatsapp"`

---

## Task 14: Reserva repository + exclusion-constraint verification

**Files:**
- Create: `backend/src/repositories/reserva.repo.ts`, `backend/src/repositories/auditLog.repo.ts`
- Test: `backend/tests/integration/reserva.repo.test.ts`

**This task proves the double-booking guarantee.** The repo maps the Postgres exclusion-constraint violation (SQLSTATE `23P01`) to a `409 Conflict`.

- [ ] **Step 1: Write failing integration test (overlap → Conflict)**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { reservaRepo } from '../../src/repositories/reserva.repo.js';
import { AppError } from '../../src/utils/errors.js';

let canchaId: string; let clienteId: string;
beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } });
  const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
  canchaId = c.id; clienteId = cl.id;
});

const slot = (h: number) => ({
  fechaInicio: new Date(`2026-06-12T${String(h).padStart(2, '0')}:00:00.000Z`),
  fechaFin: new Date(`2026-06-12T${String(h + 1).padStart(2, '0')}:00:00.000Z`),
});

describe('reservaRepo.create', () => {
  it('allows two non-overlapping reservas', async () => {
    await reservaRepo.create({ canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000, ...slot(10) });
    await reservaRepo.create({ canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000, ...slot(11) });
    expect(await getPrisma().reserva.count()).toBe(2);
  });

  it('rejects an overlapping reserva with 409', async () => {
    await reservaRepo.create({ canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000, ...slot(10) });
    await expect(
      reservaRepo.create({ canchaId, clienteId, estado: 'ESPERANDO_SENA', esContacto: false, monto: 1000, ...slot(10) }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('allows reusing a slot once the prior reserva is CANCELADA', async () => {
    const r = await reservaRepo.create({ canchaId, clienteId, estado: 'ESPERANDO_SENA', esContacto: false, monto: 1000, ...slot(10) });
    await getPrisma().reserva.update({ where: { id: r.id }, data: { estado: 'CANCELADA' } });
    await reservaRepo.create({ canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 1000, ...slot(10) });
    expect(await getPrisma().reserva.count({ where: { estado: 'CONFIRMADA' } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement `src/repositories/auditLog.repo.ts`**

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';

export const auditLogRepo = {
  record: (data: Prisma.AuditLogUncheckedCreateInput, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).auditLog.create({ data }),
};
```

- [ ] **Step 4: Implement `src/repositories/reserva.repo.ts`**

```ts
import { Prisma, EstadoReserva } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { Conflict } from '../utils/errors.js';

export interface CreateReservaData {
  canchaId: string;
  clienteId: string;
  fechaInicio: Date;
  fechaFin: Date;
  estado: EstadoReserva;
  esContacto: boolean;
  monto: number;
  montoSena?: number | null;
  notas?: string | null;
}

function isExclusionViolation(e: unknown): boolean {
  // Prisma surfaces native Postgres errors here; 23P01 = exclusion_violation.
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.meta?.code === '23P01' || (e.meta as any)?.dbError?.code === '23P01')
  ) || (typeof e === 'object' && e !== null && (e as any).code === '23P01');
}

export const reservaRepo = {
  async create(data: CreateReservaData, tx?: Prisma.TransactionClient) {
    try {
      return await (tx ?? prisma).reserva.create({ data });
    } catch (e) {
      if (isExclusionViolation(e)) throw Conflict('El horario ya está reservado para esa cancha');
      throw e;
    }
  },
  findById: (id: string) => prisma.reserva.findUnique({ where: { id }, include: { pago: true, cliente: true, cancha: true } }),
  updateEstado: (id: string, estado: EstadoReserva, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).reserva.update({ where: { id }, data: { estado } }),
  list: (where: Prisma.ReservaWhereInput) =>
    prisma.reserva.findMany({ where, include: { cliente: true, cancha: true }, orderBy: { fechaInicio: 'asc' } }),
  overlapping: (canchaId: string, start: Date, end: Date) =>
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Reserva"
      WHERE "canchaId" = ${canchaId}
        AND estado IN ('CONFIRMADA','ESPERANDO_SENA')
        AND tsrange("fechaInicio","fechaFin") && tsrange(${start}, ${end})`,
};
```

> **Note for the implementer:** if `isExclusionViolation` does not catch the error in your Prisma version, run the failing test, inspect the thrown error shape (`console.error(e)`), and adjust the guard to match the actual `code`/`meta` fields. The behavior (overlap → 409) is the acceptance criterion, not the exact field path.

- [ ] **Step 5: Run test → PASS**

- [ ] **Step 6: Commit** `git commit -am "feat(reservas): repo with exclusion-constraint -> 409 mapping"`

---

## Task 15: Disponibilidad service (slot generation)

**Files:**
- Create: `backend/src/services/disponibilidad.service.ts`, `backend/src/repositories/horario.repo.ts`, `backend/src/validators/disponibilidad.schema.ts`, `backend/src/routes/disponibilidad.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/disponibilidad.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.SERVICE_API_KEY = 'svc';
  process.env.TZ_NEGOCIO = 'America/Argentina/Buenos_Aires';
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } });
  canchaId = c.id;
  // 2026-06-12 is Friday (diaSemana 5); open 18:00–21:00 local → 3 slots.
  await getPrisma().horarioDisponible.create({
    data: { canchaId: c.id, diaSemana: 5, horaInicio: '18:00', horaFin: '21:00' },
  });
});

describe('GET /disponibilidad', () => {
  it('returns 3 hourly slots when nothing is booked', async () => {
    const res = await supertest(app).get(`/disponibilidad?canchaId=${canchaId}&fecha=2026-06-12`).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(3);
    expect(res.body.slots[0].horaInicio).toBe('18:00');
  });

  it('excludes a booked slot', async () => {
    const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    // 19:00 ART = 22:00 UTC
    await getPrisma().reserva.create({
      data: {
        canchaId, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto: 1000,
        fechaInicio: new Date('2026-06-12T22:00:00.000Z'),
        fechaFin: new Date('2026-06-12T23:00:00.000Z'),
      },
    });
    const res = await supertest(app).get(`/disponibilidad?canchaId=${canchaId}&fecha=2026-06-12`).set('x-api-key', 'svc');
    expect(res.body.slots.map((s: any) => s.horaInicio)).toEqual(['18:00', '20:00']);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement `src/repositories/horario.repo.ts`**

```ts
import { prisma } from '../db/prisma.js';

export const horarioRepo = {
  forCanchaAndDay: (canchaId: string, diaSemana: number) =>
    prisma.horarioDisponible.findMany({ where: { canchaId, diaSemana, activo: true }, orderBy: { horaInicio: 'asc' } }),
};
```

- [ ] **Step 4: Implement `src/services/disponibilidad.service.ts`**

```ts
import { getEnv } from '../config/env.js';
import { horarioRepo } from '../repositories/horario.repo.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { canchaService } from './cancha.service.js';
import { combineDateTimeUtc, dayOfWeekInTz, dayWindowUtc } from '../utils/tz.js';

const SLOT_MIN = 60;
const pad = (n: number) => String(n).padStart(2, '0');
const toHHMM = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export interface Slot { horaInicio: string; horaFin: string; inicioUtc: string; finUtc: string; }

export const disponibilidadService = {
  async listar(canchaId: string, fecha: string): Promise<{ canchaId: string; fecha: string; slots: Slot[] }> {
    await canchaService.get(canchaId); // 404 if missing
    const tz = getEnv().TZ_NEGOCIO;
    const dia = dayOfWeekInTz(fecha, tz);
    const horarios = await horarioRepo.forCanchaAndDay(canchaId, dia);

    const { start, end } = dayWindowUtc(fecha, tz);
    const ocupadas = await reservaRepo.overlapping(canchaId, start, end).then(() =>
      // overlapping() returns ids; we need ranges, so query reservas directly:
      []);
    const reservas = await import('../db/prisma.js').then(({ prisma }) =>
      prisma.reserva.findMany({
        where: { canchaId, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] }, fechaInicio: { gte: start, lt: end } },
        select: { fechaInicio: true, fechaFin: true },
      }));

    const slots: Slot[] = [];
    for (const h of horarios) {
      for (let t = fromHHMM(h.horaInicio); t + SLOT_MIN <= fromHHMM(h.horaFin); t += SLOT_MIN) {
        const horaInicio = toHHMM(t);
        const horaFin = toHHMM(t + SLOT_MIN);
        const inicioUtc = combineDateTimeUtc(fecha, horaInicio, tz);
        const finUtc = combineDateTimeUtc(fecha, horaFin, tz);
        const taken = reservas.some((r) => r.fechaInicio < finUtc && inicioUtc < r.fechaFin);
        if (!taken) slots.push({ horaInicio, horaFin, inicioUtc: inicioUtc.toISOString(), finUtc: finUtc.toISOString() });
      }
    }
    return { canchaId, fecha, slots };
  },
};
```

> **Refactor note:** the `ocupadas`/dynamic-import lines above are intentionally redundant scaffolding — in the GREEN step write only the working `reservas` query (drop the `ocupadas` line and the dynamic import; import `prisma` at the top). Keep the slot loop. This keeps the file clean per the REFACTOR step.

Clean version of the data fetch (use this, not the scaffolding):
```ts
import { prisma } from '../db/prisma.js';
// ...
const reservas = await prisma.reserva.findMany({
  where: { canchaId, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] }, fechaInicio: { gte: start, lt: end } },
  select: { fechaInicio: true, fechaFin: true },
});
```

- [ ] **Step 5: Implement `src/validators/disponibilidad.schema.ts`**

```ts
import { z } from 'zod';
const empty = z.object({}).passthrough();
export const disponibilidadSchema = z.object({
  query: z.object({
    canchaId: z.string().min(1),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD'),
  }),
  body: empty, params: empty,
});
```

- [ ] **Step 6: Implement `src/routes/disponibilidad.routes.ts`**

```ts
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authAny } from '../middlewares/authAny.js';
import { disponibilidadSchema } from '../validators/disponibilidad.schema.js';
import { disponibilidadService } from '../services/disponibilidad.service.js';

export const disponibilidadRoutes = Router();
disponibilidadRoutes.get('/', authAny, validate(disponibilidadSchema), async (req, res, next) => {
  try {
    const { canchaId, fecha } = (req as any).valid.query;
    res.json(await disponibilidadService.listar(canchaId, fecha));
  } catch (e) { next(e); }
});
```

- [ ] **Step 7: Mount in `src/routes/index.ts`**

```ts
import { disponibilidadRoutes } from './disponibilidad.routes.js';
apiRouter.use('/disponibilidad', disponibilidadRoutes);
```

- [ ] **Step 8: Run test → PASS**

- [ ] **Step 9: Commit** `git commit -am "feat(disponibilidad): hourly slot generation with TZ + occupancy exclusion"`

---

## Task 16: Reserva service — create + state machine

**Files:**
- Create: `backend/src/services/reserva.service.ts`, `backend/src/validators/reserva.schema.ts`, `backend/src/routes/reserva.routes.ts`, `backend/src/repositories/pago.repo.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/reserva.routes.test.ts`, `backend/tests/unit/reserva.state.test.ts`

- [ ] **Step 1: Write failing unit test for state transitions**

```ts
import { describe, it, expect } from 'vitest';
import { assertTransition } from '../../src/services/reserva.service.js';
import { AppError } from '../../src/utils/errors.js';

describe('assertTransition', () => {
  it('allows ESPERANDO_SENA -> CONFIRMADA', () => {
    expect(() => assertTransition('ESPERANDO_SENA', 'CONFIRMADA')).not.toThrow();
  });
  it('rejects CANCELADA -> CONFIRMADA', () => {
    expect(() => assertTransition('CANCELADA', 'CONFIRMADA')).toThrow(AppError);
  });
  it('rejects COMPLETADA -> CANCELADA', () => {
    expect(() => assertTransition('COMPLETADA', 'CANCELADA')).toThrow(AppError);
  });
});
```

- [ ] **Step 2: Write failing integration test for create**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.SERVICE_API_KEY = 'svc';
  process.env.TZ_NEGOCIO = 'America/Argentina/Buenos_Aires';
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } });
  canchaId = c.id;
});

const body = (over: Partial<any> = {}) => ({
  canchaId, whatsapp: '+5491150000000', nombreCliente: 'Juan',
  esContacto: false, fecha: '2026-06-12', horaInicio: '18:00',
  montoSena: 500, ...over,
});

describe('POST /reservas', () => {
  it('new client -> ESPERANDO_SENA and creates the client', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body());
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(await getPrisma().cliente.count()).toBe(1);
  });

  it('known contact -> CONFIRMADA', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true }));
    expect(res.body.estado).toBe('CONFIRMADA');
  });

  it('overlap -> 409', async () => {
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true }));
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body());
    expect(res.status).toBe(409);
  });

  it('past date -> 422', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ fecha: '2020-01-01' }));
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 3: Run tests → FAIL**

- [ ] **Step 4: Implement `src/repositories/pago.repo.ts`**

```ts
import { Prisma, EstadoPago, VerificadoPor } from '@prisma/client';
import { prisma } from '../db/prisma.js';

export const pagoRepo = {
  upsertForReserva: (
    reservaId: string,
    data: { estado: EstadoPago; verificadoPor?: VerificadoPor; aprobadoPorId?: string | null; montoDetectado?: number | null; comprobanteUrl?: string | null },
    tx?: Prisma.TransactionClient,
  ) =>
    (tx ?? prisma).pago.upsert({
      where: { reservaId },
      create: { reservaId, ...data },
      update: data,
    }),
};
```

- [ ] **Step 5: Implement `src/services/reserva.service.ts`**

```ts
import { Prisma, EstadoReserva } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { clienteRepo } from '../repositories/cliente.repo.js';
import { pagoRepo } from '../repositories/pago.repo.js';
import { auditLogRepo } from '../repositories/auditLog.repo.js';
import { canchaService } from './cancha.service.js';
import { combineDateTimeUtc } from '../utils/tz.js';
import { BusinessRule, Conflict, NotFound } from '../utils/errors.js';

const TRANSITIONS: Record<EstadoReserva, EstadoReserva[]> = {
  ESPERANDO_SENA: ['CONFIRMADA', 'CANCELADA'],
  CONFIRMADA: ['CANCELADA', 'COMPLETADA'],
  CANCELADA: [],
  COMPLETADA: [],
};

export function assertTransition(from: EstadoReserva, to: EstadoReserva): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw Conflict(`Transición inválida: ${from} -> ${to}`);
  }
}

export interface CreateReservaInput {
  canchaId: string;
  whatsapp: string;
  nombreCliente: string;
  esContacto: boolean;
  fecha: string;     // YYYY-MM-DD
  horaInicio: string; // HH:MM
  montoSena?: number;
  notas?: string;
}

export const reservaService = {
  async crear(input: CreateReservaInput) {
    const cancha = await canchaService.get(input.canchaId);
    const tz = getEnv().TZ_NEGOCIO;
    const fechaInicio = combineDateTimeUtc(input.fecha, input.horaInicio, tz);
    const fechaFin = new Date(fechaInicio.getTime() + 60 * 60 * 1000);
    if (fechaInicio.getTime() <= Date.now()) throw BusinessRule('No se puede reservar en el pasado');

    const estado: EstadoReserva = input.esContacto ? 'CONFIRMADA' : 'ESPERANDO_SENA';

    return prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.upsert({
        where: { whatsapp: input.whatsapp },
        create: { whatsapp: input.whatsapp, nombre: input.nombreCliente, esContacto: input.esContacto, primeraReserva: new Date(), totalReservas: 1 },
        update: { nombre: input.nombreCliente, esContacto: input.esContacto, totalReservas: { increment: 1 } },
      });

      const reserva = await reservaRepo.create({
        canchaId: input.canchaId,
        clienteId: cliente.id,
        fechaInicio, fechaFin,
        estado,
        esContacto: input.esContacto,
        monto: Number(cancha.precioHora),
        montoSena: input.montoSena ?? null,
        notas: input.notas ?? null,
      }, tx);

      if (estado === 'ESPERANDO_SENA') {
        await pagoRepo.upsertForReserva(reserva.id, { estado: 'PENDIENTE' }, tx);
      }
      return reserva;
    });
  },

  async get(id: string) {
    const r = await reservaRepo.findById(id);
    if (!r) throw NotFound('Reserva', id);
    return r;
  },

  list: (filtros: { fecha?: string; canchaId?: string; estado?: EstadoReserva; whatsapp?: string }) => {
    const where: Prisma.ReservaWhereInput = {};
    if (filtros.canchaId) where.canchaId = filtros.canchaId;
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.whatsapp) where.cliente = { whatsapp: filtros.whatsapp };
    if (filtros.fecha) {
      const tz = getEnv().TZ_NEGOCIO;
      const start = combineDateTimeUtc(filtros.fecha, '00:00', tz);
      where.fechaInicio = { gte: start, lt: new Date(start.getTime() + 86400000) };
    }
    return reservaRepo.list(where);
  },

  async aprobarSena(id: string, by: { adminId?: string }, detalle?: { montoDetectado?: number; comprobanteUrl?: string }) {
    const r = await reservaService.get(id);
    assertTransition(r.estado, 'CONFIRMADA');
    return prisma.$transaction(async (tx) => {
      await pagoRepo.upsertForReserva(id, {
        estado: 'APROBADO',
        verificadoPor: by.adminId ? 'HUMANO' : 'IA',
        aprobadoPorId: by.adminId ?? null,
        montoDetectado: detalle?.montoDetectado ?? null,
        comprobanteUrl: detalle?.comprobanteUrl ?? null,
      }, tx);
      const updated = await reservaRepo.updateEstado(id, 'CONFIRMADA', tx);
      await auditLogRepo.record({ adminId: by.adminId ?? null, accion: 'APROBAR_SENA', entidad: 'Reserva', entidadId: id }, tx);
      return updated;
    });
  },

  async rechazarSena(id: string, by: { adminId?: string }) {
    const r = await reservaService.get(id);
    assertTransition(r.estado, 'CANCELADA');
    return prisma.$transaction(async (tx) => {
      await pagoRepo.upsertForReserva(id, { estado: 'RECHAZADO', verificadoPor: by.adminId ? 'HUMANO' : 'IA', aprobadoPorId: by.adminId ?? null }, tx);
      const updated = await reservaRepo.updateEstado(id, 'CANCELADA', tx);
      await auditLogRepo.record({ adminId: by.adminId ?? null, accion: 'RECHAZAR_SENA', entidad: 'Reserva', entidadId: id }, tx);
      return updated;
    });
  },

  async cancelar(id: string, by: { adminId?: string }) {
    const r = await reservaService.get(id);
    assertTransition(r.estado, 'CANCELADA');
    const horas = getEnv().CANCELACION_ANTICIPACION_HORAS;
    const limite = new Date(r.fechaInicio.getTime() - horas * 3600000);
    // Admins can force-cancel; the service principal (n8n acting for the client) must respect the window.
    if (!by.adminId && Date.now() > limite.getTime()) {
      throw BusinessRule(`Solo se puede cancelar hasta ${horas}h antes del turno`);
    }
    return prisma.$transaction(async (tx) => {
      const updated = await reservaRepo.updateEstado(id, 'CANCELADA', tx);
      await auditLogRepo.record({ adminId: by.adminId ?? null, accion: 'CANCELAR_RESERVA', entidad: 'Reserva', entidadId: id }, tx);
      return updated;
    });
  },

  vencidasSena: () => {
    const min = getEnv().SENA_TIMEOUT_MINUTOS;
    const limite = new Date(Date.now() - min * 60000);
    return reservaRepo.list({ estado: 'ESPERANDO_SENA', creadoEn: { lt: limite } });
  },
};
```

- [ ] **Step 6: Implement `src/validators/reserva.schema.ts`**

```ts
import { z } from 'zod';
const empty = z.object({}).passthrough();

export const createReservaSchema = z.object({
  body: z.object({
    canchaId: z.string().min(1),
    whatsapp: z.string().min(5),
    nombreCliente: z.string().min(1),
    esContacto: z.boolean().default(false),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
    montoSena: z.number().nonnegative().optional(),
    notas: z.string().optional(),
  }),
  query: empty, params: empty,
});

export const listReservaSchema = z.object({
  query: z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    canchaId: z.string().optional(),
    estado: z.enum(['CONFIRMADA', 'ESPERANDO_SENA', 'CANCELADA', 'COMPLETADA']).optional(),
    whatsapp: z.string().optional(),
  }),
  body: empty, params: empty,
});

export const aprobarSenaSchema = z.object({
  body: z.object({ montoDetectado: z.number().optional(), comprobanteUrl: z.string().url().optional() }).default({}),
  query: empty, params: z.object({ id: z.string().min(1) }),
});

export const idParamSchema = z.object({
  body: empty, query: empty, params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 7: Implement `src/routes/reserva.routes.ts`**

```ts
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { authAny } from '../middlewares/authAny.js';
import { reservaService } from '../services/reserva.service.js';
import { createReservaSchema, listReservaSchema, aprobarSenaSchema, idParamSchema } from '../validators/reserva.schema.js';

export const reservaRoutes = Router();

const adminId = (req: any) => (req.principal?.kind === 'admin' ? req.principal.adminId : undefined);

reservaRoutes.post('/', authAny, validate(createReservaSchema), async (req, res, next) => {
  try { res.status(201).json(await reservaService.crear((req as any).valid.body)); } catch (e) { next(e); }
});

reservaRoutes.get('/', authJwt, validate(listReservaSchema), async (req, res, next) => {
  try { res.json(await reservaService.list((req as any).valid.query)); } catch (e) { next(e); }
});

reservaRoutes.get('/vencidas-sena', authAny, async (_req, res, next) => {
  try { res.json(await reservaService.vencidasSena()); } catch (e) { next(e); }
});

reservaRoutes.get('/:id', authJwt, validate(idParamSchema), async (req, res, next) => {
  try { res.json(await reservaService.get(req.params.id)); } catch (e) { next(e); }
});

reservaRoutes.patch('/:id/aprobar-sena', authAny, validate(aprobarSenaSchema), async (req, res, next) => {
  try { res.json(await reservaService.aprobarSena(req.params.id, { adminId: adminId(req) }, (req as any).valid.body)); } catch (e) { next(e); }
});

reservaRoutes.patch('/:id/rechazar-sena', authAny, validate(idParamSchema), async (req, res, next) => {
  try { res.json(await reservaService.rechazarSena(req.params.id, { adminId: adminId(req) })); } catch (e) { next(e); }
});

reservaRoutes.patch('/:id/cancelar', authAny, validate(idParamSchema), async (req, res, next) => {
  try { res.json(await reservaService.cancelar(req.params.id, { adminId: adminId(req) })); } catch (e) { next(e); }
});
```

> **Routing note:** register `/vencidas-sena` before `/:id` (done above) so Express does not treat "vencidas-sena" as an `:id`.

- [ ] **Step 8: Mount in `src/routes/index.ts`**

```ts
import { reservaRoutes } from './reserva.routes.js';
apiRouter.use('/reservas', reservaRoutes);
```

- [ ] **Step 9: Run tests → PASS** (`npx vitest run tests/unit/reserva.state.test.ts tests/integration/reserva.routes.test.ts`)

- [ ] **Step 10: Commit** `git commit -am "feat(reservas): create + state machine + seña/cancelación endpoints"`

---

## Task 17: Seña approve/reject + cancel — integration coverage

**Files:**
- Test: `backend/tests/integration/reserva.sena.test.ts`

(The service logic already exists from Task 16; this task locks behavior with integration tests and an audit-log assertion.)

- [ ] **Step 1: Write failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.SERVICE_API_KEY = 'svc';
  process.env.TZ_NEGOCIO = 'America/Argentina/Buenos_Aires';
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } })).id;
});

async function crearEsperandoSena() {
  const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp: '+5491150000000', nombreCliente: 'Juan', esContacto: false,
    fecha: '2026-06-12', horaInicio: '18:00', montoSena: 500,
  });
  return res.body.id as string;
}

describe('seña lifecycle', () => {
  it('IA approval (service key) confirms and writes an audit log', async () => {
    const id = await crearEsperandoSena();
    const res = await supertest(app).patch(`/reservas/${id}/aprobar-sena`).set('x-api-key', 'svc')
      .send({ montoDetectado: 500, comprobanteUrl: 'https://x/img.png' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CONFIRMADA');
    const pago = await getPrisma().pago.findUnique({ where: { reservaId: id } });
    expect(pago?.estado).toBe('APROBADO');
    expect(pago?.verificadoPor).toBe('IA');
    expect(await getPrisma().auditLog.count({ where: { accion: 'APROBAR_SENA' } })).toBe(1);
  });

  it('reject cancels the reserva', async () => {
    const id = await crearEsperandoSena();
    const res = await supertest(app).patch(`/reservas/${id}/rechazar-sena`).set('x-api-key', 'svc').send({});
    expect(res.body.estado).toBe('CANCELADA');
  });

  it('double approval -> 409 (invalid transition)', async () => {
    const id = await crearEsperandoSena();
    await supertest(app).patch(`/reservas/${id}/aprobar-sena`).set('x-api-key', 'svc').send({});
    const res = await supertest(app).patch(`/reservas/${id}/aprobar-sena`).set('x-api-key', 'svc').send({});
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test → PASS** (logic exists). If anything fails, fix the service per systematic-debugging before proceeding.

- [ ] **Step 3: Commit** `git commit -am "test(reservas): seña lifecycle + audit log coverage"`

---

## Task 18: Analytics

**Files:**
- Create: `backend/src/services/analytics.service.ts`, `backend/src/routes/analytics.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/analytics.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.SERVICE_API_KEY = 'svc';
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com' });
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } })).id;
  const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
  await getPrisma().reserva.create({ data: {
    canchaId, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto: 1000,
    fechaInicio: new Date('2026-06-12T22:00:00.000Z'), fechaFin: new Date('2026-06-12T23:00:00.000Z'),
  }});
});

describe('analytics', () => {
  it('ingresos sums confirmed/completed reservas', async () => {
    const res = await supertest(app).get('/analytics/ingresos').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.total)).toBe(1000);
  });
  it('canchas-top returns the cancha with its count', async () => {
    const res = await supertest(app).get('/analytics/canchas-top').set('authorization', `Bearer ${token}`);
    expect(res.body[0].canchaId).toBe(canchaId);
    expect(Number(res.body[0].reservas)).toBe(1);
  });
  it('requires admin (service key forbidden)', async () => {
    const res = await supertest(app).get('/analytics/ingresos').set('x-api-key', 'svc');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement `src/services/analytics.service.ts`**

```ts
import { prisma } from '../db/prisma.js';

const ACTIVE = { in: ['CONFIRMADA', 'COMPLETADA'] as const };

export const analyticsService = {
  async ingresos(desde?: Date, hasta?: Date) {
    const where: any = { estado: ACTIVE };
    if (desde || hasta) where.fechaInicio = { ...(desde && { gte: desde }), ...(hasta && { lt: hasta }) };
    const agg = await prisma.reserva.aggregate({ _sum: { monto: true }, where });
    return { total: agg._sum.monto ?? 0 };
  },

  async canchasTop() {
    const rows = await prisma.reserva.groupBy({
      by: ['canchaId'], where: { estado: ACTIVE }, _count: { _all: true },
      orderBy: { _count: { canchaId: 'desc' } },
    });
    return rows.map((r) => ({ canchaId: r.canchaId, reservas: r._count._all }));
  },

  async horariosPico() {
    // Group by start hour (UTC); the panel renders local. Good enough for the MVP.
    return prisma.$queryRaw<Array<{ hora: number; reservas: bigint }>>`
      SELECT EXTRACT(HOUR FROM "fechaInicio")::int AS hora, COUNT(*) AS reservas
      FROM "Reserva" WHERE estado IN ('CONFIRMADA','COMPLETADA')
      GROUP BY 1 ORDER BY reservas DESC`;
  },

  async ocupacion() {
    return prisma.$queryRaw<Array<{ dia: number; hora: number; reservas: bigint }>>`
      SELECT EXTRACT(DOW FROM "fechaInicio")::int AS dia,
             EXTRACT(HOUR FROM "fechaInicio")::int AS hora,
             COUNT(*) AS reservas
      FROM "Reserva" WHERE estado IN ('CONFIRMADA','COMPLETADA')
      GROUP BY 1,2 ORDER BY dia, hora`;
  },
};
```

- [ ] **Step 4: Implement `src/routes/analytics.routes.ts`**

```ts
import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { analyticsService } from '../services/analytics.service.js';

export const analyticsRoutes = Router();
analyticsRoutes.use(authJwt);

const json = (fn: () => Promise<unknown>) => async (_req: any, res: any, next: any) => {
  try { res.json(await fn()); } catch (e) { next(e); }
};

analyticsRoutes.get('/ingresos', json(() => analyticsService.ingresos()));
analyticsRoutes.get('/canchas-top', json(() => analyticsService.canchasTop()));
analyticsRoutes.get('/horarios-pico', json(() => analyticsService.horariosPico().then(serializeBigInt)));
analyticsRoutes.get('/ocupacion', json(() => analyticsService.ocupacion().then(serializeBigInt)));

function serializeBigInt(rows: any[]) {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
}
```

- [ ] **Step 5: Mount in `src/routes/index.ts`**

```ts
import { analyticsRoutes } from './analytics.routes.js';
apiRouter.use('/analytics', analyticsRoutes);
```

- [ ] **Step 6: Run test → PASS**

- [ ] **Step 7: Commit** `git commit -am "feat(analytics): ingresos, canchas-top, horarios-pico, ocupacion"`

---

## Task 19: Seeds

**Files:**
- Create: `backend/prisma/seed.ts`
- Modify: `backend/package.json` (add `prisma.seed` config)

- [ ] **Step 1: Implement `prisma/seed.ts`**

```ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL ?? 'admin@canchitas.com';
  const password = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-admin';
  await prisma.adminUser.upsert({
    where: { email },
    create: { email, nombre: 'Admin', passwordHash: await bcrypt.hash(password, 10) },
    update: {},
  });

  for (const n of ['Cancha 1', 'Cancha 2']) {
    const cancha = await prisma.cancha.upsert({
      where: { id: `seed-${n}` },
      create: { id: `seed-${n}`, nombre: n, tipo: 'futbol5', precioHora: 12000 },
      update: {},
    });
    // Mon–Sun, 16:00–23:00
    for (let dia = 0; dia <= 6; dia++) {
      const exists = await prisma.horarioDisponible.findFirst({ where: { canchaId: cancha.id, diaSemana: dia } });
      if (!exists) {
        await prisma.horarioDisponible.create({ data: { canchaId: cancha.id, diaSemana: dia, horaInicio: '16:00', horaFin: '23:00' } });
      }
    }
  }
  console.log('Seed completo');
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add seed config to `package.json`**

```json
{
  "prisma": { "seed": "tsx prisma/seed.ts" }
}
```

- [ ] **Step 3: Run seed against a dev DB**

Run: `npx prisma db seed`
Expected: "Seed completo"; `psql` shows 1 admin, 2 canchas, 14 horarios.

- [ ] **Step 4: Commit** `git commit -am "feat(seed): admin + canchas + horarios"`

---

## Task 20: Docker

**Files:**
- Create: `backend/Dockerfile`, `backend/docker-compose.yml`, `backend/docker/postgres-init.sql`

- [ ] **Step 1: Write `Dockerfile` (multi-stage)**

```dockerfile
# --- build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# --- runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
```

- [ ] **Step 2: Write `docker/postgres-init.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

- [ ] **Step 3: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: canchitas
      POSTGRES_PASSWORD: canchitas
      POSTGRES_DB: canchitas
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U canchitas"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build: .
    environment:
      DATABASE_URL: postgresql://canchitas:canchitas@postgres:5432/canchitas?schema=public
      JWT_SECRET: change-me-32-chars-minimum-secret-xx
      SERVICE_API_KEY: change-me-service-key
      TZ_NEGOCIO: America/Argentina/Buenos_Aires
      ADMIN_SEED_EMAIL: admin@canchitas.com
      ADMIN_SEED_PASSWORD: change-me-admin
      PORT: 3000
    ports: ["3000:3000"]
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

- [ ] **Step 4: Verify build**

Run: `docker compose build` → Expected: image builds. (Optionally `docker compose up` and `curl localhost:3000/health`.)

- [ ] **Step 5: Commit** `git commit -am "feat(docker): multi-stage Dockerfile + compose with postgres"`

---

## Task 21: README + final validation

**Files:**
- Create: `backend/README.md`

- [ ] **Step 1: Write `README.md`** documenting: prerequisites (Node 20, Docker for tests), `.env` setup, `npm run dev`, `npx prisma migrate dev`, `npm test` (needs Docker for Testcontainers), endpoint table, and the n8n integration contract (API key header, create/aprobar/cancelar payloads).

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck` → Expected: PASS

- [ ] **Step 3: Full test suite**

Run: `npm test` → Expected: all suites green (Docker must be running).

- [ ] **Step 4: Smoke test via docker-compose**

Run: `docker compose up --build -d && curl -s localhost:3000/health` → Expected: `{"ok":true}`. Then `curl -s -XPOST localhost:3000/auth/login -H 'content-type: application/json' -d '{"email":"admin@canchitas.com","password":"change-me-admin"}'` (after seeding) → token.

- [ ] **Step 5: Security review checklist**
  - Passwords only stored as bcrypt hash (grep for plaintext).
  - Secrets only from env, none committed (`.env` gitignored).
  - 500 responses never leak stack/internal messages (verified in `errorHandler`).
  - API key compared correctly; analytics requires JWT.

- [ ] **Step 6: Commit** `git commit -am "docs: README + final validation"`

---

## Self-Review (against the spec)

- **Concurrency / double booking** → Tasks 3, 14, 16 (exclusion constraint + 409 mapping + create flow). ✅
- **Slot generation (60 min) + TZ** → Tasks 6, 15. ✅
- **State machine (4 estados)** → Task 16 (`assertTransition` + `TRANSITIONS`). ✅
- **Seña approve/reject (IA/humano) + audit** → Tasks 16, 17. ✅
- **Cancellation rule (anticipación, admin override)** → Task 16 `cancelar`. ✅
- **Auth JWT + API key** → Tasks 10, 11. ✅
- **Endpoints (canchas, disponibilidad, reservas, clientes, analytics, auth)** → Tasks 11–18. ✅
- **Soft delete (Cancha.activa, estados)** → Tasks 2, 12. ✅
- **Audit log** → Tasks 14, 16, 17. ✅
- **Error format** → Task 9. ✅
- **Docker multi-stage + compose + btree_gist** → Task 20. ✅
- **Seeds** → Task 19. ✅
- **vencidas-sena for n8n timing** → Task 16. ✅

**Type consistency:** `buildApp`, `reservaRepo.create`, `assertTransition`, `disponibilidadService.listar`, `canchaService.get`, `clienteRepo.upsert`, `pagoRepo.upsertForReserva`, `auditLogRepo.record` are referenced consistently across tasks.

**Known follow-ups (deuda aceptada, out of scope):** comprobante file storage (n8n owns), scheduler for timeout/reminders (n8n owns), multi-tenant, analytics in local TZ buckets.

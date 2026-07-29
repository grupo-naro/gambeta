# Backend hardening (A1 + A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Endurecer la seguridad del backend: rate limiting + headers (`helmet`) y permitir rotar la `SERVICE_API_KEY` sin downtime (set de keys + comparación constant-time).

**Architecture:** Dos tareas backend independientes. Task 1 (A2): un helper `isValidServiceKey` que valida contra un conjunto de keys leído de `process.env`, usado por `authAny`/`authApiKey`. Task 2 (A1): `helmet` + `express-rate-limit` cableados en `buildApp()`, con `trust proxy` por Traefik. TDD; tests con Vitest/Supertest (Testcontainers, requiere Docker) salvo el unit del helper.

**Tech Stack:** Node + Express 5 + TypeScript, Prisma 7, Zod 4, Vitest + Supertest + Testcontainers, npm. Repo: `backend`, rama `main` (crear rama feature `feat/backend-hardening`).

## Global Constraints

- Imports CON extensión `.js` (ESM/NodeNext).
- `crypto.timingSafeEqual` para comparar la key (constant-time); manejar largos distintos sin excepción.
- `app.set('trust proxy', 1)` (NO `true`): confía solo en el primer proxy (Traefik), no spoofeable.
- Rate-limit: general 600/min sobre todo el router (`/health` exento por registrarse antes); login 10 / 15 min → 429.
- `express-rate-limit` v7: la opción es `limit` (no `max`); `standardHeaders: 'draft-7'`, `legacyHeaders: false`.
- A2 no rompe nada con la config actual: si `SERVICE_API_KEYS` está vacía, el set = solo `SERVICE_API_KEY` (comportamiento idéntico al de hoy).
- Al cerrar: declarar `SERVICE_API_KEYS` en el `environment:` de `docker-compose.vm.yml` (gotcha conocido); el deploy lo corre el usuario.
- Comandos: unit `npx vitest run <archivo>`; suite + tipos `npx tsc --noEmit && npx vitest run`.

---

## File Structure

- `backend/src/utils/serviceAuth.ts` (Create): helper `isValidServiceKey` + set de keys aceptadas (lee `process.env`).
- `backend/src/utils/serviceAuth.test.ts` (Create): unit del helper.
- `backend/src/config/env.ts` (Modify): agregar `SERVICE_API_KEYS` al schema.
- `backend/src/middlewares/authAny.ts` (Modify): usar `isValidServiceKey`.
- `backend/src/middlewares/authApiKey.ts` (Modify): usar `isValidServiceKey`.
- `backend/tests/integration/service-key-rotacion.test.ts` (Create): authAny acepta key primaria y extra, rechaza inválida.
- `backend/src/middlewares/rateLimiters.ts` (Create): `loginLimiter` + `generalLimiter` (módulo aparte para evitar ciclo de imports app↔routes).
- `backend/src/app.ts` (Modify): `trust proxy` + `helmet` + usa los limiters.
- `backend/tests/integration/hardening.test.ts` (Create): helmet header + login 429.
- `backend/package.json` (Modify, vía `npm install`): deps `helmet`, `express-rate-limit`.

---

### Task 1: A2 — rotación de `SERVICE_API_KEY` (helper + middlewares)

**Files:**
- Create: `backend/src/utils/serviceAuth.ts`
- Create: `backend/src/utils/serviceAuth.test.ts`
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/middlewares/authAny.ts`
- Modify: `backend/src/middlewares/authApiKey.ts`
- Test: `backend/tests/integration/service-key-rotacion.test.ts`

**Interfaces:**
- Consumes: `process.env.SERVICE_API_KEY`, `process.env.SERVICE_API_KEYS`.
- Produces: `isValidServiceKey(provided: string | undefined | null): boolean` en `../utils/serviceAuth.js` — true si `provided` (no vacío) matchea, por `timingSafeEqual`, alguna de las keys aceptadas (`SERVICE_API_KEY` + las de `SERVICE_API_KEYS` separadas por coma, trim, sin vacías, únicas).

- [ ] **Step 1: Write the failing unit test**

Crear `backend/src/utils/serviceAuth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isValidServiceKey } from './serviceAuth.js';

const ORIG = { k: process.env.SERVICE_API_KEY, ks: process.env.SERVICE_API_KEYS };
beforeEach(() => { process.env.SERVICE_API_KEY = 'primaria'; process.env.SERVICE_API_KEYS = 'segunda, tercera'; });
afterEach(() => { process.env.SERVICE_API_KEY = ORIG.k; process.env.SERVICE_API_KEYS = ORIG.ks; });

describe('isValidServiceKey', () => {
  it('acepta la key primaria', () => { expect(isValidServiceKey('primaria')).toBe(true); });
  it('acepta una key de SERVICE_API_KEYS (con espacios alrededor)', () => {
    expect(isValidServiceKey('segunda')).toBe(true);
    expect(isValidServiceKey('tercera')).toBe(true);
  });
  it('rechaza una key que no está en el set', () => { expect(isValidServiceKey('otra')).toBe(false); });
  it('rechaza vacío / undefined / null', () => {
    expect(isValidServiceKey('')).toBe(false);
    expect(isValidServiceKey(undefined)).toBe(false);
    expect(isValidServiceKey(null)).toBe(false);
  });
  it('no lanza cuando los largos difieren', () => {
    expect(() => isValidServiceKey('x')).not.toThrow();
    expect(isValidServiceKey('x')).toBe(false);
  });
  it('si SERVICE_API_KEYS está vacía, solo vale la primaria', () => {
    process.env.SERVICE_API_KEYS = '';
    expect(isValidServiceKey('primaria')).toBe(true);
    expect(isValidServiceKey('segunda')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `cd backend && npx vitest run src/utils/serviceAuth.test.ts`
Expected: FAIL — `serviceAuth.js` / `isValidServiceKey` no existe (import error).

- [ ] **Step 3: Implementar el helper**

Crear `backend/src/utils/serviceAuth.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';

// Conjunto de service keys aceptadas: la primaria + las extra de SERVICE_API_KEYS
// (coma-separadas). Se lee de process.env en cada llamada para permitir rotación
// sin reiniciar y para ser testeable sin bootstrappear todo el env.
function keysAceptadas(): string[] {
  const raw = [process.env.SERVICE_API_KEY ?? '', ...(process.env.SERVICE_API_KEYS ?? '').split(',')];
  return [...new Set(raw.map((s) => s.trim()).filter((s) => s.length > 0))];
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false; // timingSafeEqual exige mismo largo
  return timingSafeEqual(ab, bb);
}

export function isValidServiceKey(provided: string | undefined | null): boolean {
  if (!provided) return false;
  return keysAceptadas().some((k) => safeEqual(provided, k));
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd backend && npx vitest run src/utils/serviceAuth.test.ts`
Expected: PASS.

- [ ] **Step 5: Agregar `SERVICE_API_KEYS` al schema de env**

En `backend/src/config/env.ts`, dentro del `z.object({...})`, agregar debajo de la línea `SERVICE_API_KEY: z.string().min(1),`:

```ts
  SERVICE_API_KEYS: z.string().default(''),
```

- [ ] **Step 6: Usar el helper en `authAny`**

En `backend/src/middlewares/authAny.ts`: reemplazar el import de `getEnv` por el del helper y usarlo. Resultado completo del archivo:

```ts
import type { Request, Response, NextFunction } from 'express';
import { verifyAdminToken } from '../services/auth.service.js';
import { isValidServiceKey } from '../utils/serviceAuth.js';
import { Unauthorized } from '../utils/errors.js';

export function authAny(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.header('x-api-key');
  if (isValidServiceKey(apiKey)) {
    req.principal = { kind: 'service' };
    return next();
  }
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const claims = verifyAdminToken(header.slice(7));
    req.principal = { kind: 'admin', adminId: claims.adminId, email: claims.email, rol: claims.rol };
    return next();
  }
  return next(Unauthorized('Falta autenticación'));
}
```

- [ ] **Step 7: Usar el helper en `authApiKey`**

En `backend/src/middlewares/authApiKey.ts`, reemplazar todo el archivo por:

```ts
import type { Request, Response, NextFunction } from 'express';
import { isValidServiceKey } from '../utils/serviceAuth.js';
import { Unauthorized } from '../utils/errors.js';

export function authApiKey(req: Request, _res: Response, next: NextFunction) {
  if (!isValidServiceKey(req.header('x-api-key'))) return next(Unauthorized('API key inválida'));
  req.principal = { kind: 'service' };
  next();
}
```

- [ ] **Step 8: Write the failing integration test (rotación end-to-end)**

Crear `backend/tests/integration/service-key-rotacion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';

let app: any;
const ORIG = process.env.SERVICE_API_KEYS;
beforeAll(async () => {
  await setupTestDb();
  process.env.SERVICE_API_KEYS = 'rotada-nueva-123';
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(async () => { process.env.SERVICE_API_KEYS = ORIG; await teardownTestDb(); });
beforeEach(resetTables);

// GET /reservas/mias usa authAny y no requiere seed (cliente sin reservas → []).
const mias = (key: string) => supertest(app).get('/reservas/mias?whatsapp=5491100000000').set('x-api-key', key);

describe('rotación de service key (authAny)', () => {
  it('acepta la key primaria (svc, la de los tests)', async () => {
    const r = await mias('svc');
    expect(r.status).toBe(200);
  });
  it('acepta una key extra de SERVICE_API_KEYS', async () => {
    const r = await mias('rotada-nueva-123');
    expect(r.status).toBe(200);
  });
  it('rechaza una key inválida con 401', async () => {
    const r = await mias('no-soy-valida');
    expect(r.status).toBe(401);
  });
});
```

(Nota: los tests corren con `SERVICE_API_KEY='svc'` — por eso `x-api-key: 'svc'` ya funciona en los demás tests de integración.)

- [ ] **Step 9: Run the integration test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/service-key-rotacion.test.ts`
Expected: PASS (3/3). (Si falla el caso "primaria" por no estar seteada `SERVICE_API_KEY`, confirmá cómo la inyectan los tests existentes —`liberar-fijo.test.ts` usa `x-api-key: 'svc'`— y alineá el valor.)

- [ ] **Step 10: Typecheck + suite completa**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: tsc sin errores; suite verde (las 3 fallas pre-existentes de `reserva.sena.test.ts` por contención de Testcontainers no cuentan; deben pasar en aislado).

- [ ] **Step 11: Commit**

```bash
cd backend && git add src/utils/serviceAuth.ts src/utils/serviceAuth.test.ts src/config/env.ts src/middlewares/authAny.ts src/middlewares/authApiKey.ts tests/integration/service-key-rotacion.test.ts
git commit -m "feat(auth): service key rotable (set de keys + constant-time compare)"
```

---

### Task 2: A1 — `helmet` + rate limiting

**Files:**
- Modify: `backend/package.json` (vía `npm install`)
- Create: `backend/src/middlewares/rateLimiters.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/routes/auth.routes.ts`
- Test: `backend/tests/integration/hardening.test.ts`

**Interfaces:**
- Consumes: `buildApp()` de `../../src/app.js` (existente).
- Produces: `loginLimiter` y `generalLimiter` en `../middlewares/rateLimiters.js`; app con `helmet` + ambos limiters (general en el router, estricto en `POST /auth/login`).
- Nota anti-ciclo: los limiters viven en `rateLimiters.ts` (NO en `app.ts`), porque `auth.routes.ts` necesita importar `loginLimiter` y `app.ts` ya importa (transitivamente) `auth.routes.ts` → importarlo desde `app.ts` haría un ciclo y dejaría `loginLimiter` undefined al registrar la ruta.

- [ ] **Step 1: Instalar dependencias**

Run: `cd backend && npm install helmet express-rate-limit`
Expected: agrega `helmet` (^8) y `express-rate-limit` (^7) a `dependencies`, sin errores.

- [ ] **Step 2: Write the failing integration test**

Crear `backend/tests/integration/hardening.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb } from '../helpers/db.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);

describe('helmet', () => {
  it('setea headers de seguridad', async () => {
    const r = await supertest(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('rate limit de login', () => {
  it('devuelve 429 tras superar el límite de intentos', async () => {
    const intento = () => supertest(app).post('/auth/login').send({ email: 'nadie@x.com', password: 'malisima' });
    let last = 0;
    for (let i = 0; i < 11; i++) { last = (await intento()).status; }
    expect(last).toBe(429);
  });
});
```

- [ ] **Step 3: Run the integration test to verify it fails**

Run: `cd backend && npx vitest run tests/integration/hardening.test.ts`
Expected: FAIL — sin helmet no aparece `x-content-type-options`; sin rate-limit el intento 11 da 401 (no 429).

- [ ] **Step 4: Crear el módulo de rate limiters**

Crear `backend/src/middlewares/rateLimiters.ts`:

```ts
import rateLimit from 'express-rate-limit';

// Anti fuerza-bruta del login: pocos intentos por IP en una ventana amplia.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, probá más tarde' },
});

// Anti-flood general, holgado para no estrangular al bot ni al panel.
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, esperá un momento' },
});
```

- [ ] **Step 5: Cablear `helmet` + `generalLimiter` en `app.ts`**

Reemplazar `backend/src/app.ts` por:

```ts
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './utils/logger.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { generalLimiter } from './middlewares/rateLimiters.js';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1); // hay Traefik delante; confiar solo en el primer proxy
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(generalLimiter);
  app.use(apiRouter);
  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 6: Aplicar el `loginLimiter` a la ruta de login**

En `backend/src/routes/auth.routes.ts`:

1. Agregar el import del limiter:

```ts
import { loginLimiter } from '../middlewares/rateLimiters.js';
```

2. Insertarlo como primer middleware del `POST /login` (antes de `validate`):

```ts
authRoutes.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
```

- [ ] **Step 7: Run the integration test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/hardening.test.ts`
Expected: PASS (helmet header presente; intento 11 → 429).

- [ ] **Step 8: Typecheck + suite completa**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: tsc sin errores; suite verde (salvo las 3 fallas pre-existentes de `reserva.sena.test.ts`, que pasan en aislado).

- [ ] **Step 9: Commit**

```bash
cd backend && git add package.json package-lock.json src/middlewares/rateLimiters.ts src/app.ts src/routes/auth.routes.ts tests/integration/hardening.test.ts
git commit -m "feat(seguridad): helmet + rate limiting (login + general) con trust proxy"
```

---

## Self-review (hecho)

- **Cobertura del spec:** A1 (helmet + trust proxy + login limiter + general limiter + /health exento) → Task 2; A2 (SERVICE_API_KEYS en env + isValidServiceKey constant-time + middlewares) → Task 1; tests (unit helper, integración rotación, helmet header, login 429) → cubiertos. ✓
- **Sin placeholders.** Código completo en cada step.
- **Consistencia de tipos:** `isValidServiceKey(provided: string | undefined | null): boolean` usado igual en helper, authAny y authApiKey; `loginLimiter` exportado de `app.ts` e importado en `auth.routes.ts`.

## Cierre

Tras las 2 tareas: usar **superpowers:finishing-a-development-branch** — `npx tsc --noEmit` + `npx vitest run`, revisión whole-branch, merge de `feat/backend-hardening` a `main` + push. Acordarse de declarar `SERVICE_API_KEYS` en el `environment:` del `docker-compose.vm.yml` antes/junto al deploy (el deploy lo corre el usuario). Después viene el **follow-on del bot** (rotación real + sacar la key del código), directo en n8n.

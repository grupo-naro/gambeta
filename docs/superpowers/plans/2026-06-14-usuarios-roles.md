# Usuarios y roles (ADMIN / RECEPCIONISTA) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dos roles (ADMIN/RECEPCIONISTA): el admin gestiona todo y administra usuarios; la recepcionista opera reservas/calendario. El admin por defecto es inmutable.

**Architecture:** `AdminUser` suma `rol` + `esDefault`; el JWT lleva `rol`; un middleware `requireRole` gatea las rutas de escritura admin-only; nuevo CRUD `/usuarios`. El frontend obtiene el rol de `GET /auth/me`, filtra el nav y protege las páginas admin-only, y suma la pantalla `/usuarios`.

**Tech Stack:** Backend Node+Express 5+TS, Prisma 7 (`../db/client.js`), Zod 4, Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 + React 19 + Tailwind 4 + Base UI + pnpm.

**Ramas:** backend `feat/roles-backend`, frontend `feat/roles-panel`. Sin bot.

**Datos del repo (verificados):** `Forbidden` (403) ya existe en `utils/errors.ts`. `/auth/me` ya existe (`authJwt`, devuelve `{id,email,nombre}`). `AuthPrincipal = {kind:'admin',adminId,email} | {kind:'service'}` en `src/types/domain.ts`. `adminUserRepo` tiene `findByEmail`/`findById`. El layout `(panel)/layout.tsx` hace `apiFetch('/auth/me')` para el email. `login` (lib/auth) parsea `LoginResult` y redirige a `/dashboard`.

---

## Parte A — Backend (rama `feat/roles-backend`)

### Task A0: Crear la rama
- [ ] **Step 1**
```bash
cd c:/Users/Lautaro/Desktop/ortigoza/backend && git checkout main && git pull && git checkout -b feat/roles-backend
```

---

### Task A1: Modelo `rol` + `esDefault` + migración + seed

**Files:** `prisma/schema.prisma`, migración, `src/seed.ts`

- [ ] **Step 1: Schema**

En `prisma/schema.prisma`, agregar el enum (cerca de los otros enums) y los campos en `AdminUser`:
```prisma
enum Rol {
  ADMIN
  RECEPCIONISTA
}
```
```prisma
model AdminUser {
  id           String     @id @default(cuid())
  email        String     @unique
  passwordHash String
  nombre       String
  rol          Rol        @default(RECEPCIONISTA)
  esDefault    Boolean    @default(false)
  creadoEn     DateTime   @default(now())
  pagos        Pago[]
  auditLogs    AuditLog[]
}
```

- [ ] **Step 2: Migración (necesita Docker)**
```bash
npx prisma migrate dev --name add_user_roles
```
Expected: `ALTER TABLE "AdminUser" ADD COLUMN "rol" ...` (con tipo enum `Rol`) + `ADD COLUMN "esDefault" BOOLEAN NOT NULL DEFAULT false`, y `CREATE TYPE "Rol"`.

- [ ] **Step 3: Seed marca al admin por defecto**

En `src/seed.ts`, donde se siembra/asegura el admin (`admin@canchitas.com`), setear `rol: 'ADMIN', esDefault: true` en el create Y en el update del upsert (idempotente). Buscar el bloque del adminUser y ajustar; si usa `prisma.adminUser.upsert`, ambos `create` y `update` deben incluir `rol: 'ADMIN', esDefault: true`. Si crea con `findFirst`+`create`, agregar `update` para asegurar el flag en instalaciones existentes.

- [ ] **Step 4: tsc + commit**
```bash
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations src/seed.ts
git commit -m "feat(usuarios): add rol + esDefault to AdminUser, seed default admin"
```

---

### Task A2: JWT y principal con `rol` (TDD)

**Files:** `src/services/auth.service.ts`, `src/types/domain.ts`, `src/middlewares/authJwt.ts`, `src/routes/auth.routes.ts`, test `tests/integration/auth.test.ts` (crear o ampliar)

- [ ] **Step 1: Test que falla**

Crear/ampliar `tests/integration/auth.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('login con rol', () => {
  it('el token y la respuesta incluyen el rol', async () => {
    await getPrisma().adminUser.create({ data: { email: 'a@a.com', nombre: 'A', passwordHash: await hashPassword('secreto'), rol: 'ADMIN', esDefault: true } });
    const res = await supertest(app).post('/auth/login').send({ email: 'a@a.com', password: 'secreto' });
    expect(res.status).toBe(200);
    expect(res.body.admin.rol).toBe('ADMIN');
    const payload = jwt.decode(res.body.token) as any;
    expect(payload.rol).toBe('ADMIN');
  });
});
```
NOTA: confirmá el nombre real del helper de hashing en `src/utils/password.ts` (`hashPassword`/`hash`); ajustá el import.

- [ ] **Step 2: Correr → falla**
```bash
npx vitest run tests/integration/auth.test.ts -t "rol"
```
Expected: FAIL — `admin.rol`/`payload.rol` undefined.

- [ ] **Step 3: Implementar**

`src/types/domain.ts` — el principal admin suma `rol`:
```ts
export type Rol = 'ADMIN' | 'RECEPCIONISTA';
export type AuthPrincipal =
  | { kind: 'admin'; adminId: string; email: string; rol: Rol }
  | { kind: 'service' };
```

`src/services/auth.service.ts` — claims y login con rol:
```ts
import type { Rol } from '../types/domain.js';
export interface AdminClaims { adminId: string; email: string; rol: Rol; }

export function signAdminToken(claims: AdminClaims): string {
  const env = getEnv();
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

export function verifyAdminToken(token: string): AdminClaims {
  try {
    const decoded = jwt.verify(token, getEnv().JWT_SECRET) as jwt.JwtPayload;
    return { adminId: String(decoded.adminId), email: String(decoded.email), rol: (decoded.rol === 'ADMIN' ? 'ADMIN' : 'RECEPCIONISTA') };
  } catch {
    throw Unauthorized('Token inválido');
  }
}

export async function login(email: string, password: string) {
  const admin = await adminUserRepo.findByEmail(email);
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    throw Unauthorized('Credenciales inválidas');
  }
  const token = signAdminToken({ adminId: admin.id, email: admin.email, rol: admin.rol as Rol });
  return { token, admin: { id: admin.id, email: admin.email, nombre: admin.nombre, rol: admin.rol } };
}
```

`src/middlewares/authJwt.ts` — propagar rol al principal:
```ts
  req.principal = { kind: 'admin', adminId: claims.adminId, email: claims.email, rol: claims.rol };
```

`src/routes/auth.routes.ts` — `/auth/me` devuelve rol:
```ts
    res.json({ id: admin.id, email: admin.email, nombre: admin.nombre, rol: admin.rol });
```

- [ ] **Step 4: Correr → pasa**
```bash
npx vitest run tests/integration/auth.test.ts -t "rol"
```
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/services/auth.service.ts src/types/domain.ts src/middlewares/authJwt.ts src/routes/auth.routes.ts tests/integration/auth.test.ts
git commit -m "feat(usuarios): carry rol in JWT, principal and /auth/me"
```

---

### Task A3: Middleware `requireRole` (TDD)

**Files:** Create `src/middlewares/requireRole.ts`, test `tests/integration/require-role.test.ts`

- [ ] **Step 1: Test que falla**

Crear `tests/integration/require-role.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

const adminTok = () => signAdminToken({ adminId: 'x', email: 'a@a.com', rol: 'ADMIN' });
const recepTok = () => signAdminToken({ adminId: 'y', email: 'r@r.com', rol: 'RECEPCIONISTA' });

describe('requireRole(ADMIN) en PATCH /config', () => {
  it('RECEPCIONISTA → 403', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${recepTok()}`).send({ horaApertura: '16:00' });
    expect(res.status).toBe(403);
  });
  it('ADMIN → no 403', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${adminTok()}`).send({ horaApertura: '16:00' });
    expect(res.status).not.toBe(403);
  });
});

describe('GET turnos-fijos accesible a RECEPCIONISTA', () => {
  it('RECEPCIONISTA → 200', async () => {
    const res = await supertest(app).get('/turnos-fijos').set('authorization', `Bearer ${recepTok()}`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Correr → falla**
```bash
npx vitest run tests/integration/require-role.test.ts
```
Expected: FAIL — hoy RECEPCIONISTA no recibe 403 en PATCH /config (no hay gate).

- [ ] **Step 3: Implementar el middleware**

Crear `src/middlewares/requireRole.ts`:
```ts
import type { Request, Response, NextFunction } from 'express';
import type { Rol } from '../types/domain.js';
import { Forbidden } from '../utils/errors.js';

export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const p = req.principal;
    if (!p || p.kind !== 'admin' || !roles.includes(p.rol)) return next(Forbidden('Requiere rol ' + roles.join('/')));
    next();
  };
}
```

- [ ] **Step 4: Aplicar el gate en las rutas de escritura admin-only**

Agregar `requireRole('ADMIN')` después de `authJwt` (antes de `validate`) en:
- `src/routes/cancha.routes.ts`: `POST /`, `POST /divisible`, `PATCH /:id`, `PATCH /:id/activa`, `DELETE /:id`. (Dejar los `GET` como están.)
- `src/routes/config.routes.ts`: `PATCH /` (el `GET` queda).
- `src/routes/turnoFijo.routes.ts`: `POST /`, `DELETE /:id`, `POST /:id/excepciones`, `DELETE /:id/excepciones/:fecha`. **Dejar `GET /` solo con `authJwt`** (recepcionista lo necesita para el calendario).
- `src/routes/bloqueo.routes.ts`: `POST /`, `DELETE /:id`. **Dejar `GET /` con `authJwt`.**
- `src/routes/analytics.routes.ts`: todas las rutas (el dashboard es admin-only). Verificar que sean `authJwt` y agregarles `requireRole('ADMIN')`.

Ejemplo (cancha POST):
```ts
import { requireRole } from '../middlewares/requireRole.js';
canchaRoutes.post('/', authJwt, requireRole('ADMIN'), validate(createCanchaSchema), async (req, res, next) => { ... });
```
NO tocar las rutas `authAny` (reservas, disponibilidad, GET canchas/config) — el bot las usa con x-api-key.

- [ ] **Step 5: Correr → pasa**
```bash
npx vitest run tests/integration/require-role.test.ts
```
Expected: PASS (3 casos).

- [ ] **Step 6: Commit**
```bash
git add src/middlewares/requireRole.ts src/routes/*.ts tests/integration/require-role.test.ts
git commit -m "feat(usuarios): requireRole(ADMIN) gate on write/admin routes"
```

---

### Task A4: CRUD `/usuarios` (TDD)

**Files:** Create `src/routes/usuario.routes.ts`, `src/services/usuario.service.ts`, `src/validators/usuario.schema.ts`; Modify `src/repositories/adminUser.repo.ts`, `src/routes/index.ts`; Test `tests/integration/usuarios.test.ts`

- [ ] **Step 1: Test que falla**

Crear `tests/integration/usuarios.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

async function seedDefaultAdmin() {
  const { hashPassword } = await import('../../src/utils/password.js');
  return getPrisma().adminUser.create({ data: { email: 'admin@canchitas.com', nombre: 'Admin', passwordHash: await hashPassword('x'), rol: 'ADMIN', esDefault: true } });
}
const tok = (id: string) => signAdminToken({ adminId: id, email: 'admin@canchitas.com', rol: 'ADMIN' });

describe('/usuarios (ADMIN)', () => {
  it('crea, lista (sin hash) y respeta email único', async () => {
    const admin = await seedDefaultAdmin();
    const c = await supertest(app).post('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`)
      .send({ email: 'recep@x.com', nombre: 'Recep', password: 'secreto', rol: 'RECEPCIONISTA' });
    expect(c.status).toBe(201);
    expect(c.body.rol).toBe('RECEPCIONISTA');
    expect(c.body.passwordHash).toBeUndefined();
    const dup = await supertest(app).post('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`)
      .send({ email: 'recep@x.com', nombre: 'Otro', password: 'secreto', rol: 'RECEPCIONISTA' });
    expect(dup.status).toBe(409);
    const list = await supertest(app).get('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);
    expect(list.body[0].passwordHash).toBeUndefined();
  });

  it('cambia rol pero NO el del default', async () => {
    const admin = await seedDefaultAdmin();
    const r = await getPrisma().adminUser.create({ data: { email: 'r@x.com', nombre: 'R', passwordHash: 'h', rol: 'RECEPCIONISTA' } });
    const ok = await supertest(app).patch(`/usuarios/${r.id}/rol`).set('authorization', `Bearer ${tok(admin.id)}`).send({ rol: 'ADMIN' });
    expect(ok.status).toBe(200);
    expect(ok.body.rol).toBe('ADMIN');
    const no = await supertest(app).patch(`/usuarios/${admin.id}/rol`).set('authorization', `Bearer ${tok(admin.id)}`).send({ rol: 'RECEPCIONISTA' });
    expect(no.status).toBe(403);
  });

  it('elimina otros, pero NO el default ni a sí mismo', async () => {
    const admin = await seedDefaultAdmin();
    const r = await getPrisma().adminUser.create({ data: { email: 'r2@x.com', nombre: 'R2', passwordHash: 'h', rol: 'RECEPCIONISTA' } });
    expect((await supertest(app).delete(`/usuarios/${admin.id}`).set('authorization', `Bearer ${tok(admin.id)}`)).status).toBe(403); // default + self
    expect((await supertest(app).delete(`/usuarios/${r.id}`).set('authorization', `Bearer ${tok(admin.id)}`)).status).toBe(200);
  });

  it('RECEPCIONISTA no puede usar /usuarios', async () => {
    const res = await supertest(app).get('/usuarios').set('authorization', `Bearer ${signAdminToken({ adminId: 'z', email: 'r@r.com', rol: 'RECEPCIONISTA' })}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Correr → falla**
```bash
npx vitest run tests/integration/usuarios.test.ts
```
Expected: FAIL — 404 (rutas no existen).

- [ ] **Step 3: Repo**

En `src/repositories/adminUser.repo.ts` agregar:
```ts
  list: () => prisma.adminUser.findMany({ orderBy: { creadoEn: 'asc' }, select: { id: true, email: true, nombre: true, rol: true, esDefault: true } }),
  create: (data: { email: string; nombre: string; passwordHash: string; rol: 'ADMIN' | 'RECEPCIONISTA' }) =>
    prisma.adminUser.create({ data, select: { id: true, email: true, nombre: true, rol: true, esDefault: true } }),
  updateRol: (id: string, rol: 'ADMIN' | 'RECEPCIONISTA') =>
    prisma.adminUser.update({ where: { id }, data: { rol }, select: { id: true, email: true, nombre: true, rol: true, esDefault: true } }),
  remove: (id: string) => prisma.adminUser.delete({ where: { id } }),
```

- [ ] **Step 4: Validadores**

Crear `src/validators/usuario.schema.ts`:
```ts
import { z } from 'zod';
const empty = z.looseObject({});
const rol = z.enum(['ADMIN', 'RECEPCIONISTA']);

export const crearUsuarioSchema = z.object({
  body: z.object({ email: z.string().email(), nombre: z.string().min(1), password: z.string().min(6), rol }),
  query: empty, params: empty,
});
export const cambiarRolSchema = z.object({
  body: z.object({ rol }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const idUsuarioParamSchema = z.object({
  body: z.unknown(), query: empty, params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 5: Service**

Crear `src/services/usuario.service.ts`:
```ts
import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { hashPassword } from '../utils/password.js';
import { Conflict, NotFound, Forbidden } from '../utils/errors.js';

export const usuarioService = {
  list: () => adminUserRepo.list(),
  crear: async (input: { email: string; nombre: string; password: string; rol: 'ADMIN' | 'RECEPCIONISTA' }) => {
    if (await adminUserRepo.findByEmail(input.email)) throw Conflict('Ya existe un usuario con ese email');
    return adminUserRepo.create({ email: input.email, nombre: input.nombre, passwordHash: await hashPassword(input.password), rol: input.rol });
  },
  cambiarRol: async (id: string, rol: 'ADMIN' | 'RECEPCIONISTA') => {
    const u = await adminUserRepo.findById(id);
    if (!u) throw NotFound('Usuario', id);
    if (u.esDefault) throw Forbidden('No se puede cambiar el rol del administrador por defecto');
    return adminUserRepo.updateRol(id, rol);
  },
  eliminar: async (id: string, currentAdminId: string) => {
    const u = await adminUserRepo.findById(id);
    if (!u) throw NotFound('Usuario', id);
    if (u.esDefault) throw Forbidden('No se puede eliminar el administrador por defecto');
    if (id === currentAdminId) throw Forbidden('No podés eliminar tu propio usuario');
    await adminUserRepo.remove(id);
    return { ok: true };
  },
};
```
NOTA: confirmá el nombre real de `hashPassword` en `src/utils/password.ts` y ajustá.

- [ ] **Step 6: Rutas + montaje**

Crear `src/routes/usuario.routes.ts`:
```ts
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { usuarioService } from '../services/usuario.service.js';
import { crearUsuarioSchema, cambiarRolSchema, idUsuarioParamSchema } from '../validators/usuario.schema.js';

export const usuarioRoutes = Router();
usuarioRoutes.use(authJwt, requireRole('ADMIN'));

usuarioRoutes.get('/', async (_req, res, next) => { try { res.json(await usuarioService.list()); } catch (e) { next(e); } });
usuarioRoutes.post('/', validate(crearUsuarioSchema), async (req, res, next) => { try { res.status(201).json(await usuarioService.crear((req as any).valid.body)); } catch (e) { next(e); } });
usuarioRoutes.patch('/:id/rol', validate(cambiarRolSchema), async (req, res, next) => { try { res.json(await usuarioService.cambiarRol(String(req.params.id), (req as any).valid.body.rol)); } catch (e) { next(e); } });
usuarioRoutes.delete('/:id', validate(idUsuarioParamSchema), async (req, res, next) => {
  try {
    const me = req.principal?.kind === 'admin' ? req.principal.adminId : '';
    res.json(await usuarioService.eliminar(String(req.params.id), me));
  } catch (e) { next(e); }
});
```
En `src/routes/index.ts`: `import { usuarioRoutes } from './usuario.routes.js';` y `apiRouter.use('/usuarios', usuarioRoutes);`.

- [ ] **Step 7: Correr → pasa**
```bash
npx vitest run tests/integration/usuarios.test.ts
```
Expected: PASS (4 describes).

- [ ] **Step 8: Commit**
```bash
git add src/routes/usuario.routes.ts src/services/usuario.service.ts src/validators/usuario.schema.ts src/repositories/adminUser.repo.ts src/routes/index.ts tests/integration/usuarios.test.ts
git commit -m "feat(usuarios): CRUD /usuarios (admin-only) with default/self protections"
```

---

### Task A5: Suite completa + commit
- [ ] **Step 1**
```bash
npx vitest run && npx tsc --noEmit
```
Expected: todo verde. OJO: tests existentes que arman tokens con `signAdminToken({adminId,email})` ahora requieren `rol` — el TS los marcará. Agregar `rol: 'ADMIN'` a esas llamadas en los tests afectados. Commit:
```bash
git add -A && git commit -m "test(usuarios): add rol to existing signAdminToken calls"
```
(Omitir si no hubo cambios.)

---

## Parte B — Frontend (rama `feat/roles-panel`)

### Task B0: Crear la rama
- [ ] **Step 1**
```bash
cd c:/Users/Lautaro/Desktop/ortigoza/frontend && git checkout master && git checkout -b feat/roles-panel
```

---

### Task B1: Sesión con rol + tipos

**Files:** Create `src/lib/session.ts`; Modify `src/lib/types.ts`, `src/app/(panel)/layout.tsx`, `src/lib/auth.ts`

- [ ] **Step 1: Tipos**

En `src/lib/types.ts`:
```ts
export type Rol = 'ADMIN' | 'RECEPCIONISTA';
```
Y `LoginResult.admin` suma `rol: Rol` (buscar la interface `LoginResult` y agregarlo).

- [ ] **Step 2: `getSession`**

Crear `src/lib/session.ts`:
```ts
import { apiFetch } from './api';
import type { Rol } from './types';

export interface Session { id: string; email: string; nombre: string; rol: Rol }

/** Lee la sesión actual desde el backend (GET /auth/me). Lanza ApiAuthError si no hay sesión. */
export async function getSession(): Promise<Session> {
  return apiFetch<Session>('/auth/me');
}
```

- [ ] **Step 3: Layout pasa rol**

En `src/app/(panel)/layout.tsx`, usar `getSession` y pasar `rol`:
```tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { ApiAuthError } from '@/lib/types';
import { AppShell } from '@/components/app-shell';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof ApiAuthError) redirect('/login');
    throw e;
  }
  return <AppShell email={session.email} rol={session.rol}>{children}</AppShell>;
}
```

- [ ] **Step 4: Login redirige según rol**

En `src/lib/auth.ts`, leer el rol de la respuesta y redirigir: cambiar el bloque que hace `token = data.token;` para guardar también el rol, y al final `redirect(data.admin.rol === 'ADMIN' ? '/dashboard' : '/reservas');`. Concretamente, después de `const data = (await res.json()) as LoginResult; token = data.token;` capturar `const destino = data.admin?.rol === 'ADMIN' ? '/dashboard' : '/reservas';` (declarar `let destino = '/dashboard';` antes del try) y reemplazar el `redirect('/dashboard')` final por `redirect(destino);`.

- [ ] **Step 5: tsc + commit**
```bash
pnpm exec tsc --noEmit
git add src/lib/session.ts src/lib/types.ts "src/app/(panel)/layout.tsx" src/lib/auth.ts
git commit -m "feat(usuarios): session with rol (/auth/me), role-based login redirect"
```

---

### Task B2: Nav gateado por rol

**Files:** `src/components/nav-items.ts`, `src/components/app-shell.tsx`, `src/components/mobile-nav.tsx`

- [ ] **Step 1: nav-items con roles**

En `src/components/nav-items.ts`, agregar `Users` al import de lucide, `roles` por item y el item Usuarios:
```ts
import { LayoutDashboard, CalendarDays, CalendarRange, LandPlot, CalendarClock, Ban, Settings, Users, type LucideIcon } from 'lucide-react';
import type { Rol } from '@/lib/types';

export interface NavItem { href: string; label: string; icon: LucideIcon; roles: Rol[] }

const AMBOS: Rol[] = ['ADMIN', 'RECEPCIONISTA'];
const SOLO_ADMIN: Rol[] = ['ADMIN'];

export const nav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: SOLO_ADMIN },
  { href: '/reservas', label: 'Reservas', icon: CalendarDays, roles: AMBOS },
  { href: '/calendario', label: 'Calendario', icon: CalendarRange, roles: AMBOS },
  { href: '/canchas', label: 'Canchas', icon: LandPlot, roles: SOLO_ADMIN },
  { href: '/turnos-fijos', label: 'Turnos fijos', icon: CalendarClock, roles: SOLO_ADMIN },
  { href: '/bloqueos', label: 'Bloqueos', icon: Ban, roles: SOLO_ADMIN },
  { href: '/configuracion', label: 'Configuración', icon: Settings, roles: SOLO_ADMIN },
  { href: '/usuarios', label: 'Usuarios', icon: Users, roles: SOLO_ADMIN },
];
```

- [ ] **Step 2: AppShell filtra por rol**

En `src/components/app-shell.tsx`: la firma pasa a `({ email, rol, children }: { email: string; rol: Rol; children: React.ReactNode })` (importar `type Rol` de `@/lib/types`), y el `.map` del sidebar filtra: `{nav.filter((n) => n.roles.includes(rol)).map(...)}`. Pasar `rol` a `<MobileNav rol={rol} />`.

- [ ] **Step 3: MobileNav filtra por rol**

En `src/components/mobile-nav.tsx`: la firma pasa a `export function MobileNav({ rol }: { rol: Rol })` (importar `type Rol`), y el `.map` del drawer filtra `nav.filter((n) => n.roles.includes(rol))`.

- [ ] **Step 4: tsc + build + commit**
```bash
pnpm exec tsc --noEmit && pnpm build
git add src/components/nav-items.ts src/components/app-shell.tsx src/components/mobile-nav.tsx
git commit -m "feat(usuarios): role-gated navigation"
```

---

### Task B3: Guard de páginas admin-only

**Files:** Create `src/lib/require-admin.ts`; Modify las páginas admin-only

- [ ] **Step 1: Helper**

Crear `src/lib/require-admin.ts`:
```ts
import { redirect } from 'next/navigation';
import { getSession } from './session';
import { ApiAuthError } from './types';

/** Server guard: exige ADMIN. Recepcionista → /reservas; sin sesión → /login. */
export async function requireAdmin(): Promise<void> {
  try {
    const s = await getSession();
    if (s.rol !== 'ADMIN') redirect('/reservas');
  } catch (e) {
    if (e instanceof ApiAuthError) redirect('/login');
    throw e;
  }
}
```
NOTA: `redirect()` lanza internamente; no lo envuelvas en try/catch que trague su error — el patrón de arriba relanza todo lo que no sea `ApiAuthError`, y `redirect` se propaga bien porque su excepción no es `ApiAuthError`.

- [ ] **Step 2: Aplicar el guard**

Al inicio del componente de cada page admin-only, agregar `await requireAdmin();` como primera línea del `export default async function ...Page(...)`:
- `src/app/(panel)/dashboard/page.tsx`
- `src/app/(panel)/canchas/page.tsx`
- `src/app/(panel)/configuracion/page.tsx`
- `src/app/(panel)/turnos-fijos/page.tsx`
- `src/app/(panel)/bloqueos/page.tsx`
(La de `/usuarios` se crea ya con el guard en B4.) Import: `import { requireAdmin } from '@/lib/require-admin';`.

- [ ] **Step 3: tsc + build + commit**
```bash
pnpm exec tsc --noEmit && pnpm build
git add src/lib/require-admin.ts "src/app/(panel)/dashboard/page.tsx" "src/app/(panel)/canchas/page.tsx" "src/app/(panel)/configuracion/page.tsx" "src/app/(panel)/turnos-fijos/page.tsx" "src/app/(panel)/bloqueos/page.tsx"
git commit -m "feat(usuarios): requireAdmin guard on admin-only pages"
```

---

### Task B4: Pantalla `/usuarios`

**Files:** Create `src/app/(panel)/usuarios/page.tsx`, `src/components/usuarios/usuarios-table.tsx`, `src/components/usuarios/usuario-dialog.tsx`, `src/lib/usuarios-actions.ts`; Modify `src/lib/types.ts`, `src/lib/validators.ts`

- [ ] **Step 1: Tipo + schema**

En `src/lib/types.ts`:
```ts
export interface Usuario { id: string; email: string; nombre: string; rol: Rol; esDefault: boolean }
```
En `src/lib/validators.ts`:
```ts
export const usuarioSchema = z.object({
  email: z.string().email('Email inválido'),
  nombre: z.string().min(1, 'Ingresá el nombre'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  rol: z.enum(['ADMIN', 'RECEPCIONISTA']),
});
```

- [ ] **Step 2: Server actions**

Crear `src/lib/usuarios-actions.ts`:
```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { Rol } from './types';

type Result = { ok: true } | { ok: false; error: string };
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/usuarios'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function crearUsuario(input: { email: string; nombre: string; password: string; rol: Rol }): Promise<Result> {
  return run(() => apiFetch('/usuarios', { method: 'POST', body: JSON.stringify(input) }));
}
export async function cambiarRolUsuario(id: string, rol: Rol): Promise<Result> {
  return run(() => apiFetch(`/usuarios/${id}/rol`, { method: 'PATCH', body: JSON.stringify({ rol }) }));
}
export async function eliminarUsuario(id: string): Promise<Result> {
  return run(() => apiFetch(`/usuarios/${id}`, { method: 'DELETE' }));
}
```

- [ ] **Step 3: Dialog crear usuario**

Crear `src/components/usuarios/usuario-dialog.tsx` (client) siguiendo el patrón de `cancha-dialog.tsx`: campos email, nombre, password (type=password), select rol (ADMIN/RECEPCIONISTA); valida con `usuarioSchema`; en submit llama `crearUsuario` (useTransition + toast); cierra al ok. Trigger: un `<Button>` "Nuevo usuario" (el dialog maneja su propio `open` o recibe open/onOpenChange — seguir el patrón existente más simple del repo).

```tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usuarioSchema } from '@/lib/validators';
import { crearUsuario } from '@/lib/usuarios-actions';

export function UsuarioDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<'ADMIN' | 'RECEPCIONISTA'>('RECEPCIONISTA');
  const [pending, start] = useTransition();

  function submit() {
    const parsed = usuarioSchema.safeParse({ email, nombre, password, rol });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = await crearUsuario(parsed.data);
      if (r.ok) { toast.success('Usuario creado'); setOpen(false); setEmail(''); setNombre(''); setPassword(''); setRol('RECEPCIONISTA'); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Nuevo usuario</Button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo usuario</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="u-email">Email</Label><Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="u-nombre">Nombre</Label><Input id="u-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="u-pass">Contraseña</Label><Input id="u-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mín. 6 caracteres" /></div>
          <div className="space-y-1"><Label htmlFor="u-rol">Rol</Label>
            <select id="u-rol" value={rol} onChange={(e) => setRol(e.target.value as 'ADMIN' | 'RECEPCIONISTA')} className="w-full rounded-md border px-2 py-1.5">
              <option value="RECEPCIONISTA">Recepcionista</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : 'Crear usuario'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Tabla de usuarios (responsive)**

Crear `src/components/usuarios/usuarios-table.tsx` (client) que reciba `usuarios: Usuario[]` y `currentEmail: string`. Muestra tabla `hidden md:block` + cards `md:hidden` (mismo patrón que las otras tablas). Por fila: email, nombre, badge rol (+ badge "default" si `esDefault`). Acciones (DropdownMenu): "Hacer admin/recepcionista" (PATCH rol; oculto si `esDefault`) y "Eliminar" (oculto si `esDefault` o si `u.email === currentEmail`), con `confirm()`. Usa `cambiarRolUsuario`/`eliminarUsuario` con `useTransition`+toast (patrón de `canchas-table.tsx`). El botón "Nuevo usuario" se renderiza arriba (puede vivir en la page o en la tabla; ubicarlo en el header de la tabla como en canchas).

Por simplicidad: usar `currentEmail` para identificar "uno mismo" (la lista no trae el adminId actual; comparar por email contra la sesión).

- [ ] **Step 5: Page (con guard)**

Crear `src/app/(panel)/usuarios/page.tsx`:
```tsx
import { requireAdmin } from '@/lib/require-admin';
import { getSession } from '@/lib/session';
import { apiFetch } from '@/lib/api';
import type { Usuario } from '@/lib/types';
import { UsuariosTable } from '@/components/usuarios/usuarios-table';

export default async function UsuariosPage() {
  await requireAdmin();
  const [usuarios, session] = await Promise.all([
    apiFetch<Usuario[]>('/usuarios'),
    getSession(),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
        <p className="mt-1 text-sm text-neutral-500">Administrá quién puede entrar al panel y con qué rol.</p>
      </div>
      <UsuariosTable usuarios={usuarios} currentEmail={session.email} />
    </div>
  );
}
```

- [ ] **Step 6: tsc + build + commit**
```bash
pnpm exec tsc --noEmit && pnpm build
git add "src/app/(panel)/usuarios/page.tsx" src/components/usuarios/ src/lib/usuarios-actions.ts src/lib/types.ts src/lib/validators.ts
git commit -m "feat(usuarios): pantalla de gestión de usuarios (admin)"
```

---

### Task B5: Verificación completa
- [ ] **Step 1**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build
```
Expected: todo verde. Manual: como recepcionista el nav muestra solo Reservas+Calendario y `/configuracion` redirige a `/reservas`; como admin aparece Usuarios y se puede crear/eliminar (no el default ni uno mismo).

---

## Parte C — Cierre

### Task C1: Finalizar
- [ ] **Step 1: Backend** — finishing-a-development-branch en `feat/roles-backend`: tests verdes → merge `main` + push (verificar deploy; la migración corre con `migrate deploy`, y **el seed debe correrse** para marcar `esDefault` en el admin existente: `docker exec canchitas-backend node dist/seed.js`).
- [ ] **Step 2: Frontend** — finishing-a-development-branch en `feat/roles-panel`: merge `master` (local).

---

## Self-Review

**Spec coverage:** modelo rol+esDefault+migración+seed (A1) ✓; JWT/principal/auth.me con rol (A2) ✓; requireRole + gating de writes canchas/config/fijos/bloqueos/analytics, GET fijos/bloqueos abiertos (A3) ✓; CRUD /usuarios con protecciones default/self/email único (A4) ✓; tests requireRole/login-rol/CRUD/gating (A2-A4) ✓; frontend sesión-rol via /auth/me (B1) ✓; nav gateado (B2) ✓; requireAdmin en páginas (B3) ✓; pantalla /usuarios responsive + crear/cambiar-rol/eliminar (B4) ✓; usuarioSchema (B4) ✓; login redirect por rol (B1) ✓.

**Placeholder scan:** sin TBD. Las "NOTA: confirmá el nombre de hashPassword / del helper de auth en tests" remiten a verificar contra el repo real (no son placeholders de implementación).

**Type consistency:** `Rol='ADMIN'|'RECEPCIONISTA'` en backend (`domain.ts`) y frontend (`types.ts`); `AdminClaims`/principal con `rol`; `signAdminToken({adminId,email,rol})` consistente en código y tests; `Usuario {id,email,nombre,rol,esDefault}` usado en repo.list/service/tabla; `requireRole(...roles: Rol[])`; nav `NavItem.roles: Rol[]`; `getSession(): {id,email,nombre,rol}` = shape de `/auth/me`.

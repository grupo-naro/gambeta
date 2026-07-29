# Registro de actividad (auditoría) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar quién hizo qué cambio y cuándo (texto legible) y verlo en una pantalla del panel solo-admin.

**Architecture:** Se extiende `AuditLog` con `descripcion`. Un `auditService` escribe logs best-effort; se instrumentan los handlers de mutación (route-level) con una descripción legible (field-level en config). `GET /auditoria` (admin) lista lo último. El frontend agrega `/actividad`.

**Tech Stack:** Backend Node+Express 5+TS, Prisma 7 (`../db/client.js`), Zod 4, Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 + React 19 + Tailwind 4 + Base UI + pnpm.

**Ramas:** backend `feat/auditoria-backend`, frontend `feat/auditoria-panel`. Sin bot.

**Verificado:** `AuditLog {adminId?, admin rel, accion, entidad, entidadId?, payload Json?, creadoEn}` (índices entidad/creadoEn). `auditLogRepo.record(data,tx?)`. `req.principal={kind:'admin',adminId,email,rol}|{kind:'service'}`. `requireRole('ADMIN')`. `PATCH /config` ya está gateado admin. Reserva-actions ya loguean en el service con `by.adminId`.

---

## Parte A — Backend (rama `feat/auditoria-backend`)

### Task A0: Rama
- [ ] **Step 1**
```bash
cd c:/Users/Lautaro/Desktop/ortigoza/backend && git checkout main && git pull && git checkout -b feat/auditoria-backend
```

---

### Task A1: `descripcion` en AuditLog + migración
**Files:** `prisma/schema.prisma`, migración

- [ ] **Step 1: Schema** — en `model AuditLog`, agregar debajo de `payload`:
```prisma
  payload   Json?
  descripcion String   @default("")
```
- [ ] **Step 2: Migración**
```bash
npx prisma migrate dev --name add_auditlog_descripcion
```
Expected: `ALTER TABLE "AuditLog" ADD COLUMN "descripcion" TEXT NOT NULL DEFAULT ''`.
- [ ] **Step 3: tsc + commit**
```bash
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations && git commit -m "feat(auditoria): add descripcion to AuditLog"
```

---

### Task A2: `auditService` + `auditLogRepo.list` (TDD)
**Files:** Create `src/services/audit.service.ts`; Modify `src/repositories/auditLog.repo.ts`; Test `tests/integration/auditoria.test.ts`

- [ ] **Step 1: Test que falla**

Crear `tests/integration/auditoria.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

async function admin() {
  const u = await getPrisma().adminUser.create({ data: { email: 'a@a.com', nombre: 'Ana Admin', passwordHash: await hashPassword('x'), rol: 'ADMIN', esDefault: true } });
  return { u, tok: signAdminToken({ adminId: u.id, email: u.email, rol: 'ADMIN' }) };
}

describe('auditoría', () => {
  it('PATCH /config (cambia alias) crea un log con descripción que menciona alias y NO el valor', async () => {
    const { u, tok } = await admin();
    await getPrisma().configuracion.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${tok}`).send({ alias: 'mi.alias.secreto' });
    expect(res.status).toBe(200);
    const logs = await getPrisma().auditLog.findMany({ where: { entidad: 'Config' } });
    expect(logs.length).toBe(1);
    expect(logs[0].descripcion.toLowerCase()).toContain('alias');
    expect(logs[0].descripcion).not.toContain('mi.alias.secreto');
    expect(logs[0].adminId).toBe(u.id);
  });

  it('GET /auditoria: RECEPCIONISTA → 403; ADMIN → newest-first con usuario; filtra por entidad', async () => {
    const { u, tok } = await admin();
    await getPrisma().auditLog.create({ data: { adminId: u.id, accion: 'CREAR', entidad: 'Cancha', descripcion: 'Creó la cancha A' } });
    await getPrisma().auditLog.create({ data: { adminId: null, accion: 'LOGIN', entidad: 'Auth', descripcion: 'Inició sesión' } });

    const recep = signAdminToken({ adminId: 'z', email: 'r@r.com', rol: 'RECEPCIONISTA' });
    expect((await supertest(app).get('/auditoria').set('authorization', `Bearer ${recep}`)).status).toBe(403);

    const res = await supertest(app).get('/auditoria').set('authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].creadoEn >= res.body[1].creadoEn).toBe(true); // newest-first
    const cancha = res.body.find((l: any) => l.entidad === 'Cancha');
    expect(cancha.usuario).toBe('Ana Admin');
    const auth = res.body.find((l: any) => l.entidad === 'Auth');
    expect(auth.usuario).toBe('Sistema'); // adminId null

    const filt = await supertest(app).get('/auditoria?entidad=Cancha').set('authorization', `Bearer ${tok}`);
    expect(filt.body.every((l: any) => l.entidad === 'Cancha')).toBe(true);
  });
});
```
NOTA: confirmá nombres reales de helpers (`hashPassword`, `getPrisma`/`resetTables`) y el id singleton de Configuracion (`'default'`).

- [ ] **Step 2: Correr → falla**
```bash
npx vitest run tests/integration/auditoria.test.ts
```
Expected: FAIL (no hay logging en config ni ruta /auditoria).

- [ ] **Step 3: repo.list**

En `src/repositories/auditLog.repo.ts` agregar:
```ts
  list: (opts: { entidad?: string; limit?: number }) =>
    prisma.auditLog.findMany({
      where: opts.entidad ? { entidad: opts.entidad } : {},
      orderBy: { creadoEn: 'desc' },
      take: opts.limit ?? 200,
      include: { admin: { select: { nombre: true } } },
    }),
```

- [ ] **Step 4: audit.service**

Crear `src/services/audit.service.ts`:
```ts
import type { Request } from 'express';
import { auditLogRepo } from '../repositories/auditLog.repo.js';

interface LogInput { accion: string; entidad: string; entidadId?: string | null; descripcion: string; payload?: unknown }

function adminIdOf(req: Request): string | null {
  return req.principal?.kind === 'admin' ? req.principal.adminId : null;
}

export const auditService = {
  /** Best-effort: nunca rompe la operación principal. */
  async record(adminId: string | null, input: LogInput): Promise<void> {
    try {
      await auditLogRepo.record({
        adminId, accion: input.accion, entidad: input.entidad,
        entidadId: input.entidadId ?? null, descripcion: input.descripcion,
        payload: (input.payload ?? undefined) as never,
      });
    } catch { /* no-op */ }
  },
  log(req: Request, input: LogInput): Promise<void> {
    return auditService.record(adminIdOf(req), input);
  },
  async list(opts: { entidad?: string; limit?: number }) {
    const rows = await auditLogRepo.list(opts);
    return rows.map((r) => ({
      id: r.id, creadoEn: r.creadoEn, usuario: r.admin?.nombre ?? 'Sistema',
      accion: r.accion, entidad: r.entidad, descripcion: r.descripcion,
    }));
  },
};
```

- [ ] **Step 5: Instrumentar `PATCH /config` (field-level)**

En `src/routes/config.routes.ts`: importar `auditService` y un mapa de labels; reemplazar el handler PATCH:
```ts
import { auditService } from '../services/audit.service.js';

const CAMPO_LABEL: Record<string, string> = {
  alias: 'el alias', cbu: 'el CBU', titular: 'el titular',
  horaApertura: 'el horario de apertura', horaCierre: 'el horario de cierre',
  adminWhatsapp: 'el WhatsApp del administrador',
  senaModo: 'el modo de seña', senaPorcentaje: 'el porcentaje de seña', senaMontoFijo: 'el monto de seña',
  picoDesde: 'la franja pico (semana)', picoHasta: 'la franja pico (semana)',
  picoFindeDesde: 'la franja pico (finde)', picoFindeHasta: 'la franja pico (finde)',
};

configRoutes.patch('/', authJwt, requireRole('ADMIN'), validate(updateConfigSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body as Record<string, unknown>;
    const before = await configService.get() as Record<string, unknown>;
    const updated = await configService.update(body);
    const cambiados = Object.keys(body).filter((k) => String(before[k]) !== String(body[k]));
    const labels = [...new Set(cambiados.map((k) => CAMPO_LABEL[k] ?? k))];
    const descripcion = labels.length ? ('Cambió ' + labels.join(', ')) : 'Actualizó la configuración';
    await auditService.log(req, { accion: 'ACTUALIZAR', entidad: 'Config', descripcion });
    res.json(updated);
  } catch (e) { next(e); }
});
```
(No se loguean valores — solo nombres de campos.)

- [ ] **Step 6: Endpoint `GET /auditoria` + montaje**

Crear `src/routes/auditoria.routes.ts`:
```ts
import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { auditService } from '../services/audit.service.js';

export const auditoriaRoutes = Router();
auditoriaRoutes.get('/', authJwt, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const entidad = typeof req.query.entidad === 'string' ? req.query.entidad : undefined;
    res.json(await auditService.list({ entidad, limit: 200 }));
  } catch (e) { next(e); }
});
```
En `src/routes/index.ts`: `import { auditoriaRoutes } from './auditoria.routes.js';` y `apiRouter.use('/auditoria', auditoriaRoutes);`.

- [ ] **Step 7: Correr → pasa**
```bash
npx vitest run tests/integration/auditoria.test.ts
```
Expected: PASS (2 describes).

- [ ] **Step 8: Commit**
```bash
git add src/services/audit.service.ts src/repositories/auditLog.repo.ts src/routes/config.routes.ts src/routes/auditoria.routes.ts src/routes/index.ts tests/integration/auditoria.test.ts
git commit -m "feat(auditoria): audit service, /auditoria endpoint, config field-level logging"
```

---

### Task A3: Instrumentar el resto de las mutaciones

**Files:** `src/routes/cancha.routes.ts`, `src/routes/usuario.routes.ts`, `src/routes/turnoFijo.routes.ts`, `src/routes/bloqueo.routes.ts`, `src/routes/reserva.routes.ts`, `src/routes/auth.routes.ts`, `src/services/reserva.service.ts`

Patrón general: importar `auditService` y, tras la mutación exitosa (con el objeto resultado a mano), agregar `await auditService.log(req, { accion, entidad, entidadId, descripcion });` antes de `res.json(...)`. Ejemplos concretos por handler:

- [ ] **Step 1: Canchas** (`cancha.routes.ts`, importar `auditService`)
  - POST `/`: `const c = await canchaService.create(body); await auditService.log(req,{accion:'CREAR',entidad:'Cancha',entidadId:c.id,descripcion:'Creó la cancha «'+c.nombre+'»'}); res.status(201).json(c);`
  - POST `/divisible`: `const r = await canchaService.crearDivisible(body); await auditService.log(req,{accion:'CREAR',entidad:'Cancha',descripcion:'Creó la cancha divisible «'+body.nombre+'»'}); res.status(201).json(r);`
  - PATCH `/:id`: `const c = await canchaService.update(id, body); await auditService.log(req,{accion:'EDITAR',entidad:'Cancha',entidadId:c.id,descripcion:'Editó la cancha «'+c.nombre+'»'}); res.json(c);`
  - PATCH `/:id/activa`: `const c = await canchaService.setActiva(id, activa); await auditService.log(req,{accion:'EDITAR',entidad:'Cancha',entidadId:c.id,descripcion:(activa?'Activó':'Desactivó')+' la cancha «'+c.nombre+'»'}); res.json(c);`
  - DELETE `/:id`: obtener el nombre antes (`const c = await canchaService.get(id);`) luego `await canchaService.eliminar(id); await auditService.log(req,{accion:'ELIMINAR',entidad:'Cancha',entidadId:id,descripcion:'Eliminó la cancha «'+c.nombre+'»'}); res.json({ok:true});`

- [ ] **Step 2: Usuarios** (`usuario.routes.ts`)
  - POST `/`: `const u = await usuarioService.crear(body); await auditService.log(req,{accion:'CREAR',entidad:'Usuario',entidadId:u.id,descripcion:'Creó el usuario '+u.email+' ('+u.rol+')'}); res.status(201).json(u);`
  - PATCH `/:id/rol`: `const u = await usuarioService.cambiarRol(id, rol, me); await auditService.log(req,{accion:'EDITAR',entidad:'Usuario',entidadId:u.id,descripcion:'Cambió el rol de '+u.email+' a '+u.rol}); res.json(u);`
  - DELETE `/:id`: necesita el email para la descripción → en el service `eliminar` ya hace `findById`; para tener el email en la ruta, hacer `const u = await usuarioService.get?` — como no existe `get`, obtenerlo vía `adminUserRepo.findById(id)` antes; o registrar con el id. Para mantenerlo simple: `const victim = await import('../repositories/adminUser.repo.js').then(m=>m.adminUserRepo.findById(id)); await usuarioService.eliminar(id, me); await auditService.log(req,{accion:'ELIMINAR',entidad:'Usuario',entidadId:id,descripcion:'Eliminó el usuario '+(victim?.email ?? id)}); res.json({ok:true});` (import normal arriba del archivo, no dinámico).

- [ ] **Step 3: Turnos fijos** (`turnoFijo.routes.ts`)
  - POST `/`: `const f = await turnoFijoService.crear(body); await auditService.log(req,{accion:'CREAR',entidad:'TurnoFijo',entidadId:f.id,descripcion:'Creó turno fijo de '+body.clienteNombre}); res.status(201).json(f);`
  - DELETE `/:id`: `await turnoFijoService.eliminar(id); await auditService.log(req,{accion:'ELIMINAR',entidad:'TurnoFijo',entidadId:id,descripcion:'Eliminó un turno fijo'}); res.json(...)`
  - POST `/:id/excepciones`: `await auditService.log(req,{accion:'EDITAR',entidad:'TurnoFijo',entidadId:id,descripcion:'Liberó la fecha '+body.fecha+' de un turno fijo'});`
  - DELETE `/:id/excepciones/:fecha`: `await auditService.log(req,{accion:'EDITAR',entidad:'TurnoFijo',entidadId:id,descripcion:'Reactivó la fecha '+req.params.fecha+' de un turno fijo'});`

- [ ] **Step 4: Bloqueos** (`bloqueo.routes.ts`)
  - POST `/`: `const b = await bloqueoService.crear(body); await auditService.log(req,{accion:'CREAR',entidad:'Bloqueo',entidadId:b.id,descripcion:'Creó un bloqueo ('+body.motivo+')'}); res.status(201).json(b);`
  - DELETE `/:id`: `await bloqueoService.eliminar(id); await auditService.log(req,{accion:'ELIMINAR',entidad:'Bloqueo',entidadId:id,descripcion:'Eliminó un bloqueo'}); res.json(...)`

- [ ] **Step 5: Reservas — crear** (`reserva.routes.ts`, POST `/`)
```ts
const r = await reservaService.crear((req as any).valid.body);
await auditService.log(req, { accion: 'CREAR', entidad: 'Reserva', entidadId: r.id, descripcion: 'Creó una reserva' });
res.status(201).json(r);
```
(POST /reservas es `authAny`: si lo crea el bot con x-api-key, `adminId` queda null → "Sistema". Correcto.)

- [ ] **Step 6: Reserva-actions — agregar `descripcion`** (`reserva.service.ts`)

En las 4 llamadas existentes a `auditLogRepo.record({ adminId..., accion, entidad:'Reserva', entidadId })`, agregar `descripcion`:
  - APROBAR_SENA → `descripcion: 'Aprobó la seña de una reserva'`
  - RECHAZAR_SENA → `descripcion: 'Rechazó la seña de una reserva'`
  - CANCELAR_RESERVA → `descripcion: 'Canceló una reserva'`
  - REPROGRAMAR_RESERVA → `descripcion: 'Reprogramó una reserva'`

- [ ] **Step 7: Login** (`auth.routes.ts`, POST `/login`)

Tras `const result = await login(email, password);` (que devuelve `{ token, admin }`), registrar con el id del admin que entró:
```ts
import { auditService } from '../services/audit.service.js';
// ...
const result = await login(email, password);
await auditService.record(result.admin.id, { accion: 'LOGIN', entidad: 'Auth', descripcion: 'Inició sesión' });
res.json(result);
```

- [ ] **Step 8: Suite completa + commit**
```bash
npx vitest run && npx tsc --noEmit
```
Expected: verde. Si algún test de esos services/rutas se rompe por el nuevo log, revisar (no debería: `auditService.log` es best-effort). Commit:
```bash
git add src/routes/*.ts src/services/reserva.service.ts && git commit -m "feat(auditoria): log canchas/usuarios/fijos/bloqueos/reservas/login"
```

---

## Parte B — Frontend (rama `feat/auditoria-panel`)

### Task B0: Rama
- [ ] **Step 1**
```bash
cd c:/Users/Lautaro/Desktop/ortigoza/frontend && git checkout master && git checkout -b feat/auditoria-panel
```

---

### Task B1: Tipo + nav item
**Files:** `src/lib/types.ts`, `src/components/nav-items.ts`

- [ ] **Step 1: Tipo** — en `src/lib/types.ts`:
```ts
export interface LogActividad { id: string; creadoEn: string; usuario: string; accion: string; entidad: string; descripcion: string }
```
- [ ] **Step 2: Nav** — en `src/components/nav-items.ts`, importar `Activity` de lucide y agregar (rol ADMIN), debajo de Usuarios:
```ts
  { href: '/actividad', label: 'Actividad', icon: Activity, roles: SOLO_ADMIN },
```
(Agregar `Activity` al import de `lucide-react`.)
- [ ] **Step 3: build + commit**
```bash
pnpm exec tsc --noEmit && pnpm build
git add src/lib/types.ts src/components/nav-items.ts && git commit -m "feat(actividad): tipo LogActividad + nav item"
```

---

### Task B2: Pantalla `/actividad`
**Files:** Create `src/app/(panel)/actividad/page.tsx`, `src/components/actividad/actividad-list.tsx`

- [ ] **Step 1: Lista (client)** — crear `src/components/actividad/actividad-list.tsx`:
```tsx
'use client';
import { Badge } from '@/components/ui/badge';
import type { LogActividad } from '@/lib/types';

const ACCION_LABEL: Record<string, string> = {
  APROBAR_SENA: 'Aprobó una seña', RECHAZAR_SENA: 'Rechazó una seña',
  CANCELAR_RESERVA: 'Canceló una reserva', REPROGRAMAR_RESERVA: 'Reprogramó una reserva',
  CREAR: 'Creó', EDITAR: 'Editó', ELIMINAR: 'Eliminó', ACTUALIZAR: 'Actualizó', LOGIN: 'Inició sesión',
};
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const texto = (l: LogActividad) => l.descripcion || ACCION_LABEL[l.accion] || l.accion;

export function ActividadList({ logs }: { logs: LogActividad[] }) {
  if (logs.length === 0) return <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-500">Sin actividad registrada.</p>;
  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-lg border bg-white md:block">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-neutral-500">
            <th className="p-3">Cuándo</th><th className="p-3">Usuario</th><th className="p-3">Actividad</th><th className="p-3">Sección</th>
          </tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="whitespace-nowrap p-3 text-neutral-500">{fmt(l.creadoEn)}</td>
                <td className="p-3 font-medium">{l.usuario}</td>
                <td className="p-3">{texto(l)}</td>
                <td className="p-3"><Badge variant="secondary">{l.entidad}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <div className="space-y-3 md:hidden">
        {logs.map((l) => (
          <div key={l.id} className="rounded-lg border bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{l.usuario}</span>
              <span className="text-xs text-neutral-400">{fmt(l.creadoEn)}</span>
            </div>
            <p className="mt-1 text-sm">{texto(l)}</p>
            <Badge variant="secondary" className="mt-2">{l.entidad}</Badge>
          </div>
        ))}
      </div>
    </>
  );
}
```
(Confirmá que `Badge` acepta `variant="secondary"` como en `canchas-table.tsx`.)

- [ ] **Step 2: Page (server, admin-only)** — crear `src/app/(panel)/actividad/page.tsx`:
```tsx
import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { LogActividad } from '@/lib/types';
import { ActividadList } from '@/components/actividad/actividad-list';

export default async function ActividadPage() {
  await requireAdmin();
  const logs = await apiFetch<LogActividad[]>('/auditoria');
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Actividad</h1>
        <p className="mt-1 text-sm text-neutral-500">Registro de cambios hechos en el panel.</p>
      </div>
      <ActividadList logs={logs} />
    </div>
  );
}
```

- [ ] **Step 3: build + commit**
```bash
pnpm exec tsc --noEmit && pnpm build
git add "src/app/(panel)/actividad/page.tsx" src/components/actividad/actividad-list.tsx && git commit -m "feat(actividad): pantalla de registro de actividad (admin)"
```

---

### Task B3: Verificación
- [ ] **Step 1**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build
```
Expected: todo verde. Manual: como admin, hacer un cambio (ej. alias en Configuración) y verlo en /actividad ("… Cambió el alias …"); como recepcionista, no aparece "Actividad" en el nav y `/actividad` redirige a /reservas.

---

## Parte C — Cierre
- [ ] **Step 1: Backend** — finishing-a-development-branch en `feat/auditoria-backend`: tests verdes → merge `main` + push (la migración corre con `migrate deploy` en el deploy).
- [ ] **Step 2: Frontend** — finishing-a-development-branch en `feat/auditoria-panel`: merge `master` (local).

---

## Self-Review

**Spec coverage:** `descripcion`+migración (A1) ✓; `auditService` best-effort + actor del principal + `list` con usuario/'Sistema' (A2) ✓; config field-level por nombre sin valores (A2 Step 5) ✓; instrumentación canchas/usuarios/fijos/bloqueos/reservas-crear/login + descripcion en reserva-actions (A3) ✓; `GET /auditoria` admin-only, newest-first, ?entidad (A2 Step 6) ✓; tests log/actor/config-alias/403/orden/filtro (A2) ✓; frontend tipo+nav (B1) + pantalla responsive con TZ AR y fallback de label (B2) ✓; retención total (no se purga) — no hay tarea de purga ✓.

**Placeholder scan:** sin TBD. Las "NOTA: confirmá nombre de helper/Badge variant" son verificaciones contra el código real.

**Type consistency:** `auditService.log(req, {accion,entidad,entidadId?,descripcion,payload?})` y `.record(adminId,input)` y `.list({entidad?,limit?})` consistentes entre A2 (definición) y A3 (uso). `auditLogRepo.list({entidad?,limit?})` con include admin{nombre}. Shape de salida `{id,creadoEn,usuario,accion,entidad,descripcion}` = `LogActividad` del frontend (B1). Entidades usadas: 'Config','Cancha','Usuario','TurnoFijo','Bloqueo','Reserva','Auth' (consistentes backend↔filtro).

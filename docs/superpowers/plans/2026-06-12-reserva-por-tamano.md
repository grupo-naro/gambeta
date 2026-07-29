# Reservar por tamaño de cancha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cliente reserve eligiendo el tamaño de cancha (fútbol 5/7/9/11); el sistema muestra las canchas libres de ese tamaño y el cliente elige una. El admin setea el tamaño de cada cancha desde el panel.

**Architecture:** Se agrega `jugadores Int` a `Cancha`. El backend expone `GET /disponibilidad/por-tamano?jugadores=N&fecha=YYYY-MM-DD` que reusa la disponibilidad por-cancha (que ya respeta sectores/fijos/bloqueos) y agrupa los slots libres por hora con las canchas libres a esa hora. El panel agrega el tamaño en crear/editar. El bot (n8n, fuera de este plan) clasifica el tamaño y consume el nuevo endpoint.

**Tech Stack:** Backend Node+Express 5+TS, Prisma 7 (cliente en `src/generated/prisma`, importado vía `../db/client.js`), PostgreSQL, Zod 4, Vitest+Supertest+Testcontainers (necesita Docker Desktop local). Frontend Next 16 + React 19 + Tailwind 4 + Base UI + pnpm, Vitest.

**Ramas:** backend `feat/tamano-backend` (repo `c:/Users/Lautaro/Desktop/ortigoza/backend`), frontend `feat/tamano-panel` (repo `c:/Users/Lautaro/Desktop/ortigoza/frontend`). El bot lo hace el usuario con n8n MCP (no en este plan).

**Tamaños válidos:** `{5, 7, 9, 11}`. Default `jugadores = 5` para las canchas existentes.

---

## Parte A — Backend (rama `feat/tamano-backend`)

### Task A0: Crear la rama

**Files:** ninguno (solo git).

- [ ] **Step 1: Crear y posicionarse en la rama de feature**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/backend`):
```bash
git checkout main && git pull && git checkout -b feat/tamano-backend
```
Expected: `Switched to a new branch 'feat/tamano-backend'`

---

### Task A1: Campo `jugadores` en el modelo `Cancha` + migración

**Files:**
- Modify: `backend/prisma/schema.prisma:62-79` (model Cancha)
- Create: `backend/prisma/migrations/<timestamp>_add_jugadores_cancha/migration.sql` (lo genera Prisma)

- [ ] **Step 1: Agregar el campo al schema**

En `backend/prisma/schema.prisma`, dentro de `model Cancha`, agregar la línea `jugadores` justo debajo de `tipo`:

```prisma
model Cancha {
  id          String              @id @default(cuid())
  nombre      String
  tipo        String
  jugadores   Int                 @default(5)
  precioHora  Decimal             @db.Decimal(10, 2)
  activa      Boolean             @default(true)
  creadoEn    DateTime            @default(now())
  grupoId     String?
  grupo       CanchaGrupo?        @relation(fields: [grupoId], references: [id])
  esEntera    Boolean             @default(false)
  sectores    CanchaSector[]
  reservas    Reserva[]
  horarios    HorarioDisponible[]
  turnosFijos TurnoFijo[]
  bloqueos    Bloqueo[]

  @@index([activa])
}
```

- [ ] **Step 2: Generar la migración (requiere Docker Desktop corriendo + DB local)**

Run:
```bash
npx prisma migrate dev --name add_jugadores_cancha
```
Expected: crea `prisma/migrations/<timestamp>_add_jugadores_cancha/migration.sql` con `ALTER TABLE "Cancha" ADD COLUMN "jugadores" INTEGER NOT NULL DEFAULT 5;` y regenera el cliente Prisma. Si Docker no está corriendo, arrancarlo antes (Testcontainers y migrate dev necesitan el daemon).

- [ ] **Step 3: Verificar que el cliente compila con el nuevo campo**

Run:
```bash
npx tsc --noEmit
```
Expected: sin errores (el tipo `Cancha` generado ahora incluye `jugadores: number`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(canchas): add jugadores field to Cancha with migration"
```

---

### Task A2: Validación `jugadores ∈ {5,7,9,11}` en los schemas de cancha

**Files:**
- Modify: `backend/src/validators/cancha.schema.ts`
- Test: `backend/tests/integration/cancha.routes.test.ts` (crear si no existe)

- [ ] **Step 1: Escribir el test que falla**

Si `backend/tests/integration/cancha.routes.test.ts` no existe, crearlo con este contenido; si existe, agregar el `describe` de jugadores. Contenido completo:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
let token: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  const admin = await import('../../src/services/auth.service.js');
  // crea un admin y obtiene JWT para los endpoints authJwt
  await getPrisma().adminUser.create({
    data: { email: 'a@a.com', nombre: 'A', passwordHash: await (await import('bcryptjs')).default.hash('x', 4) },
  });
  const login = await supertest(app).post('/auth/login').send({ email: 'a@a.com', password: 'x' });
  token = login.body.token;
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);

describe('POST /canchas — jugadores', () => {
  it('crea una cancha con jugadores=7', async () => {
    const res = await auth(supertest(app).post('/canchas'))
      .send({ nombre: 'C7', tipo: 'futbol7', precioHora: 1000, jugadores: 7 });
    expect(res.status).toBe(201);
    expect(res.body.jugadores).toBe(7);
  });

  it('rechaza jugadores=6 con 422', async () => {
    const res = await auth(supertest(app).post('/canchas'))
      .send({ nombre: 'C6', tipo: 'otro', precioHora: 1000, jugadores: 6 });
    expect(res.status).toBe(422);
  });
});
```

**Nota:** el `beforeEach(resetTables)` borra el adminUser creado en `beforeAll`. Reemplazar la creación del admin + login para que ocurra en un `beforeEach` ANTES de cada test, o asegurar que `resetTables` no borre `AdminUser`. Para mantenerlo simple, mover la creación de admin + login a un helper llamado dentro de cada `it`. Si el proyecto ya tiene un helper de auth en `tests/helpers/`, usarlo. Si no, inline así al principio de cada `it`:

```ts
async function adminToken() {
  await getPrisma().adminUser.create({
    data: { email: 'a@a.com', nombre: 'A', passwordHash: await (await import('bcryptjs')).default.hash('x', 4) },
  });
  const login = await supertest(app).post('/auth/login').send({ email: 'a@a.com', password: 'x' });
  return login.body.token as string;
}
```
y en cada `it`: `const token = await adminToken();` antes de usar `auth`. Quitar el `beforeAll` que crea admin/login y la variable `token` global; pasar el token explícito. Verificar el shape real de `/auth/login` (campo del JWT) leyendo `backend/src/routes/auth.routes.ts` antes de correr.

- [ ] **Step 2: Correr el test para verque falla**

Run:
```bash
npx vitest run tests/integration/cancha.routes.test.ts
```
Expected: FAIL — `jugadores=6` devuelve 201 en vez de 422 (el schema aún no valida).

- [ ] **Step 3: Agregar la validación al schema**

En `backend/src/validators/cancha.schema.ts`, definir un validador reusable y agregarlo a los tres schemas:

```ts
import { z } from 'zod';
const empty = z.looseObject({});

const jugadores = z.union([z.literal(5), z.literal(7), z.literal(9), z.literal(11)]);

export const crearDivisibleSchema = z.object({
  body: z.object({
    nombre: z.string().min(1),
    partes: z.number().int().min(2).max(6),
    precioEntera: z.number().positive(),
    precioParte: z.number().positive(),
    jugadoresEntera: jugadores,
    jugadoresParte: jugadores,
  }),
  query: empty, params: empty,
});

export const createCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1), tipo: z.string().min(1), precioHora: z.number().positive(), jugadores }),
  query: empty, params: empty,
});
export const updateCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1).optional(), tipo: z.string().min(1).optional(), precioHora: z.number().positive().optional(), jugadores: jugadores.optional() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const setActivaSchema = z.object({
  body: z.object({ activa: z.boolean() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const listCanchaSchema = z.object({
  body: z.unknown(), params: empty,
  query: z.looseObject({ activa: z.enum(['true', 'false']).optional() }),
});
export const idCanchaParamSchema = z.object({
  body: z.unknown(),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run:
```bash
npx vitest run tests/integration/cancha.routes.test.ts
```
Expected: PASS (las 2 aserciones). Si el create aún no propaga `jugadores` al INSERT, fallará la primera (`res.body.jugadores === 7`) → eso lo arregla Task A3; si A3 no se hizo aún, dejar el `it` de 422 pasando y el de 201 se completa tras A3.

- [ ] **Step 5: Commit**

```bash
git add src/validators/cancha.schema.ts tests/integration/cancha.routes.test.ts
git commit -m "feat(canchas): validate jugadores in {5,7,9,11} on create/update/divisible"
```

---

### Task A3: `cancha.service` persiste `jugadores` (create/update/divisible)

**Files:**
- Modify: `backend/src/services/cancha.service.ts:13-40`

- [ ] **Step 1: Verificar que el test de A2 (`crea una cancha con jugadores=7`) sigue fallando si el service no propaga**

Run:
```bash
npx vitest run tests/integration/cancha.routes.test.ts -t "jugadores=7"
```
Expected: FAIL si el service aún no incluye `jugadores` en el `create` (el INSERT usa el default 5).

- [ ] **Step 2: Propagar `jugadores` en `create`, `update` y `crearDivisible`**

En `backend/src/services/cancha.service.ts`, reemplazar `create`, `update` y `crearDivisible`:

```ts
  create: async (input: { nombre: string; tipo: string; precioHora: number; jugadores: number }) =>
    prisma.$transaction(async (tx) => {
      const cancha = await tx.cancha.create({ data: input });
      const sector = await tx.sector.create({ data: { nombre: cancha.nombre } });
      await tx.canchaSector.create({ data: { canchaId: cancha.id, sectorId: sector.id } });
      return cancha;
    }),
  update: async (id: string, input: Partial<{ nombre: string; tipo: string; precioHora: number; jugadores: number }>) => {
    await canchaService.get(id);
    return canchaRepo.update(id, input);
  },
```

Y en `crearDivisible`, aceptar `jugadoresEntera`/`jugadoresParte` y pasarlos a cada `cancha.create`:

```ts
  crearDivisible: ({ nombre, partes, precioEntera, precioParte, jugadoresEntera, jugadoresParte }: { nombre: string; partes: number; precioEntera: number; precioParte: number; jugadoresEntera: number; jugadoresParte: number }) =>
    prisma.$transaction(async (tx) => {
      const grupo = await tx.canchaGrupo.create({ data: { nombre } });
      const sectores = [];
      for (let i = 1; i <= partes; i++) sectores.push(await tx.sector.create({ data: { nombre: `${nombre} - ${i}` } }));
      const entera = await tx.cancha.create({ data: { nombre, tipo: 'futbol', precioHora: precioEntera, jugadores: jugadoresEntera, grupoId: grupo.id, esEntera: true } });
      await tx.canchaSector.createMany({ data: sectores.map((s) => ({ canchaId: entera.id, sectorId: s.id })) });
      for (let i = 0; i < partes; i++) {
        const parte = await tx.cancha.create({ data: { nombre: `${nombre} - ${i + 1}`, tipo: 'futbol', precioHora: precioParte, jugadores: jugadoresParte, grupoId: grupo.id, esEntera: false } });
        await tx.canchaSector.create({ data: { canchaId: parte.id, sectorId: sectores[i].id } });
      }
      return tx.cancha.findMany({ where: { grupoId: grupo.id }, orderBy: { esEntera: 'desc' } });
    }),
```

- [ ] **Step 3: Correr el test completo de canchas**

Run:
```bash
npx vitest run tests/integration/cancha.routes.test.ts
```
Expected: PASS (incluye `jugadores=7` devolviendo 201 con `jugadores:7`).

- [ ] **Step 4: Commit**

```bash
git add src/services/cancha.service.ts
git commit -m "feat(canchas): persist jugadores on create/update/divisible"
```

---

### Task A4: `disponibilidadService.listarPorTamano`

**Files:**
- Modify: `backend/src/services/disponibilidad.service.ts`
- Test: `backend/tests/integration/disponibilidad-tamano.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/disponibilidad-tamano.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { configService } from '../../src/services/config.service.js';

let app: any;
let cA: string; let cB: string;
let sectorB: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTables();
  // Dos canchas de 5; una de 11 (no debe aparecer al pedir 5)
  const a = await getPrisma().cancha.create({ data: { nombre: 'A5', tipo: 'f5', precioHora: 1000, jugadores: 5 } });
  const b = await getPrisma().cancha.create({ data: { nombre: 'B5', tipo: 'f5', precioHora: 1000, jugadores: 5 } });
  await getPrisma().cancha.create({ data: { nombre: 'C11', tipo: 'f11', precioHora: 2000, jugadores: 11 } });
  cA = a.id; cB = b.id;
  for (const id of [cA, cB]) {
    const s = await getPrisma().sector.create({ data: { nombre: 's' + id } });
    if (id === cB) sectorB = s.id;
    await getPrisma().canchaSector.create({ data: { canchaId: id, sectorId: s.id } });
  }
  await configService.get();
  await configService.update({ horaApertura: '18:00', horaCierre: '21:00' }); // 3 slots
});

describe('GET /disponibilidad/por-tamano', () => {
  it('agrupa por hora las canchas libres del tamaño pedido', async () => {
    const res = await supertest(app).get('/disponibilidad/por-tamano?jugadores=5&fecha=2026-06-12').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.jugadores).toBe(5);
    expect(res.body.slots).toHaveLength(3);
    // a las 18:00 ambas canchas de 5 están libres; la de 11 nunca aparece
    expect(res.body.slots[0].canchas.map((c: any) => c.nombre).sort()).toEqual(['A5', 'B5']);
  });

  it('una hora ocupada en una cancha deja solo la otra; ninguna libre => no aparece la hora', async () => {
    const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    // Ocupar B5 a las 18:00 ART (=21:00 UTC) — queda solo A5 a esa hora
    const r = await getPrisma().reserva.create({
      data: { canchaId: cB, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto: 1000,
        fechaInicio: new Date('2026-06-12T21:00:00.000Z'), fechaFin: new Date('2026-06-12T22:00:00.000Z') },
    });
    await getPrisma().reservaSector.create({
      data: { reservaId: r.id, sectorId: sectorB, estado: 'CONFIRMADA',
        fechaInicio: new Date('2026-06-12T21:00:00.000Z'), fechaFin: new Date('2026-06-12T22:00:00.000Z') },
    });
    const res = await supertest(app).get('/disponibilidad/por-tamano?jugadores=5&fecha=2026-06-12').set('x-api-key', 'svc');
    const s18 = res.body.slots.find((s: any) => s.horaInicio === '18:00');
    expect(s18.canchas.map((c: any) => c.nombre)).toEqual(['A5']);
    // las otras horas siguen con ambas
    const s19 = res.body.slots.find((s: any) => s.horaInicio === '19:00');
    expect(s19.canchas).toHaveLength(2);
  });

  it('rechaza jugadores=6 con 422', async () => {
    const res = await supertest(app).get('/disponibilidad/por-tamano?jugadores=6&fecha=2026-06-12').set('x-api-key', 'svc');
    expect(res.status).toBe(422);
  });
});
```

**Nota tz:** 18:00 ART = 21:00 UTC (offset -03:00). Verificar contra `dayWindowUtc`/`combineDateTimeUtc` y la convención del test `disponibilidad.test.ts` (allí 19:00 ART = 22:00 UTC), que confirma el offset -3.

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
npx vitest run tests/integration/disponibilidad-tamano.test.ts
```
Expected: FAIL — 404 (la ruta `/disponibilidad/por-tamano` aún no existe).

- [ ] **Step 3: Implementar `listarPorTamano` en el service**

En `backend/src/services/disponibilidad.service.ts`, agregar el método dentro del objeto `disponibilidadService` (después de `listar`):

```ts
  async listarPorTamano(jugadores: number, fecha: string): Promise<{ jugadores: number; fecha: string; slots: { horaInicio: string; horaFin: string; canchas: { id: string; nombre: string }[] }[] }> {
    const canchas = await prisma.cancha.findMany({ where: { activa: true, jugadores }, orderBy: { nombre: 'asc' } });
    const byHora = new Map<string, { horaInicio: string; horaFin: string; canchas: { id: string; nombre: string }[] }>();
    for (const c of canchas) {
      const { slots } = await this.listar(c.id, fecha);
      for (const s of slots) {
        const e = byHora.get(s.horaInicio) ?? { horaInicio: s.horaInicio, horaFin: s.horaFin, canchas: [] };
        e.canchas.push({ id: c.id, nombre: c.nombre });
        byHora.set(s.horaInicio, e);
      }
    }
    const slots = [...byHora.values()].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
    return { jugadores, fecha, slots };
  },
```

- [ ] **Step 4: Agregar el schema de validación de la query**

En `backend/src/validators/disponibilidad.schema.ts`, agregar al final:

```ts
export const disponibilidadPorTamanoSchema = z.object({
  query: z.object({
    jugadores: z.coerce.number().int().refine((n) => [5, 7, 9, 11].includes(n), 'jugadores debe ser 5, 7, 9 u 11'),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD'),
  }),
  body: z.unknown(), params: empty,
});
```

- [ ] **Step 5: Agregar la ruta**

En `backend/src/routes/disponibilidad.routes.ts`, importar el nuevo schema y agregar la ruta (antes del `export` ya existente del router está bien; sólo registrar otra ruta en el mismo router):

```ts
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authAny } from '../middlewares/authAny.js';
import { disponibilidadSchema, disponibilidadPorTamanoSchema } from '../validators/disponibilidad.schema.js';
import { disponibilidadService } from '../services/disponibilidad.service.js';

export const disponibilidadRoutes = Router();
disponibilidadRoutes.get('/', authAny, validate(disponibilidadSchema), async (req, res, next) => {
  try {
    const { canchaId, fecha } = (req as any).valid.query;
    res.json(await disponibilidadService.listar(canchaId, fecha));
  } catch (e) { next(e); }
});

disponibilidadRoutes.get('/por-tamano', authAny, validate(disponibilidadPorTamanoSchema), async (req, res, next) => {
  try {
    const { jugadores, fecha } = (req as any).valid.query;
    res.json(await disponibilidadService.listarPorTamano(jugadores, fecha));
  } catch (e) { next(e); }
});
```

**Nota de ruteo Express 5:** `/por-tamano` es una ruta estática y `/` es la raíz, no hay colisión con un `:param`. Registrar ambas en el mismo router como arriba.

- [ ] **Step 6: Correr el test para verificar que pasa**

Run:
```bash
npx vitest run tests/integration/disponibilidad-tamano.test.ts
```
Expected: PASS (las 3 aserciones).

- [ ] **Step 7: Commit**

```bash
git add src/services/disponibilidad.service.ts src/validators/disponibilidad.schema.ts src/routes/disponibilidad.routes.ts tests/integration/disponibilidad-tamano.test.ts
git commit -m "feat(disponibilidad): add GET /disponibilidad/por-tamano grouped by hour"
```

---

### Task A5: Suite completa backend verde

**Files:** ninguno (verificación).

- [ ] **Step 1: Correr toda la suite (necesita Docker)**

Run:
```bash
npx vitest run
```
Expected: todos los tests verdes. Revisar especialmente que los tests existentes que crean canchas sin `jugadores` (`reserva.routes.test.ts`, `reserva.sena.test.ts`, `disponibilidad.test.ts`) sigan pasando — como el campo tiene `@default(5)`, no rompen.

- [ ] **Step 2: tsc + build**

Run:
```bash
npx tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 3: Si algún test falla por el nuevo campo, arreglarlo y commit**

```bash
git add -A
git commit -m "test(canchas): fix fixtures for jugadores field"
```
(Omitir el commit si no hubo cambios.)

---

## Parte B — Frontend (rama `feat/tamano-panel`)

### Task B0: Crear la rama

- [ ] **Step 1: Crear la rama**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/frontend`):
```bash
git checkout master && git pull && git checkout -b feat/tamano-panel
```
Expected: `Switched to a new branch 'feat/tamano-panel'`

---

### Task B1: Tipo `Cancha.jugadores` + schemas con jugadores (TDD)

**Files:**
- Modify: `frontend/src/lib/types.ts:3`
- Modify: `frontend/src/lib/validators.ts:21-32`
- Test: `frontend/src/lib/validators.test.ts` (crear o ampliar)

- [ ] **Step 1: Escribir el test que falla**

Crear/ampliar `frontend/src/lib/validators.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canchaSchema, canchaDivisibleSchema } from './validators';

describe('canchaSchema con jugadores', () => {
  it('acepta jugadores=7 (coerciona string)', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol7', precioHora: '1000', jugadores: '7' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.jugadores).toBe(7);
  });
  it('rechaza jugadores=6', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'otro', precioHora: '1000', jugadores: '6' });
    expect(r.success).toBe(false);
  });
});

describe('canchaDivisibleSchema con jugadores entera/parte', () => {
  it('acepta jugadoresEntera=11 y jugadoresParte=5', () => {
    const r = canchaDivisibleSchema.safeParse({ nombre: 'C4', partes: '3', precioEntera: '30000', precioParte: '12000', jugadoresEntera: '11', jugadoresParte: '5' });
    expect(r.success).toBe(true);
    if (r.success) { expect(r.data.jugadoresEntera).toBe(11); expect(r.data.jugadoresParte).toBe(5); }
  });
  it('rechaza jugadoresParte=6', () => {
    const r = canchaDivisibleSchema.safeParse({ nombre: 'C4', partes: '3', precioEntera: '30000', precioParte: '12000', jugadoresEntera: '11', jugadoresParte: '6' });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
pnpm vitest run src/lib/validators.test.ts
```
Expected: FAIL — `jugadores` no existe en los schemas (los `safeParse` ignoran el campo y `r.data.jugadores` es `undefined`; las aserciones de rechazo fallan).

- [ ] **Step 3: Agregar `jugadores` a los schemas**

En `frontend/src/lib/validators.ts`, definir el validador y agregarlo:

```ts
const jugadoresField = z.coerce.number().int().refine((n) => [5, 7, 9, 11].includes(n), 'Tamaño inválido');

export const canchaSchema = z.object({
  nombre: z.string().min(1, 'Ingresá el nombre'),
  tipo: z.string().min(1, 'Elegí el tipo'),
  precioHora: z.coerce.number().positive('El precio debe ser mayor a 0'),
  jugadores: jugadoresField,
});

export const canchaDivisibleSchema = z.object({
  nombre: z.string().min(1, 'Ingresá el nombre'),
  partes: z.coerce.number().int().min(2, 'Mínimo 2 partes').max(6, 'Máximo 6'),
  precioEntera: z.coerce.number().positive('Precio inválido'),
  precioParte: z.coerce.number().positive('Precio inválido'),
  jugadoresEntera: jugadoresField,
  jugadoresParte: jugadoresField,
});
```

- [ ] **Step 4: Agregar `jugadores` al tipo `Cancha`**

En `frontend/src/lib/types.ts`, línea 3:

```ts
export interface Cancha { id: string; nombre: string; tipo: string; jugadores: number; precioHora: number; activa: boolean; grupoId: string | null; esEntera: boolean }
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run:
```bash
pnpm vitest run src/lib/validators.test.ts
```
Expected: PASS (las 4 aserciones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/validators.ts src/lib/validators.test.ts
git commit -m "feat(canchas): add jugadores to Cancha type and zod schemas"
```

---

### Task B2: Server actions pasan `jugadores` al backend

**Files:**
- Modify: `frontend/src/lib/canchas-actions.ts:13,31`

- [ ] **Step 1: Actualizar los tipos de input de las actions**

En `frontend/src/lib/canchas-actions.ts`:

```ts
type CanchaInput = { nombre: string; tipo: string; precioHora: number; jugadores: number };
```

y la firma de `crearCanchaDivisible`:

```ts
export async function crearCanchaDivisible(input: { nombre: string; partes: number; precioEntera: number; precioParte: number; jugadoresEntera: number; jugadoresParte: number }): Promise<Result> {
  return run(() => apiFetch('/canchas/divisible', { method: 'POST', body: JSON.stringify(input) }));
}
```

(El cuerpo de `crearCancha`/`editarCancha` ya reenvía el `input` completo, así que `jugadores` viaja automáticamente.)

- [ ] **Step 2: Verificar tipos**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: sin errores (o sólo errores en `cancha-dialog.tsx` que aún no pasa `jugadores` — se arregla en B3).

- [ ] **Step 3: Commit**

```bash
git add src/lib/canchas-actions.ts
git commit -m "feat(canchas): server actions forward jugadores to backend"
```

---

### Task B3: Selector de tamaño en el dialog de cancha

**Files:**
- Modify: `frontend/src/components/canchas/cancha-dialog.tsx`

- [ ] **Step 1: Agregar estado, selector y envío de `jugadores`**

Reemplazar `frontend/src/components/canchas/cancha-dialog.tsx` por:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Cancha } from '@/lib/types';
import { canchaSchema, canchaDivisibleSchema } from '@/lib/validators';
import { crearCancha, editarCancha, crearCanchaDivisible } from '@/lib/canchas-actions';

const TIPOS = [
  { value: 'futbol5', label: 'Fútbol 5' },
  { value: 'futbol7', label: 'Fútbol 7' },
  { value: 'futbol11', label: 'Fútbol 11' },
  { value: 'otro', label: 'Otro' },
];
const TAMANOS = [5, 7, 9, 11];

function tipoFor(cancha: Cancha | null) {
  if (!cancha) return 'futbol5';
  return TIPOS.some((t) => t.value === cancha.tipo) ? cancha.tipo : 'otro';
}

export function CanchaDialog({ open, onOpenChange, cancha }: { open: boolean; onOpenChange: (o: boolean) => void; cancha: Cancha | null }) {
  const [nombre, setNombre] = useState(cancha?.nombre ?? '');
  const [tipo, setTipo] = useState(tipoFor(cancha));
  const [jugadores, setJugadores] = useState(String(cancha?.jugadores ?? 5));
  const [precio, setPrecio] = useState(cancha ? String(Number(cancha.precioHora)) : '');
  const [tipoForm, setTipoForm] = useState<'simple' | 'divisible'>('simple');
  const [partes, setPartes] = useState('3');
  const [precioEntera, setPrecioEntera] = useState('');
  const [precioParte, setPrecioParte] = useState('');
  const [jugadoresEntera, setJugadoresEntera] = useState('11');
  const [jugadoresParte, setJugadoresParte] = useState('5');
  const [pending, start] = useTransition();
  const editing = !!cancha;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNombre(cancha?.nombre ?? '');
      setTipo(tipoFor(cancha));
      setJugadores(String(cancha?.jugadores ?? 5));
      setPrecio(cancha ? String(Number(cancha.precioHora)) : '');
      setTipoForm('simple');
      setPartes('3');
      setPrecioEntera('');
      setPrecioParte('');
      setJugadoresEntera('11');
      setJugadoresParte('5');
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    if (!editing && tipoForm === 'divisible') {
      const parsed = canchaDivisibleSchema.safeParse({ nombre, partes, precioEntera, precioParte, jugadoresEntera, jugadoresParte });
      if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
      start(async () => {
        const r = await crearCanchaDivisible(parsed.data);
        if (r.ok) { toast.success('Cancha divisible creada'); onOpenChange(false); } else toast.error(r.error);
      });
      return;
    }
    const parsed = canchaSchema.safeParse({ nombre, tipo, precioHora: precio, jugadores });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    start(async () => {
      const r = editing ? await editarCancha(cancha!.id, parsed.data) : await crearCancha(parsed.data);
      if (r.ok) { toast.success(editing ? 'Cancha actualizada' : 'Cancha creada'); onOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Editar cancha' : 'Nueva cancha'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!editing && (
            <div className="space-y-1">
              <Label htmlFor="c-tipo-form">Tipo de cancha</Label>
              <select id="c-tipo-form" value={tipoForm} onChange={(e) => setTipoForm(e.target.value as 'simple' | 'divisible')} className="w-full rounded-md border px-2 py-1.5">
                <option value="simple">Simple</option>
                <option value="divisible">Divisible (entera + partes)</option>
              </select>
            </div>
          )}
          <div className="space-y-1"><Label htmlFor="c-nombre">Nombre</Label>
            <Input id="c-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cancha 1" />
          </div>
          {(!editing && tipoForm === 'divisible') ? (
            <>
              <div className="space-y-1"><Label htmlFor="c-partes">Cantidad de partes</Label>
                <Input id="c-partes" type="number" min="2" max="6" value={partes} onChange={(e) => setPartes(e.target.value)} placeholder="3" />
              </div>
              <div className="space-y-1"><Label htmlFor="c-jug-entera">Tamaño cancha entera</Label>
                <select id="c-jug-entera" value={jugadoresEntera} onChange={(e) => setJugadoresEntera(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                  {TAMANOS.map((n) => <option key={n} value={n}>Fútbol {n}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="c-jug-parte">Tamaño de cada parte</Label>
                <select id="c-jug-parte" value={jugadoresParte} onChange={(e) => setJugadoresParte(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                  {TAMANOS.map((n) => <option key={n} value={n}>Fútbol {n}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="c-precio-entera">Precio entera / hora</Label>
                <Input id="c-precio-entera" type="number" min="0" value={precioEntera} onChange={(e) => setPrecioEntera(e.target.value)} placeholder="30000" />
              </div>
              <div className="space-y-1"><Label htmlFor="c-precio-parte">Precio parte / hora</Label>
                <Input id="c-precio-parte" type="number" min="0" value={precioParte} onChange={(e) => setPrecioParte(e.target.value)} placeholder="12000" />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1"><Label htmlFor="c-subtipo">Tipo</Label>
                <select id="c-subtipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                  {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="c-jugadores">Tamaño (jugadores)</Label>
                <select id="c-jugadores" value={jugadores} onChange={(e) => setJugadores(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
                  {TAMANOS.map((n) => <option key={n} value={n}>Fútbol {n}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="c-precio">Precio por hora</Label>
                <Input id="c-precio" type="number" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="12000" />
              </div>
            </>
          )}
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : (editing ? 'Guardar' : 'Crear cancha')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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
git add src/components/canchas/cancha-dialog.tsx
git commit -m "feat(canchas): tamaño selector in dialog (simple + divisible entera/parte)"
```

---

### Task B4: Columna "Tamaño" en la tabla de canchas

**Files:**
- Modify: `frontend/src/components/canchas/canchas-table.tsx:54,76`

- [ ] **Step 1: Agregar el header y la celda**

En `frontend/src/components/canchas/canchas-table.tsx`, en el `<TableRow>` del header (línea ~54) agregar `<TableHead>Tamaño</TableHead>` entre "Tipo" y "Precio/hora":

```tsx
<TableRow><TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Tamaño</TableHead><TableHead>Precio/hora</TableHead><TableHead>Estado</TableHead><TableHead className="w-10" /></TableRow>
```

Y en el cuerpo, después de la celda de `c.tipo` (línea ~76) agregar:

```tsx
<TableCell className="text-neutral-500">{c.tipo}</TableCell>
<TableCell className="text-neutral-600">Fútbol {c.jugadores}</TableCell>
```

- [ ] **Step 2: Verificar tipos + build**

Run:
```bash
pnpm exec tsc --noEmit && pnpm build
```
Expected: build OK (recordar: en módulos `'use server'` todos los exports deben ser `async function` — ya cumplido en canchas-actions).

- [ ] **Step 3: Commit**

```bash
git add src/components/canchas/canchas-table.tsx
git commit -m "feat(canchas): show tamaño column in canchas table"
```

---

### Task B5: Verificación frontend completa

**Files:** ninguno.

- [ ] **Step 1: Lint + tsc + tests + build**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build
```
Expected: todo verde. `pnpm build` es obligatorio antes de mergear (tsc/lint/vitest NO atrapan errores de boundary RSC).

---

## Parte C — Cierre

### Task C1: Finalizar las ramas

- [ ] **Step 1: Backend — finishing-a-development-branch**

Anunciar: "I'm using the finishing-a-development-branch skill to complete this work." en el repo backend (rama `feat/tamano-backend`). Seguir esa skill: verificar tests verdes, presentar opciones, ejecutar el merge a `main` + push.

- [ ] **Step 2: Frontend — finishing-a-development-branch**

Idem en el repo frontend (rama `feat/tamano-panel`): merge a `master` + push.

### Task C2: Bot (n8n) — fuera de este plan, lo hace el usuario / asistente con n8n MCP

Tras deployar el backend con `jugadores` y `/disponibilidad/por-tamano`, actualizar el workflow "Canchitas — Bot v2" (id I8yiX4g1rGh5Hb2U):
- **Prompt:** agregar `jugadores` (int, nullable) al `responseSchema`; el sistema ofrece "canchas de 5, 7, 9 y 11" en vez de listar canchas; mapear "cancha de 5"/"fútbol 9"/"para 11" → número.
- **Cerebro (rama reservar):** pide tamaño → fecha → `GET /disponibilidad/por-tamano` (muestra horas con cancha libre) → hora → muestra las canchas libres de ese tamaño por nombre → cliente elige → confirma → `POST /reservas` con el `canchaId` elegido. Guardar `jugadores` (+ `canchaId`/`cancha`) en el contexto Redis.

### Task C3: Deploy VM (ya pendiente de features anteriores + esta)

Recordatorio: el deploy de la VM acumula config + divisibles + fijos/bloqueos + esta migración. Tras `git reset --hard origin/main && docker compose ... up -d --build` correr **`docker exec canchitas-backend node dist/seed.js`** (backfill ReservaSector). La columna `jugadores` arranca en 5 para todas; el dueño debe editar cada cancha y ponerle su tamaño real desde el panel.

---

## Self-Review

**Spec coverage:**
- Modelo `jugadores Int @default(5)` → Task A1 ✓
- Validación {5,7,9,11} en crear/editar/divisible → Task A2 ✓
- Service persiste jugadores (create/update/divisible con entera+parte) → Task A3 ✓
- `GET /disponibilidad/por-tamano` agrupado por hora, canchas activas, respeta sectores/fijos/bloqueos (vía `listar`), sólo horas con ≥1 libre → Task A4 ✓
- Frontend tipo + schemas + actions + dialog selector + columna tabla + unit schemas → B1–B4 ✓
- Migración/datos default 5 + nota de editar tras deploy → A1 + C3 ✓
- Bot → C2 (fuera de alcance del código, documentado) ✓
- Reservar sigue por `POST /reservas` con canchaId → sin cambios (correcto) ✓

**Placeholder scan:** Sin TBD/TODO. El único punto "a verificar" es el shape de `/auth/login` en A2 (instrucción explícita de leer el archivo), no un placeholder de implementación.

**Type consistency:** `jugadores` Int en todos lados; backend usa `z.union([z.literal(5)...])`, query coercionada con `z.coerce.number()`; frontend `z.coerce.number()`. `listarPorTamano(jugadores, fecha)` y la ruta coinciden. `crearDivisible` usa `jugadoresEntera`/`jugadoresParte` consistente entre schema (A2), service (A3), validators frontend (B1), action (B2) y dialog (B3).

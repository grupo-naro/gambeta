# Control de stock del buffet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el buffet registre lo que vende (lector de código de barras + botonera para preparados), lleve stock, y al cerrar el turno muestre cuánto se vendió.

**Architecture:** Un módulo `buffet` nuevo en el backend Express/Prisma del `.36`, con dos caminos de auth separados: las rutas del mostrador validan una `BUFFET_API_KEY` propia (menor privilegio) y las de admin usan el `authJwt` existente. En el panel de Next (Vercel) se agrega una ruta `/mostrador` a pantalla completa, fuera del grupo `(panel)`, gateada por un PIN; y una sección `/buffet` dentro del panel para catálogo, stock y cierres.

**Tech Stack:** Node 22 + Express 5 + TypeScript (ESM, imports con `.js`) + Prisma 7 + Postgres · Vitest + Supertest + Postgres en Docker · Next 16 (custom) + React + Tailwind v4 + pnpm.

## Global Constraints

- **NO PUSHEAR.** Mergear a `main` (backend) y `master` (frontend) **en local**. El usuario pushea. Nunca ejecutar `git push`.
- Backend usa **npm** (`package-lock.json`), frontend usa **pnpm**.
- Backend es **ESM**: todos los imports internos llevan extensión `.js` (ej. `import { prisma } from '../db/prisma.js'`).
- Migraciones de Prisma **escritas a mano** en `prisma/migrations/<YYYYMMDDHHMMSS>_<nombre>/migration.sql`. Los tests corren `npx prisma migrate deploy`, así que la carpeta tiene que existir antes de correrlos.
- Los `Decimal` de Prisma serializan como string en JSON. **Todo servicio devuelve `Number(...)`** para montos, como hace `src/services/caja.service.ts`.
- Errores del backend: usar los helpers de `src/utils/errors.ts` (`NotFound`, `Conflict`, `BusinessRule`, `Unauthorized`). No tirar `Error` pelado.
- Frontend Next 16 es **custom**: ante cualquier duda de API, leer `node_modules/next/dist/docs/` — no confiar en el conocimiento previo de Next (ver `frontend/AGENTS.md`).
- **Restricción de usabilidad que manda sobre lo demás:** el mostrador lo atienden personas mayores. Una sola pantalla, sin menús, botones grandes, feedback imposible de no ver.
- Env nueva **`BUFFET_API_KEY`** en dos lados: `.env` de la VM y env vars de Vercel. Se usa además como clave HMAC para firmar la cookie de sesión del mostrador.
- Cada venta lleva un **`uid`** único generado por el cliente → idempotencia ante reintentos.

**Desvíos respecto del spec, decididos al explorar el código (aplicarlos, el spec está desactualizado en estos dos puntos):**
1. El PIN se verifica en el **backend**, no en un server action de Next: `bcrypt` ya existe en `backend/src/utils/password.ts` y no es dependencia del frontend. Meter un módulo nativo en Vercel sería gratuito daño.
2. La excepción de `/mostrador` se hace con un **early-return dentro de `middleware()`**, no editando el regex del `matcher`. Menos riesgo de romper el ruteo del panel.

---

## Estructura de archivos

**Backend (`c:\Users\Lautaro\Desktop\ortigoza\backend`)**

| Archivo | Responsabilidad |
|---|---|
| `prisma/schema.prisma` (modificar) | Modelos `ProductoBuffet`, `CajaBuffet`, `VentaBuffet`, enum `EstadoCajaBuffet`, campo `Configuracion.buffetPinHash` |
| `prisma/migrations/20260710120000_buffet_stock/migration.sql` (crear) | DDL a mano, incluye el índice único parcial de "una sola caja abierta" |
| `src/utils/buffetAuth.ts` (crear) | `isValidBuffetKey(provided)` — timing-safe, lee `process.env` en cada llamada |
| `src/middlewares/authBuffet.ts` (crear) | Middleware que valida `x-buffet-key` |
| `src/validators/buffet.schema.ts` (crear) | Schemas zod de todos los endpoints del módulo |
| `src/services/buffetProducto.service.ts` (crear) | Catálogo, botonera, reponer stock |
| `src/services/buffetCaja.service.ts` (crear) | Abrir / estado / vender / deshacer / cerrar |
| `src/services/buffetPin.service.ts` (crear) | Setear y verificar el PIN del mostrador |
| `src/routes/buffet.routes.ts` (crear) | Router único: rutas de mostrador (`authBuffet`) + admin (`authJwt`) |
| `src/routes/index.ts` (modificar) | Montar `apiRouter.use('/buffet', buffetRoutes)` |
| `tests/helpers/db.ts` (modificar) | `resetTables` limpia las 3 tablas nuevas |

**Frontend (`c:\Users\Lautaro\Desktop\ortigoza\frontend`)**

| Archivo | Responsabilidad |
|---|---|
| `src/lib/buffet-api.ts` (crear) | `buffetFetch` server-only, manda `x-buffet-key` |
| `src/lib/buffet-session.ts` (crear) | Cookie HMAC del mostrador: crear / verificar / exigir |
| `src/lib/buffet-actions.ts` (crear) | Server actions del mostrador (todas guardadas por la sesión) |
| `src/lib/buffet-admin-actions.ts` (crear) | Server actions del admin (catálogo, reponer, PIN) |
| `src/middleware.ts` (modificar) | Early-return para `/mostrador` |
| `src/app/mostrador/pin/page.tsx` (crear) | Pantalla de PIN |
| `src/app/mostrador/page.tsx` (crear) | Server component: gatea sesión, trae estado, renderiza la pantalla |
| `src/components/mostrador/pantalla-venta.tsx` (crear) | Client component: lector + botonera + total + deshacer + cerrar |
| `src/app/(panel)/buffet/page.tsx` (crear) | Admin: catálogo + stock |
| `src/app/(panel)/buffet/cierres/page.tsx` (crear) | Admin: cierres de caja |
| `src/components/buffet/*` (crear) | Tabla de productos, diálogo de alta/edición, diálogo de reposición |
| `src/components/nav-items.tsx` (modificar) | Ítem `/buffet` en el grupo Operación |
| `src/components/nav-items.test.ts` (modificar) | Ajustar los conteos por grupo |
| `src/lib/types.ts` (modificar) | Tipos del buffet |

---

## Task 1: Backend — modelos, migración y auth del mostrador

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260710120000_buffet_stock/migration.sql`
- Create: `backend/src/utils/buffetAuth.ts`
- Create: `backend/src/middlewares/authBuffet.ts`
- Create: `backend/src/services/buffetProducto.service.ts`
- Create: `backend/src/validators/buffet.schema.ts`
- Create: `backend/src/routes/buffet.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Modify: `backend/tests/helpers/db.ts`
- Test: `backend/tests/integration/buffet-auth.test.ts`

**Interfaces:**
- Produces: `isValidBuffetKey(provided: string | undefined | null): boolean`; `authBuffet(req, res, next)`; `buffetProductoService.listBotonera(): Promise<ProductoDTO[]>` donde `ProductoDTO = { id: string; nombre: string; precio: number; enBotonera: boolean; orden: number }`; router montado en `/buffet`.

- [ ] **Step 1: Agregar los modelos al schema**

En `backend/prisma/schema.prisma`, al final del archivo:

```prisma
enum EstadoCajaBuffet {
  ABIERTA
  CERRADA
}

model ProductoBuffet {
  id          String        @id @default(cuid())
  nombre      String
  codigoBarra String?       @unique
  precio      Decimal       @db.Decimal(10, 2)
  stock       Int           @default(0)
  stockMinimo Int           @default(0)
  enBotonera  Boolean       @default(false)
  orden       Int           @default(0)
  activo      Boolean       @default(true)
  ventas      VentaBuffet[]
}

model CajaBuffet {
  id            String           @id @default(cuid())
  abiertaEn     DateTime         @default(now())
  cerradaEn     DateTime?
  estado        EstadoCajaBuffet @default(ABIERTA)
  totalUnidades Int?
  totalMonto    Decimal?         @db.Decimal(10, 2)
  ventas        VentaBuffet[]
}

model VentaBuffet {
  id         String         @id @default(cuid())
  uid        String         @unique
  cajaId     String
  caja       CajaBuffet     @relation(fields: [cajaId], references: [id])
  productoId String
  producto   ProductoBuffet @relation(fields: [productoId], references: [id])
  precioUnit Decimal        @db.Decimal(10, 2)
  creadoEn   DateTime       @default(now())

  @@index([cajaId])
}
```

Y en `model Configuracion`, después de `titular2 String @default("")`:

```prisma
  buffetPinHash  String   @default("")
```

- [ ] **Step 2: Escribir la migración a mano**

Crear `backend/prisma/migrations/20260710120000_buffet_stock/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "EstadoCajaBuffet" AS ENUM ('ABIERTA', 'CERRADA');

-- CreateTable
CREATE TABLE "ProductoBuffet" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigoBarra" TEXT,
    "precio" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "stockMinimo" INTEGER NOT NULL DEFAULT 0,
    "enBotonera" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProductoBuffet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CajaBuffet" (
    "id" TEXT NOT NULL,
    "abiertaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradaEn" TIMESTAMP(3),
    "estado" "EstadoCajaBuffet" NOT NULL DEFAULT 'ABIERTA',
    "totalUnidades" INTEGER,
    "totalMonto" DECIMAL(10,2),
    CONSTRAINT "CajaBuffet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaBuffet" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "precioUnit" DECIMAL(10,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VentaBuffet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductoBuffet_codigoBarra_key" ON "ProductoBuffet"("codigoBarra");
CREATE UNIQUE INDEX "VentaBuffet_uid_key" ON "VentaBuffet"("uid");
CREATE INDEX "VentaBuffet_cajaId_idx" ON "VentaBuffet"("cajaId");

-- Una sola caja ABIERTA a la vez, garantizado por la base (Prisma no sabe expresar
-- indices parciales; si esto falla, es que hay dos cajas abiertas y hay un bug).
CREATE UNIQUE INDEX "CajaBuffet_una_abierta" ON "CajaBuffet"(("estado")) WHERE "estado" = 'ABIERTA'::"EstadoCajaBuffet";

-- AddForeignKey
ALTER TABLE "VentaBuffet" ADD CONSTRAINT "VentaBuffet_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CajaBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VentaBuffet" ADD CONSTRAINT "VentaBuffet_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "ProductoBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN "buffetPinHash" TEXT NOT NULL DEFAULT '';
```

Regenerar el cliente:

```bash
cd backend && npx prisma generate
```

Expected: `Generated Prisma Client`.

- [ ] **Step 3: Actualizar `resetTables` (si no, los tests se pisan entre sí)**

En `backend/tests/helpers/db.ts`, dentro del `p.$transaction([...])`, agregar **al principio del array** (antes de `p.auditLog.deleteMany()`), porque `VentaBuffet` referencia a las otras dos:

```ts
    p.ventaBuffet.deleteMany(),
    p.cajaBuffet.deleteMany(),
    p.productoBuffet.deleteMany(),
```

- [ ] **Step 4: Escribir el test que falla**

Crear `backend/tests/integration/buffet-auth.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let adminToken: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  adminToken = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('buffet: auth del mostrador', () => {
  it('sin x-buffet-key devuelve 401', async () => {
    const r = await supertest(app).get('/buffet/productos/botonera');
    expect(r.status).toBe(401);
  });

  it('con x-buffet-key incorrecta devuelve 401', async () => {
    const r = await supertest(app).get('/buffet/productos/botonera').set('x-buffet-key', 'otra-cosa');
    expect(r.status).toBe(401);
  });

  it('el JWT de admin NO abre las rutas del mostrador', async () => {
    const r = await supertest(app).get('/buffet/productos/botonera').set('authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(401);
  });

  it('con la key correcta devuelve la botonera, solo activos y en orden', async () => {
    const p = getPrisma();
    await p.productoBuffet.createMany({ data: [
      { nombre: 'Sanguche', precio: '3000', enBotonera: true, orden: 2, activo: true },
      { nombre: 'Pancho', precio: '2500', enBotonera: true, orden: 1, activo: true },
      { nombre: 'Agua caliente', precio: '1000', enBotonera: true, orden: 3, activo: false },
      { nombre: 'Coca 500', codigoBarra: '7790895000997', precio: '1500', enBotonera: false, orden: 0, activo: true },
    ] });
    const r = await supertest(app).get('/buffet/productos/botonera').set('x-buffet-key', KEY);
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.nombre)).toEqual(['Pancho', 'Sanguche']);
    expect(r.body[0].precio).toBe(2500); // number, no string: los Decimal se mapean con Number()
  });
});
```

- [ ] **Step 5: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/buffet-auth.test.ts
```

Expected: FAIL — 404 en vez de 401/200 (la ruta `/buffet` no existe todavía).

- [ ] **Step 6: `buffetAuth.ts` — validación timing-safe de la key**

Crear `backend/src/utils/buffetAuth.ts` (calcado de `src/utils/serviceAuth.ts`):

```ts
import { timingSafeEqual } from 'node:crypto';

// Se lee de process.env en cada llamada: permite rotar la key sin reiniciar
// y hace testeable el módulo sin bootstrappear todo el env.
function keysAceptadas(): string[] {
  const raw = [process.env.BUFFET_API_KEY ?? ''];
  return [...new Set(raw.map((s) => s.trim()).filter((s) => s.length > 0))];
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false; // timingSafeEqual exige mismo largo
  return timingSafeEqual(ab, bb);
}

export function isValidBuffetKey(provided: string | undefined | null): boolean {
  if (!provided) return false;
  return keysAceptadas().some((k) => safeEqual(provided, k));
}
```

- [ ] **Step 7: `authBuffet.ts` — el middleware**

Crear `backend/src/middlewares/authBuffet.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { isValidBuffetKey } from '../utils/buffetAuth.js';
import { Unauthorized } from '../utils/errors.js';

// Auth de menor privilegio: solo abre las rutas del mostrador del buffet.
// A propósito NO acepta el JWT de admin ni la SERVICE_API_KEY.
export function authBuffet(req: Request, _res: Response, next: NextFunction) {
  if (!isValidBuffetKey(req.header('x-buffet-key'))) return next(Unauthorized('Buffet key inválida'));
  next();
}
```

- [ ] **Step 8: El servicio de productos (por ahora, solo la botonera)**

Crear `backend/src/services/buffetProducto.service.ts`:

```ts
import { prisma } from '../db/prisma.js';

export interface ProductoDTO {
  id: string;
  nombre: string;
  codigoBarra: string | null;
  precio: number;
  stock: number;
  stockMinimo: number;
  enBotonera: boolean;
  orden: number;
  activo: boolean;
}

const toDTO = (p: {
  id: string; nombre: string; codigoBarra: string | null; precio: unknown;
  stock: number; stockMinimo: number; enBotonera: boolean; orden: number; activo: boolean;
}): ProductoDTO => ({ ...p, precio: Number(p.precio) });

export const buffetProductoService = {
  async listBotonera(): Promise<ProductoDTO[]> {
    const rows = await prisma.productoBuffet.findMany({
      where: { activo: true, enBotonera: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
    return rows.map(toDTO);
  },
};
```

- [ ] **Step 9: El router y su montaje**

Crear `backend/src/routes/buffet.routes.ts`:

```ts
import { Router } from 'express';
import { authBuffet } from '../middlewares/authBuffet.js';
import { buffetProductoService } from '../services/buffetProducto.service.js';

export const buffetRoutes = Router();

// --- Mostrador (x-buffet-key) ---
// OJO: /productos/botonera va antes que cualquier /productos/:id de admin.
buffetRoutes.get('/productos/botonera', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetProductoService.listBotonera()); } catch (e) { next(e); }
});
```

En `backend/src/routes/index.ts`, agregar el import junto a los demás y el mount al final:

```ts
import { buffetRoutes } from './buffet.routes.js';
```
```ts
apiRouter.use('/buffet', buffetRoutes);
```

- [ ] **Step 10: Correr el test — debe pasar**

```bash
cd backend && npx vitest run tests/integration/buffet-auth.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 11: Typecheck y commit**

```bash
cd backend && npm run typecheck
git checkout -b feat/buffet-stock
git add prisma/schema.prisma prisma/migrations src/utils/buffetAuth.ts src/middlewares/authBuffet.ts src/services/buffetProducto.service.ts src/routes/buffet.routes.ts src/routes/index.ts tests/helpers/db.ts tests/integration/buffet-auth.test.ts
git commit -m "feat(buffet): modelos, migracion y auth del mostrador (x-buffet-key)"
```

---

## Task 2: Backend — catálogo de productos y reposición de stock (admin)

**Files:**
- Modify: `backend/src/services/buffetProducto.service.ts`
- Create: `backend/src/validators/buffet.schema.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-productos.test.ts`

**Interfaces:**
- Consumes: `buffetProductoService.listBotonera()`, `authBuffet`.
- Produces: `buffetProductoService.list()`, `.crear(input)`, `.actualizar(id, input)`, `.reponer(id, cantidad, adminId)` → todos devuelven `ProductoDTO`. Rutas `GET/POST /buffet/productos`, `PATCH /buffet/productos/:id`, `POST /buffet/productos/:id/reponer` (todas `authJwt`).

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/buffet-productos.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let token: string; let adminId: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  // AuditLog tiene FK a AdminUser: hay que sembrar un admin real.
  const admin = await getPrisma().adminUser.create({
    data: { email: 'admin@test.com', passwordHash: 'x', nombre: 'Admin', rol: 'ADMIN' },
  });
  adminId = admin.id;
  token = signAdminToken({ adminId, email: admin.email, rol: 'ADMIN' });
});

const auth = (r: any) => r.set('authorization', `Bearer ${token}`);

describe('buffet: catalogo de productos', () => {
  it('la buffet-key NO abre las rutas de admin', async () => {
    const r = await supertest(app).get('/buffet/productos').set('x-buffet-key', KEY);
    expect(r.status).toBe(401);
  });

  it('crea un producto con codigo de barras y lo lista', async () => {
    const c = await auth(supertest(app).post('/buffet/productos'))
      .send({ nombre: 'Coca 500', codigoBarra: '7790895000997', precio: 1500, stock: 10, stockMinimo: 3 });
    expect(c.status).toBe(201);
    expect(c.body.precio).toBe(1500);

    const l = await auth(supertest(app).get('/buffet/productos'));
    expect(l.status).toBe(200);
    expect(l.body).toHaveLength(1);
    expect(l.body[0].codigoBarra).toBe('7790895000997');
  });

  it('crea un preparado sin codigo de barras, en la botonera', async () => {
    const c = await auth(supertest(app).post('/buffet/productos'))
      .send({ nombre: 'Pancho', precio: 2500, enBotonera: true, orden: 1 });
    expect(c.status).toBe(201);
    expect(c.body.codigoBarra).toBeNull();
  });

  it('dos preparados sin codigo no colisionan (muchos NULL en columna unica)', async () => {
    await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Pancho', precio: 2500 });
    const b = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Sanguche', precio: 3000 });
    expect(b.status).toBe(201);
  });

  it('rechaza un codigo de barras duplicado con 409', async () => {
    await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Coca', codigoBarra: '111', precio: 1500 });
    const b = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Otra', codigoBarra: '111', precio: 1600 });
    expect(b.status).toBe(409);
  });

  it('PATCH cambia el precio', async () => {
    const c = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Coca', precio: 1500 });
    const u = await auth(supertest(app).patch(`/buffet/productos/${c.body.id}`)).send({ precio: 1800 });
    expect(u.status).toBe(200);
    expect(u.body.precio).toBe(1800);
  });

  it('reponer suma stock y deja rastro en el AuditLog', async () => {
    const c = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Coca', precio: 1500, stock: 2 });
    const r = await auth(supertest(app).post(`/buffet/productos/${c.body.id}/reponer`)).send({ cantidad: 12 });
    expect(r.status).toBe(200);
    expect(r.body.stock).toBe(14);

    const logs = await getPrisma().auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].entidad).toBe('ProductoBuffet');
  });

  it('reponer con cantidad 0 o negativa es 400', async () => {
    const c = await auth(supertest(app).post('/buffet/productos')).send({ nombre: 'Coca', precio: 1500 });
    const r = await auth(supertest(app).post(`/buffet/productos/${c.body.id}/reponer`)).send({ cantidad: 0 });
    expect(r.status).toBe(400);
  });

  it('reponer un producto inexistente es 404', async () => {
    const r = await auth(supertest(app).post('/buffet/productos/noexiste/reponer')).send({ cantidad: 5 });
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/buffet-productos.test.ts
```

Expected: FAIL — 404 en `POST /buffet/productos`.

- [ ] **Step 3: Los schemas zod**

Crear `backend/src/validators/buffet.schema.ts`:

```ts
import { z } from 'zod';

const empty = z.looseObject({});
const idParam = z.object({ id: z.string().min(1) });

export const crearProductoSchema = z.object({
  body: z.object({
    nombre: z.string().min(1),
    codigoBarra: z.string().min(1).nullable().optional(),
    precio: z.coerce.number().nonnegative(),
    stock: z.coerce.number().int().optional(),
    stockMinimo: z.coerce.number().int().nonnegative().optional(),
    enBotonera: z.boolean().optional(),
    orden: z.coerce.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  query: empty, params: empty,
});

export const actualizarProductoSchema = z.object({
  body: z.object({
    nombre: z.string().min(1).optional(),
    codigoBarra: z.string().min(1).nullable().optional(),
    precio: z.coerce.number().nonnegative().optional(),
    stockMinimo: z.coerce.number().int().nonnegative().optional(),
    enBotonera: z.boolean().optional(),
    orden: z.coerce.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  query: empty, params: idParam,
});

export const reponerSchema = z.object({
  body: z.object({ cantidad: z.coerce.number().int().positive() }),
  query: empty, params: idParam,
});
```

- [ ] **Step 4: Completar el servicio**

En `backend/src/services/buffetProducto.service.ts`, agregar los imports y los métodos dentro de `buffetProductoService`:

```ts
import { prisma } from '../db/prisma.js';
import { Conflict, NotFound } from '../utils/errors.js';
import { auditService } from './audit.service.js';
```

> **Firma real de `auditService` (verificada en `src/services/audit.service.ts`):** `auditService.record(adminId: string | null, { accion, entidad, entidadId, descripcion, payload })`. Es best-effort (nunca rompe la operación). No existe un método `registrar`.

```ts
  async list(): Promise<ProductoDTO[]> {
    const rows = await prisma.productoBuffet.findMany({ orderBy: [{ activo: 'desc' }, { nombre: 'asc' }] });
    return rows.map(toDTO);
  },

  async crear(input: {
    nombre: string; codigoBarra?: string | null; precio: number;
    stock?: number; stockMinimo?: number; enBotonera?: boolean; orden?: number; activo?: boolean;
  }): Promise<ProductoDTO> {
    if (input.codigoBarra) {
      const dup = await prisma.productoBuffet.findUnique({ where: { codigoBarra: input.codigoBarra } });
      if (dup) throw Conflict('Ya existe un producto con ese código de barras');
    }
    const creado = await prisma.productoBuffet.create({
      data: {
        nombre: input.nombre,
        codigoBarra: input.codigoBarra ?? null,
        precio: input.precio,
        stock: input.stock ?? 0,
        stockMinimo: input.stockMinimo ?? 0,
        enBotonera: input.enBotonera ?? false,
        orden: input.orden ?? 0,
        activo: input.activo ?? true,
      },
    });
    return toDTO(creado);
  },

  async actualizar(id: string, input: Record<string, unknown>): Promise<ProductoDTO> {
    const actual = await prisma.productoBuffet.findUnique({ where: { id } });
    if (!actual) throw NotFound('ProductoBuffet', id);
    if (typeof input.codigoBarra === 'string' && input.codigoBarra !== actual.codigoBarra) {
      const dup = await prisma.productoBuffet.findUnique({ where: { codigoBarra: input.codigoBarra } });
      if (dup) throw Conflict('Ya existe un producto con ese código de barras');
    }
    const upd = await prisma.productoBuffet.update({ where: { id }, data: input });
    return toDTO(upd);
  },

  async reponer(id: string, cantidad: number, adminId: string): Promise<ProductoDTO> {
    const actual = await prisma.productoBuffet.findUnique({ where: { id } });
    if (!actual) throw NotFound('ProductoBuffet', id);
    const upd = await prisma.productoBuffet.update({ where: { id }, data: { stock: { increment: cantidad } } });
    await auditService.record(adminId, {
      accion: 'REPONER', entidad: 'ProductoBuffet', entidadId: id,
      descripcion: `Repuso ${cantidad} de ${actual.nombre} (${actual.stock} → ${upd.stock})`,
    });
    return toDTO(upd);
  },
```

- [ ] **Step 5: Las rutas de admin**

En `backend/src/routes/buffet.routes.ts`, agregar imports y rutas **después** de la de botonera:

```ts
import { authJwt } from '../middlewares/authJwt.js';
import { validate } from '../middlewares/validate.js';
import { crearProductoSchema, actualizarProductoSchema, reponerSchema } from '../validators/buffet.schema.js';
```

```ts
// --- Admin (JWT) ---
buffetRoutes.get('/productos', authJwt, async (_req, res, next) => {
  try { res.json(await buffetProductoService.list()); } catch (e) { next(e); }
});

buffetRoutes.post('/productos', authJwt, validate(crearProductoSchema), async (req, res, next) => {
  try { res.status(201).json(await buffetProductoService.crear((req as any).valid.body)); } catch (e) { next(e); }
});

buffetRoutes.patch('/productos/:id', authJwt, validate(actualizarProductoSchema), async (req, res, next) => {
  try { res.json(await buffetProductoService.actualizar((req as any).valid.params.id, (req as any).valid.body)); } catch (e) { next(e); }
});

buffetRoutes.post('/productos/:id/reponer', authJwt, validate(reponerSchema), async (req, res, next) => {
  try {
    const adminId = (req as any).principal.adminId as string;
    res.json(await buffetProductoService.reponer((req as any).valid.params.id, (req as any).valid.body.cantidad, adminId));
  } catch (e) { next(e); }
});
```

- [ ] **Step 6: Correr los tests**

```bash
cd backend && npx vitest run tests/integration/buffet-productos.test.ts tests/integration/buffet-auth.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 7: Commit**

```bash
cd backend && npm run typecheck
git add src/services/buffetProducto.service.ts src/validators/buffet.schema.ts src/routes/buffet.routes.ts tests/integration/buffet-productos.test.ts
git commit -m "feat(buffet): catalogo de productos y reposicion de stock (admin)"
```

---

## Task 3: Backend — abrir caja y vender (idempotente)

**Files:**
- Create: `backend/src/services/buffetCaja.service.ts`
- Modify: `backend/src/validators/buffet.schema.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-venta.test.ts`

**Interfaces:**
- Consumes: `authBuffet`, `ProductoDTO`.
- Produces: `buffetCajaService.abrir(): Promise<CajaEstado>`, `.actual(): Promise<CajaEstado | null>`, `.vender(input: { uid: string; codigoBarra?: string; productoId?: string }): Promise<CajaEstado>`.
  ```ts
  export interface VentaDTO { id: string; productoId: string; nombre: string; precioUnit: number; creadoEn: string }
  export interface CajaEstado {
    id: string; abiertaEn: string; totalUnidades: number; totalMonto: number;
    ultimas: VentaDTO[]; // las 10 más recientes, de la más nueva a la más vieja
  }
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/buffet-venta.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const mostrador = (r: any) => r.set('x-buffet-key', KEY);

async function sembrarCoca(stock = 10) {
  return getPrisma().productoBuffet.create({
    data: { nombre: 'Coca 500', codigoBarra: '779089', precio: '1500', stock },
  });
}

describe('buffet: abrir caja y vender', () => {
  it('abrir crea una caja ABIERTA', async () => {
    const r = await mostrador(supertest(app).post('/buffet/caja/abrir'));
    expect(r.status).toBe(200);
    expect(r.body.totalUnidades).toBe(0);
    expect(r.body.totalMonto).toBe(0);
  });

  it('abrir dos veces reusa la caja abierta, no crea otra', async () => {
    const a = await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const b = await mostrador(supertest(app).post('/buffet/caja/abrir'));
    expect(b.body.id).toBe(a.body.id);
    expect(await getPrisma().cajaBuffet.count()).toBe(1);
  });

  it('vender sin caja abierta devuelve 409', async () => {
    await sembrarCoca();
    const r = await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u1', codigoBarra: '779089' });
    expect(r.status).toBe(409);
  });

  it('vender descuenta stock, congela el precio y suma al total', async () => {
    const coca = await sembrarCoca(10);
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u1', codigoBarra: '779089' });
    expect(r.status).toBe(200);
    expect(r.body.totalUnidades).toBe(1);
    expect(r.body.totalMonto).toBe(1500);
    expect(r.body.ultimas[0].nombre).toBe('Coca 500');

    const p = await getPrisma().productoBuffet.findUnique({ where: { id: coca.id } });
    expect(p!.stock).toBe(9);

    // el precio queda congelado: cambiarlo no altera la venta ya hecha
    await getPrisma().productoBuffet.update({ where: { id: coca.id }, data: { precio: '9999' } });
    const venta = await getPrisma().ventaBuffet.findFirst();
    expect(Number(venta!.precioUnit)).toBe(1500);
  });

  it('el mismo uid dos veces NO duplica la venta ni descuenta de nuevo', async () => {
    const coca = await sembrarCoca(10);
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'mismo', codigoBarra: '779089' });
    const r2 = await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'mismo', codigoBarra: '779089' });

    expect(r2.status).toBe(200);
    expect(r2.body.totalUnidades).toBe(1);
    expect(await getPrisma().ventaBuffet.count()).toBe(1);
    const p = await getPrisma().productoBuffet.findUnique({ where: { id: coca.id } });
    expect(p!.stock).toBe(9);
  });

  it('vender por productoId (botonera) funciona igual', async () => {
    const pancho = await getPrisma().productoBuffet.create({
      data: { nombre: 'Pancho', precio: '2500', stock: 5, enBotonera: true },
    });
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u1', productoId: pancho.id });
    expect(r.status).toBe(200);
    expect(r.body.totalMonto).toBe(2500);
  });

  it('codigo de barras desconocido devuelve 404 y no registra nada', async () => {
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u1', codigoBarra: 'no-existe' });
    expect(r.status).toBe(404);
    expect(await getPrisma().ventaBuffet.count()).toBe(0);
  });

  it('producto inactivo no se vende', async () => {
    await getPrisma().productoBuffet.create({ data: { nombre: 'Viejo', codigoBarra: '000', precio: '100', activo: false } });
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u1', codigoBarra: '000' });
    expect(r.status).toBe(404);
  });

  it('el stock puede quedar negativo: la venta NO se bloquea', async () => {
    const coca = await sembrarCoca(0);
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u1', codigoBarra: '779089' });
    expect(r.status).toBe(200);
    const p = await getPrisma().productoBuffet.findUnique({ where: { id: coca.id } });
    expect(p!.stock).toBe(-1);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/buffet-venta.test.ts
```

Expected: FAIL — 404 en `POST /buffet/caja/abrir`.

- [ ] **Step 3: Schemas de venta**

En `backend/src/validators/buffet.schema.ts`, agregar:

```ts
export const ventaSchema = z.object({
  body: z.object({
    uid: z.string().min(8),
    codigoBarra: z.string().min(1).optional(),
    productoId: z.string().min(1).optional(),
  }).refine((b) => !!b.codigoBarra !== !!b.productoId, {
    message: 'Mandá codigoBarra o productoId, uno solo', path: ['codigoBarra'],
  }),
  query: empty, params: empty,
});
```

- [ ] **Step 4: El servicio de caja**

Crear `backend/src/services/buffetCaja.service.ts`:

```ts
import { prisma } from '../db/prisma.js';
import { Conflict, NotFound } from '../utils/errors.js';

export interface VentaDTO { id: string; productoId: string; nombre: string; precioUnit: number; creadoEn: string }
export interface CajaEstado {
  id: string; abiertaEn: string; totalUnidades: number; totalMonto: number; ultimas: VentaDTO[];
}

async function estadoDe(cajaId: string): Promise<CajaEstado> {
  const caja = await prisma.cajaBuffet.findUniqueOrThrow({ where: { id: cajaId } });
  const ventas = await prisma.ventaBuffet.findMany({
    where: { cajaId },
    include: { producto: { select: { nombre: true } } },
    orderBy: { creadoEn: 'desc' },
  });
  const totalMonto = ventas.reduce((acc, v) => acc + Number(v.precioUnit), 0);
  return {
    id: caja.id,
    abiertaEn: caja.abiertaEn.toISOString(),
    totalUnidades: ventas.length,
    totalMonto,
    ultimas: ventas.slice(0, 10).map((v) => ({
      id: v.id, productoId: v.productoId, nombre: v.producto.nombre,
      precioUnit: Number(v.precioUnit), creadoEn: v.creadoEn.toISOString(),
    })),
  };
}

async function cajaAbierta() {
  return prisma.cajaBuffet.findFirst({ where: { estado: 'ABIERTA' } });
}

export const buffetCajaService = {
  async abrir(): Promise<CajaEstado> {
    const ya = await cajaAbierta();
    if (ya) return estadoDe(ya.id); // reusa, no falla
    const creada = await prisma.cajaBuffet.create({ data: {} });
    return estadoDe(creada.id);
  },

  async actual(): Promise<CajaEstado | null> {
    const c = await cajaAbierta();
    return c ? estadoDe(c.id) : null;
  },

  async vender(input: { uid: string; codigoBarra?: string; productoId?: string }): Promise<CajaEstado> {
    // Idempotencia: si el navegador reintentó el POST, devolvemos el estado sin
    // volver a registrar ni descontar stock.
    const previa = await prisma.ventaBuffet.findUnique({ where: { uid: input.uid } });
    if (previa) return estadoDe(previa.cajaId);

    const caja = await cajaAbierta();
    if (!caja) throw Conflict('No hay una caja abierta');

    const producto = input.codigoBarra
      ? await prisma.productoBuffet.findFirst({ where: { codigoBarra: input.codigoBarra, activo: true } })
      : await prisma.productoBuffet.findFirst({ where: { id: input.productoId, activo: true } });
    if (!producto) throw NotFound('ProductoBuffet', input.codigoBarra ?? input.productoId);

    await prisma.$transaction([
      prisma.ventaBuffet.create({
        data: { uid: input.uid, cajaId: caja.id, productoId: producto.id, precioUnit: producto.precio },
      }),
      // El stock puede quedar negativo a propósito: trabar el mostrador es peor.
      prisma.productoBuffet.update({ where: { id: producto.id }, data: { stock: { decrement: 1 } } }),
    ]);

    return estadoDe(caja.id);
  },
};
```

- [ ] **Step 5: Las rutas del mostrador**

En `backend/src/routes/buffet.routes.ts`, agregar el import y las rutas en la sección de mostrador:

```ts
import { buffetCajaService } from '../services/buffetCaja.service.js';
import { ventaSchema } from '../validators/buffet.schema.js';
```

```ts
buffetRoutes.post('/caja/abrir', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetCajaService.abrir()); } catch (e) { next(e); }
});

buffetRoutes.get('/caja/actual', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetCajaService.actual()); } catch (e) { next(e); }
});

buffetRoutes.post('/venta', authBuffet, validate(ventaSchema), async (req, res, next) => {
  try { res.json(await buffetCajaService.vender((req as any).valid.body)); } catch (e) { next(e); }
});
```

- [ ] **Step 6: Correr los tests**

```bash
cd backend && npx vitest run tests/integration/buffet-venta.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
cd backend && npm run typecheck
git add src/services/buffetCaja.service.ts src/validators/buffet.schema.ts src/routes/buffet.routes.ts tests/integration/buffet-venta.test.ts
git commit -m "feat(buffet): abrir caja y vender con idempotencia por uid"
```

---

## Task 4: Backend — deshacer último y cerrar caja

**Files:**
- Modify: `backend/src/services/buffetCaja.service.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-cierre.test.ts`

**Interfaces:**
- Consumes: `buffetCajaService.abrir/actual/vender`, `CajaEstado`.
- Produces: `buffetCajaService.deshacerUltima(): Promise<CajaEstado>`; `.cerrar(): Promise<CierreDTO>`; `.listCierres(): Promise<CierreDTO[]>`.
  ```ts
  export interface LineaCierre { productoId: string; nombre: string; unidades: number; monto: number }
  export interface CierreDTO {
    id: string; abiertaEn: string; cerradaEn: string;
    totalUnidades: number; totalMonto: number; porProducto: LineaCierre[];
  }
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/buffet-cierre.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let token: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const mostrador = (r: any) => r.set('x-buffet-key', KEY);

async function sembrar() {
  const p = getPrisma();
  const coca = await p.productoBuffet.create({ data: { nombre: 'Coca', codigoBarra: '111', precio: '1500', stock: 10 } });
  const pancho = await p.productoBuffet.create({ data: { nombre: 'Pancho', precio: '2500', stock: 5, enBotonera: true } });
  return { coca, pancho };
}

describe('buffet: deshacer y cerrar', () => {
  it('deshacer borra la ultima venta y repone el stock', async () => {
    const { coca } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u1', codigoBarra: '111' });
    await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u2', codigoBarra: '111' });

    const r = await mostrador(supertest(app).delete('/buffet/venta/ultima'));
    expect(r.status).toBe(200);
    expect(r.body.totalUnidades).toBe(1);
    expect(r.body.totalMonto).toBe(1500);

    const p = await getPrisma().productoBuffet.findUnique({ where: { id: coca.id } });
    expect(p!.stock).toBe(9); // 10 - 2 + 1
  });

  it('deshacer sin ventas devuelve 409', async () => {
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).delete('/buffet/venta/ultima'));
    expect(r.status).toBe(409);
  });

  it('deshacer sin caja abierta devuelve 409', async () => {
    const r = await mostrador(supertest(app).delete('/buffet/venta/ultima'));
    expect(r.status).toBe(409);
  });

  it('cerrar congela los totales y devuelve el detalle por producto', async () => {
    await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u1', codigoBarra: '111' });
    await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u2', codigoBarra: '111' });
    const { pancho } = await sembrar().catch(() => ({ pancho: null as any }));
    void pancho;

    const r = await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    expect(r.status).toBe(200);
    expect(r.body.totalUnidades).toBe(2);
    expect(r.body.totalMonto).toBe(3000);
    expect(r.body.porProducto).toEqual([{ productoId: expect.any(String), nombre: 'Coca', unidades: 2, monto: 3000 }]);

    const caja = await getPrisma().cajaBuffet.findFirstOrThrow();
    expect(caja.estado).toBe('CERRADA');
    expect(caja.totalUnidades).toBe(2);
    expect(Number(caja.totalMonto)).toBe(3000);
    expect(caja.cerradaEn).not.toBeNull();
  });

  it('cerrar sin caja abierta devuelve 409', async () => {
    const r = await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    expect(r.status).toBe(409);
  });

  it('cerrar dos veces devuelve 409 la segunda', async () => {
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    const r = await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    expect(r.status).toBe(409);
  });

  it('despues de cerrar se puede abrir una caja nueva', async () => {
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    const r = await mostrador(supertest(app).post('/buffet/caja/abrir'));
    expect(r.status).toBe(200);
    expect(await getPrisma().cajaBuffet.count()).toBe(2);
  });

  it('el admin ve los cierres; la buffet-key no', async () => {
    await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/venta')).send({ uid: 'u1', codigoBarra: '111' });
    await mostrador(supertest(app).post('/buffet/caja/cerrar'));

    const no = await supertest(app).get('/buffet/cajas').set('x-buffet-key', KEY);
    expect(no.status).toBe(401);

    const si = await supertest(app).get('/buffet/cajas').set('authorization', `Bearer ${token}`);
    expect(si.status).toBe(200);
    expect(si.body).toHaveLength(1);
    expect(si.body[0].totalMonto).toBe(1500);
    expect(si.body[0].porProducto[0].nombre).toBe('Coca');
  });
});
```

> Nota para el implementador: en el test "cerrar congela los totales", la segunda llamada a `sembrar()` falla a propósito por el código de barras duplicado y se traga el error con `.catch`. Si te resulta confuso, borrá esas dos líneas (`const { pancho } = ...` y `void pancho;`) — no aportan a la aserción.

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/buffet-cierre.test.ts
```

Expected: FAIL — 404 en `DELETE /buffet/venta/ultima`.

- [ ] **Step 3: Agregar `deshacerUltima`, `cerrar` y `listCierres` al servicio**

En `backend/src/services/buffetCaja.service.ts`, agregar los tipos arriba y los métodos dentro de `buffetCajaService`:

```ts
export interface LineaCierre { productoId: string; nombre: string; unidades: number; monto: number }
export interface CierreDTO {
  id: string; abiertaEn: string; cerradaEn: string;
  totalUnidades: number; totalMonto: number; porProducto: LineaCierre[];
}
```

```ts
  async deshacerUltima(): Promise<CajaEstado> {
    const caja = await cajaAbierta();
    if (!caja) throw Conflict('No hay una caja abierta');
    const ultima = await prisma.ventaBuffet.findFirst({ where: { cajaId: caja.id }, orderBy: { creadoEn: 'desc' } });
    if (!ultima) throw Conflict('No hay ventas para deshacer');

    await prisma.$transaction([
      prisma.ventaBuffet.delete({ where: { id: ultima.id } }),
      prisma.productoBuffet.update({ where: { id: ultima.productoId }, data: { stock: { increment: 1 } } }),
    ]);
    return estadoDe(caja.id);
  },

  async cerrar(): Promise<CierreDTO> {
    const caja = await cajaAbierta();
    if (!caja) throw Conflict('No hay una caja abierta');
    const est = await estadoDe(caja.id);
    await prisma.cajaBuffet.update({
      where: { id: caja.id },
      data: { estado: 'CERRADA', cerradaEn: new Date(), totalUnidades: est.totalUnidades, totalMonto: est.totalMonto },
    });
    return (await detalleCierre(caja.id))!;
  },

  async listCierres(): Promise<CierreDTO[]> {
    const cajas = await prisma.cajaBuffet.findMany({ where: { estado: 'CERRADA' }, orderBy: { cerradaEn: 'desc' } });
    const out: CierreDTO[] = [];
    for (const c of cajas) { const d = await detalleCierre(c.id); if (d) out.push(d); }
    return out;
  },
```

Y la función auxiliar, junto a `estadoDe`:

```ts
async function detalleCierre(cajaId: string): Promise<CierreDTO | null> {
  const caja = await prisma.cajaBuffet.findUnique({ where: { id: cajaId } });
  if (!caja || !caja.cerradaEn) return null;
  const ventas = await prisma.ventaBuffet.findMany({
    where: { cajaId }, include: { producto: { select: { nombre: true } } },
  });
  const mapa = new Map<string, LineaCierre>();
  for (const v of ventas) {
    const l = mapa.get(v.productoId) ?? { productoId: v.productoId, nombre: v.producto.nombre, unidades: 0, monto: 0 };
    l.unidades += 1;
    l.monto += Number(v.precioUnit);
    mapa.set(v.productoId, l);
  }
  return {
    id: caja.id,
    abiertaEn: caja.abiertaEn.toISOString(),
    cerradaEn: caja.cerradaEn.toISOString(),
    totalUnidades: caja.totalUnidades ?? 0,
    totalMonto: Number(caja.totalMonto ?? 0),
    porProducto: [...mapa.values()].sort((a, b) => b.monto - a.monto),
  };
}
```

- [ ] **Step 4: Las rutas**

En `backend/src/routes/buffet.routes.ts`:

```ts
buffetRoutes.delete('/venta/ultima', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetCajaService.deshacerUltima()); } catch (e) { next(e); }
});

buffetRoutes.post('/caja/cerrar', authBuffet, async (_req, res, next) => {
  try { res.json(await buffetCajaService.cerrar()); } catch (e) { next(e); }
});

buffetRoutes.get('/cajas', authJwt, async (_req, res, next) => {
  try { res.json(await buffetCajaService.listCierres()); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Correr toda la suite del buffet**

```bash
cd backend && npx vitest run tests/integration/buffet-
```

Expected: PASS, 30 tests en 4 archivos.

- [ ] **Step 6: Commit**

```bash
cd backend && npm run typecheck
git add src/services/buffetCaja.service.ts src/routes/buffet.routes.ts tests/integration/buffet-cierre.test.ts
git commit -m "feat(buffet): deshacer ultima venta y cerrar caja con totales congelados"
```

---

## Task 5: Backend — PIN del mostrador

**Files:**
- Create: `backend/src/services/buffetPin.service.ts`
- Modify: `backend/src/validators/buffet.schema.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-pin.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword` de `src/utils/password.ts`; `authBuffet`; `authJwt`.
- Produces: `buffetPinService.setear(pin: string): Promise<void>`; `.verificar(pin: string): Promise<boolean>`. Rutas `PUT /buffet/pin` (admin) y `POST /buffet/pin/verificar` (mostrador, rate-limited).

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/buffet-pin.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let token: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('buffet: PIN del mostrador', () => {
  it('sin PIN configurado, verificar devuelve ok:false (no deja entrar a nadie)', async () => {
    const r = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '1234' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
  });

  it('el admin setea el PIN y el mostrador lo verifica', async () => {
    const s = await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`).send({ pin: '4321' });
    expect(s.status).toBe(204);

    const ok = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '4321' });
    expect(ok.body.ok).toBe(true);

    const mal = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '0000' });
    expect(mal.body.ok).toBe(false);
  });

  it('el PIN se guarda hasheado, nunca en claro', async () => {
    await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`).send({ pin: '4321' });
    const cfg = await supertest(app).get('/config').set('authorization', `Bearer ${token}`);
    expect(JSON.stringify(cfg.body)).not.toContain('4321');
  });

  it('el PIN debe tener 4 digitos', async () => {
    const a = await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`).send({ pin: '12' });
    expect(a.status).toBe(400);
    const b = await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`).send({ pin: 'abcd' });
    expect(b.status).toBe(400);
  });

  it('la buffet-key no puede setear el PIN', async () => {
    const r = await supertest(app).put('/buffet/pin').set('x-buffet-key', KEY).send({ pin: '4321' });
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/buffet-pin.test.ts
```

Expected: FAIL — 404 en `POST /buffet/pin/verificar`.

- [ ] **Step 3: Schemas del PIN**

En `backend/src/validators/buffet.schema.ts`:

```ts
const pin4 = z.string().regex(/^\d{4}$/, 'El PIN son 4 dígitos');
export const setPinSchema = z.object({ body: z.object({ pin: pin4 }), query: empty, params: empty });
export const verificarPinSchema = z.object({ body: z.object({ pin: pin4 }), query: empty, params: empty });
```

- [ ] **Step 4: El servicio**

Crear `backend/src/services/buffetPin.service.ts`:

```ts
import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

const CONFIG_ID = 'default';

export const buffetPinService = {
  async setear(pin: string): Promise<void> {
    const buffetPinHash = await hashPassword(pin);
    await prisma.configuracion.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, buffetPinHash },
      update: { buffetPinHash },
    });
  },

  async verificar(pin: string): Promise<boolean> {
    const cfg = await prisma.configuracion.findUnique({ where: { id: CONFIG_ID } });
    // Sin PIN configurado no entra nadie: un hash vacío nunca matchea.
    if (!cfg?.buffetPinHash) return false;
    return verifyPassword(pin, cfg.buffetPinHash);
  },
};
```

- [ ] **Step 5: Las rutas**

En `backend/src/routes/buffet.routes.ts`, agregar imports (`loginLimiter` reusa el anti-fuerza-bruta del login: 10 intentos cada 15 min por IP) y rutas:

```ts
import { loginLimiter } from '../middlewares/rateLimiters.js';
import { buffetPinService } from '../services/buffetPin.service.js';
import { setPinSchema, verificarPinSchema } from '../validators/buffet.schema.js';
```

```ts
buffetRoutes.post('/pin/verificar', authBuffet, loginLimiter, validate(verificarPinSchema), async (req, res, next) => {
  try { res.json({ ok: await buffetPinService.verificar((req as any).valid.body.pin) }); } catch (e) { next(e); }
});

buffetRoutes.put('/pin', authJwt, validate(setPinSchema), async (req, res, next) => {
  try { await buffetPinService.setear((req as any).valid.body.pin); res.status(204).end(); } catch (e) { next(e); }
});
```

- [ ] **Step 6: Verificar que `GET /config` no filtre el hash**

Abrir `backend/src/services/config.service.ts`. Si el `get()` devuelve la fila completa de `Configuracion`, **excluir `buffetPinHash`** del objeto devuelto (por ejemplo con un `select` explícito o destructurando y descartando el campo). El test "el PIN se guarda hasheado" lo cubre parcialmente; este paso lo cubre de verdad.

- [ ] **Step 7: Correr toda la suite del buffet**

```bash
cd backend && npx vitest run tests/integration/buffet-
```

Expected: PASS, 35 tests.

- [ ] **Step 8: Correr la suite completa (chequear que no rompimos nada)**

```bash
cd backend && npm test
```

Expected: PASS salvo 4 fallos **preexistentes** (3 en `sena`, 1 en `disponibilidad-tamano`). Si aparece cualquier otro fallo, es culpa nuestra: arreglarlo antes de seguir.

- [ ] **Step 9: Commit y merge a `main` (SIN PUSH)**

```bash
cd backend
npm run typecheck
git add src/services/buffetPin.service.ts src/validators/buffet.schema.ts src/routes/buffet.routes.ts src/services/config.service.ts tests/integration/buffet-pin.test.ts
git commit -m "feat(buffet): PIN del mostrador (hash bcrypt en Configuracion)"
git checkout main
git merge --no-ff feat/buffet-stock -m "Merge feat/buffet-stock: modulo buffet (backend)"
git log --oneline -1
```

**NO ejecutar `git push`.** Avisar al usuario que el backend está listo para que él lo pushee, y recordarle que al deployar hay que agregar `BUFFET_API_KEY` al `.env` de la VM.

---

## Task 6: Frontend — sesión del mostrador (cookie firmada) y pantalla de PIN

**Files:**
- Create: `frontend/src/lib/buffet-api.ts`
- Create: `frontend/src/lib/buffet-session.ts`
- Create: `frontend/src/app/mostrador/pin/page.tsx`
- Create: `frontend/src/components/mostrador/pin-form.tsx`
- Modify: `frontend/src/middleware.ts`
- Test: `frontend/src/lib/buffet-session.test.ts`

**Interfaces:**
- Produces: `buffetFetch<T>(path, init?): Promise<T>`; `firmarToken(expMs: number): string`; `tokenValido(token: string): boolean`; `crearSesionBuffet()`; `sesionBuffetValida(): Promise<boolean>`; `requireSesionBuffet(): Promise<void>` (tira si no hay sesión); server action `verificarPin(pin: string): Promise<{ ok: boolean }>`.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/lib/buffet-session.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { firmarToken, tokenValido } from './buffet-session';

beforeEach(() => { process.env.BUFFET_API_KEY = 'clave-de-prueba-1234567890'; });

describe('token de sesion del mostrador', () => {
  it('un token recien firmado es valido', () => {
    expect(tokenValido(firmarToken(Date.now() + 60_000))).toBe(true);
  });

  it('un token vencido no es valido', () => {
    expect(tokenValido(firmarToken(Date.now() - 1))).toBe(false);
  });

  it('un token con la firma alterada no es valido', () => {
    const t = firmarToken(Date.now() + 60_000);
    const [exp] = t.split('.');
    expect(tokenValido(`${exp}.firmafalsa`)).toBe(false);
  });

  it('cambiar el exp sin refirmar invalida el token', () => {
    const t = firmarToken(Date.now() + 1000);
    const [, sig] = t.split('.');
    expect(tokenValido(`${Date.now() + 999_999}.${sig}`)).toBe(false);
  });

  it('basura no rompe, devuelve false', () => {
    expect(tokenValido('')).toBe(false);
    expect(tokenValido('sin-punto')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd frontend && pnpm vitest run src/lib/buffet-session.test.ts
```

Expected: FAIL — no existe `./buffet-session`.

- [ ] **Step 3: `buffet-session.ts`**

Crear `frontend/src/lib/buffet-session.ts`:

```ts
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const BUFFET_COOKIE = 'buffet';
const DIAS_30 = 30 * 24 * 60 * 60 * 1000;

// Reusamos BUFFET_API_KEY como clave HMAC: una env var menos que sincronizar
// entre Vercel y la VM, y nunca sale del servidor.
function secreto(): string {
  const s = process.env.BUFFET_API_KEY;
  if (!s) throw new Error('BUFFET_API_KEY no configurada');
  return s;
}

const firmar = (exp: string) => createHmac('sha256', secreto()).update(exp).digest('hex');

export function firmarToken(expMs: number): string {
  const exp = String(expMs);
  return `${exp}.${firmar(exp)}`;
}

export function tokenValido(token: string): boolean {
  const [exp, sig] = (token ?? '').split('.');
  if (!exp || !sig) return false;
  const esperada = Buffer.from(firmar(exp));
  const dada = Buffer.from(sig);
  if (esperada.length !== dada.length) return false;
  if (!timingSafeEqual(esperada, dada)) return false;
  return Number(exp) > Date.now();
}

export async function crearSesionBuffet(): Promise<void> {
  const jar = await cookies();
  jar.set(BUFFET_COOKIE, firmarToken(Date.now() + DIAS_30), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/mostrador', maxAge: DIAS_30 / 1000,
  });
}

export async function sesionBuffetValida(): Promise<boolean> {
  const t = (await cookies()).get(BUFFET_COOKIE)?.value;
  return !!t && tokenValido(t);
}

export async function requireSesionBuffet(): Promise<void> {
  if (!(await sesionBuffetValida())) throw new Error('Sesión de buffet inválida');
}
```

- [ ] **Step 4: Correr el test — debe pasar**

```bash
cd frontend && pnpm vitest run src/lib/buffet-session.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: `buffet-api.ts`**

Crear `frontend/src/lib/buffet-api.ts` (`parseApiError` vive en `src/lib/api.ts` y `ApiError` en `src/lib/types.ts`):

```ts
import 'server-only';
import { parseApiError } from './api';
import { ApiError } from './types';

/** Llama al backend con la llave del buffet. La key vive solo en el server. */
export async function buffetFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.API_URL;
  const key = process.env.BUFFET_API_KEY;
  if (!base) throw new Error('API_URL no configurada');
  if (!key) throw new Error('BUFFET_API_KEY no configurada');

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-buffet-key': key, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, parseApiError(body, res.status));
  return body as T;
}
```

- [ ] **Step 6: Exceptuar `/mostrador` del middleware**

En `frontend/src/middleware.ts`, como **primera línea** dentro de `export function middleware(req: NextRequest)`:

```ts
  // El mostrador del buffet no usa el login de admin: se gatea con su propio PIN
  // dentro de la ruta (ver src/lib/buffet-session.ts). Sin este early-return, el
  // middleware lo mandaría a /login y la pantalla sería inalcanzable.
  if (req.nextUrl.pathname.startsWith('/mostrador')) return NextResponse.next();
```

- [ ] **Step 7: La pantalla de PIN**

Crear `frontend/src/components/mostrador/pin-form.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { verificarPin } from '@/lib/buffet-actions';

export function PinForm() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function enviar(valor: string) {
    setCargando(true);
    setError('');
    const r = await verificarPin(valor);
    setCargando(false);
    if (r.ok) router.replace('/mostrador');
    else { setError('PIN incorrecto'); setPin(''); }
  }

  function tecla(d: string) {
    if (cargando) return;
    const siguiente = (pin + d).slice(0, 4);
    setPin(siguiente);
    if (siguiente.length === 4) void enviar(siguiente);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-3xl font-semibold">Buffet</h1>

      <div className="flex gap-3" aria-label="PIN ingresado">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-5 w-5 rounded-full border-2 ${i < pin.length ? 'bg-neutral-900 border-neutral-900' : 'border-neutral-300'}`} />
        ))}
      </div>

      {error && <p className="text-lg font-medium text-red-600">{error}</p>}

      <div className="grid w-full grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => tecla(d)} disabled={cargando}
            className="h-20 rounded-2xl border border-neutral-300 bg-white text-3xl font-semibold active:scale-95 disabled:opacity-50">
            {d}
          </button>
        ))}
        <button type="button" onClick={() => setPin('')} disabled={cargando}
          className="h-20 rounded-2xl border border-neutral-300 bg-white text-lg font-medium active:scale-95">
          Borrar
        </button>
        <button type="button" onClick={() => tecla('0')} disabled={cargando}
          className="h-20 rounded-2xl border border-neutral-300 bg-white text-3xl font-semibold active:scale-95 disabled:opacity-50">
          0
        </button>
      </div>
    </div>
  );
}
```

Crear `frontend/src/app/mostrador/pin/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { sesionBuffetValida } from '@/lib/buffet-session';
import { PinForm } from '@/components/mostrador/pin-form';

export default async function MostradorPinPage() {
  if (await sesionBuffetValida()) redirect('/mostrador');
  return <PinForm />;
}
```

- [ ] **Step 8: El server action `verificarPin`**

Crear `frontend/src/lib/buffet-actions.ts`:

```ts
'use server';
import { buffetFetch } from './buffet-api';
import { crearSesionBuffet } from './buffet-session';

export async function verificarPin(pin: string): Promise<{ ok: boolean }> {
  try {
    const r = await buffetFetch<{ ok: boolean }>('/buffet/pin/verificar', {
      method: 'POST', body: JSON.stringify({ pin }),
    });
    if (r.ok) await crearSesionBuffet();
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 9: Verificar el build**

```bash
cd frontend && pnpm build
```

Expected: compila. Si tira `Route "/mostrador/pin" ...` sobre server actions, revisar `frontend/AGENTS.md` y la doc en `node_modules/next/dist/docs/` — hay un gotcha conocido de server actions que rompe `next build` en esta versión.

- [ ] **Step 10: Commit**

```bash
cd frontend
git checkout -b feat/buffet-mostrador
git add src/lib/buffet-api.ts src/lib/buffet-session.ts src/lib/buffet-session.test.ts src/lib/buffet-actions.ts src/middleware.ts src/app/mostrador src/components/mostrador
git commit -m "feat(mostrador): sesion con cookie firmada y pantalla de PIN"
```

---

## Task 7: Frontend — la pantalla del mostrador

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/buffet-actions.ts`
- Create: `frontend/src/app/mostrador/page.tsx`
- Create: `frontend/src/components/mostrador/pantalla-venta.tsx`
- Test: `frontend/src/components/mostrador/pantalla-venta.test.tsx`

**Interfaces:**
- Consumes: `buffetFetch`, `requireSesionBuffet`, `sesionBuffetValida`, `CajaEstado` del backend.
- Produces: server actions `abrirCaja()`, `vender(input)`, `deshacerUltima()`, `cerrarCaja()`; todas devuelven `Resultado<CajaEstado>` o `Resultado<CierreBuffet>`.
  ```ts
  export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };
  ```

- [ ] **Step 1: Los tipos**

En `frontend/src/lib/types.ts`, al final:

```ts
export interface ProductoBuffet {
  id: string; nombre: string; codigoBarra: string | null; precio: number;
  stock: number; stockMinimo: number; enBotonera: boolean; orden: number; activo: boolean;
}
export interface VentaBuffet { id: string; productoId: string; nombre: string; precioUnit: number; creadoEn: string }
export interface CajaBuffetEstado {
  id: string; abiertaEn: string; totalUnidades: number; totalMonto: number; ultimas: VentaBuffet[];
}
export interface LineaCierreBuffet { productoId: string; nombre: string; unidades: number; monto: number }
export interface CierreBuffet {
  id: string; abiertaEn: string; cerradaEn: string;
  totalUnidades: number; totalMonto: number; porProducto: LineaCierreBuffet[];
}
```

- [ ] **Step 2: Los server actions**

En `frontend/src/lib/buffet-actions.ts`, agregar (dejando `verificarPin` como está):

```ts
import { requireSesionBuffet } from './buffet-session';
import { ApiError } from './types';
import type { CajaBuffetEstado, CierreBuffet, ProductoBuffet } from './types';

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

async function conSesion<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    await requireSesionBuffet();
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

export async function abrirCaja(): Promise<Resultado<CajaBuffetEstado>> {
  return conSesion(() => buffetFetch<CajaBuffetEstado>('/buffet/caja/abrir', { method: 'POST' }));
}

export async function vender(input: { uid: string; codigoBarra?: string; productoId?: string }): Promise<Resultado<CajaBuffetEstado>> {
  return conSesion(() => buffetFetch<CajaBuffetEstado>('/buffet/venta', { method: 'POST', body: JSON.stringify(input) }));
}

export async function deshacerUltima(): Promise<Resultado<CajaBuffetEstado>> {
  return conSesion(() => buffetFetch<CajaBuffetEstado>('/buffet/venta/ultima', { method: 'DELETE' }));
}

export async function cerrarCaja(): Promise<Resultado<CierreBuffet>> {
  return conSesion(() => buffetFetch<CierreBuffet>('/buffet/caja/cerrar', { method: 'POST' }));
}
```

Y en `buffet-api.ts` nada cambia. En el import de `buffet-actions.ts` agregar `ProductoBuffet` solo si se usa; si no, sacarlo (el linter se queja).

- [ ] **Step 3: Escribir el test que falla**

Crear `frontend/src/components/mostrador/pantalla-venta.test.tsx`. Testea la **lógica pura** del acumulador de escaneo, que es lo que se puede automatizar:

```tsx
import { describe, it, expect } from 'vitest';
import { parseEscaneo } from './pantalla-venta';

describe('parseEscaneo', () => {
  it('acumula digitos y no emite hasta el Enter', () => {
    expect(parseEscaneo('779', '0')).toEqual({ buffer: '7790', codigo: null });
  });

  it('con Enter emite el codigo y limpia el buffer', () => {
    expect(parseEscaneo('7790895', 'Enter')).toEqual({ buffer: '', codigo: '7790895' });
  });

  it('Enter con buffer vacio no emite nada', () => {
    expect(parseEscaneo('', 'Enter')).toEqual({ buffer: '', codigo: null });
  });

  it('ignora teclas que no son caracteres unicos', () => {
    expect(parseEscaneo('779', 'Shift')).toEqual({ buffer: '779', codigo: null });
  });
});
```

- [ ] **Step 4: Correr el test para verificar que falla**

```bash
cd frontend && pnpm vitest run src/components/mostrador/pantalla-venta.test.tsx
```

Expected: FAIL — no existe `parseEscaneo`.

- [ ] **Step 5: La pantalla**

Crear `frontend/src/components/mostrador/pantalla-venta.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import type { CajaBuffetEstado, ProductoBuffet } from '@/lib/types';
import { abrirCaja, vender, deshacerUltima, cerrarCaja } from '@/lib/buffet-actions';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Acumulador del lector: es un teclado que "tipea" el código y cierra con Enter. */
export function parseEscaneo(buffer: string, key: string): { buffer: string; codigo: string | null } {
  if (key === 'Enter') return buffer ? { buffer: '', codigo: buffer } : { buffer: '', codigo: null };
  if (key.length !== 1) return { buffer, codigo: null }; // Shift, Tab, etc.
  return { buffer: buffer + key, codigo: null };
}

export function PantallaVenta({ inicial, botonera }: { inicial: CajaBuffetEstado | null; botonera: ProductoBuffet[] }) {
  const [caja, setCaja] = useState(inicial);
  const [ultimo, setUltimo] = useState<string>('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const buffer = useRef('');
  const foco = useRef<HTMLInputElement>(null);

  // El lector escribe donde esté el foco. Si el foco se va (un botón, un click en
  // cualquier lado), el escaneo siguiente se pierde en el vacío. Lo recuperamos siempre.
  useEffect(() => {
    const recuperar = () => foco.current?.focus();
    recuperar();
    const id = setInterval(recuperar, 1000);
    document.addEventListener('click', recuperar);
    return () => { clearInterval(id); document.removeEventListener('click', recuperar); };
  }, []);

  function aplicar(r: Awaited<ReturnType<typeof vender>>, nombre?: string) {
    if (r.ok) { setCaja(r.data); setError(''); if (nombre) setUltimo(nombre); }
    else { setError(r.error); }
  }

  async function onCodigo(codigo: string) {
    if (ocupado) return;
    setOcupado(true);
    const r = await vender({ uid: crypto.randomUUID(), codigoBarra: codigo });
    setOcupado(false);
    if (!r.ok) { setUltimo(''); setError('Producto no cargado'); return; }
    setCaja(r.data);
    setError('');
    setUltimo(r.data.ultimas[0]?.nombre ?? '');
  }

  async function onBoton(p: ProductoBuffet) {
    if (ocupado) return;
    setOcupado(true);
    const r = await vender({ uid: crypto.randomUUID(), productoId: p.id });
    setOcupado(false);
    aplicar(r, p.nombre);
  }

  if (!caja) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <button type="button" disabled={ocupado}
          onClick={async () => { setOcupado(true); const r = await abrirCaja(); setOcupado(false); if (r.ok) setCaja(r.data); else setError(r.error); }}
          className="h-32 w-full max-w-md rounded-3xl bg-emerald-600 text-4xl font-semibold text-white active:scale-95">
          Abrir caja
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <input ref={foco} className="sr-only" aria-hidden tabIndex={-1} autoFocus
        onKeyDown={(e) => {
          const r = parseEscaneo(buffer.current, e.key);
          buffer.current = r.buffer;
          if (r.codigo) { e.preventDefault(); void onCodigo(r.codigo); }
        }}
        onChange={() => { /* el valor real vive en buffer.current */ }} value="" />

      <header className="rounded-2xl bg-emerald-50 p-5 text-center ring-1 ring-emerald-600/20">
        <p className="text-lg font-medium text-emerald-700">Total del turno</p>
        <p className="text-6xl font-bold tabular-nums text-emerald-800">{money(caja.totalMonto)}</p>
        <p className="mt-1 text-lg text-emerald-700">{caja.totalUnidades} productos</p>
      </header>

      <div aria-live="polite" className="min-h-16 rounded-2xl p-4 text-center text-2xl font-semibold">
        {error && <span className="text-red-600">{error}</span>}
        {!error && ultimo && <span>{ultimo} — {money(caja.ultimas[0]?.precioUnit ?? 0)}</span>}
      </div>

      <section className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
        {botonera.map((p) => (
          <button key={p.id} type="button" disabled={ocupado}
            onMouseDown={(e) => e.preventDefault()}  // no le roba el foco al lector
            onClick={() => void onBoton(p)}
            className="min-h-28 rounded-2xl border-2 border-neutral-300 bg-white p-4 text-2xl font-semibold active:scale-95 disabled:opacity-50">
            {p.nombre}
            <span className="mt-1 block text-lg font-normal text-neutral-500">{money(p.precio)}</span>
          </button>
        ))}
      </section>

      <footer className="flex gap-3">
        <button type="button" disabled={ocupado || caja.totalUnidades === 0}
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => { setOcupado(true); const r = await deshacerUltima(); setOcupado(false); aplicar(r); setUltimo(''); }}
          className="h-20 flex-1 rounded-2xl border-2 border-neutral-300 bg-white text-2xl font-semibold active:scale-95 disabled:opacity-40">
          Deshacer último
        </button>
        <button type="button" disabled={ocupado}
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            if (!confirm(`¿Cerrar la caja? Se vendieron ${money(caja.totalMonto)}.`)) return;
            setOcupado(true); const r = await cerrarCaja(); setOcupado(false);
            if (r.ok) { alert(`Caja cerrada.\n${r.data.totalUnidades} productos — ${money(r.data.totalMonto)}`); setCaja(null); setUltimo(''); }
            else setError(r.error);
          }}
          className="h-20 flex-1 rounded-2xl bg-neutral-900 text-2xl font-semibold text-white active:scale-95">
          Cerrar caja
        </button>
      </footer>
    </main>
  );
}
```

- [ ] **Step 6: La página**

Crear `frontend/src/app/mostrador/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { sesionBuffetValida } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { CajaBuffetEstado, ProductoBuffet } from '@/lib/types';
import { PantallaVenta } from '@/components/mostrador/pantalla-venta';

export default async function MostradorPage() {
  if (!(await sesionBuffetValida())) redirect('/mostrador/pin');
  const [caja, botonera] = await Promise.all([
    buffetFetch<CajaBuffetEstado | null>('/buffet/caja/actual'),
    buffetFetch<ProductoBuffet[]>('/buffet/productos/botonera'),
  ]);
  return <PantallaVenta inicial={caja} botonera={botonera} />;
}
```

- [ ] **Step 7: Correr el test — debe pasar**

```bash
cd frontend && pnpm vitest run src/components/mostrador/pantalla-venta.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Build**

```bash
cd frontend && pnpm build
```

Expected: compila y typechequea.

- [ ] **Step 9: PRUEBA MANUAL OBLIGATORIA con el lector real**

Esto **no se puede automatizar** y es la parte más frágil de la feature. Con el lector conectado y la app corriendo (`pnpm dev`, con `API_URL` y `BUFFET_API_KEY` en `.env.local`):

1. Escanear un producto → aparece el nombre y el total sube.
2. **Tocar un botón de la botonera y volver a escanear** → el escaneo tiene que funcionar. Si no pasa nada, el `onMouseDown`/`preventDefault` no está reteniendo el foco.
3. Hacer click en cualquier lugar vacío de la pantalla y escanear → tiene que funcionar.
4. Escanear un código inexistente → cartel rojo "Producto no cargado", el total no cambia.
5. "Deshacer último" → el total baja y el stock vuelve.

Anotar el resultado. Si algo falla, arreglarlo antes de commitear.

- [ ] **Step 10: Commit**

```bash
cd frontend
git add src/lib/types.ts src/lib/buffet-actions.ts src/app/mostrador/page.tsx src/components/mostrador
git commit -m "feat(mostrador): pantalla de venta con lector, botonera, deshacer y cierre"
```

---

## Task 8: Frontend — sección Buffet en el panel de admin

**Files:**
- Create: `frontend/src/lib/buffet-admin-actions.ts`
- Create: `frontend/src/app/(panel)/buffet/page.tsx`
- Create: `frontend/src/app/(panel)/buffet/cierres/page.tsx`
- Create: `frontend/src/components/buffet/productos-table.tsx`
- Create: `frontend/src/components/buffet/producto-dialog.tsx`
- Modify: `frontend/src/components/nav-items.tsx`
- Modify: `frontend/src/components/nav-items.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (JWT de admin, NO `buffetFetch`), `ProductoBuffet`, `CierreBuffet`.
- Produces: server actions `crearProducto`, `actualizarProducto`, `reponerStock`, `setPinBuffet`.

- [ ] **Step 1: Actualizar el test de navegación (va primero: define el contrato)**

En `frontend/src/components/nav-items.test.ts`, cambiar los conteos: Buffet entra en **Operación**, visible para ambos roles.

```ts
    expect(r.map((g) => g.items.length)).toEqual([6, 3, 4]); // ADMIN
```
```ts
    expect(r.map((g) => g.items.length)).toEqual([6, 1]); // RECEPCIONISTA
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd frontend && pnpm vitest run src/components/nav-items.test.ts
```

Expected: FAIL — recibe `[5, 3, 4]`, esperaba `[6, 3, 4]`.

- [ ] **Step 3: Agregar el ítem de navegación**

En `frontend/src/components/nav-items.tsx`, agregar `ShoppingBasket` al import de `lucide-react` y el ítem al final del grupo Operación (después de `/clientes`):

```ts
  { href: '/buffet', label: 'Buffet', icon: ShoppingBasket, roles: AMBOS, grupo: 'Operación' },
```

- [ ] **Step 4: Correr el test — debe pasar**

```bash
cd frontend && pnpm vitest run src/components/nav-items.test.ts
```

Expected: PASS.

- [ ] **Step 5: Los server actions de admin**

Crear `frontend/src/lib/buffet-admin-actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath('/buffet');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

type ProductoInput = {
  nombre: string; codigoBarra?: string | null; precio: number;
  stock?: number; stockMinimo?: number; enBotonera?: boolean; orden?: number; activo?: boolean;
};

export async function crearProducto(i: ProductoInput): Promise<Result> {
  return run(() => apiFetch('/buffet/productos', { method: 'POST', body: JSON.stringify(i) }));
}

export async function actualizarProducto(id: string, i: Partial<ProductoInput>): Promise<Result> {
  return run(() => apiFetch(`/buffet/productos/${id}`, { method: 'PATCH', body: JSON.stringify(i) }));
}

export async function reponerStock(id: string, cantidad: number): Promise<Result> {
  return run(() => apiFetch(`/buffet/productos/${id}/reponer`, { method: 'POST', body: JSON.stringify({ cantidad }) }));
}

export async function setPinBuffet(pin: string): Promise<Result> {
  return run(() => apiFetch('/buffet/pin', { method: 'PUT', body: JSON.stringify({ pin }) }));
}
```

- [ ] **Step 6: La página de catálogo + stock**

Crear `frontend/src/app/(panel)/buffet/page.tsx`:

```tsx
import { apiFetch } from '@/lib/api';
import type { ProductoBuffet } from '@/lib/types';
import { ProductosTable } from '@/components/buffet/productos-table';

export default async function BuffetPage() {
  const productos = await apiFetch<ProductoBuffet[]>('/buffet/productos');
  const bajos = productos.filter((p) => p.activo && p.stock <= p.stockMinimo);
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Buffet</h1>
        <p className="text-sm text-neutral-600">Catálogo y stock</p>
      </header>

      {bajos.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="font-medium text-amber-900">Stock bajo ({bajos.length})</p>
          <p className="mt-1 text-sm text-amber-800">{bajos.map((p) => `${p.nombre} (${p.stock})`).join(' · ')}</p>
        </div>
      )}

      <ProductosTable productos={productos} />
    </div>
  );
}
```

Crear `frontend/src/components/buffet/productos-table.tsx` y `producto-dialog.tsx` **siguiendo el patrón exacto** de `src/components/bloqueos/bloqueos-table.tsx` y `excepcion-bloqueo-dialog.tsx`: leerlos primero y copiar la estructura (lista desktop + lista mobile, `useState` para el diálogo, `useRouter().refresh()` tras una acción exitosa, `sonner` para el toast de error). La tabla muestra: nombre, código de barras (o "—"), precio, stock (en rojo si `stock <= stockMinimo`), botonera (sí/no), y dos botones: "Editar" y "Reponer".

- [ ] **Step 7: La página de cierres**

Crear `frontend/src/app/(panel)/buffet/cierres/page.tsx`:

```tsx
import { apiFetch } from '@/lib/api';
import type { CierreBuffet } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

export default async function CierresBuffetPage() {
  const cierres = await apiFetch<CierreBuffet[]>('/buffet/cajas');
  if (cierres.length === 0) return <p className="text-neutral-600">Todavía no hay cajas cerradas.</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Cierres del buffet</h1>
      {cierres.map((c) => (
        <article key={c.id} className="rounded-xl border bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-neutral-600">{fmt(c.cerradaEn)}</span>
            <span className="text-lg font-semibold tabular-nums">{money(c.totalMonto)}</span>
          </div>
          <p className="text-sm text-neutral-600">{c.totalUnidades} productos</p>
          <ul className="mt-2 space-y-1 text-sm">
            {c.porProducto.map((l) => (
              <li key={l.productoId} className="flex justify-between">
                <span>{l.nombre} × {l.unidades}</span>
                <span className="tabular-nums">{money(l.monto)}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Build y suite completa**

```bash
cd frontend && pnpm build && pnpm vitest run
```

Expected: compila; los tests pasan salvo los **2 fallos preexistentes** de `validators.test.ts` (`canchaSchema` con `jugadores=6`). Cualquier otro fallo es nuestro.

- [ ] **Step 9: Commit y merge a `master` (SIN PUSH)**

```bash
cd frontend
git add src/lib/buffet-admin-actions.ts "src/app/(panel)/buffet" src/components/buffet src/components/nav-items.tsx src/components/nav-items.test.ts
git commit -m "feat(buffet): seccion de admin (catalogo, stock y cierres)"
git checkout master
git merge --no-ff feat/buffet-mostrador -m "Merge feat/buffet-mostrador: buffet (mostrador + admin)"
git log --oneline -1
```

**NO ejecutar `git push`.**

---

## Cierre: qué queda en manos del usuario

Al terminar las 8 tareas, avisar exactamente esto:

1. **Nada está pusheado.** `main` (backend) y `master` (frontend) tienen los merges en local.
2. Antes de deployar hay que **generar la `BUFFET_API_KEY`** (por ejemplo `openssl rand -hex 24`) y cargarla en **dos lugares**: el `.env` de la VM `.36` y las env vars del proyecto en Vercel. **Tiene que ser el mismo valor.** Si difiere, o falta en uno, el mostrador da 401 sin explicación evidente.
3. El deploy del backend corre la migración `20260710120000_buffet_stock`.
4. **El PIN del buffet arranca vacío y con hash vacío nadie puede entrar.** El dueño tiene que setearlo una vez desde el panel antes de que el mostrador funcione. (Si no se agregó UI para eso en la Task 8, hacerlo con un `PUT /buffet/pin` autenticado.)
5. Queda pendiente la **prueba manual del foco del lector** (Task 7, Step 9) si no se pudo hacer con el hardware real.

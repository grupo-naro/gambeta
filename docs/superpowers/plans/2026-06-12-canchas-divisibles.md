# Canchas divisibles (recursos compuestos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir canchas que se alquilan enteras o divididas en N partes (ej. Cancha 4) sin doble reserva, administrables desde el panel.

**Architecture:** Se separa la unidad vendible (`Cancha`) del sector físico (`Sector`). Una reserva ocupa los sectores de su cancha (`ReservaSector`), y el anti-overlap (exclusion constraint gist) se mueve a `ReservaSector(sectorId, tstzrange)`. Una cancha divisible = un `CanchaGrupo` con la entera (mapea a todos los sectores) + N partes (1 sector c/u).

**Tech Stack:** Express 5 + TS + Prisma 7 (driver adapter, btree_gist) + Zod + Vitest/Supertest/Testcontainers. Frontend Next 16 + Tailwind 4 + shadcn(Base UI) + pnpm.

---

# PART 1 — Backend (`feat/canchas-divisibles-backend`)

**Branch:** desde `main`, en `c:/Users/Lautaro/Desktop/ortigoza/backend`. Docker corriendo (Testcontainers + `prisma migrate dev`). `npx vitest run`, `npx tsc --noEmit`.

**Contexto (estado actual, verificado):**
- `reserva.repo.ts`: `create` (cattchea 23P01 → Conflict), `updateEstado`, `reprogramar` (idem), `list`, `countByCancha`. Hay un helper `isExclusionViolation(e)` (exportarlo o reusarlo).
- `cancha.service.ts`: `create` hoy llama `horarioRepo.createDefaults` (que YA NO aplica — disponibilidad usa horario global). `eliminar` chequea `reservaRepo.countByCancha`.
- `disponibilidad.service.ts`: arma slots con `configService.get()` (horaApertura/Cierre) y hoy filtra `prisma.reserva` por `canchaId`.
- `reserva.service.ts`: `crear` usa `prisma.$transaction(tx => { cliente.upsert; reservaRepo.create(data, tx); pagoRepo... })`; `cancelar/aprobarSena/rechazarSena` usan `reservaRepo.updateEstado(id, estado, tx)` dentro de tx; `reprogramar` usa `reservaRepo.reprogramar(id, ini, fin, tx)`.
- Migración de constraint existente de referencia: `prisma/migrations/20260609013050_reserva_exclusion/migration.sql` (estilo SQL crudo con `EXCLUDE USING gist`).
- Errores: `Conflict` (409), `NotFound` (404), `BusinessRule` (422) en `src/utils/errors.ts`.

## Task B1: Modelo + migración (mueve el constraint) + backfill

**Files:**
- Modify: `prisma/schema.prisma`, `src/seed.ts`
- Create: migración(es) en `prisma/migrations/`
- Test: `tests/integration/sectores.test.ts` (create)

- [ ] **Step 1: Editar `prisma/schema.prisma`**

Agregar modelos y campos:
```prisma
model CanchaGrupo {
  id       String   @id @default(cuid())
  nombre   String
  creadoEn DateTime @default(now())
  canchas  Cancha[]
}

model Sector {
  id          String          @id @default(cuid())
  nombre      String
  canchas     CanchaSector[]
  ocupaciones ReservaSector[]
}

model CanchaSector {
  canchaId String
  sectorId String
  cancha   Cancha @relation(fields: [canchaId], references: [id], onDelete: Cascade)
  sector   Sector @relation(fields: [sectorId], references: [id], onDelete: Cascade)
  @@id([canchaId, sectorId])
}

model ReservaSector {
  id          String        @id @default(cuid())
  reservaId   String
  reserva     Reserva       @relation(fields: [reservaId], references: [id], onDelete: Cascade)
  sectorId    String
  sector      Sector        @relation(fields: [sectorId], references: [id])
  estado      EstadoReserva
  fechaInicio DateTime      @db.Timestamptz(3)
  fechaFin    DateTime      @db.Timestamptz(3)
  @@index([sectorId])
}
```
En `model Cancha` agregar:
```prisma
  grupoId   String?
  grupo     CanchaGrupo?   @relation(fields: [grupoId], references: [id])
  esEntera  Boolean        @default(false)
  sectores  CanchaSector[]
```
En `model Reserva` agregar la relación inversa: `sectores  ReservaSector[]`.

- [ ] **Step 2: Crear la migración de tablas/columnas**

Run: `npx prisma migrate dev --name canchas_divisibles`
Expected: crea las tablas y columnas. (Si no regenera el client, `npx prisma generate`.)

- [ ] **Step 3: Crear la migración del constraint (manual)**

Run: `npx prisma migrate dev --create-only --name mover_overlap_a_sector`
Editar el `migration.sql` generado (vacío) con:
```sql
ALTER TABLE "Reserva" DROP CONSTRAINT IF EXISTS reserva_no_overlap;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "ReservaSector"
  ADD CONSTRAINT reservasector_no_overlap
  EXCLUDE USING gist (
    "sectorId" WITH =,
    tstzrange("fechaInicio", "fechaFin") WITH &&
  )
  WHERE (estado IN ('CONFIRMADA'::"EstadoReserva", 'ESPERANDO_SENA'::"EstadoReserva"));
```
Run: `npx prisma migrate dev` (aplica).

- [ ] **Step 4: Backfill idempotente en `src/seed.ts`**

Antes de `console.log('Seed completo')`, agregar:
```ts
  // Backfill sectores: cada cancha sin sector → 1 sector propio; cada reserva sin ReservaSector → sus filas.
  const canchasAll = await prisma.cancha.findMany({ include: { sectores: true } });
  for (const c of canchasAll) {
    if (c.sectores.length === 0) {
      const s = await prisma.sector.create({ data: { nombre: c.nombre } });
      await prisma.canchaSector.create({ data: { canchaId: c.id, sectorId: s.id } });
    }
  }
  const reservasAll = await prisma.reserva.findMany({ include: { sectores: true, cancha: { include: { sectores: true } } } });
  for (const r of reservasAll) {
    if (r.sectores.length === 0) {
      await prisma.reservaSector.createMany({
        data: r.cancha.sectores.map((cs) => ({ reservaId: r.id, sectorId: cs.sectorId, estado: r.estado, fechaInicio: r.fechaInicio, fechaFin: r.fechaFin })),
      });
    }
  }
```

- [ ] **Step 5: Test (TDD) — `tests/integration/sectores.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('modelo de sectores', () => {
  it('el constraint anti-overlap vive en ReservaSector (dos ocupaciones del mismo sector que se solapan fallan)', async () => {
    const p = getPrisma();
    const sector = await p.sector.create({ data: { nombre: 'S1' } });
    const cancha = await p.cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
    const cli = await p.cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    const ini = new Date(Date.now() + 72 * 3600_000); const fin = new Date(ini.getTime() + 3600_000);
    const r1 = await p.reserva.create({ data: { canchaId: cancha.id, clienteId: cli.id, estado: 'CONFIRMADA', esContacto: true, monto: 12000, fechaInicio: ini, fechaFin: fin } });
    await p.reservaSector.create({ data: { reservaId: r1.id, sectorId: sector.id, estado: 'CONFIRMADA', fechaInicio: ini, fechaFin: fin } });
    const r2 = await p.reserva.create({ data: { canchaId: cancha.id, clienteId: cli.id, estado: 'CONFIRMADA', esContacto: true, monto: 12000, fechaInicio: ini, fechaFin: fin } });
    await expect(
      p.reservaSector.create({ data: { reservaId: r2.id, sectorId: sector.id, estado: 'CONFIRMADA', fechaInicio: ini, fechaFin: fin } }),
    ).rejects.toThrow();
  });
});
```
Run: `npx vitest run tests/integration/sectores.test.ts` → PASS (el constraint existe). Si `resetTables` no limpia las tablas nuevas, agregarlas (orden: ReservaSector, CanchaSector, Sector, CanchaGrupo antes que Reserva/Cancha por las FKs — o usar el truncate dinámico existente).

- [ ] **Step 6: tsc + commit**
```bash
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations src/seed.ts tests/integration/sectores.test.ts
git commit -m "feat(sectores): modelo Sector/CanchaSector/ReservaSector/Grupo + constraint a nivel sector + backfill"
```

## Task B2: reservas escriben ReservaSector; create simple crea sector

**Files:**
- Modify: `src/repositories/reserva.repo.ts`, `src/services/cancha.service.ts`
- Test: `tests/integration/sectores.test.ts` (append)

- [ ] **Step 1: Exportar el helper de exclusión en `reserva.repo.ts`**

Cambiar `function isExclusionViolation` por `export function isExclusionViolation` (se reusa en otros repos si hace falta) — opcional, pero dejarlo accesible.

- [ ] **Step 2: `reserva.repo.create` inserta ReservaSector**

Reemplazar `create`:
```ts
  async create(data: CreateReservaData, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma;
    const reserva = await db.reserva.create({ data });
    let cs = await db.canchaSector.findMany({ where: { canchaId: data.canchaId }, select: { sectorId: true } });
    // Fallback: toda cancha debe tener ≥1 sector. Si por algún motivo no lo tiene
    // (ej. canchas creadas directo en tests), le creamos uno al vuelo para no perder
    // la protección de overlap. En producción siempre lo tienen (service/seed).
    if (cs.length === 0) {
      const s = await db.sector.create({ data: { nombre: 'auto' } });
      await db.canchaSector.create({ data: { canchaId: data.canchaId, sectorId: s.id } });
      cs = [{ sectorId: s.id }];
    }
    try {
      await db.reservaSector.createMany({
        data: cs.map((s) => ({ reservaId: reserva.id, sectorId: s.sectorId, estado: data.estado, fechaInicio: data.fechaInicio, fechaFin: data.fechaFin })),
      });
    } catch (e) {
      if (isExclusionViolation(e)) throw Conflict('El horario ya está reservado para esa cancha');
      throw e;
    }
    return reserva;
  },
```
(El `reserva.create` ya no choca con el constraint — se movió a ReservaSector. El fallback de sector mantiene verdes los tests existentes que crean canchas sin pasar por el servicio.)

- [ ] **Step 3: `updateEstado` y `reprogramar` sincronizan ReservaSector**

```ts
  updateEstado: async (id: string, estado: EstadoReserva, tx?: Prisma.TransactionClient) => {
    const db = tx ?? prisma;
    await db.reservaSector.updateMany({ where: { reservaId: id }, data: { estado } });
    return db.reserva.update({ where: { id }, data: { estado } });
  },
  async reprogramar(id: string, fechaInicio: Date, fechaFin: Date, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma;
    try {
      await db.reservaSector.updateMany({ where: { reservaId: id }, data: { fechaInicio, fechaFin } });
      return await db.reserva.update({ where: { id }, data: { fechaInicio, fechaFin } });
    } catch (e) {
      if (isExclusionViolation(e)) throw Conflict('El horario ya está reservado para esa cancha');
      throw e;
    }
  },
```

- [ ] **Step 4: `cancha.service.create` crea 1 sector (reemplaza createDefaults)**

```ts
  create: async (input: { nombre: string; tipo: string; precioHora: number }) =>
    prisma.$transaction(async (tx) => {
      const cancha = await tx.cancha.create({ data: input });
      const sector = await tx.sector.create({ data: { nombre: cancha.nombre } });
      await tx.canchaSector.create({ data: { canchaId: cancha.id, sectorId: sector.id } });
      return cancha;
    }),
```
Quitar el import y uso de `horarioRepo` en `cancha.service.ts`. (Importar `prisma` desde `../db/prisma.js`.)

- [ ] **Step 5: Test (append) — reservar por el servicio crea ReservaSector y respeta overlap**

```ts
import supertest from 'supertest';
// app + admin token como en otros tests (buildApp en beforeAll)
describe('reserva escribe ReservaSector (cancha simple)', () => {
  it('crear reserva genera ReservaSector y un segundo solape da 409', async () => {
    // crear cancha vía POST /canchas (ya crea sector)
    const c = await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000 });
    const fecha = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const r1 = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: c.body.id, whatsapp: '+5491150000000', nombreCliente: 'A', esContacto: true, fecha, horaInicio: '20:00' });
    expect(r1.status).toBe(201);
    expect(await getPrisma().reservaSector.count({ where: { reservaId: r1.body.id } })).toBe(1);
    const r2 = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: c.body.id, whatsapp: '+5491150000001', nombreCliente: 'B', esContacto: true, fecha, horaInicio: '20:00' });
    expect(r2.status).toBe(409);
  });
});
```
Run: `npx vitest run tests/integration/sectores.test.ts` → PASS. Luego `npx vitest run` completa.

> Nota: gracias al fallback auto-sector del Step 2, los tests existentes que crean canchas con `prisma.cancha.create` directo siguen teniendo protección de overlap en reservas. PERO la **disponibilidad** por sector (Task B4) consulta `CanchaSector`; una cancha creada directo sin reservas no tendrá sector hasta su primera reserva. Si algún test viejo de disponibilidad crea la cancha directo y espera slots, sigue funcionando (sin reservas → sin ocupación → todos los slots libres). Igual correr la suite completa al final de B4 y ajustar lo que aparezca.

- [ ] **Step 6: tsc + commit**
```bash
npx tsc --noEmit
git add src/repositories/reserva.repo.ts src/services/cancha.service.ts tests/integration/sectores.test.ts
git commit -m "feat(sectores): reservas escriben/sincronizan ReservaSector; create simple crea sector"
```

## Task B3: crearDivisible + endpoint + schema

**Files:**
- Modify: `src/services/cancha.service.ts`, `src/routes/cancha.routes.ts`, `src/validators/cancha.schema.ts`
- Test: `tests/integration/canchas-divisibles.test.ts` (create)

- [ ] **Step 1: `crearDivisibleSchema` en `src/validators/cancha.schema.ts`**
```ts
export const crearDivisibleSchema = z.object({
  body: z.object({
    nombre: z.string().min(1),
    partes: z.number().int().min(2).max(6),
    precioEntera: z.number().positive(),
    precioParte: z.number().positive(),
  }),
  query: empty, params: empty,
});
```

- [ ] **Step 2: `cancha.service.crearDivisible`**
```ts
  crearDivisible: ({ nombre, partes, precioEntera, precioParte }: { nombre: string; partes: number; precioEntera: number; precioParte: number }) =>
    prisma.$transaction(async (tx) => {
      const grupo = await tx.canchaGrupo.create({ data: { nombre } });
      const sectores = [];
      for (let i = 1; i <= partes; i++) sectores.push(await tx.sector.create({ data: { nombre: `${nombre} - ${i}` } }));
      const entera = await tx.cancha.create({ data: { nombre, tipo: 'futbol', precioHora: precioEntera, grupoId: grupo.id, esEntera: true } });
      await tx.canchaSector.createMany({ data: sectores.map((s) => ({ canchaId: entera.id, sectorId: s.id })) });
      for (let i = 0; i < partes; i++) {
        const parte = await tx.cancha.create({ data: { nombre: `${nombre} - ${i + 1}`, tipo: 'futbol', precioHora: precioParte, grupoId: grupo.id, esEntera: false } });
        await tx.canchaSector.create({ data: { canchaId: parte.id, sectorId: sectores[i].id } });
      }
      return tx.cancha.findMany({ where: { grupoId: grupo.id }, orderBy: { esEntera: 'desc' } });
    }),
```

- [ ] **Step 3: Ruta `POST /canchas/divisible`**

En `src/routes/cancha.routes.ts`, importar `crearDivisibleSchema` y agregar (antes de `/:id` no es necesario porque `/divisible` no es paramétrico, pero ubicarla junto a `POST /`):
```ts
canchaRoutes.post('/divisible', authJwt, validate(crearDivisibleSchema), async (req, res, next) => {
  try { res.status(201).json(await canchaService.crearDivisible((req as any).valid.body)); } catch (e) { next(e); }
});
```

- [ ] **Step 4: Test (TDD) — `tests/integration/canchas-divisibles.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); const a = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'A', passwordHash: 'x' } }); token = signAdminToken({ adminId: a.id, email: a.email }); });

const fecha = () => new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
async function crearDivisible() {
  const r = await supertest(app).post('/canchas/divisible').set('authorization', `Bearer ${token}`).send({ nombre: 'Cancha 4', partes: 3, precioEntera: 30000, precioParte: 12000 });
  return r;
}
const reservar = (canchaId: string, wa: string) =>
  supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId, whatsapp: wa, nombreCliente: 'X', esContacto: true, fecha: fecha(), horaInicio: '20:00' });

describe('canchas divisibles', () => {
  it('crea grupo + 3 sectores + 4 unidades con precios', async () => {
    const r = await crearDivisible();
    expect(r.status).toBe(201);
    expect(r.body).toHaveLength(4);
    const entera = r.body.find((c: any) => c.esEntera);
    expect(Number(entera.precioHora)).toBe(30000);
    expect(await getPrisma().sector.count()).toBe(3);
  });
  it('reservar la entera bloquea las partes', async () => {
    const cs = (await crearDivisible()).body;
    const entera = cs.find((c: any) => c.esEntera); const parte = cs.find((c: any) => !c.esEntera);
    expect((await reservar(entera.id, '+5491150000000')).status).toBe(201);
    expect((await reservar(parte.id, '+5491150000001')).status).toBe(409);
  });
  it('reservar una parte bloquea la entera', async () => {
    const cs = (await crearDivisible()).body;
    const entera = cs.find((c: any) => c.esEntera); const parte = cs.find((c: any) => !c.esEntera);
    expect((await reservar(parte.id, '+5491150000000')).status).toBe(201);
    expect((await reservar(entera.id, '+5491150000001')).status).toBe(409);
  });
  it('dos partes distintas conviven', async () => {
    const cs = (await crearDivisible()).body;
    const partes = cs.filter((c: any) => !c.esEntera);
    expect((await reservar(partes[0].id, '+5491150000000')).status).toBe(201);
    expect((await reservar(partes[1].id, '+5491150000001')).status).toBe(201);
  });
});
```
Run: `npx vitest run tests/integration/canchas-divisibles.test.ts` → PASS.

- [ ] **Step 5: tsc + commit**
```bash
npx tsc --noEmit
git add src/services/cancha.service.ts src/routes/cancha.routes.ts src/validators/cancha.schema.ts tests/integration/canchas-divisibles.test.ts
git commit -m "feat(sectores): crearDivisible + POST /canchas/divisible"
```

## Task B4: disponibilidad por sectores

**Files:**
- Modify: `src/services/disponibilidad.service.ts`
- Test: `tests/integration/canchas-divisibles.test.ts` (append)

- [ ] **Step 1: Test (TDD)**
```ts
describe('disponibilidad por sectores', () => {
  it('la parte no muestra el slot ocupado por la entera', async () => {
    const cs = (await crearDivisible()).body;
    const entera = cs.find((c: any) => c.esEntera); const parte = cs.find((c: any) => !c.esEntera);
    await reservar(entera.id, '+5491150000000'); // ocupa 20:00 en los 3 sectores
    const disp = await supertest(app).get('/disponibilidad').query({ canchaId: parte.id, fecha: fecha() }).set('x-api-key', 'svc');
    expect(disp.status).toBe(200);
    expect(disp.body.slots.map((s: any) => s.horaInicio)).not.toContain('20:00');
  });
});
```

- [ ] **Step 2: Reescribir el query de ocupación en `disponibilidad.service.ts`**

Reemplazar el bloque `const reservas = await prisma.reserva.findMany(...)` por la consulta de ocupación por sectores de la cancha:
```ts
    const sectores = await prisma.canchaSector.findMany({ where: { canchaId }, select: { sectorId: true } });
    const sectorIds = sectores.map((s) => s.sectorId);
    const ocup = await prisma.reservaSector.findMany({
      where: { sectorId: { in: sectorIds }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] }, fechaInicio: { gte: start, lt: end } },
      select: { fechaInicio: true, fechaFin: true },
    });
```
y cambiar la condición `taken` para usar `ocup` en vez de `reservas`:
```ts
      const taken = ocup.some((r) => r.fechaInicio < finUtc && inicioUtc < r.fechaFin);
```

- [ ] **Step 3: Run (suite completa) + tsc + commit**
Run: `npx vitest run` (toda la suite verde — ajustar cualquier test viejo de disponibilidad que cree canchas sin sector) ; `npx tsc --noEmit`.
```bash
git add src/services/disponibilidad.service.ts tests/integration/canchas-divisibles.test.ts
git commit -m "feat(sectores): disponibilidad calcula ocupacion por sectores"
```

## Task B5: eliminar group-aware

**Files:**
- Modify: `src/services/cancha.service.ts`, `src/repositories/cancha.repo.ts` (si hace falta)
- Test: `tests/integration/canchas-divisibles.test.ts` (append)

- [ ] **Step 1: `cancha.service.eliminar` group-aware**

Reemplazar `eliminar`:
```ts
  eliminar: async (id: string) => {
    const c = await canchaService.get(id);
    if (c.grupoId) {
      const unidades = await prisma.cancha.findMany({ where: { grupoId: c.grupoId }, select: { id: true } });
      for (const u of unidades) {
        if ((await reservaRepo.countByCancha(u.id)) > 0) throw Conflict('Una cancha del grupo tiene reservas; desactivala en vez de eliminarla');
      }
      const sectorIds = (await prisma.canchaSector.findMany({ where: { canchaId: { in: unidades.map((u) => u.id) } }, select: { sectorId: true } })).map((s) => s.sectorId);
      await prisma.$transaction(async (tx) => {
        await tx.cancha.deleteMany({ where: { grupoId: c.grupoId! } }); // cascade borra CanchaSector
        await tx.sector.deleteMany({ where: { id: { in: Array.from(new Set(sectorIds)) } } });
        await tx.canchaGrupo.delete({ where: { id: c.grupoId! } });
      });
      return { ok: true };
    }
    if ((await reservaRepo.countByCancha(id)) > 0) throw Conflict('La cancha tiene reservas; desactivala en vez de eliminarla');
    const sectorIds = (await prisma.canchaSector.findMany({ where: { canchaId: id }, select: { sectorId: true } })).map((s) => s.sectorId);
    await prisma.$transaction(async (tx) => {
      await tx.cancha.delete({ where: { id } });
      await tx.sector.deleteMany({ where: { id: { in: sectorIds } } });
    });
    return { ok: true };
  },
```
(Importar `prisma` en `cancha.service.ts` si no está.)

- [ ] **Step 2: Test (append)**
```ts
describe('eliminar divisible', () => {
  it('borra todo el grupo cuando no hay reservas', async () => {
    const cs = (await crearDivisible()).body;
    const entera = cs.find((c: any) => c.esEntera);
    const res = await supertest(app).delete(`/canchas/${entera.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await getPrisma().cancha.count()).toBe(0);
    expect(await getPrisma().sector.count()).toBe(0);
  });
  it('409 si una unidad del grupo tiene reservas', async () => {
    const cs = (await crearDivisible()).body;
    const parte = cs.find((c: any) => !c.esEntera); const entera = cs.find((c: any) => c.esEntera);
    await reservar(parte.id, '+5491150000000');
    const res = await supertest(app).delete(`/canchas/${entera.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});
```
Run: `npx vitest run tests/integration/canchas-divisibles.test.ts` → PASS; `npx vitest run` completa; `npx tsc --noEmit`.

- [ ] **Step 3: Commit**
```bash
git add src/services/cancha.service.ts tests/integration/canchas-divisibles.test.ts
git commit -m "feat(sectores): eliminar group-aware (borra grupo + sectores)"
```

## Part 1 completion
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verificar suite, merge `feat/canchas-divisibles-backend` → `main`, push.

---

# PART 2 — Frontend (`feat/canchas-divisibles-panel`)

**Branch:** desde `master`, en `c:/Users/Lautaro/Desktop/ortigoza/frontend`. `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec vitest run`, `API_URL=... pnpm build`.

**Contexto:** `GET /canchas` ahora devuelve `grupoId` y `esEntera`. Mirar `src/components/canchas/canchas-table.tsx`, `cancha-dialog.tsx`, `src/lib/canchas-actions.ts`.

## Task F1: tipos + schema divisible (TDD)

**Files:** Modify `src/lib/types.ts`, `src/lib/validators.ts`, `src/lib/validators.test.ts`

- [ ] **Step 1: `Cancha` en `types.ts`** — agregar `grupoId: string | null; esEntera: boolean`.

- [ ] **Step 2: Test (append a validators.test.ts)**
```ts
import { canchaDivisibleSchema } from '@/lib/validators';
describe('canchaDivisibleSchema', () => {
  it('acepta divisible válida', () => {
    expect(canchaDivisibleSchema.safeParse({ nombre: 'Cancha 4', partes: '3', precioEntera: '30000', precioParte: '12000' }).success).toBe(true);
  });
  it('rechaza partes < 2', () => {
    expect(canchaDivisibleSchema.safeParse({ nombre: 'X', partes: '1', precioEntera: '1', precioParte: '1' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: `canchaDivisibleSchema` en `validators.ts`**
```ts
export const canchaDivisibleSchema = z.object({
  nombre: z.string().min(1, 'Ingresá el nombre'),
  partes: z.coerce.number().int().min(2, 'Mínimo 2 partes').max(6, 'Máximo 6'),
  precioEntera: z.coerce.number().positive('Precio inválido'),
  precioParte: z.coerce.number().positive('Precio inválido'),
});
```

- [ ] **Step 4: Run + commit**
```bash
git checkout -b feat/canchas-divisibles-panel
pnpm exec vitest run src/lib/validators.test.ts
git add src/lib/types.ts src/lib/validators.ts src/lib/validators.test.ts
git commit -m "feat(canchas): tipo grupoId/esEntera + canchaDivisibleSchema"
```

## Task F2: action

**Files:** Modify `src/lib/canchas-actions.ts`

- [ ] **Step 1:** agregar:
```ts
export async function crearCanchaDivisible(input: { nombre: string; partes: number; precioEntera: number; precioParte: number }): Promise<Result> {
  return run(() => apiFetch('/canchas/divisible', { method: 'POST', body: JSON.stringify(input) }));
}
```
(`Result`/`run` ya existen en el archivo.)

- [ ] **Step 2: commit**
```bash
git add src/lib/canchas-actions.ts
git commit -m "feat(canchas): action crearCanchaDivisible"
```

## Task F3: dialog tipo Simple/Divisible + tabla agrupada

**Files:** Modify `src/components/canchas/cancha-dialog.tsx`, `src/components/canchas/canchas-table.tsx`

- [ ] **Step 1: Dialog — agregar modo Divisible**

En `cancha-dialog.tsx` (solo modo creación, `cancha===null`), agregar un selector arriba: tipo "Simple" / "Divisible". Estado `[tipoForm, setTipoForm] = useState<'simple'|'divisible'>('simple')`. Si `divisible`, mostrar campos `partes` (number, default 3), `precioEntera`, `precioParte` (en vez de los simples) y validar con `canchaDivisibleSchema`, llamar `crearCanchaDivisible`. Si `simple`, comportamiento actual. En modo edición (cancha != null) el selector no se muestra (solo se editan los campos simples). Importar `crearCanchaDivisible` y `canchaDivisibleSchema`.

```tsx
// fragmento del submit:
if (!editing && tipoForm === 'divisible') {
  const parsed = canchaDivisibleSchema.safeParse({ nombre, partes, precioEntera, precioParte });
  if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
  start(async () => {
    const r = await crearCanchaDivisible(parsed.data);
    if (r.ok) { toast.success('Cancha divisible creada'); onOpenChange(false); } else toast.error(r.error);
  });
  return;
}
// ...resto: lógica simple actual
```
(Agregar los `useState` para `partes`/`precioEntera`/`precioParte` y resetearlos en `handleOpenChange`.)

- [ ] **Step 2: Tabla — agrupar divisibles**

En `canchas-table.tsx`, al renderizar, agrupar por `grupoId`: las canchas con `grupoId` se muestran juntas (la entera primero, luego las partes con sangría / un badge "parte"). Las simples (grupoId null) como hoy. Badge "Divisible" en la entera. La acción **Eliminar** sobre cualquier unidad del grupo ya borra el grupo entero en el backend (mostrar en el confirm: "Esto elimina la cancha y todas sus partes").

Implementación mínima: ordenar `canchas` por `(grupoId ?? id)` y luego `esEntera desc`, y en la fila mostrar un prefijo/sangría si `grupoId && !esEntera`. Badge "Divisible" si `esEntera`.

- [ ] **Step 3: Verificación**
Run: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec vitest run`, `API_URL=http://localhost:3000 pnpm build` → verde.

- [ ] **Step 4: Commit**
```bash
git add src/components/canchas/cancha-dialog.tsx src/components/canchas/canchas-table.tsx
git commit -m "feat(canchas): crear cancha divisible desde el panel + tabla agrupada"
```

## Part 2 completion
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verificar, merge `feat/canchas-divisibles-panel` → `master`.

---

## Bot
Sin cambios de código. Tras desplegar el backend, el bot verá las nuevas unidades (entera + partes) en la lista dinámica de canchas y la disponibilidad ya las cruza por sector.

## Out of scope
Precios por parte individuales; precios por combinación; sub-divisiones anidadas; editar la estructura de un grupo existente (se elimina y recrea).

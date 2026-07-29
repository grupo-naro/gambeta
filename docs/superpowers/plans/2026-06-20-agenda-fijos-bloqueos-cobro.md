# Agenda con fijos/bloqueos + cobro de fijos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/hoy` y `/reservas` muestren los turnos fijos y los bloqueos del día, y que cada turno de un fijo se pueda cobrar materializándolo como una reserva real (precio = el de la cancha).

**Architecture:** El fijo aparece virtual en la agenda; al cobrarlo se materializa una `Reserva` vinculada (`turnoFijoId`) y se cobra con el flujo existente. Un endpoint `GET /agenda?fecha` unifica reservas + fijos virtuales + bloqueos. El fijo deja de tener precio propio: se cobra con `precioEfectivo` (precio de la cancha).

**Tech Stack:** Backend Node/Express/Prisma 7/Zod, Vitest+Testcontainers (Docker). Frontend Next 16/React 19/Zod/Vitest.

## Global Constraints

- Backend: imports ESM con `.js`. Errores de validación → 400 vía middleware `validate`; reglas de negocio → `BusinessRule` (422), `Conflict` (409), `NotFound` (404).
- El monto de un turno de fijo se calcula con `precioEfectivo(cancha, fecha, horaInicio, cfg)` (mismo que una reserva). El fijo NO tiene precio propio.
- WhatsApp del fijo: requerido al crear, normalizado con `whatsappCanonico` (formato `5491136620274`). `Cliente.whatsapp` es único y requerido.
- Materializar es idempotente: misma fecha → misma reserva (unique `(turnoFijoId, fechaInicio)`).
- Estado de la reserva materializada: `CONFIRMADA`, sin seña.
- Bloqueos/torneos: solo lectura (no se cobran).
- Tests unitarios backend sin Docker: `npx vitest run --config vitest.unit.config.ts <archivo>`. Integración (Docker): `npx vitest run <archivo>`.
- Antes de mergear: backend `npx tsc --noEmit` + tests; frontend `pnpm build` + `pnpm lint`. Backend → `main` + push; frontend → `master` local.

---

### Task 1: Migración — `Reserva.turnoFijoId` + `TurnoFijo.precio` nullable

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260620120000_agenda_fijos/migration.sql`
- Modify: `backend/src/repositories/reserva.repo.ts` (CreateReservaData + create pasa `turnoFijoId`)
- Test: `backend/tests/integration/materializar-fijo.test.ts` (solo el primer caso acá; se completa en Task 3)

**Interfaces:**
- Produces: `Reserva.turnoFijoId` (col nullable, FK a TurnoFijo, unique con fechaInicio); `CreateReservaData.turnoFijoId?: string | null`.

- [ ] **Step 1: Editar schema.** En `backend/prisma/schema.prisma`, dentro de `model Reserva` agregar el campo y la relación (junto a los otros campos, antes de los `@@index`):
```prisma
  turnoFijoId String?
  turnoFijo   TurnoFijo? @relation(fields: [turnoFijoId], references: [id])
```
y agregar al final del bloque de `model Reserva` (con los otros `@@`):
```prisma
  @@unique([turnoFijoId, fechaInicio])
```
En `model TurnoFijo`: cambiar `precio        Decimal              @db.Decimal(10, 2)` por:
```prisma
  precio        Decimal?             @db.Decimal(10, 2)
```
y agregar la relación inversa (junto a `excepciones`):
```prisma
  reservas      Reserva[]
```

- [ ] **Step 2: Migración SQL.** Crear `backend/prisma/migrations/20260620120000_agenda_fijos/migration.sql`:
```sql
-- Reserva: vínculo al turno fijo materializado (idempotente por fecha)
ALTER TABLE "Reserva" ADD COLUMN "turnoFijoId" TEXT;
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_turnoFijoId_fkey"
  FOREIGN KEY ("turnoFijoId") REFERENCES "TurnoFijo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Reserva_turnoFijoId_fechaInicio_key" ON "Reserva"("turnoFijoId", "fechaInicio");

-- TurnoFijo: el precio sale de la cancha; deja de ser obligatorio
ALTER TABLE "TurnoFijo" ALTER COLUMN "precio" DROP NOT NULL;
```
(El unique con `turnoFijoId` NULL no afecta a las reservas normales: en Postgres los NULL son distintos entre sí.)

- [ ] **Step 3: Generar client.** `cd backend && npx prisma generate` → sin errores.

- [ ] **Step 4: `CreateReservaData` acepta turnoFijoId.** En `backend/src/repositories/reserva.repo.ts`, agregar a la interfaz `CreateReservaData` (después de `notas?`):
```typescript
  turnoFijoId?: string | null;
```
No hace falta tocar `create`: ya hace `db.reserva.create({ data })` y el campo viaja en `data`.

- [ ] **Step 5: Test de humo (integración, Docker).** Crear `backend/tests/integration/materializar-fijo.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
});

// 2026-06-24 es MIÉRCOLES (diaSemana 3, 0=Dom).
async function fijoMiercoles(over: Record<string, unknown> = {}) {
  return getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true, ...over } });
}
const materializar = (id: string, body: Record<string, unknown>) =>
  supertest(app).post(`/turnos-fijos/${id}/materializar`).set('x-api-key', 'svc').send(body);

describe('POST /turnos-fijos/:id/materializar', () => {
  it('persiste turnoFijoId en la reserva creada', async () => {
    const f = await fijoMiercoles();
    const r = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r.status).toBe(201);
    expect(r.body.turnoFijoId).toBe(f.id);
  });
});
```

- [ ] **Step 6: Correr → FALLA.** `npx vitest run tests/integration/materializar-fijo.test.ts` → FAIL (ruta `/materializar` no existe). Esto deja el test listo para Task 3. Si Docker no está disponible, dejar pendiente y avisarlo.

- [ ] **Step 7: tsc + commit.** `npx tsc --noEmit` → 0 errores. Commit:
```bash
git add prisma/schema.prisma prisma/migrations/20260620120000_agenda_fijos src/repositories/reserva.repo.ts tests/integration/materializar-fijo.test.ts
git commit -m "feat(reserva): turnoFijoId + migracion; precio de fijo nullable"
```

---

### Task 2: Crear fijo sin precio + WhatsApp requerido

**Files:**
- Modify: `backend/src/validators/turnoFijo.schema.ts`
- Modify: `backend/src/services/turnoFijo.service.ts`
- Test: `backend/tests/unit/turno-fijo-crear.test.ts`

**Interfaces:**
- Consumes: `whatsappCanonico` de `./whatsapp.field.js` (ya existe).
- Produces: `crearTurnoFijoSchema` sin `precio`, con `whatsapp` requerido y canónico.

- [ ] **Step 1: Test que falla (unit).** Crear `backend/tests/unit/turno-fijo-crear.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { crearTurnoFijoSchema } from '../../src/validators/turnoFijo.schema.js';

const base = { canchaId: 'c1', clienteNombre: 'Naro', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00' };
const parse = (body: Record<string, unknown>) => crearTurnoFijoSchema.parse({ body, query: {}, params: {} });

describe('crearTurnoFijoSchema', () => {
  it('no requiere precio y normaliza el whatsapp', () => {
    const r = parse({ ...base, whatsapp: '+541136620274' });
    expect(r.body.whatsapp).toBe('5491136620274');
    expect('precio' in r.body).toBe(false);
  });
  it('rechaza si falta whatsapp', () => {
    expect(() => parse({ ...base })).toThrow();
  });
});
```

- [ ] **Step 2: Correr → FALLA.** `npx vitest run --config vitest.unit.config.ts tests/unit/turno-fijo-crear.test.ts` → FAIL (hoy `precio` es requerido y `whatsapp` opcional).

- [ ] **Step 3: Editar el validator.** En `backend/src/validators/turnoFijo.schema.ts`, agregar import arriba:
```typescript
import { whatsappCanonico } from './whatsapp.field.js';
```
Reemplazar el `crearTurnoFijoSchema` por:
```typescript
export const crearTurnoFijoSchema = z.object({
  body: z.object({
    canchaId: z.string().min(1),
    clienteNombre: z.string().min(1),
    whatsapp: whatsappCanonico,
    diaSemana: z.coerce.number().int().min(0).max(6),
    horaInicio: hhmm,
    horaFin: hhmm,
  }).refine((b) => b.horaInicio < b.horaFin, { message: 'La hora de inicio debe ser anterior al fin', path: ['horaFin'] }),
  query: empty, params: empty,
});
```

- [ ] **Step 4: Service no exige precio.** En `backend/src/services/turnoFijo.service.ts`, cambiar la firma de `crear` (sacar `precio`):
```typescript
  async crear(input: { canchaId: string; clienteNombre: string; whatsapp?: string; diaSemana: number; horaInicio: string; horaFin: string }) {
```
El cuerpo no cambia: `prisma.turnoFijo.create({ data: input })` (sin `precio`, queda null).

- [ ] **Step 5: Correr → PASA.** `npx vitest run --config vitest.unit.config.ts tests/unit/turno-fijo-crear.test.ts` → 2/2.

- [ ] **Step 6: Regresión (Docker).** `npx vitest run tests/integration/fijos-bloqueos.test.ts` → PASS. Si algún test crea un fijo con `precio`/sin `whatsapp`, ajustarlo: quitar `precio` y poner `whatsapp: '5491150000000'`. (Si Docker no está, dejar pendiente y avisar.)

- [ ] **Step 7: tsc + commit.**
```bash
npx tsc --noEmit
git add src/validators/turnoFijo.schema.ts src/services/turnoFijo.service.ts tests/unit/turno-fijo-crear.test.ts
git commit -m "feat(turnos-fijos): crear sin precio + whatsapp requerido (canonico)"
```

---

### Task 3: Materializar un turno de fijo en reserva

**Files:**
- Modify: `backend/src/services/turnoFijo.service.ts`
- Modify: `backend/src/validators/turnoFijo.schema.ts`
- Modify: `backend/src/routes/turnoFijo.routes.ts`
- Test: `backend/tests/integration/materializar-fijo.test.ts` (ampliar el de Task 1)

**Interfaces:**
- Consumes: `precioEfectivo` (`./precio.service.js`), `configService` (`./config.service.js`), `combineDateTimeUtc`/`dayOfWeekInTz` (`../utils/tz.js`), `reservaRepo` (`../repositories/reserva.repo.js`), `prisma`.
- Produces: `turnoFijoService.materializar(fijoId, fecha)` → reserva (con `pagado`/`saldo`); `POST /turnos-fijos/:id/materializar`.

- [ ] **Step 1: Ampliar el test (integración).** En `backend/tests/integration/materializar-fijo.test.ts`, agregar dentro del `describe` (después del test de humo):
```typescript
  it('crea la reserva con precio de la cancha, CONFIRMADA, y es idempotente', async () => {
    const f = await fijoMiercoles();
    const r1 = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r1.status).toBe(201);
    expect(r1.body.estado).toBe('CONFIRMADA');
    expect(Number(r1.body.monto)).toBe(12000); // precioHora de la cancha
    const r2 = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r2.body.id).toBe(r1.body.id); // idempotente
    const n = await getPrisma().reserva.count({ where: { turnoFijoId: f.id } });
    expect(n).toBe(1);
  });
  it('upsert del cliente por whatsapp del fijo', async () => {
    const f = await fijoMiercoles();
    await materializar(f.id, { fecha: '2026-06-24' });
    const cli = await getPrisma().cliente.findUnique({ where: { whatsapp: '5491136620274' } });
    expect(cli?.nombre).toBe('Naro');
  });
  it('rechaza si hay excepción (liberado) en esa fecha', async () => {
    const f = await fijoMiercoles();
    await getPrisma().turnoFijoExcepcion.create({ data: { turnoFijoId: f.id, fecha: new Date('2026-06-24T00:00:00.000Z') } });
    const r = await materializar(f.id, { fecha: '2026-06-24' });
    expect(r.status).toBe(422);
  });
  it('rechaza si la fecha no cae en el día del fijo', async () => {
    const f = await fijoMiercoles();
    const r = await materializar(f.id, { fecha: '2026-06-25' }); // jueves
    expect(r.status).toBe(422);
  });
```

- [ ] **Step 2: Correr → FALLA.** `npx vitest run tests/integration/materializar-fijo.test.ts` → FAIL (sin endpoint).

- [ ] **Step 3: Validator.** En `backend/src/validators/turnoFijo.schema.ts` agregar:
```typescript
export const materializarFijoSchema = z.object({
  body: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 4: Service.** En `backend/src/services/turnoFijo.service.ts` agregar imports arriba (si faltan):
```typescript
import { combineDateTimeUtc } from '../utils/tz.js';
import { getEnv } from '../config/env.js';
import { precioEfectivo } from './precio.service.js';
import { configService } from './config.service.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
```
(Ya están `dayOfWeekInTz`, `Conflict`, `NotFound`, `BusinessRule`, `prisma` por el resto del archivo; agregá los que falten.)
Agregar el método al objeto `turnoFijoService` (después de `liberarPorWhatsapp`):
```typescript
  async materializar(fijoId: string, fecha: string) {
    const tz = getEnv().TZ_NEGOCIO;
    const fijo = await prisma.turnoFijo.findUnique({ where: { id: fijoId }, include: { cancha: true } });
    if (!fijo || !fijo.activo) throw NotFound('TurnoFijo', fijoId);
    if (!fijo.whatsapp) throw BusinessRule('El turno fijo no tiene WhatsApp; recargalo con el número para poder cobrarlo');
    if (dayOfWeekInTz(fecha, tz) !== fijo.diaSemana) throw BusinessRule('Ese turno fijo no aplica a esa fecha');
    const fechaDate = new Date(fecha + 'T00:00:00.000Z');
    const exc = await prisma.turnoFijoExcepcion.findUnique({ where: { turnoFijoId_fecha: { turnoFijoId: fijoId, fecha: fechaDate } } });
    if (exc) throw BusinessRule('Ese turno fijo está liberado en esa fecha');
    const fechaInicio = combineDateTimeUtc(fecha, fijo.horaInicio, tz);
    const existente = await prisma.reserva.findUnique({ where: { turnoFijoId_fechaInicio: { turnoFijoId: fijoId, fechaInicio } } });
    if (existente) return existente;
    const fechaFin = combineDateTimeUtc(fecha, fijo.horaFin, tz);
    const cfg = await configService.get();
    const monto = precioEfectivo(fijo.cancha, fecha, fijo.horaInicio, cfg);
    const whatsapp = fijo.whatsapp;
    return prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.upsert({
        where: { whatsapp },
        create: { whatsapp, nombre: fijo.clienteNombre, nombreConfirmado: true, primeraReserva: new Date(), totalReservas: 1 },
        update: { totalReservas: { increment: 1 } },
      });
      return reservaRepo.create({
        canchaId: fijo.canchaId, clienteId: cliente.id, fechaInicio, fechaFin,
        estado: 'CONFIRMADA', esContacto: false, monto, montoSena: null, notas: null, turnoFijoId: fijoId,
      }, tx);
    });
  },
```

- [ ] **Step 5: Ruta.** En `backend/src/routes/turnoFijo.routes.ts`, agregar imports arriba (los que falten):
```typescript
import { prisma } from '../db/prisma.js';
import { reservaService } from '../services/reserva.service.js';
```
agregar `materializarFijoSchema` al import de `../validators/turnoFijo.schema.js`, y registrar la ruta (después de `/liberar`):
```typescript
turnoFijoRoutes.post('/:id/materializar', authAny, validate(materializarFijoSchema), async (req, res, next) => {
  try {
    const { fecha } = (req as any).valid.body;
    const creada = await turnoFijoService.materializar(String(req.params.id), fecha);
    const reserva = await reservaService.get(creada.id); // incluye cliente + cancha
    const agg = await prisma.cobro.aggregate({ where: { reservaId: reserva.id }, _sum: { monto: true } });
    const pagado = Number(agg._sum.monto ?? 0);
    res.status(201).json({ ...reserva, pagado, saldo: Math.max(0, Number(reserva.monto) - pagado) });
  } catch (e) { next(e); }
});
```
> `reservaService.get` (findById) incluye `cliente` y `cancha`, así el frontend puede abrir el sheet de cobro con la reserva completa.

- [ ] **Step 6: Correr → PASA.** `npx vitest run tests/integration/materializar-fijo.test.ts` → todos verdes (incluye el de humo de Task 1).

- [ ] **Step 7: tsc + commit.**
```bash
npx tsc --noEmit
git add src/services/turnoFijo.service.ts src/validators/turnoFijo.schema.ts src/routes/turnoFijo.routes.ts tests/integration/materializar-fijo.test.ts
git commit -m "feat(turnos-fijos): POST /materializar (reserva CONFIRMADA con precio de cancha, idempotente)"
```

---

### Task 4: Endpoint de agenda del día

**Files:**
- Create: `backend/src/services/agenda.service.ts`
- Create: `backend/src/routes/agenda.routes.ts`
- Modify: `backend/src/app.ts` (montar la ruta)
- Test: `backend/tests/integration/agenda.test.ts`

**Interfaces:**
- Consumes: `reservaService.list`, `precioEfectivo`, `configService`, `dayOfWeekInTz`, `combineDateTimeUtc`, `prisma`.
- Produces: `agendaService.delDia(fecha)` → `{ reservas, fijos, bloqueos }`; `GET /agenda?fecha`.

- [ ] **Step 1: Test que falla (integración).** Crear `backend/tests/integration/agenda.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
});
const agenda = (fecha: string) => supertest(app).get(`/agenda?fecha=${fecha}`).set('x-api-key', 'svc');

describe('GET /agenda', () => {
  it('lista fijos virtuales del día con precio de la cancha', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });
    const r = await agenda('2026-06-24'); // miércoles
    expect(r.status).toBe(200);
    expect(r.body.fijos).toHaveLength(1);
    expect(Number(r.body.fijos[0].precio)).toBe(12000);
    expect(r.body.fijos[0].turnoFijoId).toBeTruthy();
  });
  it('excluye el fijo ya materializado (no se duplica)', async () => {
    const f = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });
    await supertest(app).post(`/turnos-fijos/${f.id}/materializar`).set('x-api-key', 'svc').send({ fecha: '2026-06-24' });
    const r = await agenda('2026-06-24');
    expect(r.body.fijos).toHaveLength(0);
    expect(r.body.reservas).toHaveLength(1);
  });
  it('excluye fijo liberado (excepción) y lista bloqueos del día', async () => {
    const f = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '5491136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });
    await getPrisma().turnoFijoExcepcion.create({ data: { turnoFijoId: f.id, fecha: new Date('2026-06-24T00:00:00.000Z') } });
    await getPrisma().bloqueo.create({ data: { canchaId, motivo: 'TORNEO', recurrente: false, fecha: new Date('2026-06-24T00:00:00.000Z'), horaInicio: '10:00', horaFin: '14:00', activo: true } });
    const r = await agenda('2026-06-24');
    expect(r.body.fijos).toHaveLength(0);
    expect(r.body.bloqueos).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr → FALLA.** `npx vitest run tests/integration/agenda.test.ts` → FAIL (sin ruta).

- [ ] **Step 3: Service.** Crear `backend/src/services/agenda.service.ts`:
```typescript
import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { dayOfWeekInTz, combineDateTimeUtc } from '../utils/tz.js';
import { precioEfectivo } from './precio.service.js';
import { configService } from './config.service.js';
import { reservaService } from './reserva.service.js';

export const agendaService = {
  async delDia(fecha: string) {
    const tz = getEnv().TZ_NEGOCIO;
    const dia = dayOfWeekInTz(fecha, tz);
    const fechaDate = new Date(fecha + 'T00:00:00.000Z');
    const inicioDia = combineDateTimeUtc(fecha, '00:00', tz);
    const finDia = new Date(inicioDia.getTime() + 86400000);

    const reservas = await reservaService.list({ fecha });

    // fijos materializados ese día → para no duplicar
    const materializados = await prisma.reserva.findMany({
      where: { turnoFijoId: { not: null }, fechaInicio: { gte: inicioDia, lt: finDia } },
      select: { turnoFijoId: true },
    });
    const yaMat = new Set(materializados.map((r) => r.turnoFijoId));

    const cfg = await configService.get();
    const fijosRaw = await prisma.turnoFijo.findMany({
      where: { activo: true, diaSemana: dia },
      include: { cancha: true, excepciones: { where: { fecha: fechaDate } } },
    });
    const fijos = fijosRaw
      .filter((f) => f.excepciones.length === 0 && !yaMat.has(f.id))
      .map((f) => ({
        turnoFijoId: f.id,
        canchaId: f.canchaId,
        cancha: { nombre: f.cancha.nombre },
        clienteNombre: f.clienteNombre,
        whatsapp: f.whatsapp,
        horaInicio: f.horaInicio,
        horaFin: f.horaFin,
        precio: precioEfectivo(f.cancha, fecha, f.horaInicio, cfg),
      }));

    const bloqueosRaw = await prisma.bloqueo.findMany({
      where: { activo: true, OR: [{ recurrente: true, diaSemana: dia }, { recurrente: false, fecha: fechaDate }] },
      include: { cancha: true },
    });
    const bloqueos = bloqueosRaw.map((b) => ({
      id: b.id, canchaId: b.canchaId, motivo: b.motivo, recurrente: b.recurrente,
      diaSemana: b.diaSemana, fecha: b.fecha, horaInicio: b.horaInicio, horaFin: b.horaFin,
      nota: b.nota, cancha: { nombre: b.cancha.nombre },
    }));

    return { reservas, fijos, bloqueos };
  },
};
```

- [ ] **Step 4: Ruta.** Crear `backend/src/routes/agenda.routes.ts`:
```typescript
import { Router } from 'express';
import { z } from 'zod';
import { authAny } from '../middlewares/authAny.js';
import { validate } from '../middlewares/validate.js';
import { agendaService } from '../services/agenda.service.js';

const empty = z.looseObject({});
const agendaSchema = z.object({
  query: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  body: z.unknown(), params: empty,
});

export const agendaRoutes = Router();
agendaRoutes.get('/', authAny, validate(agendaSchema), async (req, res, next) => {
  try { res.json(await agendaService.delDia((req as any).valid.query.fecha)); } catch (e) { next(e); }
});
```
> Nota: `authAny` (acepta x-api-key o JWT) para que los tests con `x-api-key` y el panel con cookie funcionen.

- [ ] **Step 5: Montar la ruta.** En `backend/src/app.ts`, junto a los otros `app.use('/...', ...)`, agregar el import `import { agendaRoutes } from './routes/agenda.routes.js';` y:
```typescript
app.use('/agenda', agendaRoutes);
```

- [ ] **Step 6: Correr → PASA.** `npx vitest run tests/integration/agenda.test.ts` → 3/3.

- [ ] **Step 7: tsc + commit.**
```bash
npx tsc --noEmit
git add src/services/agenda.service.ts src/routes/agenda.routes.ts src/app.ts tests/integration/agenda.test.ts
git commit -m "feat(agenda): GET /agenda?fecha (reservas + fijos virtuales + bloqueos)"
```

- [ ] **Step 8: Cierre backend.** `npx tsc --noEmit` ok + regresión integración (`npx vitest run`, Docker; ajustar tests de fijos que usen `precio`/sin whatsapp si los hubiera) → **superpowers:finishing-a-development-branch** (merge a `main` + push). Deploy VM lo hace el usuario.

---

### Task 5: Frontend — tipos, acciones y diálogo de fijo (sin precio, whatsapp requerido)

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/fijos-actions.ts`
- Modify: `frontend/src/lib/validators.ts`
- Modify: `frontend/src/components/fijos/turno-fijo-dialog.tsx`

**Interfaces:**
- Consumes: `aCanonico`/`previewWhatsapp` de `@/lib/whatsapp` (ya existen).
- Produces: tipos `FijoAgenda`, `AgendaDia`; acción `materializarFijo(id, fecha)`.

- [ ] **Step 1: Tipos.** En `frontend/src/lib/types.ts`, debajo de la interfaz `Bloqueo`, agregar:
```typescript
export interface FijoAgenda {
  turnoFijoId: string; canchaId: string; cancha: { nombre: string };
  clienteNombre: string; whatsapp: string | null;
  horaInicio: string; horaFin: string; precio: number;
}
export interface AgendaDia { reservas: Reserva[]; fijos: FijoAgenda[]; bloqueos: Bloqueo[]; }
```

- [ ] **Step 2: Acción `materializarFijo`.** En `frontend/src/lib/fijos-actions.ts`:
- Cambiar el tipo `FijoInput` (sacar `precio`, `whatsapp` requerido):
```typescript
type FijoInput = { canchaId: string; clienteNombre: string; whatsapp: string; diaSemana: number; horaInicio: string; horaFin: string };
```
- Agregar el import de tipos arriba: `import { ApiError, type Reserva } from './types';` (reemplaza el `import { ApiError } from './types';`).
- Agregar al final:
```typescript
export async function materializarFijo(id: string, fecha: string): Promise<{ ok: true; reserva: Reserva } | { ok: false; error: string }> {
  try {
    const reserva = await apiFetch<Reserva>(`/turnos-fijos/${id}/materializar`, { method: 'POST', body: JSON.stringify({ fecha }) });
    revalidatePath('/hoy'); revalidatePath('/reservas');
    return { ok: true, reserva };
  } catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}
```

- [ ] **Step 3: Validator del fijo (front).** En `frontend/src/lib/validators.ts`, reemplazar `turnoFijoSchema` por (sin `precio`, whatsapp requerido y válido):
```typescript
export const turnoFijoSchema = z.object({
  canchaId: z.string().min(1, 'Elegí una cancha'),
  clienteNombre: z.string().min(1, 'Ingresá el cliente'),
  whatsapp: z.string().refine((s) => aCanonico(s) !== null, 'WhatsApp inválido (ej: 11 3662 0274)'),
  diaSemana: z.coerce.number().int().min(0).max(6),
  horaInicio: hhmm, horaFin: hhmm,
}).refine((b) => b.horaInicio < b.horaFin, { message: 'Inicio debe ser antes del fin', path: ['horaFin'] });
```
(El import `import { aCanonico } from './whatsapp';` ya fue agregado en el feature de normalización.)

- [ ] **Step 4: Diálogo del fijo.** En `frontend/src/components/fijos/turno-fijo-dialog.tsx`:
- Agregar import: `import { previewWhatsapp } from '@/lib/whatsapp';`
- Quitar el estado `precio`: borrar la línea `const [precio, setPrecio] = useState('');` y, en `handleOpenChange`, la línea `setPrecio('');`.
- En `submit`, quitar `precio` del objeto del `safeParse`:
```typescript
    const parsed = turnoFijoSchema.safeParse({ canchaId, clienteNombre, whatsapp, diaSemana, horaInicio, horaFin });
```
- Reemplazar el bloque del input de WhatsApp por (preview + placeholder local):
```tsx
          <div className="space-y-1">
            <Label htmlFor="tf-whatsapp">WhatsApp</Label>
            <Input id="tf-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
            {whatsapp.trim() !== '' && (
              previewWhatsapp(whatsapp)
                ? <p className="text-xs text-muted-foreground">Se guardará como: {previewWhatsapp(whatsapp)}</p>
                : <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>
            )}
          </div>
```
- Borrar el bloque del input de **precio** completo (el `<div>` con `<Label htmlFor="tf-precio">` y su `<Input id="tf-precio" ...>`).

- [ ] **Step 5: Verificar.** `cd frontend && pnpm vitest run src/lib/validators.test.ts` → PASS (si algún caso valida `precio`/whatsapp viejo del fijo, actualizarlo). Luego `pnpm build` → sin errores.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/types.ts src/lib/fijos-actions.ts src/lib/validators.ts src/components/fijos/turno-fijo-dialog.tsx
git commit -m "feat(fijos): sin precio + whatsapp requerido; tipos agenda y accion materializar"
```

---

### Task 6: Frontend — /hoy muestra fijos (cobrables) y bloqueos

**Files:**
- Modify: `frontend/src/app/(panel)/hoy/page.tsx`
- Modify: `frontend/src/components/hoy/agenda-hoy.tsx`
- Create: `frontend/src/components/hoy/fijo-card.tsx`
- Create: `frontend/src/components/hoy/bloqueo-card.tsx`

**Interfaces:**
- Consumes: `AgendaDia`, `FijoAgenda`, `Bloqueo`, `materializarFijo`, `AccionReservaSheet`.

- [ ] **Step 1: Página carga la agenda.** Reemplazar `frontend/src/app/(panel)/hoy/page.tsx` por:
```tsx
import { apiFetch } from '@/lib/api';
import type { Cancha, CajaReporte, AgendaDia } from '@/lib/types';
import { hoyAR } from '@/lib/fecha';
import { AgendaHoy } from '@/components/hoy/agenda-hoy';

export default async function HoyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const fecha = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : hoyAR();

  const [canchas, agenda, caja] = await Promise.all([
    apiFetch<Cancha[]>('/canchas'),
    apiFetch<AgendaDia>(`/agenda?fecha=${fecha}`),
    apiFetch<CajaReporte>(`/caja?desde=${fecha}&hasta=${fecha}`),
  ]);

  return <AgendaHoy agenda={agenda} canchas={canchas} fecha={fecha} totalCobrado={caja.total} />;
}
```

- [ ] **Step 2: BloqueoCard.** Crear `frontend/src/components/hoy/bloqueo-card.tsx`:
```tsx
import { Ban } from 'lucide-react';
import type { Bloqueo } from '@/lib/types';
import { etiquetaMotivo } from '@/lib/calendario';

export function BloqueoCard({ bloqueo }: { bloqueo: Bloqueo }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed bg-neutral-50 px-4 py-3">
      <Ban className="h-5 w-5 flex-none text-neutral-400" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-neutral-700">
          {bloqueo.horaInicio}–{bloqueo.horaFin} · {bloqueo.cancha?.nombre ?? 'Cancha'}
        </p>
        <p className="truncate text-xs text-neutral-500">
          {etiquetaMotivo(bloqueo.motivo)}{bloqueo.nota ? ` · ${bloqueo.nota}` : ''}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: FijoCard.** Crear `frontend/src/components/hoy/fijo-card.tsx`:
```tsx
import { CalendarClock } from 'lucide-react';
import type { FijoAgenda } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function FijoCard({ fijo, onClick }: { fijo: FijoAgenda; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left transition hover:bg-neutral-50">
      <CalendarClock className="h-5 w-5 flex-none text-sky-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fijo.horaInicio}–{fijo.horaFin} · {fijo.cancha.nombre}</p>
        <p className="truncate text-xs text-neutral-500">Fijo · {fijo.clienteNombre}</p>
      </div>
      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Fijo · {money(fijo.precio)}</span>
    </button>
  );
}
```

- [ ] **Step 4: AgendaHoy integra fijos + bloqueos.** Reemplazar `frontend/src/components/hoy/agenda-hoy.tsx` por:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NuevaReservaDialog } from '@/components/reservas/nueva-reserva-dialog';
import { ReprogramarDialog } from '@/components/reservas/reprogramar-dialog';
import { TurnoCard } from './turno-card';
import { FijoCard } from './fijo-card';
import { BloqueoCard } from './bloqueo-card';
import { AccionReservaSheet } from '@/components/reservas/accion-reserva-sheet';
import { materializarFijo } from '@/lib/fijos-actions';
import { addDias, esHoy, fmtFechaLarga, hoyAR } from '@/lib/fecha';
import type { AgendaDia, Cancha, Reserva } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function AgendaHoy({ agenda, canchas, fecha, totalCobrado }: { agenda: AgendaDia; canchas: Cancha[]; fecha: string; totalCobrado: number }) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Reserva | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reprogramarId, setReprogramarId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reservas = agenda.reservas.filter((r) => r.estado !== 'CANCELADA');
  const vacio = reservas.length === 0 && agenda.fijos.length === 0 && agenda.bloqueos.length === 0;
  const irA = (ymd: string) => router.push(`/hoy?fecha=${ymd}`);

  function abrir(r: Reserva) { setSeleccion(r); setSheetOpen(true); }

  function cobrarFijo(turnoFijoId: string) {
    start(async () => {
      const res = await materializarFijo(turnoFijoId, fecha);
      if (!res.ok) { toast.error(res.error); return; }
      setSeleccion(res.reserva); setSheetOpen(true);
    });
  }

  return (
    <div className="space-y-4">
      <header className="sticky top-0 z-10 -mx-4 bg-neutral-50/95 px-4 pb-3 pt-1 backdrop-blur supports-backdrop-filter:bg-neutral-50/80">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{esHoy(fecha) ? 'Hoy' : 'Agenda'}</h1>
            <p className="text-sm capitalize text-neutral-500">{fmtFechaLarga(fecha)}</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Cobrado: {money(totalCobrado)}</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => irA(addDias(fecha, -1))} aria-label="Día anterior"><ChevronLeft className="h-4 w-4" /></Button>
          {!esHoy(fecha) && <Button variant="outline" size="sm" onClick={() => irA(hoyAR())}>Hoy</Button>}
          <Button variant="outline" size="icon" onClick={() => irA(addDias(fecha, 1))} aria-label="Día siguiente"><ChevronRight className="h-4 w-4" /></Button>
          <div className="ml-auto"><NuevaReservaDialog canchas={canchas} /></div>
        </div>
      </header>

      {vacio ? (
        <div className="rounded-xl border border-dashed bg-white py-12 text-center">
          <CalendarDays className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm text-neutral-500">No hay turnos para este día.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reservas.map((r) => <TurnoCard key={r.id} reserva={r} onClick={() => abrir(r)} />)}
          {agenda.fijos.map((f) => <FijoCard key={f.turnoFijoId} fijo={f} onClick={() => { if (!pending) cobrarFijo(f.turnoFijoId); }} />)}
          {agenda.bloqueos.map((b) => <BloqueoCard key={b.id} bloqueo={b} />)}
        </div>
      )}

      <AccionReservaSheet reserva={seleccion} open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) { setSeleccion(null); router.refresh(); } }} onReprogramar={(id) => setReprogramarId(id)} />
      <ReprogramarDialog id={reprogramarId} open={reprogramarId !== null} onOpenChange={(o) => { if (!o) { setReprogramarId(null); router.refresh(); } }} />
    </div>
  );
}
```
> Nota: al cerrar el sheet se hace `router.refresh()` para que el fijo recién materializado aparezca como reserva y desaparezca de la lista de fijos virtuales.

- [ ] **Step 5: Verificar.** `pnpm build` → sin errores. `pnpm lint` → sin errores (ojo `react-hooks` con `pending`/transición: el patrón `start(async ...)` es correcto).

- [ ] **Step 6: Commit.**
```bash
git add "src/app/(panel)/hoy/page.tsx" src/components/hoy/agenda-hoy.tsx src/components/hoy/fijo-card.tsx src/components/hoy/bloqueo-card.tsx
git commit -m "feat(hoy): agenda muestra fijos (cobrables) y bloqueos del dia"
```

---

### Task 7: Frontend — /reservas muestra fijos y bloqueos del día

**Files:**
- Modify: `frontend/src/app/(panel)/reservas/page.tsx`
- Modify: `frontend/src/components/reservas/reservas-table.tsx`

**Interfaces:**
- Consumes: `AgendaDia`, `FijoAgenda`, `Bloqueo`.

- [ ] **Step 1: Página usa /agenda para fijos+bloqueos.** En `frontend/src/app/(panel)/reservas/page.tsx`:
- Cambiar el import de tipos a: `import type { Reserva, Cancha, AgendaDia } from '@/lib/types';`
- Después de obtener `reservas`, agregar (mismo día del filtro):
```tsx
  const agenda = await apiFetch<AgendaDia>(`/agenda?fecha=${f.fecha}`);
  const fijos = f.canchaId ? agenda.fijos.filter((x) => x.canchaId === f.canchaId) : agenda.fijos;
  const bloqueos = f.canchaId ? agenda.bloqueos.filter((x) => x.canchaId === f.canchaId) : agenda.bloqueos;
```
- Pasar las props nuevas a la tabla: `<ReservasTable reservas={reservas} fijos={fijos} bloqueos={bloqueos} />`.
> Los fijos/bloqueos se muestran como contexto del día y NO dependen del filtro de estado (no tienen estado); el filtro de cancha sí se les aplica (arriba).

- [ ] **Step 2: Tabla renderiza filas extra.** En `frontend/src/components/reservas/reservas-table.tsx`:
- Ampliar las props: aceptar `fijos?: FijoAgenda[]` y `bloqueos?: Bloqueo[]` (import `import type { FijoAgenda, Bloqueo } from '@/lib/types';`).
- Debajo de la tabla de reservas, agregar una sección (solo si hay alguno):
```tsx
      {((fijos?.length ?? 0) > 0 || (bloqueos?.length ?? 0) > 0) && (
        <div className="mt-4 space-y-1 rounded-lg border bg-white p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">También este día</p>
          {fijos?.map((f) => (
            <div key={f.turnoFijoId} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
              <span>{f.horaInicio}–{f.horaFin} · {f.cancha.nombre} · {f.clienteNombre}</span>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">Fijo · ${Number(f.precio).toLocaleString('es-AR')}</span>
            </div>
          ))}
          {bloqueos?.map((b) => (
            <div key={b.id} className="flex items-center justify-between border-b py-2 text-sm text-neutral-600 last:border-0">
              <span>{b.horaInicio}–{b.horaFin} · {b.cancha?.nombre ?? 'Cancha'} · {b.nota ?? b.motivo}</span>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">Bloqueo</span>
            </div>
          ))}
        </div>
      )}
```
> Para cobrar un fijo, el flujo es desde /hoy; en /reservas se muestran como contexto (solo lectura).

- [ ] **Step 3: Verificar.** `pnpm build` + `pnpm lint` → sin errores.

- [ ] **Step 4: Commit.**
```bash
git add "src/app/(panel)/reservas/page.tsx" src/components/reservas/reservas-table.tsx
git commit -m "feat(reservas): mostrar fijos y bloqueos del dia como contexto"
```

- [ ] **Step 5: Cierre frontend.** `pnpm build` + `pnpm lint` ok → **superpowers:finishing-a-development-branch** (merge a `master` local).
```

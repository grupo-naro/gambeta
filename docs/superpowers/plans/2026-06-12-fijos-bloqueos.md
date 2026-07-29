# Turnos fijos + Bloqueos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargar turnos fijos (habitués recurrentes) y bloqueos (torneo/entrenamiento/mantenimiento) desde el panel; que resten disponibilidad y no se puedan reservar. Gestión solo-panel; el bot los respeta vía `/disponibilidad` sin cambios.

**Architecture:** Opción B — fijos y bloqueos son **plantillas** (no se materializan). Un `ocupacionService` calcula, por cancha y fecha, los rangos ocupados por fijos/bloqueos (a nivel sector, reusando `CanchaSector`). La disponibilidad los resta y `reserva.crear` valida que no se pisen (409). Anti-overlap alquiler↔alquiler sigue por constraint de base.

**Tech Stack:** Express 5 + TS + Prisma 7 + Zod + Vitest/Supertest/Testcontainers. Frontend Next 16 + Tailwind 4 + shadcn(Base UI) + pnpm.

---

# PART 1 — Backend (`feat/fijos-bloqueos-backend`)

**Branch:** desde `main`, `c:/Users/Lautaro/Desktop/ortigoza/backend`. Docker corriendo. `npx vitest run`, `npx tsc --noEmit`.

**Contexto:**
- Modelo de sectores ya existe: `Sector`, `CanchaSector` (canchaId↔sectorId), `ReservaSector` (ocupación de alquileres con exclusion constraint).
- `src/utils/tz.ts`: `combineDateTimeUtc(date,time,tz)`, `dayOfWeekInTz(date,tz)→0..6`, `dayWindowUtc`. TZ negocio: `getEnv().TZ_NEGOCIO`.
- `disponibilidad.service.listar(canchaId,fecha)`: arma slots `cfg.horaApertura..cfg.horaCierre`; ocupación actual = `ReservaSector` activo por sectores de la cancha.
- `reserva.service.crear`: calcula `fechaInicio/fechaFin`, chequea pasado, luego transacción. `Conflict`(409)/`BusinessRule`(422) en `src/utils/errors.ts`.
- Rutas se montan en `src/routes/index.ts`.

## Task B1: Modelos + migración

**Files:** Modify `prisma/schema.prisma`; Create migración; Test `tests/integration/fijos-bloqueos.test.ts`

- [ ] **Step 1: schema**
```prisma
model TurnoFijo {
  id            String   @id @default(cuid())
  canchaId      String
  cancha        Cancha   @relation(fields: [canchaId], references: [id])
  clienteNombre String
  whatsapp      String?
  diaSemana     Int
  horaInicio    String
  horaFin       String
  precio        Decimal  @db.Decimal(10, 2)
  activo        Boolean  @default(true)
  creadoEn      DateTime @default(now())
  excepciones   TurnoFijoExcepcion[]
  @@index([canchaId, diaSemana])
}

model TurnoFijoExcepcion {
  id          String    @id @default(cuid())
  turnoFijoId String
  turnoFijo   TurnoFijo @relation(fields: [turnoFijoId], references: [id], onDelete: Cascade)
  fecha       DateTime  @db.Date
  @@unique([turnoFijoId, fecha])
}

enum MotivoBloqueo { TORNEO ENTRENAMIENTO MANTENIMIENTO OTRO }

model Bloqueo {
  id         String        @id @default(cuid())
  canchaId   String
  cancha     Cancha        @relation(fields: [canchaId], references: [id])
  motivo     MotivoBloqueo
  recurrente Boolean       @default(false)
  diaSemana  Int?
  fecha      DateTime?     @db.Date
  horaInicio String
  horaFin    String
  nota       String?
  activo     Boolean       @default(true)
  creadoEn   DateTime      @default(now())
  @@index([canchaId])
}
```
En `model Cancha` agregar relaciones inversas: `turnosFijos TurnoFijo[]` y `bloqueos Bloqueo[]`.

- [ ] **Step 2:** `npx prisma migrate dev --name fijos_bloqueos` (crea tablas; si hace falta `npx prisma generate`).

- [ ] **Step 3:** Verificar que `tests/helpers/db.ts` `resetTables` limpie las nuevas tablas (`turnoFijoExcepcion`, `turnoFijo`, `bloqueo`) — agregarlas si usa lista fija (excepción antes que turnoFijo por FK).

- [ ] **Step 4: Test (smoke del modelo)** — crear el archivo con el setup estándar (buildApp + admin token, como `cancha-delete.test.ts`) y un test mínimo:
```ts
it('crea un turno fijo en la DB', async () => {
  const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
  const f = await getPrisma().turnoFijo.create({ data: { canchaId: c.id, clienteNombre: 'Juan', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', precio: 12000 } });
  expect(f.id).toBeTruthy();
});
```
Run: `npx vitest run tests/integration/fijos-bloqueos.test.ts` → PASS. `npx tsc --noEmit`.

- [ ] **Step 5: commit**
```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.ts tests/integration/fijos-bloqueos.test.ts
git commit -m "feat(fijos): modelos TurnoFijo/Excepcion/Bloqueo + migracion"
```

## Task B2: `ocupacionService` (rangos por plantilla, a nivel sector)

**Files:** Create `src/services/ocupacion.service.ts`; Test append a `fijos-bloqueos.test.ts`

- [ ] **Step 1: Crear `src/services/ocupacion.service.ts`**
```ts
import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { dayOfWeekInTz } from '../utils/tz.js';

const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

// minutos AR (diaSemana + minuto del día) de un timestamp.
function partesAr(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const min = (p.hour === '24' ? 0 : Number(p.hour)) * 60 + Number(p.minute);
  return { dia, min };
}

export interface RangoOcupado { ini: number; fin: number; tipo: 'fijo' | 'bloqueo' }

export const ocupacionService = {
  // canchas que comparten algún sector con la dada (incluye la misma).
  async canchasRelacionadas(canchaId: string): Promise<string[]> {
    const cs = await prisma.canchaSector.findMany({ where: { canchaId }, select: { sectorId: true } });
    const sectorIds = cs.map((s) => s.sectorId);
    if (sectorIds.length === 0) return [canchaId];
    const rel = await prisma.canchaSector.findMany({ where: { sectorId: { in: sectorIds } }, select: { canchaId: true } });
    return [...new Set(rel.map((r) => r.canchaId))];
  },

  // rangos [ini,fin) (minutos) ocupados por fijos/bloqueos para esa cancha en esa fecha.
  async rangosPlantilla(canchaId: string, fecha: string): Promise<RangoOcupado[]> {
    const tz = getEnv().TZ_NEGOCIO;
    const dia = dayOfWeekInTz(fecha, tz);
    const canchas = await ocupacionService.canchasRelacionadas(canchaId);
    const fechaDate = new Date(fecha + 'T00:00:00.000Z');
    const out: RangoOcupado[] = [];

    const fijos = await prisma.turnoFijo.findMany({
      where: { canchaId: { in: canchas }, activo: true, diaSemana: dia },
      include: { excepciones: { where: { fecha: fechaDate } } },
    });
    for (const f of fijos) if (f.excepciones.length === 0) out.push({ ini: fromHHMM(f.horaInicio), fin: fromHHMM(f.horaFin), tipo: 'fijo' });

    const bloqueos = await prisma.bloqueo.findMany({
      where: { canchaId: { in: canchas }, activo: true, OR: [{ recurrente: true, diaSemana: dia }, { recurrente: false, fecha: fechaDate }] },
    });
    for (const b of bloqueos) out.push({ ini: fromHHMM(b.horaInicio), fin: fromHHMM(b.horaFin), tipo: 'bloqueo' });
    return out;
  },

  // ¿[iniMin,finMin) choca con un fijo/bloqueo en esa fecha? devuelve el tipo o null.
  async conflictoReserva(canchaId: string, fecha: string, iniMin: number, finMin: number): Promise<'fijo' | 'bloqueo' | null> {
    const rangos = await ocupacionService.rangosPlantilla(canchaId, fecha);
    const r = rangos.find((x) => x.ini < finMin && iniMin < x.fin);
    return r ? r.tipo : null;
  },

  // Para crear un fijo/bloqueo: ¿pisa un alquiler futuro activo o un fijo/bloqueo existente?
  // match: recurrente => por diaSemana; puntual => por fecha exacta.
  async conflictoAlCrear(canchaId: string, opts: { diaSemana?: number; fecha?: string }, iniMin: number, finMin: number): Promise<boolean> {
    const tz = getEnv().TZ_NEGOCIO;
    const canchas = await ocupacionService.canchasRelacionadas(canchaId);
    // 1) contra otros fijos/bloqueos (mismo día o misma fecha)
    if (opts.fecha != null) {
      const rangos = await ocupacionService.rangosPlantilla(canchaId, opts.fecha);
      if (rangos.some((x) => x.ini < finMin && iniMin < x.fin)) return true;
    } else if (opts.diaSemana != null) {
      const fijos = await prisma.turnoFijo.findMany({ where: { canchaId: { in: canchas }, activo: true, diaSemana: opts.diaSemana }, select: { horaInicio: true, horaFin: true } });
      const bloqs = await prisma.bloqueo.findMany({ where: { canchaId: { in: canchas }, activo: true, recurrente: true, diaSemana: opts.diaSemana }, select: { horaInicio: true, horaFin: true } });
      const tpl = [...fijos, ...bloqs];
      if (tpl.some((x) => fromHHMM(x.horaInicio) < finMin && iniMin < fromHHMM(x.horaFin))) return true;
    }
    // 2) contra alquileres futuros activos en los sectores
    const sectores = (await prisma.canchaSector.findMany({ where: { canchaId: { in: canchas } }, select: { sectorId: true } })).map((s) => s.sectorId);
    const alquileres = await prisma.reservaSector.findMany({
      where: { sectorId: { in: sectores }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] }, fechaInicio: { gte: new Date() } },
      select: { fechaInicio: true, fechaFin: true },
    });
    const fechaTarget = opts.fecha; // YYYY-MM-DD si puntual
    for (const a of alquileres) {
      const pi = partesAr(a.fechaInicio, tz); const pf = partesAr(a.fechaFin, tz);
      const matchDia = opts.diaSemana != null ? pi.dia === opts.diaSemana : true;
      // para puntual: comparar la fecha AR del alquiler
      let matchFecha = true;
      if (fechaTarget) {
        const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(a.fechaInicio);
        matchFecha = f === fechaTarget;
      }
      const overlap = pi.min < finMin && iniMin < pf.min;
      if (matchDia && matchFecha && overlap) return true;
    }
    return false;
  },
};
```

- [ ] **Step 2: Test (TDD) — rangosPlantilla** (append). Crear cancha + sector (vía POST /canchas, que ya crea sector) o `prisma.cancha.create` + sector manual. Crear un fijo el martes 20–21 y verificar `rangosPlantilla` para un martes lo incluye y para un lunes no; y que una excepción lo saca.
```ts
it('rangosPlantilla incluye el fijo el dia que toca y lo excluye con excepcion', async () => {
  const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000 })).body;
  await getPrisma().turnoFijo.create({ data: { canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', precio: 12000 } });
  const { ocupacionService } = await import('../../src/services/ocupacion.service.js');
  // buscar un martes futuro
  const martes = proximoDia(2); // helper local que devuelve YYYY-MM-DD del próximo martes
  const lunes = proximoDia(1);
  expect((await ocupacionService.rangosPlantilla(c.id, martes)).length).toBe(1);
  expect((await ocupacionService.rangosPlantilla(c.id, lunes)).length).toBe(0);
});
```
(Definir `proximoDia(dow)` arriba del describe: itera desde mañana hasta encontrar ese día de semana en TZ AR usando `dayOfWeekInTz`.)
```ts
import { dayOfWeekInTz } from '../../src/utils/tz.js';
function proximoDia(dow: number) {
  for (let i = 1; i <= 14; i++) {
    const f = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
    if (dayOfWeekInTz(f, 'America/Argentina/Buenos_Aires') === dow) return f;
  }
  throw new Error('no day');
}
```
Run → PASS. Commit:
```bash
git add src/services/ocupacion.service.ts tests/integration/fijos-bloqueos.test.ts
git commit -m "feat(fijos): ocupacionService (rangos por plantilla + conflictos, a nivel sector)"
```

## Task B3: disponibilidad resta fijos/bloqueos + reserva.crear valida

**Files:** Modify `src/services/disponibilidad.service.ts`, `src/services/reserva.service.ts`; Test append

- [ ] **Step 1: Test (TDD)** — fijo el martes 20hs → ese slot no aparece en disponibilidad; reservar 20hs ese martes → 409.
```ts
it('disponibilidad esconde el slot del fijo y reservarlo da 409', async () => {
  const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000 })).body;
  await getPrisma().turnoFijo.create({ data: { canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', precio: 12000 } });
  const martes = proximoDia(2);
  const disp = await supertest(app).get('/disponibilidad').query({ canchaId: c.id, fecha: martes }).set('x-api-key', 'svc');
  expect(disp.body.slots.map((s: any) => s.horaInicio)).not.toContain('20:00');
  const r = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: c.id, whatsapp: '+5491150000000', nombreCliente: 'A', esContacto: true, fecha: martes, horaInicio: '20:00' });
  expect(r.status).toBe(409);
});
```

- [ ] **Step 2: disponibilidad** — en `disponibilidad.service.ts`, tras obtener `ocup` (ReservaSector), agregar:
```ts
import { ocupacionService } from './ocupacion.service.js';
// ...dentro de listar, antes del loop:
    const plantillas = await ocupacionService.rangosPlantilla(canchaId, fecha);
```
y en el loop, el `taken` pasa a:
```ts
      const minIni = fromHHMM(horaInicio); const minFin = fromHHMM(horaFin);
      const taken = ocup.some((r) => r.fechaInicio < finUtc && inicioUtc < r.fechaFin)
        || plantillas.some((p) => p.ini < minFin && minIni < p.fin);
```
(`fromHHMM` ya existe en el archivo.)

- [ ] **Step 3: reserva.crear** — en `src/services/reserva.service.ts`, importar `ocupacionService`, y tras el chequeo de pasado agregar:
```ts
    const iniMin = Number(input.horaInicio.split(':')[0]) * 60 + Number(input.horaInicio.split(':')[1]);
    const motivo = await ocupacionService.conflictoReserva(input.canchaId, input.fecha, iniMin, iniMin + 60);
    if (motivo === 'fijo') throw Conflict('Ese horario está tomado por un turno fijo');
    if (motivo === 'bloqueo') throw Conflict('Ese horario está bloqueado');
```

- [ ] **Step 4: Run + suite + tsc + commit**
```bash
npx vitest run tests/integration/fijos-bloqueos.test.ts
npx vitest run && npx tsc --noEmit
git add src/services/disponibilidad.service.ts src/services/reserva.service.ts tests/integration/fijos-bloqueos.test.ts
git commit -m "feat(fijos): disponibilidad resta fijos/bloqueos + reserva.crear valida (409)"
```

## Task B4: Turnos fijos — service + endpoints + schema

**Files:** Create `src/services/turnoFijo.service.ts`, `src/routes/turnoFijo.routes.ts`, `src/validators/turnoFijo.schema.ts`; Modify `src/routes/index.ts`; Test append

- [ ] **Step 1: schema `src/validators/turnoFijo.schema.ts`**
```ts
import { z } from 'zod';
const empty = z.looseObject({});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');

export const crearTurnoFijoSchema = z.object({
  body: z.object({
    canchaId: z.string().min(1),
    clienteNombre: z.string().min(1),
    whatsapp: z.string().optional(),
    diaSemana: z.coerce.number().int().min(0).max(6),
    horaInicio: hhmm,
    horaFin: hhmm,
    precio: z.coerce.number().positive(),
  }).refine((b) => b.horaInicio < b.horaFin, { message: 'La hora de inicio debe ser anterior al fin', path: ['horaFin'] }),
  query: empty, params: empty,
});
export const excepcionSchema = z.object({
  body: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const idFijoParamSchema = z.object({ body: z.unknown(), query: empty, params: z.object({ id: z.string().min(1) }) });
```

- [ ] **Step 2: service `src/services/turnoFijo.service.ts`**
```ts
import { prisma } from '../db/prisma.js';
import { Conflict, NotFound } from '../utils/errors.js';
import { ocupacionService } from './ocupacion.service.js';

const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export const turnoFijoService = {
  list: (canchaId?: string) =>
    prisma.turnoFijo.findMany({ where: canchaId ? { canchaId } : {}, include: { cancha: { select: { nombre: true } }, excepciones: true }, orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }] }),
  async crear(input: { canchaId: string; clienteNombre: string; whatsapp?: string; diaSemana: number; horaInicio: string; horaFin: string; precio: number }) {
    const choca = await ocupacionService.conflictoAlCrear(input.canchaId, { diaSemana: input.diaSemana }, fromHHMM(input.horaInicio), fromHHMM(input.horaFin));
    if (choca) throw Conflict('Ese horario ya está ocupado (otra reserva, fijo o bloqueo)');
    return prisma.turnoFijo.create({ data: input });
  },
  async eliminar(id: string) {
    const f = await prisma.turnoFijo.findUnique({ where: { id } });
    if (!f) throw NotFound('TurnoFijo', id);
    await prisma.turnoFijo.delete({ where: { id } });
    return { ok: true };
  },
  async agregarExcepcion(id: string, fecha: string) {
    const f = await prisma.turnoFijo.findUnique({ where: { id } });
    if (!f) throw NotFound('TurnoFijo', id);
    return prisma.turnoFijoExcepcion.upsert({
      where: { turnoFijoId_fecha: { turnoFijoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') } },
      create: { turnoFijoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') }, update: {},
    });
  },
  async quitarExcepcion(id: string, fecha: string) {
    await prisma.turnoFijoExcepcion.deleteMany({ where: { turnoFijoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') } });
    return { ok: true };
  },
};
```

- [ ] **Step 3: rutas `src/routes/turnoFijo.routes.ts`**
```ts
import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { validate } from '../middlewares/validate.js';
import { turnoFijoService } from '../services/turnoFijo.service.js';
import { crearTurnoFijoSchema, excepcionSchema, idFijoParamSchema } from '../validators/turnoFijo.schema.js';

export const turnoFijoRoutes = Router();
turnoFijoRoutes.get('/', authJwt, async (req, res, next) => { try { res.json(await turnoFijoService.list((req.query.canchaId as string) || undefined)); } catch (e) { next(e); } });
turnoFijoRoutes.post('/', authJwt, validate(crearTurnoFijoSchema), async (req, res, next) => { try { res.status(201).json(await turnoFijoService.crear((req as any).valid.body)); } catch (e) { next(e); } });
turnoFijoRoutes.delete('/:id', authJwt, validate(idFijoParamSchema), async (req, res, next) => { try { res.json(await turnoFijoService.eliminar(String(req.params.id))); } catch (e) { next(e); } });
turnoFijoRoutes.post('/:id/excepciones', authJwt, validate(excepcionSchema), async (req, res, next) => { try { res.status(201).json(await turnoFijoService.agregarExcepcion(String(req.params.id), (req as any).valid.body.fecha)); } catch (e) { next(e); } });
turnoFijoRoutes.delete('/:id/excepciones/:fecha', authJwt, async (req, res, next) => { try { res.json(await turnoFijoService.quitarExcepcion(String(req.params.id), String(req.params.fecha))); } catch (e) { next(e); } });
```
Montar en `src/routes/index.ts`: `import { turnoFijoRoutes } ...` + `apiRouter.use('/turnos-fijos', turnoFijoRoutes);`

- [ ] **Step 4: Tests (append)** — crear fijo (201), 409 al crear uno que pisa un alquiler futuro, excepción libera la fecha (disponibilidad vuelve a mostrar el slot ese día).
```ts
it('crear un fijo que pisa un alquiler futuro da 409', async () => {
  const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000 })).body;
  const martes = proximoDia(2);
  await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId: c.id, whatsapp: '+5491150000000', nombreCliente: 'A', esContacto: true, fecha: martes, horaInicio: '20:00' });
  const r = await supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`).send({ canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', precio: 12000 });
  expect(r.status).toBe(409);
});
it('una excepcion libera el slot ese dia', async () => {
  const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000 })).body;
  const f = (await supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`).send({ canchaId: c.id, clienteNombre: 'J', diaSemana: 2, horaInicio: '20:00', horaFin: '21:00', precio: 12000 })).body;
  const martes = proximoDia(2);
  await supertest(app).post(`/turnos-fijos/${f.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: martes });
  const disp = await supertest(app).get('/disponibilidad').query({ canchaId: c.id, fecha: martes }).set('x-api-key', 'svc');
  expect(disp.body.slots.map((s: any) => s.horaInicio)).toContain('20:00');
});
```
Run → PASS; `npx tsc --noEmit`. Commit:
```bash
git add src/services/turnoFijo.service.ts src/routes/turnoFijo.routes.ts src/validators/turnoFijo.schema.ts src/routes/index.ts tests/integration/fijos-bloqueos.test.ts
git commit -m "feat(fijos): service + endpoints /turnos-fijos (+ excepciones)"
```

## Task B5: Bloqueos — service + endpoints + schema

**Files:** Create `src/services/bloqueo.service.ts`, `src/routes/bloqueo.routes.ts`, `src/validators/bloqueo.schema.ts`; Modify `src/routes/index.ts`; Test append

- [ ] **Step 1: schema `src/validators/bloqueo.schema.ts`**
```ts
import { z } from 'zod';
const empty = z.looseObject({});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');

export const crearBloqueoSchema = z.object({
  body: z.object({
    canchaId: z.string().min(1),
    motivo: z.enum(['TORNEO', 'ENTRENAMIENTO', 'MANTENIMIENTO', 'OTRO']),
    recurrente: z.boolean(),
    diaSemana: z.coerce.number().int().min(0).max(6).optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    horaInicio: hhmm,
    horaFin: hhmm,
    nota: z.string().optional(),
  })
    .refine((b) => b.horaInicio < b.horaFin, { message: 'La hora de inicio debe ser anterior al fin', path: ['horaFin'] })
    .refine((b) => (b.recurrente ? b.diaSemana != null : b.fecha != null), { message: 'Recurrente necesita diaSemana; puntual necesita fecha', path: ['recurrente'] }),
  query: empty, params: empty,
});
export const idBloqueoParamSchema = z.object({ body: z.unknown(), query: empty, params: z.object({ id: z.string().min(1) }) });
```

- [ ] **Step 2: service `src/services/bloqueo.service.ts`**
```ts
import { prisma } from '../db/prisma.js';
import { Conflict, NotFound } from '../utils/errors.js';
import { ocupacionService } from './ocupacion.service.js';

const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export const bloqueoService = {
  list: (canchaId?: string) =>
    prisma.bloqueo.findMany({ where: canchaId ? { canchaId } : {}, include: { cancha: { select: { nombre: true } } }, orderBy: { creadoEn: 'desc' } }),
  async crear(input: { canchaId: string; motivo: 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO'; recurrente: boolean; diaSemana?: number; fecha?: string; horaInicio: string; horaFin: string; nota?: string }) {
    const opts = input.recurrente ? { diaSemana: input.diaSemana } : { fecha: input.fecha };
    const choca = await ocupacionService.conflictoAlCrear(input.canchaId, opts, fromHHMM(input.horaInicio), fromHHMM(input.horaFin));
    if (choca) throw Conflict('Ese horario ya está ocupado (otra reserva, fijo o bloqueo)');
    return prisma.bloqueo.create({
      data: {
        canchaId: input.canchaId, motivo: input.motivo, recurrente: input.recurrente,
        diaSemana: input.recurrente ? input.diaSemana! : null,
        fecha: input.recurrente ? null : new Date(input.fecha! + 'T00:00:00.000Z'),
        horaInicio: input.horaInicio, horaFin: input.horaFin, nota: input.nota ?? null,
      },
    });
  },
  async eliminar(id: string) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    await prisma.bloqueo.delete({ where: { id } });
    return { ok: true };
  },
};
```

- [ ] **Step 3: rutas `src/routes/bloqueo.routes.ts`** (igual patrón)
```ts
import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { validate } from '../middlewares/validate.js';
import { bloqueoService } from '../services/bloqueo.service.js';
import { crearBloqueoSchema, idBloqueoParamSchema } from '../validators/bloqueo.schema.js';

export const bloqueoRoutes = Router();
bloqueoRoutes.get('/', authJwt, async (req, res, next) => { try { res.json(await bloqueoService.list((req.query.canchaId as string) || undefined)); } catch (e) { next(e); } });
bloqueoRoutes.post('/', authJwt, validate(crearBloqueoSchema), async (req, res, next) => { try { res.status(201).json(await bloqueoService.crear((req as any).valid.body)); } catch (e) { next(e); } });
bloqueoRoutes.delete('/:id', authJwt, validate(idBloqueoParamSchema), async (req, res, next) => { try { res.json(await bloqueoService.eliminar(String(req.params.id))); } catch (e) { next(e); } });
```
Montar: `apiRouter.use('/bloqueos', bloqueoRoutes);`

- [ ] **Step 4: Tests (append)** — bloqueo puntual de una fecha esconde sus slots solo esa fecha; bloqueo recurrente esconde ese día; reservar sobre bloqueo → 409.
```ts
it('bloqueo puntual esconde el slot solo esa fecha', async () => {
  const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`).send({ nombre: 'C', tipo: 'f5', precioHora: 12000 })).body;
  const dia = proximoDia(3); // un miércoles cualquiera
  await supertest(app).post('/bloqueos').set('authorization', `Bearer ${token}`).send({ canchaId: c.id, motivo: 'MANTENIMIENTO', recurrente: false, fecha: dia, horaInicio: '18:00', horaFin: '19:00' });
  const disp = await supertest(app).get('/disponibilidad').query({ canchaId: c.id, fecha: dia }).set('x-api-key', 'svc');
  expect(disp.body.slots.map((s: any) => s.horaInicio)).not.toContain('18:00');
});
```
Run → PASS; `npx vitest run` (suite completa); `npx tsc --noEmit`. Commit:
```bash
git add src/services/bloqueo.service.ts src/routes/bloqueo.routes.ts src/validators/bloqueo.schema.ts src/routes/index.ts tests/integration/fijos-bloqueos.test.ts
git commit -m "feat(bloqueos): service + endpoints /bloqueos"
```

## Part 1 completion
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — suite verde, merge `feat/fijos-bloqueos-backend` → `main`, push.

---

# PART 2 — Frontend (`feat/fijos-bloqueos-panel`)

**Branch:** desde `master`, `c:/Users/Lautaro/Desktop/ortigoza/frontend`. `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec vitest run`, `API_URL=... pnpm build`.

**Contexto:** BFF (`apiFetch`, server actions con `run()`); shadcn Base UI (dropdown `onClick`, `render`; `<select>` nativo). Mirar `src/components/canchas/*`, `src/lib/canchas-actions.ts`, `src/lib/types.ts`. `GET /canchas` da la lista para los selects.

## Task F1: tipos + schemas (TDD)

**Files:** Modify `src/lib/types.ts`, `src/lib/validators.ts`, `src/lib/validators.test.ts`

- [ ] **Step 1: tipos en `types.ts`**
```ts
export interface TurnoFijo {
  id: string; canchaId: string; clienteNombre: string; whatsapp: string | null;
  diaSemana: number; horaInicio: string; horaFin: string; precio: number | string; activo: boolean;
  cancha?: { nombre: string }; excepciones?: { id: string; fecha: string }[];
}
export type MotivoBloqueo = 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO';
export interface Bloqueo {
  id: string; canchaId: string; motivo: MotivoBloqueo; recurrente: boolean;
  diaSemana: number | null; fecha: string | null; horaInicio: string; horaFin: string; nota: string | null;
  cancha?: { nombre: string };
}
```

- [ ] **Step 2: tests (append a validators.test.ts)**
```ts
import { turnoFijoSchema, bloqueoSchema } from '@/lib/validators';
describe('turnoFijoSchema', () => {
  it('válido', () => expect(turnoFijoSchema.safeParse({ canchaId: 'c', clienteNombre: 'J', whatsapp: '', diaSemana: '2', horaInicio: '20:00', horaFin: '21:00', precio: '12000' }).success).toBe(true));
  it('rechaza inicio>=fin', () => expect(turnoFijoSchema.safeParse({ canchaId: 'c', clienteNombre: 'J', diaSemana: '2', horaInicio: '21:00', horaFin: '20:00', precio: '1' }).success).toBe(false));
});
describe('bloqueoSchema', () => {
  it('recurrente necesita diaSemana', () => expect(bloqueoSchema.safeParse({ canchaId: 'c', motivo: 'TORNEO', recurrente: true, horaInicio: '18:00', horaFin: '20:00' }).success).toBe(false));
  it('puntual válido', () => expect(bloqueoSchema.safeParse({ canchaId: 'c', motivo: 'TORNEO', recurrente: false, fecha: '2026-06-20', horaInicio: '18:00', horaFin: '20:00' }).success).toBe(true));
});
```

- [ ] **Step 3: schemas en `validators.ts`**
```ts
const hhmm2 = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
export const turnoFijoSchema = z.object({
  canchaId: z.string().min(1, 'Elegí una cancha'),
  clienteNombre: z.string().min(1, 'Ingresá el cliente'),
  whatsapp: z.string().optional(),
  diaSemana: z.coerce.number().int().min(0).max(6),
  horaInicio: hhmm2, horaFin: hhmm2,
  precio: z.coerce.number().positive('Precio inválido'),
}).refine((b) => b.horaInicio < b.horaFin, { message: 'Inicio debe ser antes del fin', path: ['horaFin'] });
export const bloqueoSchema = z.object({
  canchaId: z.string().min(1, 'Elegí una cancha'),
  motivo: z.enum(['TORNEO', 'ENTRENAMIENTO', 'MANTENIMIENTO', 'OTRO']),
  recurrente: z.boolean(),
  diaSemana: z.coerce.number().int().min(0).max(6).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  horaInicio: hhmm2, horaFin: hhmm2,
  nota: z.string().optional(),
}).refine((b) => b.horaInicio < b.horaFin, { message: 'Inicio debe ser antes del fin', path: ['horaFin'] })
  .refine((b) => (b.recurrente ? b.diaSemana != null : !!b.fecha), { message: 'Completá día (recurrente) o fecha (puntual)', path: ['recurrente'] });
```

- [ ] **Step 4: run + commit**
```bash
git checkout -b feat/fijos-bloqueos-panel
pnpm exec vitest run src/lib/validators.test.ts
git add src/lib/types.ts src/lib/validators.ts src/lib/validators.test.ts
git commit -m "feat(fijos): tipos + turnoFijoSchema/bloqueoSchema"
```

## Task F2: actions

**Files:** Create `src/lib/fijos-actions.ts`, `src/lib/bloqueos-actions.ts`

- [ ] **Step 1:** `fijos-actions.ts`
```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
type Result = { ok: true } | { ok: false; error: string };
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/turnos-fijos'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}
type FijoInput = { canchaId: string; clienteNombre: string; whatsapp?: string; diaSemana: number; horaInicio: string; horaFin: string; precio: number };
export const crearTurnoFijo = (i: FijoInput) => run(() => apiFetch('/turnos-fijos', { method: 'POST', body: JSON.stringify(i) }));
export const eliminarTurnoFijo = (id: string) => run(() => apiFetch(`/turnos-fijos/${id}`, { method: 'DELETE' }));
export const agregarExcepcion = (id: string, fecha: string) => run(() => apiFetch(`/turnos-fijos/${id}/excepciones`, { method: 'POST', body: JSON.stringify({ fecha }) }));
export const quitarExcepcion = (id: string, fecha: string) => run(() => apiFetch(`/turnos-fijos/${id}/excepciones/${fecha}`, { method: 'DELETE' }));
```

- [ ] **Step 2:** `bloqueos-actions.ts`
```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
type Result = { ok: true } | { ok: false; error: string };
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath('/bloqueos'); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}
type BloqueoInput = { canchaId: string; motivo: string; recurrente: boolean; diaSemana?: number; fecha?: string; horaInicio: string; horaFin: string; nota?: string };
export const crearBloqueo = (i: BloqueoInput) => run(() => apiFetch('/bloqueos', { method: 'POST', body: JSON.stringify(i) }));
export const eliminarBloqueo = (id: string) => run(() => apiFetch(`/bloqueos/${id}`, { method: 'DELETE' }));
```

- [ ] **Step 3: commit**
```bash
git add src/lib/fijos-actions.ts src/lib/bloqueos-actions.ts
git commit -m "feat(fijos): server actions de fijos y bloqueos"
```

## Task F3: páginas + dialogs + nav

**Files:** Create `src/app/(panel)/turnos-fijos/page.tsx` + `src/components/fijos/*`, `src/app/(panel)/bloqueos/page.tsx` + `src/components/bloqueos/*`; Modify `src/components/app-shell.tsx`

- [ ] **Step 1: Nav** — en `app-shell.tsx` importar `CalendarClock` y `Ban` (lucide) y agregar al `nav`:
```tsx
  { href: '/turnos-fijos', label: 'Turnos fijos', icon: CalendarClock },
  { href: '/bloqueos', label: 'Bloqueos', icon: Ban },
```

- [ ] **Step 2: Turnos fijos** — `page.tsx` (server) carga `apiFetch<TurnoFijo[]>('/turnos-fijos')` y `apiFetch<Cancha[]>('/canchas')`, renderiza `<TurnosFijosTable fijos canchas />` (client). La tabla muestra cliente, cancha, día (mapear 0–6 a nombre), hora, precio; botón "Nuevo turno fijo" (dialog: select cancha, select día, horaInicio/Fin `type=time`, cliente, whatsapp, precio → `crearTurnoFijo`, validando con `turnoFijoSchema`), acción eliminar (confirm), y "Liberar fecha" (date input → `agregarExcepcion`) listando/quitando excepciones. Mirar `canchas-table.tsx`/`cancha-dialog.tsx` para el patrón (dropdown `onClick`, dialog controlado, toasts). DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'].

- [ ] **Step 3: Bloqueos** — `page.tsx` (server) carga `apiFetch<Bloqueo[]>('/bloqueos')` + canchas, renderiza `<BloqueosTable bloqueos canchas />`. Tabla: cancha, motivo, "Recurrente: <día>" o "Puntual: <fecha>", hora; botón "Nuevo bloqueo" (dialog: cancha, motivo select, toggle recurrente/puntual → muestra día select o fecha date, horaInicio/Fin, nota → `crearBloqueo` validando `bloqueoSchema`), eliminar (confirm).

- [ ] **Step 4: Verificación**
Run: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec vitest run`, `API_URL=http://localhost:3000 pnpm build` → todo verde; `/turnos-fijos` y `/bloqueos` aparecen como rutas.

- [ ] **Step 5: commit**
```bash
git add "src/app/(panel)/turnos-fijos" "src/app/(panel)/bloqueos" src/components/fijos src/components/bloqueos src/components/app-shell.tsx
git commit -m "feat(fijos): páginas Turnos fijos y Bloqueos + nav"
```

## Part 2 completion
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verificar, merge `feat/fijos-bloqueos-panel` → `master`.

---

## Bot
Sin cambios. `/disponibilidad` ya excluye fijos/bloqueos.

## Out of scope
Materializar (Opción A); cobro/seña de fijos; mostrar fijos/bloqueos en la grilla de Reservas; vincular fijo a Cliente del sistema.

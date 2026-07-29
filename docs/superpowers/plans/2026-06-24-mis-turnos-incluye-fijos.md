# "Mis turnos" incluye fijos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer un endpoint `GET /turnos-fijos/mios?whatsapp=` que devuelva los turnos fijos activos de un cliente (match por últimos 10 dígitos del WhatsApp), para que el bot pueda mencionarlos cuando el cliente pregunta por sus turnos.

**Architecture:** Una sola tarea de backend (Express + Prisma): un service `turnoFijoService.misFijos(whatsapp)` que reusa el helper `local10` ya existente en el módulo, un validator Zod para el query, y una ruta `GET /mios` con `authAny`. TDD con test de integración (Testcontainers), siguiendo el patrón de `tests/integration/liberar-fijo.test.ts`. El cambio del bot (n8n) es un follow-on directo fuera de este plan.

**Tech Stack:** Node + Express 5 + TypeScript, Prisma 7, Zod 4, Vitest + Supertest + Testcontainers (requiere Docker). Repo: `backend`, rama `main` (crear rama feature `feat/mis-fijos`).

## Global Constraints

- Imports CON extensión `.js` (ESM/NodeNext): `from '../services/turnoFijo.service.js'`, etc.
- `authAny` = acepta `x-api-key` (el bot) o JWT. En tests el header es `x-api-key: svc`.
- Match de WhatsApp por **últimos 10 dígitos** vía el helper `local10` (ya definido a nivel módulo en `src/services/turnoFijo.service.ts`).
- `precio` es `Decimal?` en Prisma → devolver `number | null` (no Decimal).
- `diaSemana`: 0=domingo … 6=sábado.
- No filtrar por fecha ni por excepciones (el fijo es recurrente).
- Al terminar: merge a `main` + push. El deploy a la VM (.36) lo corre el usuario; el cambio del bot va después, directo en n8n.

---

## File Structure

- `backend/src/validators/turnoFijo.schema.ts` (Modify): agregar `misFijosSchema` (valida el query `whatsapp`).
- `backend/src/services/turnoFijo.service.ts` (Modify): agregar el método `misFijos(whatsapp)` al objeto `turnoFijoService`.
- `backend/src/routes/turnoFijo.routes.ts` (Modify): registrar `GET /mios` con `authAny` + `validate(misFijosSchema)`.
- `backend/tests/integration/mis-fijos.test.ts` (Create): test de integración del endpoint.

---

### Task 1: Endpoint `GET /turnos-fijos/mios` (TDD)

**Files:**
- Modify: `backend/src/validators/turnoFijo.schema.ts`
- Modify: `backend/src/services/turnoFijo.service.ts`
- Modify: `backend/src/routes/turnoFijo.routes.ts`
- Test: `backend/tests/integration/mis-fijos.test.ts`

**Interfaces:**
- Consumes: helper `local10(s?: string | null): string` (ya existe, module-level en `turnoFijo.service.ts`); `prisma`; middlewares `authAny`, `validate`.
- Produces:
  - `misFijosSchema` (Zod) en `turnoFijo.schema.ts`.
  - `turnoFijoService.misFijos(whatsapp: string): Promise<Array<{ id: string; diaSemana: number; horaInicio: string; horaFin: string; canchaNombre: string; precio: number | null }>>`.
  - Ruta `GET /turnos-fijos/mios?whatsapp=<num>`.

- [ ] **Step 1: Write the failing test**

Crear `backend/tests/integration/mis-fijos.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string; let canchaBId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 1', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id;
  canchaBId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 2', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
});

const mios = (whatsapp?: string) =>
  supertest(app).get('/turnos-fijos/mios' + (whatsapp === undefined ? '' : `?whatsapp=${encodeURIComponent(whatsapp)}`)).set('x-api-key', 'svc');

describe('GET /turnos-fijos/mios', () => {
  it('devuelve los fijos activos del whatsapp (match por ultimos 10 digitos), con cancha y precio numerico', async () => {
    // Cargado en el panel como "+54 sin 9"; el bot consulta con "549..." (con 9, sin +).
    const f = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '+541136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 18000, activo: true } });
    const r = await mios('5491136620274');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ id: f.id, diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', canchaNombre: 'Cancha 1', precio: 18000 });
    expect(typeof r.body[0].precio).toBe('number');
  });

  it('matchea con los 10 digitos locales (sin prefijo)', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '+541136620274', diaSemana: 1, horaInicio: '19:00', horaFin: '20:00', precio: 18000, activo: true } });
    const r = await mios('1136620274');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it('ordena por diaSemana y luego horaInicio', async () => {
    const wa = '+541136620274';
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: wa, diaSemana: 5, horaInicio: '18:00', horaFin: '19:00', precio: 1000, activo: true } });
    await getPrisma().turnoFijo.create({ data: { canchaId: canchaBId, clienteNombre: 'Naro', whatsapp: wa, diaSemana: 1, horaInicio: '21:00', horaFin: '22:00', precio: 2000, activo: true } });
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: wa, diaSemana: 1, horaInicio: '08:00', horaFin: '09:00', precio: 3000, activo: true } });
    const r = await mios('5491136620274');
    expect(r.body.map((f: any) => [f.diaSemana, f.horaInicio])).toEqual([[1, '08:00'], [1, '21:00'], [5, '18:00']]);
  });

  it('excluye fijos inactivos', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '+541136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 18000, activo: false } });
    const r = await mios('5491136620274');
    expect(r.body).toHaveLength(0);
  });

  it('no over-matchea: el fijo de otro numero no aparece', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Otro', whatsapp: '+5491150000099', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 18000, activo: true } });
    const r = await mios('5491136620274');
    expect(r.body).toHaveLength(0);
  });

  it('fijo con precio null devuelve precio: null', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '+541136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });
    const r = await mios('5491136620274');
    expect(r.body[0].precio).toBeNull();
  });

  it('falta whatsapp -> 400', async () => {
    const r = await mios();
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/integration/mis-fijos.test.ts`
Expected: FAIL — la ruta `/turnos-fijos/mios` no existe todavía (404), y/o `misFijosSchema` no existe.

- [ ] **Step 3: Agregar el validator `misFijosSchema`**

En `backend/src/validators/turnoFijo.schema.ts`, agregar al final (después de `materializarFijoSchema`):

```ts
export const misFijosSchema = z.object({
  body: z.unknown(),
  query: z.object({ whatsapp: z.string().min(5) }),
  params: empty,
});
```

- [ ] **Step 4: Agregar el método `misFijos` al service**

En `backend/src/services/turnoFijo.service.ts`, dentro del objeto `turnoFijoService` (agregar como método nuevo, por ejemplo después de `liberarPorWhatsapp`):

```ts
  async misFijos(whatsapp: string) {
    const target = local10(whatsapp);
    if (!target) return [];
    const candidatos = await prisma.turnoFijo.findMany({ where: { activo: true }, include: { cancha: true } });
    return candidatos
      .filter((f) => local10(f.whatsapp) === target)
      .sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio))
      .map((f) => ({
        id: f.id,
        diaSemana: f.diaSemana,
        horaInicio: f.horaInicio,
        horaFin: f.horaFin,
        canchaNombre: f.cancha.nombre,
        precio: f.precio == null ? null : Number(f.precio),
      }));
  },
```

- [ ] **Step 5: Registrar la ruta `GET /mios`**

En `backend/src/routes/turnoFijo.routes.ts`:

1. Agregar `misFijosSchema` al import de validators existente:

```ts
import { crearTurnoFijoSchema, excepcionSchema, idFijoParamSchema, liberarFijoSchema, materializarFijoSchema, misFijosSchema } from '../validators/turnoFijo.schema.js';
```

2. Registrar la ruta inmediatamente después de la línea del `GET '/'` (antes de las rutas con `:id`, para que `mios` nunca sea interpretado como un id):

```ts
turnoFijoRoutes.get('/mios', authAny, validate(misFijosSchema), async (req, res, next) => {
  try {
    res.json(await turnoFijoService.misFijos((req as any).valid.query.whatsapp));
  } catch (e) { next(e); }
});
```

(`authAny` y `validate` ya están importados en este archivo.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/mis-fijos.test.ts`
Expected: PASS (7/7).

- [ ] **Step 7: Typecheck + suite completa**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: tsc sin errores; toda la suite verde (no se rompió nada existente).

- [ ] **Step 8: Commit**

```bash
cd backend && git add src/validators/turnoFijo.schema.ts src/services/turnoFijo.service.ts src/routes/turnoFijo.routes.ts tests/integration/mis-fijos.test.ts
git commit -m "feat(turnos-fijos): GET /mios — fijos del cliente por whatsapp"
```

---

## Cierre

Tras la tarea: usar **superpowers:finishing-a-development-branch** — correr `npx vitest run` + `npx tsc --noEmit`, revisión whole-branch, y merge de `feat/mis-fijos` a `main` + push. El usuario corre el deploy en la VM.

## Follow-on (fuera de este plan, directo en n8n)

Una vez deployado el endpoint, editar el nodo **Cerebro** del workflow `I8yiX4g1rGh5Hb2U`: en la rama de consulta de turnos, además de `GET /reservas/mias`, llamar `GET /turnos-fijos/mios?whatsapp=<wa>` (interno `http://backend:3000`, header `x-api-key` SVC) y combinar la respuesta (reservas sueltas + fijos recurrentes "todos los [día] a las [hora]"; mapear `diaSemana` 0=domingo…6=sábado). Verificar el snippet con `node --check` antes del patch. Esto NO pasa por Superpowers.

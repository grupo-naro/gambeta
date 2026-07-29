# Bot: liberar turnos fijos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Endpoint `POST /turnos-fijos/liberar` (authAny) para que el bot libere la fecha del turno fijo de un cliente. El bot (n8n) suma el intent `liberar_fijo` + flag `recurrente` (se aplica después del deploy).

**Architecture:** Una sola pieza de código nueva en backend (service + route + validator) reutilizando el upsert idempotente de excepciones que ya existe. Sin migración. El bot se ajusta por n8n MCP tras el deploy.

**Tech Stack:** Node/Express/Prisma 7/Zod, Vitest+Supertest+Testcontainers (Docker).

**Spec:** `docs/superpowers/specs/2026-06-17-bot-liberar-fijos-design.md`

**Gotchas:** `dayOfWeekInTz(ymd, tz)` → 0=Dom..6=Sáb (coincide con `TurnoFijo.diaSemana`). Excepción idempotente vía `turnoFijoExcepcion.upsert` con `fecha = new Date(fecha + 'T00:00:00.000Z')` (igual que `agregarExcepcion`). Imports `.js`. `POST /liberar` es path estático (no choca con `/:id/excepciones`).

> Rama: `cd backend && git checkout main && git pull && git checkout -b feat/bot-liberar-fijos`. Docker para tests.

---

### Task 1: `POST /turnos-fijos/liberar` (TDD)

**Files:** Modify `src/services/turnoFijo.service.ts`, `src/validators/turnoFijo.schema.ts`, `src/routes/turnoFijo.routes.ts`. Test: `tests/integration/liberar-fijo.test.ts` (crear).

- [ ] **Step 1: Test que falla.** Crear `tests/integration/liberar-fijo.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id;
});

const WA = '+5491150000020';
// 2026-06-17 es MIÉRCOLES (diaSemana 3, 0=Dom). 2026-06-18 es JUEVES (4).
async function fijoMiercoles() {
  return getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Pepe', whatsapp: WA, diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 10000, activo: true } });
}
const liberar = (body: Record<string, unknown>) => supertest(app).post('/turnos-fijos/liberar').set('x-api-key', 'svc').send(body);

describe('POST /turnos-fijos/liberar', () => {
  it('libera el fijo del whatsapp cuando el día coincide', async () => {
    const f = await fijoMiercoles();
    const r = await liberar({ whatsapp: WA, fecha: '2026-06-17' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ liberado: true, cantidad: 1 });
    const exc = await getPrisma().turnoFijoExcepcion.findMany({ where: { turnoFijoId: f.id } });
    expect(exc.length).toBe(1);
  });
  it('no libera si el día no coincide con el fijo', async () => {
    await fijoMiercoles();
    const r = await liberar({ whatsapp: WA, fecha: '2026-06-18' }); // jueves
    expect(r.body).toMatchObject({ liberado: false, cantidad: 0 });
  });
  it('whatsapp sin fijo → liberado false', async () => {
    const r = await liberar({ whatsapp: '+5491159999999', fecha: '2026-06-17' });
    expect(r.body).toMatchObject({ liberado: false });
  });
  it('idempotente: liberar dos veces no duplica ni falla', async () => {
    const f = await fijoMiercoles();
    await liberar({ whatsapp: WA, fecha: '2026-06-17' });
    const r2 = await liberar({ whatsapp: WA, fecha: '2026-06-17' });
    expect(r2.body).toMatchObject({ liberado: true });
    const exc = await getPrisma().turnoFijoExcepcion.findMany({ where: { turnoFijoId: f.id } });
    expect(exc.length).toBe(1);
  });
});
```

- [ ] **Step 2: Correr → FALLA.** `cd backend && npx vitest run tests/integration/liberar-fijo.test.ts` → FAIL (ruta inexistente).

- [ ] **Step 3: Implementar.**

En `src/services/turnoFijo.service.ts`, agregar imports arriba:
```typescript
import { dayOfWeekInTz } from '../utils/tz.js';
import { getEnv } from '../config/env.js';
```
y agregar el método al objeto `turnoFijoService` (después de `agregarExcepcion`):
```typescript
  async liberarPorWhatsapp(whatsapp: string, fecha: string) {
    const dow = dayOfWeekInTz(fecha, getEnv().TZ_NEGOCIO);
    const fijos = await prisma.turnoFijo.findMany({ where: { whatsapp, activo: true, diaSemana: dow } });
    if (!fijos.length) return { liberado: false, cantidad: 0 };
    const fechaDate = new Date(fecha + 'T00:00:00.000Z');
    for (const f of fijos) {
      await prisma.turnoFijoExcepcion.upsert({
        where: { turnoFijoId_fecha: { turnoFijoId: f.id, fecha: fechaDate } },
        create: { turnoFijoId: f.id, fecha: fechaDate },
        update: {},
      });
    }
    return { liberado: true, cantidad: fijos.length };
  },
```

En `src/validators/turnoFijo.schema.ts`, agregar:
```typescript
export const liberarFijoSchema = z.object({
  body: z.object({ whatsapp: z.string().min(5), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  query: empty, params: empty,
});
```

En `src/routes/turnoFijo.routes.ts`:
- Agregar `authAny` al import de middlewares: `import { authAny } from '../middlewares/authAny.js';`
- Agregar `liberarFijoSchema` al import de validators.
- Registrar la ruta (después del `GET /` y antes de los `/:id`, o en cualquier lugar — es path estático):
```typescript
turnoFijoRoutes.post('/liberar', authAny, validate(liberarFijoSchema), async (req, res, next) => {
  try {
    const { whatsapp, fecha } = (req as any).valid.body;
    const result = await turnoFijoService.liberarPorWhatsapp(whatsapp, fecha);
    if (result.liberado) await auditService.log(req, { accion: 'EDITAR', entidad: 'TurnoFijo', entidadId: '-', descripcion: 'Bot liberó la fecha ' + fecha + ' de un turno fijo' });
    res.json(result);
  } catch (e) { next(e); }
});
```

- [ ] **Step 4: Correr → PASA.** `npx vitest run tests/integration/liberar-fijo.test.ts` → 4 passing.
- [ ] **Step 5: Regresión.** `npx vitest run tests/integration/fijos-bloqueos.test.ts` → PASS.
- [ ] **Step 6:** `npx tsc --noEmit` → 0 errores.
- [ ] **Step 7: Commit:**
```bash
git add src/services/turnoFijo.service.ts src/validators/turnoFijo.schema.ts src/routes/turnoFijo.routes.ts tests/integration/liberar-fijo.test.ts
git commit -m "feat(turnos-fijos): POST /liberar para el bot (excepcion por whatsapp+fecha)"
```

### Cierre backend
- [ ] **Step 8:** `npx tsc --noEmit` ok → **superpowers:finishing-a-development-branch** → merge a `main` + push. Deploy VM (usuario).

---

## Bot (n8n — NO es parte de este plan de código; se aplica con n8n MCP tras el deploy del backend)
En el workflow `I8yiX4g1rGh5Hb2U`:
- **Prompt:** agregar `liberar_fijo` al enum de `intent` (desc: avisos de no poder ir a su turno fijo) y un campo `recurrente: boolean` al `responseSchema` (true si pide "todos los X"/"todas las semanas"/"fijo").
- **Cerebro:**
  - Rama `liberar_fijo`: `fecha = gem.fecha || hoy`; `POST /turnos-fijos/liberar { whatsapp: number, fecha }`; si `liberado` → "Listo, liberé tu turno fijo del {fechaLinda(fecha)}. ¡Gracias por avisar!"; si no → "No encuentro un turno fijo tuyo para esa fecha. Pasá por el complejo o escribinos."
  - Rama `reservar`: si `gem.recurrente` → anteponer "Por ahora te reservo el {día} suelto. Para que quede FIJO tenés que pasar por el complejo." (la reserva suelta sigue igual).

## Notas
- Solo backend; sin migración; no toca rutas/lógica existentes.
- La liberación por bot requiere que el fijo tenga `whatsapp` cargado (el panel ya lo pide); los viejos sin whatsapp → el bot deriva a presencial.

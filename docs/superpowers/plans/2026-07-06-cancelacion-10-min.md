# Cancelación hasta 10 minutos antes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox `- [ ]`.

**Goal:** Que un cliente pueda cancelar su turno hasta 10 minutos antes (en vez de 12 horas).

**Architecture:** Cambiar la regla de anticipación de cancelación de horas a minutos (env `CANCELACION_ANTICIPACION_MINUTOS`, default 10) en `reserva.service.cancelar`, actualizar tests y config de deploy. Sin bot/frontend/DB.

**Tech Stack:** Node/Express 5 + TS + Prisma 7 + Zod + Vitest/Supertest/Testcontainers (Docker).

## Global Constraints
- Repo `canchitas-backend`, rama de trabajo `feat/cancelacion-10min` desde `main` (NO feat/liberar-bloqueo).
- Solo cancelar (reprogramar queda en `REPROGRAMACION_ANTICIPACION_HORAS=2`).
- Admin (con `adminId`) bypassa la regla; no cambiar ese comportamiento.
- **NO pushear:** commit + merge a main EN LOCAL salvo indicación del usuario.
- Sin migración de DB.

---

### Task 1: Regla de cancelación en minutos (TDD)

**Files:**
- Modify: `src/config/env.ts:10`
- Modify: `src/services/reserva.service.ts:214-217`
- Modify: `tests/unit/env.test.ts:16`
- Modify: `tests/helpers/global-setup.ts:24`
- Modify: `docker-compose.vm.yml:16`, `docker-compose.yml:27`, `.env.example:6`
- Test: `tests/integration/cancelar-anticipacion.test.ts` (nuevo)

**Interfaces:**
- Produces: env `CANCELACION_ANTICIPACION_MINUTOS: number` (default 10). `cancelar()` mantiene su firma.

- [ ] **Step 1: Crear la rama**

```bash
git checkout main && git checkout -b feat/cancelacion-10min
```

- [ ] **Step 2: Escribir el test de integración (falla)**

Crear `tests/integration/cancelar-anticipacion.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string; let clienteId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol', precioHora: 12000, jugadores: 5 } })).id;
  clienteId = (await getPrisma().cliente.create({ data: { whatsapp: '5491100000000', nombre: 'Test', nombreConfirmado: true } })).id;
});

async function reservaEn(minutos: number) {
  const ini = new Date(Date.now() + minutos * 60000);
  const fin = new Date(ini.getTime() + 60 * 60000);
  return getPrisma().reserva.create({ data: { canchaId, clienteId, fechaInicio: ini, fechaFin: fin, estado: 'CONFIRMADA', esContacto: false, monto: 12000 } });
}
const cancelarSvc = (id: string) => supertest(app).patch(`/reservas/${id}/cancelar`).set('x-api-key', 'svc');
const cancelarAdmin = (id: string) => supertest(app).patch(`/reservas/${id}/cancelar`).set('authorization', `Bearer ${token}`);

describe('cancelación: se permite hasta 10 minutos antes del turno', () => {
  it('cliente (servicio) cancela un turno a +30 min → OK', async () => {
    const r = await reservaEn(30);
    const res = await cancelarSvc(r.id);
    expect(res.status).toBeLessThan(400);
    expect((await getPrisma().reserva.findUnique({ where: { id: r.id } }))?.estado).toBe('CANCELADA');
  });
  it('cliente (servicio) NO puede cancelar un turno a +5 min → 422', async () => {
    const r = await reservaEn(5);
    const res = await cancelarSvc(r.id);
    expect(res.status).toBe(422);
    expect((await getPrisma().reserva.findUnique({ where: { id: r.id } }))?.estado).toBe('CONFIRMADA');
  });
  it('admin cancela igual a +5 min (bypass) → OK', async () => {
    const r = await reservaEn(5);
    const res = await cancelarAdmin(r.id);
    expect(res.status).toBeLessThan(400);
    expect((await getPrisma().reserva.findUnique({ where: { id: r.id } }))?.estado).toBe('CANCELADA');
  });
});
```

- [ ] **Step 3: Correr el test → falla**

Run: `npx vitest run tests/integration/cancelar-anticipacion.test.ts`
Expected: FAIL — con el default de 12h, el turno a +30 min da 422 (el primer test falla).

- [ ] **Step 4: Cambiar el env en `src/config/env.ts:10`**

De:
```ts
  CANCELACION_ANTICIPACION_HORAS: z.coerce.number().int().nonnegative().default(12),
```
a:
```ts
  CANCELACION_ANTICIPACION_MINUTOS: z.coerce.number().int().nonnegative().default(10),
```

- [ ] **Step 5: Cambiar `cancelar()` en `src/services/reserva.service.ts` (líneas ~214-217)**

De:
```ts
    const horas = getEnv().CANCELACION_ANTICIPACION_HORAS;
    const limite = new Date(r.fechaInicio.getTime() - horas * 3600000);
    if (!by.adminId && Date.now() > limite.getTime()) {
      throw BusinessRule(`Solo se puede cancelar hasta ${horas}h antes del turno`);
    }
```
a:
```ts
    const minutos = getEnv().CANCELACION_ANTICIPACION_MINUTOS;
    const limite = new Date(r.fechaInicio.getTime() - minutos * 60000);
    if (!by.adminId && Date.now() > limite.getTime()) {
      throw BusinessRule(`Solo se puede cancelar hasta ${minutos} minutos antes del turno`);
    }
```

- [ ] **Step 6: Actualizar los tests de env**

`tests/unit/env.test.ts:16` — de `expect(env.CANCELACION_ANTICIPACION_HORAS).toBe(12);` a `expect(env.CANCELACION_ANTICIPACION_MINUTOS).toBe(10);`

`tests/helpers/global-setup.ts:24` — de `process.env['CANCELACION_ANTICIPACION_HORAS'] = '12';` a `process.env['CANCELACION_ANTICIPACION_MINUTOS'] = '10';`

- [ ] **Step 7: Actualizar config de deploy**

- `docker-compose.vm.yml:16` — `CANCELACION_ANTICIPACION_HORAS: "12"` → `CANCELACION_ANTICIPACION_MINUTOS: "10"`
- `docker-compose.yml:27` — idem → `"10"`
- `.env.example:6` — `CANCELACION_ANTICIPACION_HORAS=12` → `CANCELACION_ANTICIPACION_MINUTOS=10`

- [ ] **Step 8: Correr el test → pasa**

Run: `npx vitest run tests/integration/cancelar-anticipacion.test.ts`
Expected: PASS (3/3).

- [ ] **Step 9: Regresión + typecheck**

Run: `npx vitest run tests/unit/env.test.ts && npx tsc --noEmit`
Run: `npx vitest run tests/integration/ --reporter=dot`
Expected: sin regresiones nuevas (recordar 4 preexistentes: sena x3, disponibilidad-tamano x1). `tsc` limpio. Grep de que no queda `CANCELACION_ANTICIPACION_HORAS` en `src/` ni `tests/`.

- [ ] **Step 10: Commit**

```bash
git add src/config/env.ts src/services/reserva.service.ts tests/unit/env.test.ts tests/helpers/global-setup.ts tests/integration/cancelar-anticipacion.test.ts docker-compose.vm.yml docker-compose.yml .env.example
git commit -m "feat(reservas): cancelacion permitida hasta 10 min antes del turno"
```
(NO push.)

---

## Self-Review
- **Cobertura del spec:** env→minutos (Step 4), cancelar() (Step 5), tests env (Step 6), deploy config (Step 7), test integración TDD (Steps 2-3-8). Reprogramar sin tocar. Cubierto.
- **Placeholders:** ninguno; código completo.
- **Consistencia de nombres:** `CANCELACION_ANTICIPACION_MINUTOS` en env.ts, reserva.service, env.test, global-setup, ambos compose y .env.example. `cancelar()` firma intacta.
- **Riesgo:** rename del env; el grep del Step 9 confirma que no quedan referencias al viejo `_HORAS`.

## Integración (post-task)
Merge `feat/cancelacion-10min` → `main` local. **No push** hasta OK. Al deployar, el contenedor se recrea con `CANCELACION_ANTICIPACION_MINUTOS=10` (del compose de la VM). Sin migración.

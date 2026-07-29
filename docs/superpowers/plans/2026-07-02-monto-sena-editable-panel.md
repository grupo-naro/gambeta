# Monto de seña editable en Nueva reserva (con piso) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En la reserva manual del panel, cuando el cobro es "Seña", mostrar un monto editable autocompletado con la seña de la cancha, permitir subirlo (registrar el sobrepago) y bloquear (front + 422) si es menor al default.

**Architecture:** Backend: `POST /reservas` acepta `montoCobro?`, valida `≥ seña default` ANTES de crear (para no dejar reservas huérfanas) y registra el cobro por ese monto. Frontend: campo de monto en Nueva reserva (solo cobro=Seña) con prefill y bloqueo; el `senaMontoFijo` global se pasa desde las páginas Hoy/Reservas.

**Tech Stack:** Backend Node/Express 5/TS/Prisma 7, Zod 4, Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 (custom — ver `frontend/AGENTS.md`), Tailwind v4, pnpm.

## Global Constraints

- **🚫 NO PUSHEAR.** Commitear y mergear a la rama principal EN LOCAL (backend `main`, frontend `master`), SIN `git push`. Ya hay commits sin pushear encima; esto se apila. Ningún paso ejecuta `git push`.
- Default de la seña de una cancha = `senaMonto` si es **> 0**, si no el `senaMontoFijo` global (mismo criterio que `senaService.montoParaCancha`).
- El campo de monto aparece **solo** con Cobro = "Seña". Monto < default → bloquear (front avisa, back 422). El monto ingresado es el que se registra como cobro.
- "Total" = precio completo (sin cambios); "Nada" = sin cobro. Bot sin cambios.
- Frontend: NO usar training data de Next; clases Tailwind estáticas.
- Ramas: backend `feat/monto-sena-panel` (base `main`), frontend `feat/monto-sena-panel` (base `master`). Cierre = merge local sin push.

---

## REPO BACKEND (`canchitas-backend`, rama `feat/monto-sena-panel` desde `main`)

### Task 1: `montoCobro` en POST /reservas (validación + registro) + tests

**Files:**
- Modify: `backend/src/validators/reserva.schema.ts` (`createReservaSchema.body`)
- Modify: `backend/src/routes/reserva.routes.ts` (handler `POST /`)
- Test: `backend/tests/integration/reserva-cobro.test.ts` (nuevo)

**Interfaces:**
- Consumes: `senaService.montoParaCancha(cancha, precio)`, `canchaService.get(id)`, `cobroService.crear`, `BusinessRule` (422).
- Produces: `POST /reservas` acepta `montoCobro?: number`; con `cobroInicial='sena'` valida `montoCobro ?? default ≥ default` (422 si no) y registra el cobro por ese monto.

- [ ] **Step 1: Escribir el test (RED)**

Crear `backend/tests/integration/reserva-cobro.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaMontoFijo: 5000 } });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } })).id;
});
const fut = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const crear = (extra: Record<string, unknown>) =>
  supertest(app).post('/reservas').set('authorization', `Bearer ${token}`)
    .send({ canchaId, whatsapp: '+5491150000031', nombreCliente: 'Staff', fecha: fut(), horaInicio: '18:00', ...extra });

describe('POST /reservas — montoCobro (seña editable panel)', () => {
  it('registra el cobro por el monto ingresado si es mayor al default', async () => {
    const r = await crear({ cobroInicial: 'sena', medioCobro: 'TRANSFERENCIA', montoCobro: 18000 });
    expect(r.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBe(18000);
  });

  it('rechaza con 422 si el monto es menor al default y NO crea la reserva', async () => {
    const r = await crear({ cobroInicial: 'sena', montoCobro: 5000 });
    expect(r.status).toBe(422);
    expect(await getPrisma().reserva.count()).toBe(0);
  });

  it('usa el default de la cancha si no se manda montoCobro', async () => {
    const r = await crear({ cobroInicial: 'sena' });
    expect(r.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id } });
    expect(Number(cobros[0].monto)).toBe(10000);
  });

  it('cobroInicial total registra el precio completo', async () => {
    const r = await crear({ cobroInicial: 'total' });
    expect(r.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id } });
    expect(Number(cobros[0].monto)).toBe(20000);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run (desde `backend/`): `npx vitest run tests/integration/reserva-cobro.test.ts`
Expected: FAIL — el validador descarta `montoCobro` (se usa el default siempre) y el caso 422 devuelve 201 (crea la reserva).

- [ ] **Step 3: Aceptar `montoCobro` en el validador**

En `backend/src/validators/reserva.schema.ts`, dentro de `createReservaSchema.body`, agregar junto a `montoSena`:

```ts
    montoCobro: z.number().nonnegative().optional(),
```

- [ ] **Step 4: Reestructurar el handler POST**

En `backend/src/routes/reserva.routes.ts`, agregar el import (junto a los otros de utils/errors si hay, o nuevo):

```ts
import { BusinessRule } from '../utils/errors.js';
```

Reemplazar el handler `reservaRoutes.post('/', ...)` por:

```ts
reservaRoutes.post('/', authAny, validate(createReservaSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    const porStaff = req.principal?.kind === 'admin';

    // Pre-validación de la seña del panel (antes de crear, para no dejar reservas huérfanas)
    let defaultSena: number | undefined;
    if (porStaff && body.cobroInicial === 'sena') {
      const cancha = await canchaService.get(body.canchaId);
      defaultSena = await senaService.montoParaCancha(cancha, Number(cancha.precioHora));
      const monto = body.montoCobro ?? defaultSena;
      if (monto < defaultSena) throw BusinessRule('La seña no puede ser menor a la seña de la cancha');
    }

    const r = await reservaService.crear(body, { porStaff });

    if (porStaff && body.cobroInicial !== 'ninguno') {
      const precio = Number(r.monto);
      const monto = body.cobroInicial === 'total' ? precio : (body.montoCobro ?? defaultSena!);
      const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : null;
      if (monto > 0) await cobroService.crear(r.id, { monto, medio: body.medioCobro }, adminId);
    }
    await auditService.log(req, { accion: 'CREAR', entidad: 'Reserva', entidadId: r.id, descripcion: 'Creó una reserva' });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});
```

(`canchaService` ya está importado en este archivo por la feature de seña por cancha. Verificá que el import exista; si no, agregá `import { canchaService } from '../services/cancha.service.js';`.)

- [ ] **Step 5: Run test to verify GREEN**

Run (desde `backend/`): `npx vitest run tests/integration/reserva-cobro.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Correr los tests de reservas que ya existían (regresión)**

Run (desde `backend/`): `npx vitest run tests/integration/reserva.routes.test.ts tests/integration/cancha-sena.test.ts`
Expected: PASS (sin regresiones por el cambio del handler). Si alguno rompe por el nuevo flujo, reportarlo.

- [ ] **Step 7: Commit (NO push)**

```bash
git add backend/src/validators/reserva.schema.ts backend/src/routes/reserva.routes.ts backend/tests/integration/reserva-cobro.test.ts
git commit -m "feat(reservas): montoCobro editable en cobro de seña del panel (piso = seña de la cancha, 422 si menor)"
```
NO ejecutar `git push`.

---

## REPO FRONTEND (`frontend`, rama `feat/monto-sena-panel` desde `master`)

### Task 2: Campo de monto de seña en Nueva reserva + wiring de `senaMontoFijo`

**Files:**
- Modify: `frontend/src/lib/reservas-actions.ts` (`crearReserva` input)
- Modify: `frontend/src/components/reservas/nueva-reserva-dialog.tsx`
- Modify: `frontend/src/app/(panel)/reservas/page.tsx`
- Modify: `frontend/src/app/(panel)/hoy/page.tsx`
- Modify: `frontend/src/components/hoy/agenda-hoy.tsx`

**Interfaces:**
- Consumes: `Config.senaMontoFijo` (ya en `types.ts`); `Cancha.senaMonto` (ya en `types.ts`).

- [ ] **Step 1: `crearReserva` acepta `montoCobro`**

En `frontend/src/lib/reservas-actions.ts`, en la firma de `crearReserva`, agregar `montoCobro?: number` al tipo del input (el body ya se arma con `{ ...input, ... }`, así que viaja solo):

```ts
export async function crearReserva(input: { canchaId: string; whatsapp: string; nombreCliente: string; fecha: string; horaInicio: string; cobroInicial: 'ninguno' | 'sena' | 'total'; medioCobro: 'EFECTIVO' | 'TRANSFERENCIA'; montoCobro?: number }): Promise<Result> {
  return run(() => apiFetch('/reservas', { method: 'POST', body: JSON.stringify({ ...input, esContacto: false, nombreConfirmado: true }) }));
}
```

- [ ] **Step 2: Diálogo — prop, estado, prefill**

En `frontend/src/components/reservas/nueva-reserva-dialog.tsx`:
- Import: cambiar `import { useState, useTransition, useRef } from 'react';` por `import { useState, useTransition, useRef, useEffect } from 'react';`.
- Firma: `export function NuevaReservaDialog({ canchas, senaMontoFijo }: { canchas: Cancha[]; senaMontoFijo: number }) {`.
- Estado nuevo (junto a los otros): `const [montoSena, setMontoSena] = useState('');`.
- Helpers (después de derivar estado, antes del `return`):
  ```ts
  const canchaSel = canchas.find((c) => c.id === canchaId);
  const senaDefault = (c?: Cancha) => { const propio = Number(c?.senaMonto ?? 0); return propio > 0 ? propio : senaMontoFijo; };
  ```
- Prefill:
  ```ts
  useEffect(() => {
    if (cobro === 'sena') setMontoSena(String(senaDefault(canchas.find((c) => c.id === canchaId))));
  }, [canchaId, cobro]);
  ```
- En `resetForm`, agregar `setMontoSena('');`.

- [ ] **Step 3: Diálogo — campo + validación en submit**

En el mismo archivo:
- Dentro del bloque de cobro, agregar el campo (visible solo con `cobro === 'sena'`), después del `<div className="grid grid-cols-2 gap-3">` de Cobro/Medio:
  ```tsx
  {cobro === 'sena' && (
    <div className="space-y-1">
      <Label htmlFor="nueva-monto-sena">Monto de la seña</Label>
      <Input id="nueva-monto-sena" type="number" min={senaDefault(canchaSel)} value={montoSena} onChange={(e) => setMontoSena(e.target.value)} />
      <p className="text-xs text-muted-foreground">Mínimo (seña de la cancha): ${senaDefault(canchaSel).toLocaleString('es-AR')}</p>
    </div>
  )}
  ```
- En `submit`, después del parse de `nuevaReservaSchema` y antes del `start(...)`, agregar la validación y pasar `montoCobro`:
  ```ts
  if (cobro === 'sena') {
    const def = senaDefault(canchaSel);
    const m = Number(montoSena);
    if (!m || m < def) { toast.error(`La seña no puede ser menor a $${def.toLocaleString('es-AR')}`); return; }
  }
  start(async () => {
    const r = await crearReserva({ canchaId, whatsapp, nombreCliente, fecha, horaInicio, cobroInicial: cobro, medioCobro, montoCobro: cobro === 'sena' ? Number(montoSena) : undefined });
    if (r.ok) { toast.success('Reserva creada'); handleOpenChange(false); }
    else toast.error(r.error);
  });
  ```
  (Reemplaza el `start(...)` actual; el resto del submit queda igual.)

- [ ] **Step 4: Páginas pasan `senaMontoFijo`**

- `frontend/src/app/(panel)/reservas/page.tsx`: importar `Config` en el `import type { ... }` y fetchear el config; pasar la prop:
  ```ts
  const canchas = await apiFetch<Cancha[]>('/canchas');
  const config = await apiFetch<Config>('/config');
  ```
  y `<NuevaReservaDialog canchas={canchas} senaMontoFijo={Number(config.senaMontoFijo)} />`.
- `frontend/src/app/(panel)/hoy/page.tsx`: agregar `Config` al import de tipos y al `Promise.all`:
  ```ts
  const [canchas, agenda, caja, config] = await Promise.all([
    apiFetch<Cancha[]>('/canchas'),
    apiFetch<AgendaDia>(`/agenda?fecha=${fecha}`),
    apiFetch<CajaReporte>(`/caja?desde=${fecha}&hasta=${fecha}`),
    apiFetch<Config>('/config'),
  ]);
  ```
  y `<AgendaHoy agenda={agenda} canchas={canchas} fecha={fecha} totalCobrado={caja.total} senaMontoFijo={Number(config.senaMontoFijo)} />`.

- [ ] **Step 5: `AgendaHoy` reenvía la prop**

En `frontend/src/components/hoy/agenda-hoy.tsx`: agregar `senaMontoFijo: number` a las props del componente y reenviarla en `<NuevaReservaDialog canchas={canchas} senaMontoFijo={senaMontoFijo} />` (buscar el uso de `NuevaReservaDialog`, línea ~66).

- [ ] **Step 6: Typecheck + build**

Run (desde `frontend/`): `pnpm exec tsc --noEmit && pnpm build`
Expected: compila sin errores.

- [ ] **Step 7: Commit (NO push)**

```bash
git add frontend/src/lib/reservas-actions.ts frontend/src/components/reservas/nueva-reserva-dialog.tsx "frontend/src/app/(panel)/reservas/page.tsx" "frontend/src/app/(panel)/hoy/page.tsx" frontend/src/components/hoy/agenda-hoy.tsx
git commit -m "feat(reservas): monto de seña editable en Nueva reserva (prefill + piso por cancha)"
```
NO ejecutar `git push`.

---

## Cierre por repo (SIN PUSH)

- **Backend:** merge `feat/monto-sena-panel` → `main` EN LOCAL, sin push.
- **Frontend:** merge `feat/monto-sena-panel` → `master` EN LOCAL, sin push.
- Recordatorio (cuando el usuario pushee, junto con las features anteriores sin pushear): backend a `main` → auto-deploy; correr `docker exec canchitas-backend npx prisma migrate deploy` (por la migración de `senaMonto` que ya está pendiente).

## Self-Review

- **Cobertura del spec:**
  - Validador `montoCobro` → Task 1 Step 3.
  - Pre-validación ≥ default (422, sin huérfanas) + cobro por `montoCobro` → Task 1 Step 4 + tests Step 1.
  - Campo solo con Seña + prefill + bloqueo submit → Task 2 Steps 2-3.
  - `senaMontoFijo` desde páginas → Task 2 Steps 4-5.
  - `total`/`nada` sin cambios → cubierto por el handler (rama total) + test `total`.
  - Bot sin cambios → sin task. ✓
- **Placeholders:** ninguno.
- **Consistencia de tipos:** `senaDefault` (front) = `senaMonto>0 ? senaMonto : senaMontoFijo`, idéntico a `montoParaCancha` (back). `montoCobro?: number` en action (front), validador y handler (back). `senaMontoFijo: number` como prop en diálogo, `AgendaHoy` y ambas páginas.
- **NO PUSH:** ningún step pushea; cierre = merge local. ✓

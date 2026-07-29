# Seña por cancha + anular porcentaje — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada cancha tenga su propio monto fijo de seña (con fallback al monto fijo global) y que se anule el modo porcentaje en todo el sistema.

**Architecture:** Backend: nuevo `Cancha.senaMonto` (nullable) + `senaService.montoParaCancha(cancha, precio)` (propio o fallback fijo); se elimina el cálculo por porcentaje. Frontend: input de seña en el diálogo de cancha y form de config sin selector de modo (solo monto fijo). El bot no se toca (usa el `montoSena` que devuelve el backend).

**Tech Stack:** Backend Node/Express 5/TS/Prisma 7, Zod 4, Vitest+Supertest+Testcontainers (necesita Docker). Frontend Next 16 (custom — ver `frontend/AGENTS.md`), Tailwind v4, Zod, pnpm.

## Global Constraints

- **🚫 NO PUSHEAR A PRODUCCIÓN.** Hacer los commits y dejarlos listos en la **rama principal** (backend `main`, frontend `master`), SIN `git push`. El push lo hace el usuario cuando decida (el push a `main` dispara el auto-deploy). NINGÚN paso de este plan ejecuta `git push`.
- Fallback: `cancha.senaMonto` seteado (>0) → se usa ese; si no, el **monto fijo global** (`senaMontoFijo`). Nunca porcentaje.
- Datos de pago (`cbu/alias/titular`) siguen globales. Bot/n8n sin cambios.
- Columnas `senaModo`/`senaPorcentaje` se dejan en la DB (no se borran), solo se dejan de usar.
- `senaMonto` vacío en el form → se manda **`null`** (limpia y vuelve al fallback). Los schemas usan `.nullable().optional()` para no coercionar `null`→0.
- Migración de Prisma: se escribe a mano (`prisma migrate deploy` la aplica; el `global-setup.ts` de los tests también). ⚠️ Al pushear a prod, correr en la VM: `docker exec canchitas-backend npx prisma migrate deploy`.
- Frontend: NO usar training data de Next; clases Tailwind estáticas.
- Ramas de trabajo: backend `feat/sena-por-cancha` (base `main`), frontend `feat/sena-por-cancha` (base `master`). Al cerrar se mergean a la principal **en local, sin push**.

---

## REPO BACKEND (`canchitas-backend`, rama `feat/sena-por-cancha` desde `main`)

### Task 1: Campo `senaMonto` en Cancha (modelo + migración + validador + servicio)

**Files:**
- Modify: `backend/prisma/schema.prisma` (modelo `Cancha`)
- Create: `backend/prisma/migrations/20260702000000_add_cancha_sena_monto/migration.sql`
- Modify: `backend/src/validators/cancha.schema.ts`
- Modify: `backend/src/services/cancha.service.ts`
- Test: `backend/tests/integration/cancha.routes.test.ts` (agregar en el describe `canchas` o uno nuevo)

**Interfaces:**
- Produces: columna `Cancha.senaMonto Decimal?`; `POST /canchas` y `PATCH /canchas/:id` aceptan `senaMonto: number | null` opcional y lo persisten.

- [ ] **Step 1: Agregar el campo al schema Prisma**

En `backend/prisma/schema.prisma`, modelo `Cancha`, agregar la línea (junto a `precioHoraPico`):

```prisma
  senaMonto      Decimal?            @db.Decimal(10, 2)
```

- [ ] **Step 2: Crear la migración a mano**

Crear `backend/prisma/migrations/20260702000000_add_cancha_sena_monto/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Cancha" ADD COLUMN "senaMonto" DECIMAL(10,2);
```

- [ ] **Step 3: Regenerar el Prisma Client**

Run (desde `backend/`): `npx prisma generate`
Expected: "Generated Prisma Client" sin errores (el client ahora conoce `senaMonto`).

- [ ] **Step 4: Escribir el test (RED)**

En `backend/tests/integration/cancha.routes.test.ts`, agregar dentro del `describe('canchas', ...)`:

```ts
  it('persiste senaMonto en create y lo devuelve', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C sena', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.senaMonto)).toBe(10000);
  });

  it('rechaza senaMonto negativo con 400', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C neg', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: -5 });
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 5: Run test to verify RED**

Run (desde `backend/`): `npx vitest run tests/integration/cancha.routes.test.ts`
Expected: FAIL — `senaMonto` llega como `undefined`/no persistido (el validador lo descarta y el service no lo pasa).

- [ ] **Step 6: Aceptar `senaMonto` en el validador**

En `backend/src/validators/cancha.schema.ts`:
- `createCanchaSchema.body`: agregar `senaMonto: z.number().nonnegative().nullable().optional()`.
- `updateCanchaSchema.body`: agregar `senaMonto: z.number().nonnegative().nullable().optional()`.
- `crearDivisibleSchema`: sin cambios.

- [ ] **Step 7: Pasar `senaMonto` en el servicio**

En `backend/src/services/cancha.service.ts`, en `create` y `update`, sumar `senaMonto` al tipo del input y pasarlo al `prisma.cancha.create/update` (data). Ejemplo para `create`:

```ts
  create: async (input: { nombre: string; tipo: string; precioHora: number; jugadores: number; destacada?: boolean; precioHoraPico?: number; senaMonto?: number | null }) =>
    prisma.cancha.create({ data: { ...input } }),
```

(Para `update`, sumar `senaMonto?: number | null` al `Partial<...>` y asegurarse de que el spread/objeto de `data` lo incluya, igual que `precioHoraPico`.)

- [ ] **Step 8: Run test to verify GREEN**

Run (desde `backend/`): `npx vitest run tests/integration/cancha.routes.test.ts`
Expected: PASS (incluye los tests previos de canchas + los dos nuevos).

- [ ] **Step 9: Commit (NO push)**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/validators/cancha.schema.ts backend/src/services/cancha.service.ts backend/tests/integration/cancha.routes.test.ts
git commit -m "feat(canchas): campo senaMonto (seña fija por cancha)"
```

---

### Task 2: Seña por cancha + anular porcentaje (servicio + call sites)

**Files:**
- Modify: `backend/src/services/sena.service.ts`
- Modify: `backend/src/services/reserva.service.ts:62-65`
- Modify: `backend/src/routes/reserva.routes.ts:29-33`
- Test: `backend/tests/integration/cancha-sena.test.ts` (nuevo)

**Interfaces:**
- Consumes: `Cancha.senaMonto` (Task 1); `configService.get()` (devuelve `senaMontoFijo`).
- Produces: `senaService.montoParaCancha(cancha: { senaMonto?: unknown }, precioHora: number): Promise<number>`; `senaService.montoParaPrecio(precioHora: number)` ahora devuelve siempre el monto fijo.

- [ ] **Step 1: Escribir el test (RED)**

Crear `backend/tests/integration/cancha-sena.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  // config global: modo porcentaje 50% + monto fijo 5000 (para probar que NUNCA usa porcentaje)
  await getPrisma().configuracion.create({ data: { senaModo: 'PORCENTAJE', senaPorcentaje: 50, senaMontoFijo: 5000 } });
});

const reservaFutura = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

describe('seña por cancha', () => {
  it('usa el senaMonto de la cancha cuando está seteado', async () => {
    const c = await getPrisma().cancha.create({ data: { nombre: 'A', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } });
    canchaId = c.id;
    const r = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send({ canchaId, whatsapp: '+5491150000021', nombreCliente: 'Nuevo', esContacto: false, fecha: reservaFutura(), horaInicio: '18:00' });
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(r.body.montoSena)).toBe(10000);
  });

  it('cae al monto fijo global (NO porcentaje) cuando la cancha no tiene senaMonto', async () => {
    const c = await getPrisma().cancha.create({ data: { nombre: 'B', tipo: 'futbol', precioHora: 20000, jugadores: 5 } });
    const r = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send({ canchaId: c.id, whatsapp: '+5491150000022', nombreCliente: 'Nuevo2', esContacto: false, fecha: reservaFutura(), horaInicio: '19:00' });
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(r.body.montoSena)).toBe(5000); // senaMontoFijo, NO 10000 (50% de 20000)
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run (desde `backend/`): `npx vitest run tests/integration/cancha-sena.test.ts`
Expected: FAIL — el 2º test da `montoSena=10000` (50% de 20000, porcentaje) en vez de 5000; el 1º da 10000 solo por casualidad de coincidir con el % — igual la implementación aún no lee `senaMonto`.

- [ ] **Step 3: Reescribir `sena.service.ts`**

Reemplazar el cuerpo de `backend/src/services/sena.service.ts` por:

```ts
import { configService } from './config.service.js';

export interface DatosPago {
  modo: 'fijo';
  porcentaje: number;
  cbu: string;
  alias: string;
  titular: string;
}

export const senaService = {
  /** Seña de una cancha: su monto propio si está seteado (>0), si no el monto fijo global. */
  async montoParaCancha(cancha: { senaMonto?: unknown }, precioHora: number): Promise<number> {
    const propio = cancha?.senaMonto == null ? 0 : Number(cancha.senaMonto);
    if (propio > 0) return Math.round(propio);
    return this.montoParaPrecio(precioHora);
  },
  /** Fallback global: siempre monto fijo (el porcentaje quedó anulado). */
  async montoParaPrecio(_precioHora: number): Promise<number> {
    const c = await configService.get();
    return Math.round(Number(c.senaMontoFijo));
  },
  async datosPago(): Promise<DatosPago> {
    const c = await configService.get();
    return {
      modo: 'fijo',
      porcentaje: c.senaPorcentaje,
      cbu: c.cbu,
      alias: c.alias,
      titular: c.titular,
    };
  },
};
```

- [ ] **Step 4: Usar `montoParaCancha` al crear reserva**

En `backend/src/services/reserva.service.ts`, en el cálculo de `montoSena` (~línea 62-65), cambiar `senaService.montoParaPrecio(precio)` por `senaService.montoParaCancha(cancha, precio)` (la variable `cancha` ya existe en scope, línea 45):

```ts
    const montoSena =
      estado === 'ESPERANDO_SENA'
        ? (input.montoSena ?? (await senaService.montoParaCancha(cancha, precio)))
        : null;
```

- [ ] **Step 5: Usar `montoParaCancha` en el cobro del panel**

En `backend/src/routes/reserva.routes.ts`:
- Importar el servicio de cancha arriba: `import { canchaService } from '../services/cancha.service.js';`
- En el handler `POST /` (~línea 29-33), reemplazar el cálculo del monto por:

```ts
    if (porStaff && body.cobroInicial !== 'ninguno') {
      const precio = Number(r.monto);
      const cancha = await canchaService.get(body.canchaId);
      const monto = body.cobroInicial === 'total' ? precio : await senaService.montoParaCancha(cancha, precio);
      const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : null;
      if (monto > 0) await cobroService.crear(r.id, { monto, medio: body.medioCobro }, adminId);
    }
```

- [ ] **Step 6: Run tests to verify GREEN**

Run (desde `backend/`): `npx vitest run tests/integration/cancha-sena.test.ts tests/integration/cancha.routes.test.ts`
Expected: PASS. (Si algún test viejo de seña asumía porcentaje, ajustarlo al nuevo comportamiento fijo — reportarlo.)

- [ ] **Step 7: Commit (NO push)**

```bash
git add backend/src/services/sena.service.ts backend/src/services/reserva.service.ts backend/src/routes/reserva.routes.ts backend/tests/integration/cancha-sena.test.ts
git commit -m "feat(seña): monto por cancha con fallback fijo; anula cálculo por porcentaje"
```

---

## REPO FRONTEND (`frontend`, rama `feat/sena-por-cancha` desde `master`)

### Task 3: Input de seña por cancha (validador + diálogo)

**Files:**
- Modify: `frontend/src/lib/validators.ts` (`canchaSchema`)
- Modify: `frontend/src/components/canchas/cancha-dialog.tsx`

**Interfaces:**
- Consumes: acciones `crearCancha`/`editarCancha` (ya reenvían el objeto parseado, así que `senaMonto` fluye solo).

- [ ] **Step 1: Validador acepta `senaMonto`**

En `frontend/src/lib/validators.ts`, en `canchaSchema`, agregar el campo:

```ts
  senaMonto: z.coerce.number().nonnegative().nullable().optional(),
```

(`nullable` es clave: deja pasar `null` sin coercionarlo a 0. `canchaDivisibleSchema` sin cambios.)

- [ ] **Step 2: Estado + reset en el diálogo**

En `frontend/src/components/canchas/cancha-dialog.tsx`:
- Agregar estado: `const [senaMonto, setSenaMonto] = useState(cancha?.senaMonto != null ? String(Number(cancha.senaMonto)) : '');`
- En `handleOpenChange` (rama `if (nextOpen)`), agregar el reset: `setSenaMonto(cancha?.senaMonto != null ? String(Number(cancha.senaMonto)) : '');`

- [ ] **Step 3: Campo en el form + payload**

En el mismo archivo:
- En el `submit`, en la rama simple/editar, agregar `senaMonto` al objeto que se parsea:

```ts
    const parsed = canchaSchema.safeParse({ nombre, tipo, precioHora: precio, jugadores, destacada, precioHoraPico: precioPico || 0, senaMonto: senaMonto.trim() === '' ? null : Number(senaMonto) });
```

- Agregar el input después del de "Precio hora pico" (dentro del bloque simple/editar, antes del checkbox `destacada`):

```tsx
              <div className="space-y-1"><Label htmlFor="c-sena">Monto de seña (opcional)</Label>
                <Input id="c-sena" type="number" min="0" value={senaMonto} onChange={(e) => setSenaMonto(e.target.value)} placeholder="vacío = usa el general" />
              </div>
```

- [ ] **Step 4: Typecheck + build**

Run (desde `frontend/`): `pnpm exec tsc --noEmit && pnpm build`
Expected: compila sin errores. (Si `Cancha` en `src/lib/types.ts` no tiene `senaMonto`, agregarlo como `senaMonto?: string | number | null` para el typecheck.)

- [ ] **Step 5: Commit (NO push)**

```bash
git add frontend/src/lib/validators.ts frontend/src/components/canchas/cancha-dialog.tsx frontend/src/lib/types.ts
git commit -m "feat(canchas): input de monto de seña por cancha"
```

---

### Task 4: Config sin porcentaje (solo monto fijo)

**Files:**
- Modify: `frontend/src/components/config/config-form.tsx`

**Interfaces:**
- Consumes: acción `guardarConfig` + `configSchema` (sin cambios; el form sigue mandando `senaModo`/`senaPorcentaje`).

- [ ] **Step 1: Forzar modo fijo + sacar el selector y el porcentaje**

En `frontend/src/components/config/config-form.tsx`, en la sección "Pagos / Seña" (líneas ~50-59):
- Borrar el `<div>` del `<select id="modo">` (líneas 51-56).
- Reemplazar la rama condicional `{f.senaModo === 'PORCENTAJE' ? ... : ...}` (líneas 57-59) por SOLO el input de monto fijo, relabelizado:

```tsx
          <div className="space-y-1"><Label htmlFor="fijo">Monto de seña por defecto</Label>
            <Input id="fijo" type="number" min="0" value={f.senaMontoFijo} onChange={(e) => set('senaMontoFijo', e.target.value)} />
            <p className="text-xs text-neutral-600">Se usa cuando una cancha no tiene su propio monto de seña cargado.</p>
          </div>
```

- [ ] **Step 2: Fijar `senaModo` en 'FIJO' en el estado inicial**

En el `useState` inicial del form, cambiar `senaModo: config.senaModo` por `senaModo: 'FIJO'` (así siempre se guarda modo fijo, sin selector). `senaPorcentaje` se sigue enviando con su valor actual (no se toca).

- [ ] **Step 3: Typecheck + build**

Run (desde `frontend/`): `pnpm exec tsc --noEmit && pnpm build`
Expected: compila sin errores.

- [ ] **Step 4: Commit (NO push)**

```bash
git add frontend/src/components/config/config-form.tsx
git commit -m "feat(config): seña solo por monto fijo (anula porcentaje en el panel)"
```

---

## Cierre por repo (SIN PUSH)

- **Backend:** mergear `feat/sena-por-cancha` a `main` **en local** (`git checkout main && git merge --no-ff feat/sena-por-cancha`), **sin `git push`**. Dejar `main` local adelantado, listo para que el usuario pushee.
- **Frontend:** mergear `feat/sena-por-cancha` a `master` **en local**, **sin `git push`**.
- **Recordatorio para cuando el usuario pushee** (no ahora): backend a `main` dispara auto-deploy → correr en la VM `docker exec canchitas-backend npx prisma migrate deploy` (la columna `senaMonto` es una migración nueva).

## Self-Review

- **Cobertura del spec:**
  - `Cancha.senaMonto` modelo + migración → Task 1 Steps 1-2.
  - Validador create/update `nullable().optional()` → Task 1 Step 6.
  - Service pasa senaMonto → Task 1 Step 7.
  - `montoParaCancha` (propio o fallback fijo) + `montoParaPrecio` siempre fijo + `datosPago.modo='fijo'` → Task 2 Step 3.
  - Call sites (crear reserva + cobro panel) → Task 2 Steps 4-5.
  - Frontend validador + input diálogo → Task 3.
  - Config sin porcentaje → Task 4.
  - Bot/n8n sin cambios → sin task. ✓
  - Migración manual en prod → nota de cierre.
- **Placeholders:** ninguno.
- **Consistencia de tipos:** `montoParaCancha(cancha, precioHora)` misma firma en Task 2 (definición) y call sites; `senaMonto` como `number | null` opcional en backend (Task 1) y `z.coerce.number().nonnegative().nullable().optional()` en frontend (Task 3); el diálogo manda `null` cuando está vacío (Task 3), coherente con `.nullable()` de ambos schemas.
- **NO PUSH:** ningún step corre `git push`; el cierre es merge local. ✓

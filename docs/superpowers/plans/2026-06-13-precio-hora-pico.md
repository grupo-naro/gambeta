# Precio por hora pico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El precio de una reserva varía según el horario: precio pico si la hora de inicio cae en la franja pico del tipo de día (semana/finde), si no el precio normal.

**Architecture:** `Cancha` suma `precioHoraPico`; `Configuracion` suma 4 campos de franja (semana + finde). Un helper puro `precioEfectivo()` decide base vs pico; `reserva.crear` lo usa para `monto` y la seña. El panel agrega el precio pico por cancha y las franjas en Configuración.

**Tech Stack:** Backend Node+Express 5+TS, Prisma 7 (`../db/client.js`), Zod 4, Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 + React 19 + Tailwind 4 + Base UI + pnpm + Vitest.

**Ramas:** backend `feat/precio-pico-backend` (`c:/Users/Lautaro/Desktop/ortigoza/backend`), frontend `feat/precio-pico-panel` (`c:/Users/Lautaro/Desktop/ortigoza/frontend`). Bot (n8n `I8yiX4g1rGh5Hb2U`) aparte tras el deploy.

---

## Parte A — Backend (rama `feat/precio-pico-backend`)

### Task A0: Crear la rama

- [ ] **Step 1**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/backend`):
```bash
git checkout main && git pull && git checkout -b feat/precio-pico-backend
```

---

### Task A1: Migración — `precioHoraPico` + 4 franjas en Configuracion

**Files:**
- Modify: `backend/prisma/schema.prisma` (model Cancha, model Configuracion)
- Create: migración (la genera Prisma)

- [ ] **Step 1: Editar el schema**

En `model Cancha`, debajo de `precioHora`:
```prisma
  precioHora     Decimal             @db.Decimal(10, 2)
  precioHoraPico Decimal             @default(0) @db.Decimal(10, 2)
```

En `model Configuracion`, debajo de `horaCierre`:
```prisma
  horaCierre     String   @default("23:00")
  picoDesde      String   @default("")
  picoHasta      String   @default("")
  picoFindeDesde String   @default("")
  picoFindeHasta String   @default("")
```

- [ ] **Step 2: Generar la migración (necesita Docker)**

Run:
```bash
npx prisma migrate dev --name add_precio_hora_pico
```
Expected: migración con `ALTER TABLE "Cancha" ADD COLUMN "precioHoraPico" ...` y 4 `ALTER TABLE "Configuracion" ADD COLUMN "pico..."`. Regenera el cliente.

- [ ] **Step 3: tsc**

Run:
```bash
npx tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(precio): add precioHoraPico (Cancha) and peak windows (Configuracion)"
```

---

### Task A2: Helper `precioEfectivo` + unit tests (TDD)

**Files:**
- Create: `backend/src/services/precio.service.ts`
- Test: `backend/tests/unit/precio.service.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/unit/precio.service.test.ts` (test puro, sin DB):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { precioEfectivo } from '../../src/services/precio.service.js';

beforeAll(() => { process.env.TZ_NEGOCIO ||= 'America/Argentina/Buenos_Aires'; });

const cfg = { picoDesde: '19:00', picoHasta: '23:00', picoFindeDesde: '14:00', picoFindeHasta: '23:00' };
const cancha = { precioHora: 10000, precioHoraPico: 15000 };
// 2026-06-10 = miércoles (semana); 2026-06-13 = sábado (finde)

describe('precioEfectivo', () => {
  it('sin pico configurado en la cancha (precioHoraPico=0) → precio base', () => {
    expect(precioEfectivo({ precioHora: 10000, precioHoraPico: 0 }, '2026-06-10', '20:00', cfg)).toBe(10000);
  });
  it('hora dentro de la franja de semana → pico', () => {
    expect(precioEfectivo(cancha, '2026-06-10', '20:00', cfg)).toBe(15000);
  });
  it('hora fuera de la franja de semana → base', () => {
    expect(precioEfectivo(cancha, '2026-06-10', '18:00', cfg)).toBe(10000);
  });
  it('borde: inicio de franja incluido, fin excluido', () => {
    expect(precioEfectivo(cancha, '2026-06-10', '19:00', cfg)).toBe(15000); // desde inclusive
    expect(precioEfectivo(cancha, '2026-06-10', '23:00', cfg)).toBe(10000); // hasta exclusivo
  });
  it('finde usa la franja de finde (14:00 está en pico el sábado pero no en semana)', () => {
    expect(precioEfectivo(cancha, '2026-06-13', '14:00', cfg)).toBe(15000); // sábado, franja finde
    expect(precioEfectivo(cancha, '2026-06-10', '14:00', cfg)).toBe(10000); // miércoles, fuera de franja semana
  });
  it('franja vacía → base', () => {
    const sinFranja = { picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '' };
    expect(precioEfectivo(cancha, '2026-06-10', '20:00', sinFranja)).toBe(10000);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
npx vitest run tests/unit/precio.service.test.ts
```
Expected: FAIL — el módulo `precio.service` no existe.

- [ ] **Step 3: Implementar el helper**

Crear `backend/src/services/precio.service.ts`:

```ts
import { getEnv } from '../config/env.js';
import { dayOfWeekInTz } from '../utils/tz.js';

interface CanchaPrecio { precioHora: unknown; precioHoraPico: unknown }
interface PicoCfg { picoDesde: string; picoHasta: string; picoFindeDesde: string; picoFindeHasta: string }

/** Precio efectivo (base o pico) para una reserva que empieza en `horaInicio` (HH:MM) el `fecha` (YYYY-MM-DD). */
export function precioEfectivo(cancha: CanchaPrecio, fecha: string, horaInicio: string, cfg: PicoCfg): number {
  const base = Number(cancha.precioHora);
  const pico = Number(cancha.precioHoraPico);
  if (!(pico > 0)) return base;
  const wd = dayOfWeekInTz(fecha, getEnv().TZ_NEGOCIO); // 0=domingo..6=sábado
  const esFinde = wd === 0 || wd === 6;
  const desde = esFinde ? cfg.picoFindeDesde : cfg.picoDesde;
  const hasta = esFinde ? cfg.picoFindeHasta : cfg.picoHasta;
  if (!desde || !hasta || desde >= hasta) return base;
  return desde <= horaInicio && horaInicio < hasta ? pico : base;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run:
```bash
npx vitest run tests/unit/precio.service.test.ts
```
Expected: PASS (todos). Si `getEnv()` fallara por falta de env, el `beforeAll` ya setea `TZ_NEGOCIO`; si `getEnv` exige otras vars, mirá `src/config/env.ts` (tiene defaults) — no debería romper.

- [ ] **Step 5: Commit**

```bash
git add src/services/precio.service.ts tests/unit/precio.service.test.ts
git commit -m "feat(precio): precioEfectivo helper (peak vs base by time/day)"
```

---

### Task A3: `reserva.crear` usa el precio efectivo (TDD)

**Files:**
- Modify: `backend/src/services/reserva.service.ts:38-92` (crear)
- Test: `backend/tests/integration/reserva.sena.test.ts` (o `reserva.routes.test.ts`)

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integration/reserva.routes.test.ts` (usa el `body()` helper y `x-api-key: 'svc'` ya presentes; la cancha del `beforeEach` tiene `precioHora:1000` — necesitamos una con pico). Agregar este describe:

```ts
import { configService } from '../../src/services/config.service.js';
import { getPrisma } from '../helpers/db.js';

describe('POST /reservas — precio por hora pico', () => {
  it('aplica el precio pico cuando la hora cae en la franja', async () => {
    await configService.update({ picoDesde: '19:00', picoHasta: '23:00', picoFindeDesde: '', picoFindeHasta: '' });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'P', tipo: 'f5', precioHora: 1000, jugadores: 5, precioHoraPico: 3000 } });
    // un día de semana futuro (no sábado/domingo) a las 20:00 → pico
    const base = new Date(Date.now() + 7 * 86400000);
    while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
    const fecha = base.toISOString().slice(0, 10);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send({ canchaId: cancha.id, whatsapp: '+5491150000099', nombreCliente: 'Pico', esContacto: false, fecha, horaInicio: '20:00' });
    expect(res.status).toBe(201);
    expect(res.body.monto).toBe(3000);
  });

  it('aplica el precio base fuera de la franja', async () => {
    await configService.update({ picoDesde: '19:00', picoHasta: '23:00' });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'P2', tipo: 'f5', precioHora: 1000, jugadores: 5, precioHoraPico: 3000 } });
    const base = new Date(Date.now() + 7 * 86400000);
    while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
    const fecha = base.toISOString().slice(0, 10);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send({ canchaId: cancha.id, whatsapp: '+5491150000098', nombreCliente: 'Base', esContacto: false, fecha, horaInicio: '17:00' });
    expect(res.status).toBe(201);
    expect(res.body.monto).toBe(1000);
  });
});
```

NOTA: confirmá el import de `getPrisma` (helper de tests, ya usado por otros tests del repo). `base.getDay()` corre en hora local del runner; el test sólo necesita un día que no sea finde — es suficiente para no caer en la franja finde vacía. La hora 20:00 vs 17:00 distingue pico/base en la franja de semana.

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
npx vitest run tests/integration/reserva.routes.test.ts -t "hora pico"
```
Expected: FAIL — hoy `monto` es siempre `Number(cancha.precioHora)` (1000), no 3000.

- [ ] **Step 3: Usar `precioEfectivo` en `crear`**

En `backend/src/services/reserva.service.ts`:

(a) Agregar imports al tope (junto a los otros service imports):
```ts
import { configService } from './config.service.js';
import { precioEfectivo } from './precio.service.js';
```

(b) Dentro de `crear`, después de la línea `const estado: EstadoReserva = input.esContacto ? 'CONFIRMADA' : 'ESPERANDO_SENA';`, calcular el precio:
```ts
    const cfg = await configService.get();
    const precio = precioEfectivo(cancha, input.fecha, input.horaInicio, cfg);
```

(c) Cambiar el cálculo de la seña: `(input.montoSena ?? (await senaService.montoParaPrecio(Number(cancha.precioHora))))` → usar `precio`:
```ts
    const montoSena =
      estado === 'ESPERANDO_SENA'
        ? (input.montoSena ?? (await senaService.montoParaPrecio(precio)))
        : null;
```

(d) Cambiar el `monto` del `reservaRepo.create`: `monto: Number(cancha.precioHora),` → `monto: precio,`.

(No tocar `reprogramar`.)

- [ ] **Step 4: Correr el test para verificar que pasa**

Run:
```bash
npx vitest run tests/integration/reserva.routes.test.ts -t "hora pico"
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/reserva.service.ts tests/integration/reserva.routes.test.ts
git commit -m "feat(reservas): compute monto and seña using peak price"
```

---

### Task A4: Validación — `precioHoraPico` y franjas pico (TDD)

**Files:**
- Modify: `backend/src/validators/cancha.schema.ts`
- Modify: `backend/src/validators/config.schema.ts`
- Test: `backend/tests/integration/cancha.routes.test.ts` (y validación de config si hay test de config)

- [ ] **Step 1: Escribir el test que falla**

En `backend/tests/integration/cancha.routes.test.ts`, agregar:

```ts
describe('precioHoraPico', () => {
  it('persiste precioHoraPico en create', async () => {
    const res = await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`)
      .send({ nombre: 'CP', tipo: 'futbol5', precioHora: 1000, jugadores: 5, precioHoraPico: 1800 });
    expect(res.status).toBe(201);
    expect(Number(res.body.precioHoraPico)).toBe(1800);
  });
  it('rechaza precioHoraPico negativo con 400', async () => {
    const res = await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`)
      .send({ nombre: 'CN', tipo: 'futbol5', precioHora: 1000, jugadores: 5, precioHoraPico: -5 });
    expect(res.status).toBe(400);
  });
});
```

(`token` ya existe en el archivo, vía `signAdminToken`.)

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
npx vitest run tests/integration/cancha.routes.test.ts -t "precioHoraPico"
```
Expected: FAIL — el primer test devuelve `precioHoraPico` 0 (el schema lo descarta).

- [ ] **Step 3: Agregar `precioHoraPico` al schema de cancha**

En `backend/src/validators/cancha.schema.ts`, en `createCanchaSchema.body` agregar `precioHoraPico: z.number().nonnegative().optional().default(0)`, y en `updateCanchaSchema.body` agregar `precioHoraPico: z.number().nonnegative().optional()`. (NO tocar `crearDivisibleSchema`.) Quedan:

```ts
export const createCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1), tipo: z.string().min(1), precioHora: z.number().positive(), jugadores, destacada: z.boolean().optional().default(false), precioHoraPico: z.number().nonnegative().optional().default(0) }),
  query: empty, params: empty,
});
export const updateCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1).optional(), tipo: z.string().min(1).optional(), precioHora: z.number().positive().optional(), jugadores: jugadores.optional(), destacada: z.boolean().optional(), precioHoraPico: z.number().nonnegative().optional() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 4: Agregar las franjas al schema de config**

En `backend/src/validators/config.schema.ts`, agregar un validador "HH:MM o vacío" y los 4 campos + refines:

```ts
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
const hhmmOrEmpty = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Hora inválida (HH:MM) o vacío');

export const updateConfigSchema = z.object({
  body: z.object({
    horaApertura: hhmm.optional(),
    horaCierre: hhmm.optional(),
    adminWhatsapp: z.string().min(8).optional(),
    senaModo: z.enum(['PORCENTAJE', 'FIJO']).optional(),
    senaPorcentaje: z.coerce.number().int().min(0).max(100).optional(),
    senaMontoFijo: z.coerce.number().nonnegative().optional(),
    cbu: z.string().optional(),
    alias: z.string().optional(),
    titular: z.string().optional(),
    picoDesde: hhmmOrEmpty.optional(),
    picoHasta: hhmmOrEmpty.optional(),
    picoFindeDesde: hhmmOrEmpty.optional(),
    picoFindeHasta: hhmmOrEmpty.optional(),
  })
    .refine((b) => !(b.horaApertura && b.horaCierre) || b.horaApertura < b.horaCierre, { message: 'La apertura debe ser anterior al cierre', path: ['horaCierre'] })
    .refine((b) => !(b.picoDesde && b.picoHasta) || b.picoDesde < b.picoHasta, { message: 'La franja pico (semana) es inválida', path: ['picoHasta'] })
    .refine((b) => !(b.picoFindeDesde && b.picoFindeHasta) || b.picoFindeDesde < b.picoFindeHasta, { message: 'La franja pico (finde) es inválida', path: ['picoFindeHasta'] }),
  query: empty,
  params: empty,
});
```

(El string vacío `''` es falsy → los `refine` no se disparan cuando una franja está vacía.)

- [ ] **Step 5: Correr el test para verificar que pasa**

Run:
```bash
npx vitest run tests/integration/cancha.routes.test.ts -t "precioHoraPico"
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/validators/cancha.schema.ts src/validators/config.schema.ts tests/integration/cancha.routes.test.ts
git commit -m "feat(precio): validate precioHoraPico and peak windows"
```

---

### Task A5: Suite completa verde

- [ ] **Step 1**

Run:
```bash
npx vitest run && npx tsc --noEmit
```
Expected: todo verde. Los campos tienen defaults (`precioHoraPico=0`, franjas `""`), así que los tests existentes que no los envían no rompen. Si alguno falla, arreglar y:
```bash
git add -A && git commit -m "test(precio): fix fixtures for peak price fields"
```
(Omitir si no hubo cambios.)

---

## Parte B — Frontend (rama `feat/precio-pico-panel`)

### Task B0: Crear la rama

- [ ] **Step 1**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/frontend`):
```bash
git checkout master && git checkout -b feat/precio-pico-panel
```

---

### Task B1: Tipos + schemas (TDD)

**Files:**
- Modify: `frontend/src/lib/types.ts` (Cancha, Config)
- Modify: `frontend/src/lib/validators.ts` (canchaSchema, configSchema)
- Test: `frontend/src/lib/validators.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `frontend/src/lib/validators.test.ts`:

```ts
describe('canchaSchema con precioHoraPico', () => {
  it('coerce y default 0', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol5', precioHora: '1000', jugadores: '5', destacada: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.precioHoraPico).toBe(0);
  });
  it('acepta precioHoraPico=1800', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol5', precioHora: '1000', jugadores: '5', destacada: false, precioHoraPico: '1800' });
    expect(r.success && r.data.precioHoraPico).toBe(1800);
  });
  it('rechaza precioHoraPico negativo', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol5', precioHora: '1000', jugadores: '5', destacada: false, precioHoraPico: '-1' });
    expect(r.success).toBe(false);
  });
});

describe('configSchema con franjas pico', () => {
  const baseCfg = { horaApertura: '16:00', horaCierre: '23:00', adminWhatsapp: '5491100000000', senaModo: 'PORCENTAJE', senaPorcentaje: '50', senaMontoFijo: '0', cbu: '', alias: '', titular: '' };
  it('acepta franjas vacías', () => {
    const r = configSchema.safeParse({ ...baseCfg, picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '' });
    expect(r.success).toBe(true);
  });
  it('acepta una franja válida', () => {
    const r = configSchema.safeParse({ ...baseCfg, picoDesde: '19:00', picoHasta: '23:00', picoFindeDesde: '', picoFindeHasta: '' });
    expect(r.success).toBe(true);
  });
  it('rechaza franja con desde >= hasta', () => {
    const r = configSchema.safeParse({ ...baseCfg, picoDesde: '23:00', picoHasta: '19:00', picoFindeDesde: '', picoFindeHasta: '' });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr para ver fallar**

Run:
```bash
pnpm vitest run src/lib/validators.test.ts -t "pico"
```
Expected: FAIL — los schemas no tienen esos campos.

- [ ] **Step 3: Schemas**

En `frontend/src/lib/validators.ts`:

(a) `canchaSchema` suma `precioHoraPico`:
```ts
export const canchaSchema = z.object({
  nombre: z.string().min(1, 'Ingresá el nombre'),
  tipo: z.string().min(1, 'Elegí el tipo'),
  precioHora: z.coerce.number().positive('El precio debe ser mayor a 0'),
  jugadores: jugadoresField,
  destacada: z.boolean().default(false),
  precioHoraPico: z.coerce.number().nonnegative('No puede ser negativo').default(0),
});
```

(b) Junto a `const hhmm = ...` agregar y ampliar `configSchema` con los 4 campos + refines:
```ts
const hhmmOrEmpty = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Hora inválida (HH:MM)');
export const configSchema = z.object({
  horaApertura: hhmm,
  horaCierre: hhmm,
  adminWhatsapp: z.string().min(8, 'WhatsApp inválido'),
  senaModo: z.enum(['PORCENTAJE', 'FIJO']),
  senaPorcentaje: z.coerce.number().int().min(0).max(100),
  senaMontoFijo: z.coerce.number().nonnegative(),
  cbu: z.string(),
  alias: z.string(),
  titular: z.string(),
  picoDesde: hhmmOrEmpty,
  picoHasta: hhmmOrEmpty,
  picoFindeDesde: hhmmOrEmpty,
  picoFindeHasta: hhmmOrEmpty,
}).refine((b) => b.horaApertura < b.horaCierre, { message: 'La apertura debe ser anterior al cierre', path: ['horaCierre'] })
  .refine((b) => !(b.picoDesde && b.picoHasta) || b.picoDesde < b.picoHasta, { message: 'Franja pico (semana) inválida', path: ['picoHasta'] })
  .refine((b) => !(b.picoFindeDesde && b.picoFindeHasta) || b.picoFindeDesde < b.picoFindeHasta, { message: 'Franja pico (finde) inválida', path: ['picoFindeHasta'] });
```

(Mantené el orden real de los campos de `configSchema` si difiere; lo importante es agregar los 4 `pico*` y los 2 refines nuevos.)

- [ ] **Step 4: Tipos**

En `frontend/src/lib/types.ts`:
- `Cancha` suma `precioHoraPico: number`:
```ts
export interface Cancha { id: string; nombre: string; tipo: string; jugadores: number; destacada: boolean; precioHora: number; precioHoraPico: number; activa: boolean; grupoId: string | null; esEntera: boolean }
```
- `Config` suma las 4 franjas:
```ts
  cbu: string; alias: string; titular: string;
  picoDesde: string; picoHasta: string; picoFindeDesde: string; picoFindeHasta: string;
```

- [ ] **Step 5: Correr para ver pasar**

Run:
```bash
pnpm vitest run src/lib/validators.test.ts
```
Expected: PASS (nuevos + existentes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/validators.ts src/lib/validators.test.ts
git commit -m "feat(precio): precioHoraPico + peak windows in types and schemas"
```

---

### Task B2: Server action de cancha pasa `precioHoraPico`

**Files:**
- Modify: `frontend/src/lib/canchas-actions.ts:13` (CanchaInput)

- [ ] **Step 1**

```ts
type CanchaInput = { nombre: string; tipo: string; precioHora: number; jugadores: number; destacada: boolean; precioHoraPico: number };
```
(Los bodies ya reenvían `input` completo. Todos los exports siguen `async function`.)

- [ ] **Step 2: tsc**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: sin errores (o sólo en cancha-dialog/config-form, que se arreglan en B3/B4).

- [ ] **Step 3: Commit**

```bash
git add src/lib/canchas-actions.ts
git commit -m "feat(precio): cancha action forwards precioHoraPico"
```

---

### Task B3: Campo "Precio hora pico" en el dialog de cancha

**Files:**
- Modify: `frontend/src/components/canchas/cancha-dialog.tsx`

- [ ] **Step 1: Estado + reset + campo + submit (form simple)**

En `frontend/src/components/canchas/cancha-dialog.tsx`:

(a) Estado (después de `const [precio, setPrecio] = ...`):
```tsx
  const [precioPico, setPrecioPico] = useState(cancha ? String(Number(cancha.precioHoraPico)) : '');
```

(b) En `handleOpenChange`, dentro de `if (nextOpen)`, junto a los otros resets:
```tsx
      setPrecioPico(cancha ? String(Number(cancha.precioHoraPico)) : '');
```

(c) En `submit`, en la rama simple, pasar `precioHoraPico` al parse:
```tsx
    const parsed = canchaSchema.safeParse({ nombre, tipo, precioHora: precio, jugadores, destacada, precioHoraPico: precioPico || 0 });
```

(d) En el JSX del form simple, después del bloque "Precio por hora", agregar:
```tsx
              <div className="space-y-1"><Label htmlFor="c-precio-pico">Precio hora pico (opcional)</Label>
                <Input id="c-precio-pico" type="number" min="0" value={precioPico} onChange={(e) => setPrecioPico(e.target.value)} placeholder="0 = sin recargo" />
              </div>
```

- [ ] **Step 2: tsc**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: sin errores (salvo config-form si B4 no está hecho).

- [ ] **Step 3: Commit**

```bash
git add src/components/canchas/cancha-dialog.tsx
git commit -m "feat(precio): precio hora pico field in cancha dialog"
```

---

### Task B4: Sección "Hora pico" en Configuración

**Files:**
- Modify: `frontend/src/components/config/config-form.tsx`

- [ ] **Step 1: Estado + Card de franjas**

En `frontend/src/components/config/config-form.tsx`:

(a) Ampliar el estado inicial `useState({...})` agregando las 4 franjas:
```tsx
    cbu: config.cbu, alias: config.alias, titular: config.titular,
    picoDesde: config.picoDesde, picoHasta: config.picoHasta,
    picoFindeDesde: config.picoFindeDesde, picoFindeHasta: config.picoFindeHasta,
```

(b) Agregar una Card nueva antes del `<Button>` final (después de la Card de "Pagos / Seña"):
```tsx
      <Card>
        <CardHeader><CardTitle className="text-base">Hora pico</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-neutral-500">Dejá las franjas vacías para no cobrar hora pico. El precio pico se define por cancha.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label htmlFor="pd">Semana — desde</Label><Input id="pd" type="time" value={f.picoDesde} onChange={(e) => set('picoDesde', e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="ph">Semana — hasta</Label><Input id="ph" type="time" value={f.picoHasta} onChange={(e) => set('picoHasta', e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="pfd">Finde — desde</Label><Input id="pfd" type="time" value={f.picoFindeDesde} onChange={(e) => set('picoFindeDesde', e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="pfh">Finde — hasta</Label><Input id="pfh" type="time" value={f.picoFindeHasta} onChange={(e) => set('picoFindeHasta', e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>
```

- [ ] **Step 2: tsc + build**

Run:
```bash
pnpm exec tsc --noEmit && pnpm build
```
Expected: build OK. (El `<input type="time">` vacío da `''`, que el schema acepta.)

- [ ] **Step 3: Commit**

```bash
git add src/components/config/config-form.tsx
git commit -m "feat(precio): peak window section in Configuración"
```

---

### Task B5: Verificación completa

- [ ] **Step 1**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build
```
Expected: todo verde. `pnpm build` obligatorio (boundary RSC).

---

## Parte C — Cierre

### Task C1: Finalizar las ramas

- [ ] **Step 1: Backend — finishing-a-development-branch**

Anunciar "I'm using the finishing-a-development-branch skill to complete this work." en backend (`feat/precio-pico-backend`): tests verdes → merge a `main` + push. **Verificar el deploy** (auto-deploy no confiable): `docker exec canchitas-backend node -e "require('http').get('http://localhost:3000/config',r=>{console.log(r.statusCode);process.exit(0)})"` (401 = vivo) o redeploy manual. La migración corre sola con `migrate deploy`.

- [ ] **Step 2: Frontend — finishing-a-development-branch**

Idem en frontend (`feat/precio-pico-panel`): merge a `master` (local, sin remote).

### Task C2: Bot (n8n) — fuera de este plan

Tras el deploy: en el Cerebro del workflow `I8yiX4g1rGh5Hb2U`, rama `consultar_precio`, usar `/canchas` (ya devuelve `precioHoraPico`) y `/config` (franjas) para responder normal + pico (ej. "Cancha 1: $X, y $Y en hora pico de 19 a 23"). El flujo de reserva no cambia (el monto/seña ya vienen del backend con el precio efectivo).

---

## Self-Review

**Spec coverage:**
- `Cancha.precioHoraPico` + 4 franjas en `Configuracion` + migración → A1 ✓
- Helper `precioEfectivo` (pico<=0 base, finde por día 0/6, franja vacía base, borde desde-incl/hasta-excl) → A2 ✓
- `reserva.crear` usa precio efectivo para monto y seña; reprogramar sin cambios → A3 ✓
- Validación precioHoraPico (>=0) y franjas (HH:MM o vacío, desde<hasta) → A4 ✓
- GET /canchas y /config devuelven los campos (escalares de Prisma) → automático, verificado en tests A3/A4 ✓
- Frontend: tipos + canchaSchema + configSchema + action + campo dialog + sección config + unit tests → B1–B4 ✓
- Bot consultar_precio → C2 (fuera de Superpowers, documentado) ✓
- Migración default 0/"" sin backfill → A1 ✓

**Placeholder scan:** Sin TBD/TODO. "Confirmá el import de getPrisma / orden de campos" son instrucciones de verificación contra el código real, no placeholders.

**Type consistency:** `precioEfectivo(cancha, fecha, horaInicio, cfg)` firma idéntica A2↔A3. `precioHoraPico` Decimal backend / `number` frontend, validado `>=0` en ambos. Config 4 campos `picoDesde/picoHasta/picoFindeDesde/picoFindeHasta` consistentes entre schema backend (A4), tipo+schema frontend (B1) y form (B4). `canchaSchema`/`CanchaInput` con `precioHoraPico` consistentes B1↔B2↔B3.

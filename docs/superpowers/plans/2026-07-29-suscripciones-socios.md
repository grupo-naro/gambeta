# Suscripciones (socios) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un administrador dé de alta socios con suscripción mensual, de modo que sus reservas queden 100% bonificadas (sin seña y sin pago) tanto desde el panel como desde la web pública.

**Architecture:** Slice vertical nuevo (`suscripcion.repo → service → routes`) siguiendo el layering existente. Una reserva bonificada se representa con `monto: 0` + FK `suscripcionId` (+ `montoLista` informativo), lo que deja intactos saldo, cobros, Sheets y Analíticas. La cuota entra a Caja como un `Cobro` con `origen: 'SUSCRIPCION'`, para lo cual `Cobro.reservaId` pasa a nullable. El estado "vencida" no se persiste: se deriva de las fechas, así que no hace falta ningún cron.

**Tech Stack:** Express 5, Prisma 7 (ESM), PostgreSQL 16, Zod 4, Vitest 4 + Testcontainers, Next.js 16 (App Router, server actions), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-29-suscripciones-socios-design.md`

## Global Constraints

- **Idioma:** código, comentarios, nombres de dominio y textos de UI en **español**. No traducir `cancha`, `seña`, `socio`, `suscripción`, `cobro`.
- **Backend usa `npm`** (no pnpm). `frontend/` y `reservas/` usan **`pnpm`**.
- **Imports del backend siempre con extensión `.js`** (ESM): `import { x } from './y.js'`.
- **Nunca importar de `@prisma/client`.** Tipos desde `src/db/client.js`, instancia desde `src/db/prisma.js`.
- **Zona horaria:** toda comparación de fechas de negocio usa `getEnv().TZ_NEGOCIO`, nunca `new Date()` crudo en UTC.
- **Errores:** usar las factories de `src/utils/errors.js` (`BadRequest`, `NotFound`, `Conflict`, `BusinessRule`). Nunca `throw new Error()` para fallas esperadas.
- **Auditoría:** se registra desde la **ruta** con `auditService.log(req, {...})`, no desde el service (patrón de `turnoFijo.routes.ts`).
- **Server actions de Next:** en un archivo `'use server'`, **todos los exports deben ser `async function`**. El compilador RSC rechaza exports no-async aunque tsc y eslint los acepten.
- **Los tests de integración necesitan Docker corriendo** (Testcontainers). Los de `tests/unit/` no.
- **`npm test` NO chequea tipos.** Vitest transpila sin type-check, así que un error de TypeScript pasa la suite entera y rompe el build igual. Toda tarea que toque `.ts` del backend termina con **`npm run typecheck`** además de los tests. (Aprendido en la Task 3: volver `Cobro.reservaId` nullable rompió `cobro.service.ts` y los 338 tests siguieron en verde.)
- **Vencimiento inclusive:** una suscripción cubre `inicio ≤ fecha ≤ vencimiento`.
- **Rama de trabajo:** `feat/suscripciones` (ya creada, con el spec commiteado).

---

# Fase 1 · Datos

### Task 1: Modelo `Suscripcion` + migración + `resetTables`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_suscripcion/migration.sql` (generada)
- Modify: `backend/tests/helpers/db.ts:25-46`
- Test: `backend/tests/integration/suscripcion-modelo.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: modelo `Suscripcion` y enum `EstadoSuscripcion` (`ACTIVA` | `CANCELADA`) disponibles en `src/db/client.js`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/suscripcion-modelo.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('modelo Suscripcion', () => {
  it('se crea con estado ACTIVA por defecto y fechas de tipo date', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Ana', whatsapp: '+5491100000001' } });
    const s = await getPrisma().suscripcion.create({
      data: {
        clienteId: cliente.id,
        inicio: new Date('2026-08-01T00:00:00.000Z'),
        vencimiento: new Date('2026-08-31T00:00:00.000Z'),
      },
    });
    expect(s.estado).toBe('ACTIVA');
    expect(s.inicio.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(s.vencimiento.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(s.precio).toBeNull();
  });

  it('resetTables borra suscripciones sin violar la FK con Cliente', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Beto', whatsapp: '+5491100000002' } });
    await getPrisma().suscripcion.create({
      data: { clienteId: cliente.id, inicio: new Date('2026-08-01T00:00:00.000Z'), vencimiento: new Date('2026-08-31T00:00:00.000Z') },
    });
    await resetTables();
    expect(await getPrisma().suscripcion.count()).toBe(0);
    expect(await getPrisma().cliente.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/suscripcion-modelo.test.ts
```

Esperado: FAIL — `getPrisma().suscripcion` es `undefined` (el modelo no existe).

- [ ] **Step 3: Agregar el modelo al schema**

En `backend/prisma/schema.prisma`, después del enum `VerificadoPor`:

```prisma
enum EstadoSuscripcion {
  ACTIVA
  CANCELADA
}
```

Y al final del archivo:

```prisma
model Suscripcion {
  id          String            @id @default(cuid())
  clienteId   String
  cliente     Cliente           @relation(fields: [clienteId], references: [id])
  inicio      DateTime          @db.Date
  vencimiento DateTime          @db.Date
  estado      EstadoSuscripcion @default(ACTIVA)
  precio      Decimal?          @db.Decimal(10, 2)
  nota        String?
  creadoPorId String?
  creadoPor   AdminUser?        @relation(fields: [creadoPorId], references: [id])
  creadoEn    DateTime          @default(now())

  @@index([clienteId, vencimiento])
  @@index([estado, vencimiento])
}
```

Agregar las relaciones inversas. En `model Cliente`, después de `reservas Reserva[]`:

```prisma
  suscripciones Suscripcion[]
```

En `model AdminUser`, después de `cobros Cobro[]`:

```prisma
  suscripciones Suscripcion[]
```

- [ ] **Step 4: Generar y aplicar la migración**

```bash
cd backend && npx prisma migrate dev --name suscripcion
```

Esperado: crea `prisma/migrations/<timestamp>_suscripcion/` y regenera el cliente en `src/generated/prisma`.

- [ ] **Step 5: Actualizar `resetTables`**

En `backend/tests/helpers/db.ts`, dentro del array de `p.$transaction([...])`, insertar **inmediatamente después** de `p.reserva.deleteMany(),`:

```ts
    p.suscripcion.deleteMany(),
```

El orden importa: `Suscripcion` referencia a `Cliente` y `AdminUser`, y (a partir de las Tasks 2 y 3) es referenciada por `Reserva` y `Cobro`. Tiene que borrarse después de `reserva` y antes de `cliente`.

- [ ] **Step 6: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/suscripcion-modelo.test.ts
```

Esperado: PASS (2 tests).

- [ ] **Step 7: Correr la suite completa (regresión)**

```bash
cd backend && npm test
```

Esperado: todo verde. Si algo falla con violación de FK, revisar la posición de `p.suscripcion.deleteMany()` en el array.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/helpers/db.ts backend/tests/integration/suscripcion-modelo.test.ts
git commit -m "feat(suscripciones): modelo Suscripcion + migracion"
```

---

### Task 2: `Reserva.suscripcionId` + `Reserva.montoLista`

**Files:**
- Modify: `backend/prisma/schema.prisma` (`model Reserva`, `model Suscripcion`)
- Create: `backend/prisma/migrations/<timestamp>_reserva_suscripcion/migration.sql` (generada)
- Test: `backend/tests/integration/suscripcion-modelo.test.ts` (agregar caso)

**Interfaces:**
- Consumes: `Suscripcion` (Task 1).
- Produces: `Reserva.suscripcionId: string | null` y `Reserva.montoLista: Decimal | null`.

- [ ] **Step 1: Escribir el test que falla**

Agregar al `describe('modelo Suscripcion', ...)` de `backend/tests/integration/suscripcion-modelo.test.ts`:

```ts
  it('una reserva puede apuntar a una suscripcion y guardar montoLista', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Caro', whatsapp: '+5491100000003' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 12000, jugadores: 5 } });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: cliente.id, inicio: new Date('2026-08-01T00:00:00.000Z'), vencimiento: new Date('2026-08-31T00:00:00.000Z') },
    });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id,
        clienteId: cliente.id,
        estado: 'CONFIRMADA',
        esContacto: false,
        monto: 0,
        montoLista: 12000,
        suscripcionId: s.id,
        fechaInicio: new Date('2026-08-10T20:00:00.000Z'),
        fechaFin: new Date('2026-08-10T21:00:00.000Z'),
      },
    });
    expect(r.suscripcionId).toBe(s.id);
    expect(Number(r.monto)).toBe(0);
    expect(Number(r.montoLista)).toBe(12000);
  });

  it('una reserva normal deja suscripcionId y montoLista en null', async () => {
    const cliente = await getPrisma().cliente.create({ data: { nombre: 'Dani', whatsapp: '+5491100000004' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C2', tipo: 'f5', precioHora: 12000, jugadores: 5 } });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: cliente.id, estado: 'CONFIRMADA', esContacto: false, monto: 12000,
        fechaInicio: new Date('2026-08-11T20:00:00.000Z'), fechaFin: new Date('2026-08-11T21:00:00.000Z'),
      },
    });
    expect(r.suscripcionId).toBeNull();
    expect(r.montoLista).toBeNull();
  });
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/suscripcion-modelo.test.ts
```

Esperado: FAIL — `Unknown argument 'montoLista'`.

- [ ] **Step 3: Agregar los campos al schema**

En `model Reserva`, después de `turnoFijo TurnoFijo? @relation(...)`:

```prisma
  suscripcionId String?
  suscripcion   Suscripcion? @relation(fields: [suscripcionId], references: [id])
  montoLista    Decimal?     @db.Decimal(10, 2)
```

Y en el bloque de índices de `Reserva`, agregar:

```prisma
  @@index([suscripcionId])
```

En `model Suscripcion`, agregar la relación inversa después de `creadoEn`:

```prisma
  reservas    Reserva[]
```

- [ ] **Step 4: Generar y aplicar la migración**

```bash
cd backend && npx prisma migrate dev --name reserva_suscripcion
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/suscripcion-modelo.test.ts
```

Esperado: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma backend/tests/integration/suscripcion-modelo.test.ts
git commit -m "feat(suscripciones): Reserva.suscripcionId + montoLista"
```

---

### Task 3: `Cobro.reservaId` nullable + `suscripcionId` + CHECK

**Files:**
- Modify: `backend/prisma/schema.prisma` (`model Cobro`, `model Suscripcion`)
- Create: `backend/prisma/migrations/<timestamp>_cobro_suscripcion/migration.sql` (generada y **editada a mano**)
- Test: `backend/tests/integration/cobro-suscripcion.test.ts`

**Interfaces:**
- Consumes: `Suscripcion` (Task 1).
- Produces: `Cobro.reservaId: string | null`, `Cobro.suscripcionId: string | null`, y el constraint `cobro_destino_unico` que garantiza que exactamente uno de los dos esté seteado.

> **Esta es la única migración que toca una tabla con datos productivos.** El `ALTER` es no destructivo (relajar un `NOT NULL` nunca pierde datos) y reversible.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/cobro-suscripcion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function nuevaSuscripcion() {
  const cliente = await getPrisma().cliente.create({ data: { nombre: 'Eze', whatsapp: '+5491100000005' } });
  return getPrisma().suscripcion.create({
    data: { clienteId: cliente.id, inicio: new Date('2026-08-01T00:00:00.000Z'), vencimiento: new Date('2026-08-31T00:00:00.000Z') },
  });
}

describe('Cobro con destino suscripcion', () => {
  it('acepta un cobro de cuota sin reserva', async () => {
    const s = await nuevaSuscripcion();
    const c = await getPrisma().cobro.create({
      data: { suscripcionId: s.id, monto: 20000, medio: 'EFECTIVO', origen: 'SUSCRIPCION' },
    });
    expect(c.reservaId).toBeNull();
    expect(c.suscripcionId).toBe(s.id);
    expect(c.origen).toBe('SUSCRIPCION');
  });

  it('rechaza un cobro sin reserva ni suscripcion', async () => {
    await expect(
      getPrisma().cobro.create({ data: { monto: 1000, medio: 'EFECTIVO' } }),
    ).rejects.toThrow(/cobro_destino_unico/);
  });

  it('rechaza un cobro con reserva Y suscripcion a la vez', async () => {
    const s = await nuevaSuscripcion();
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C3', tipo: 'f5', precioHora: 1000, jugadores: 5 } });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: s.clienteId, estado: 'CONFIRMADA', esContacto: false, monto: 1000,
        fechaInicio: new Date('2026-08-12T20:00:00.000Z'), fechaFin: new Date('2026-08-12T21:00:00.000Z'),
      },
    });
    await expect(
      getPrisma().cobro.create({ data: { reservaId: r.id, suscripcionId: s.id, monto: 1000, medio: 'EFECTIVO' } }),
    ).rejects.toThrow(/cobro_destino_unico/);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/cobro-suscripcion.test.ts
```

Esperado: FAIL — `Unknown argument 'suscripcionId'`.

- [ ] **Step 3: Modificar el schema**

En `model Cobro`, reemplazar las dos líneas de la relación con `Reserva` y agregar la de `Suscripcion`:

```prisma
  reservaId       String?
  reserva         Reserva?     @relation(fields: [reservaId], references: [id], onDelete: Cascade)
  suscripcionId   String?
  suscripcion     Suscripcion? @relation(fields: [suscripcionId], references: [id])
```

Agregar el índice al bloque de índices de `Cobro`:

```prisma
  @@index([suscripcionId])
```

En `model Suscripcion`, agregar la relación inversa:

```prisma
  cobros      Cobro[]
```

- [ ] **Step 4: Crear la migración sin aplicarla**

```bash
cd backend && npx prisma migrate dev --create-only --name cobro_suscripcion
```

- [ ] **Step 5: Agregar el CHECK a mano en el SQL generado**

Abrir `backend/prisma/migrations/<timestamp>_cobro_suscripcion/migration.sql` y **agregar al final**:

```sql
-- Un cobro pertenece a una reserva O a una suscripcion, nunca a ambas ni a ninguna.
ALTER TABLE "Cobro" ADD CONSTRAINT cobro_destino_unico
  CHECK (("reservaId" IS NULL) <> ("suscripcionId" IS NULL));
```

(Mismo criterio que las migraciones `reserva_exclusion` y `mover_overlap_a_sector`, que también llevan SQL escrito a mano.)

- [ ] **Step 6: Aplicar la migración**

```bash
cd backend && npx prisma migrate dev
```

- [ ] **Step 7: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/cobro-suscripcion.test.ts
```

Esperado: PASS (3 tests).

- [ ] **Step 8: Correr la suite completa (regresión crítica)**

```bash
cd backend && npm test
```

Esperado: todo verde. Prestar atención a `caja.test.ts` y a cualquier test de cobros: `cobroRepo.sumByReserva` y `listByReserva` siguen filtrando por `reservaId`, así que no deberían cambiar de comportamiento.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma backend/tests/integration/cobro-suscripcion.test.ts
git commit -m "feat(suscripciones): Cobro.reservaId nullable + suscripcionId + CHECK"
```

---

# Fase 2 · Backend de suscripciones

### Task 4: Helpers puros de vigencia

**Files:**
- Create: `backend/src/services/suscripcion.vigencia.ts`
- Test: `backend/tests/unit/suscripcion.vigencia.test.ts`

**Interfaces:**
- Consumes: nada (funciones puras, sin DB).
- Produces:
  - `hoyEnTz(tz: string, ahora?: Date): string` → `'YYYY-MM-DD'`
  - `aFechaUtc(ymd: string): Date`
  - `deFechaUtc(d: Date): string`
  - `cubreFecha(s: { inicio: Date; vencimiento: Date }, ymd: string): boolean`
  - `sumarUnMes(ymd: string): string`
  - `diaSiguiente(ymd: string): string`
  - `inicioRenovacion(vencimientoAnterior: string, hoy: string): string`
  - `estadoVista(s: { estado: EstadoSuscripcion; vencimiento: Date }, hoy: string): 'ACTIVA' | 'VENCIDA' | 'CANCELADA'`

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/unit/suscripcion.vigencia.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  hoyEnTz, aFechaUtc, deFechaUtc, cubreFecha, sumarUnMes, diaSiguiente, inicioRenovacion, estadoVista,
} from '../../src/services/suscripcion.vigencia.js';

const TZ = 'America/Argentina/Buenos_Aires';
const susc = (inicio: string, vencimiento: string) => ({ inicio: aFechaUtc(inicio), vencimiento: aFechaUtc(vencimiento) });

describe('hoyEnTz', () => {
  it('usa el dia del negocio, no el de UTC', () => {
    // 2026-08-11T02:00Z son las 23:00 del 10/08 en Buenos Aires (UTC-3)
    expect(hoyEnTz(TZ, new Date('2026-08-11T02:00:00.000Z'))).toBe('2026-08-10');
  });
});

describe('cubreFecha', () => {
  const s = susc('2026-08-01', '2026-08-31');
  it('el dia anterior al inicio no esta cubierto', () => expect(cubreFecha(s, '2026-07-31')).toBe(false));
  it('el primer dia esta cubierto', () => expect(cubreFecha(s, '2026-08-01')).toBe(true));
  it('un dia intermedio esta cubierto', () => expect(cubreFecha(s, '2026-08-15')).toBe(true));
  it('el ultimo dia esta cubierto (vencimiento INCLUSIVE)', () => expect(cubreFecha(s, '2026-08-31')).toBe(true));
  it('el dia posterior al vencimiento no esta cubierto', () => expect(cubreFecha(s, '2026-09-01')).toBe(false));
});

describe('sumarUnMes', () => {
  it('caso simple', () => expect(sumarUnMes('2026-08-01')).toBe('2026-09-01'));
  it('cruza de anio', () => expect(sumarUnMes('2026-12-15')).toBe('2027-01-15'));
  it('recorta al ultimo dia del mes destino', () => expect(sumarUnMes('2026-01-31')).toBe('2026-02-28'));
  it('respeta el anio bisiesto', () => expect(sumarUnMes('2028-01-31')).toBe('2028-02-29'));
});

describe('diaSiguiente', () => {
  it('caso simple', () => expect(diaSiguiente('2026-08-30')).toBe('2026-08-31'));
  it('cruza de mes', () => expect(diaSiguiente('2026-08-31')).toBe('2026-09-01'));
  it('cruza de anio', () => expect(diaSiguiente('2026-12-31')).toBe('2027-01-01'));
});

describe('inicioRenovacion', () => {
  it('renovacion anticipada: arranca el dia siguiente al vencimiento, no pierde dias', () => {
    expect(inicioRenovacion('2026-08-31', '2026-08-20')).toBe('2026-09-01');
  });
  it('renovacion el mismo dia del vencimiento: arranca al dia siguiente', () => {
    expect(inicioRenovacion('2026-08-31', '2026-08-31')).toBe('2026-09-01');
  });
  it('renovacion tardia: arranca hoy, no regala dias retroactivos', () => {
    expect(inicioRenovacion('2026-08-31', '2026-09-15')).toBe('2026-09-15');
  });
});

describe('estadoVista', () => {
  it('cancelada gana sobre todo', () => {
    expect(estadoVista({ estado: 'CANCELADA', vencimiento: aFechaUtc('2026-12-31') }, '2026-08-10')).toBe('CANCELADA');
  });
  it('activa con vencimiento futuro', () => {
    expect(estadoVista({ estado: 'ACTIVA', vencimiento: aFechaUtc('2026-08-31') }, '2026-08-10')).toBe('ACTIVA');
  });
  it('activa el mismo dia del vencimiento sigue ACTIVA', () => {
    expect(estadoVista({ estado: 'ACTIVA', vencimiento: aFechaUtc('2026-08-31') }, '2026-08-31')).toBe('ACTIVA');
  });
  it('activa con vencimiento pasado se ve VENCIDA', () => {
    expect(estadoVista({ estado: 'ACTIVA', vencimiento: aFechaUtc('2026-08-31') }, '2026-09-01')).toBe('VENCIDA');
  });
});

describe('aFechaUtc / deFechaUtc', () => {
  it('ida y vuelta', () => expect(deFechaUtc(aFechaUtc('2026-08-15'))).toBe('2026-08-15'));
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/suscripcion.vigencia.test.ts
```

Esperado: FAIL — no se puede resolver el módulo `suscripcion.vigencia.js`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `backend/src/services/suscripcion.vigencia.ts`:

```ts
import type { EstadoSuscripcion } from '../db/client.js';

/**
 * Helpers puros de vigencia. Sin acceso a base de datos, para poder testear todos los
 * bordes de fechas sin levantar un contenedor.
 *
 * Convención: las fechas de negocio se manejan como strings 'YYYY-MM-DD'. En la DB son
 * columnas `@db.Date`, que Prisma devuelve como Date a medianoche UTC.
 */

/** Día de hoy en la zona del negocio (no en UTC). */
export function hoyEnTz(tz: string, ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ahora);
}

/** 'YYYY-MM-DD' → Date a medianoche UTC, que es como Postgres guarda un `@db.Date`. */
export function aFechaUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Date de una columna `@db.Date` → 'YYYY-MM-DD'. */
export function deFechaUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ¿La suscripción cubre esa fecha? El vencimiento es INCLUSIVE. */
export function cubreFecha(s: { inicio: Date; vencimiento: Date }, ymd: string): boolean {
  return deFechaUtc(s.inicio) <= ymd && ymd <= deFechaUtc(s.vencimiento);
}

/** Suma un mes calendario. Si el mes destino es más corto, recorta (31/01 → 28/02). */
export function sumarUnMes(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const anio = m === 12 ? y + 1 : y;
  const mes = m === 12 ? 1 : m + 1;
  // Día 0 del mes siguiente = último día del mes destino.
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function diaSiguiente(ymd: string): string {
  const d = aFechaUtc(ymd);
  d.setUTCDate(d.getUTCDate() + 1);
  return deFechaUtc(d);
}

/**
 * Inicio de una renovación: el día siguiente al vencimiento anterior, o hoy si ese día ya pasó.
 * Renovación anticipada → no pierde días pagos. Renovación tardía → no regala días retroactivos.
 */
export function inicioRenovacion(vencimientoAnterior: string, hoy: string): string {
  const siguiente = diaSiguiente(vencimientoAnterior);
  return siguiente > hoy ? siguiente : hoy;
}

export type EstadoVista = 'ACTIVA' | 'VENCIDA' | 'CANCELADA';

/** "Vencida" NO se persiste: se deriva de la fecha. Por eso no hace falta ningún cron. */
export function estadoVista(s: { estado: EstadoSuscripcion; vencimiento: Date }, hoy: string): EstadoVista {
  if (s.estado === 'CANCELADA') return 'CANCELADA';
  return deFechaUtc(s.vencimiento) < hoy ? 'VENCIDA' : 'ACTIVA';
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/suscripcion.vigencia.test.ts
```

Esperado: PASS (todos los casos).

- [ ] **Step 5: Verificar tipos**

```bash
cd backend && npm run typecheck
```

Esperado: sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/suscripcion.vigencia.ts backend/tests/unit/suscripcion.vigencia.test.ts
git commit -m "feat(suscripciones): helpers puros de vigencia y renovacion"
```

---

### Task 5: `suscripcion.repo.ts` + `vigenteDe`

**Files:**
- Create: `backend/src/repositories/suscripcion.repo.ts`
- Create: `backend/src/services/suscripcion.service.ts`
- Test: `backend/tests/integration/suscripcion-vigente.test.ts`

**Interfaces:**
- Consumes: helpers de `suscripcion.vigencia.js` (Task 4), modelo `Suscripcion` (Task 1).
- Produces:
  - `suscripcionRepo` con `create`, `findById`, `cubriendo`, `solapadas`, `list`, `listByCliente`, `cancelar`, `contarReservasPorSuscripcion`.
  - `suscripcionService.vigenteDe(clienteId: string, fecha?: string): Promise<Suscripcion | null>`

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/suscripcion-vigente.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { suscripcionService } from '../../src/services/suscripcion.service.js';
import { aFechaUtc } from '../../src/services/suscripcion.vigencia.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function cliente(whatsapp = '+5491100000010') {
  return getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp } });
}
async function suscripcion(clienteId: string, inicio: string, vencimiento: string, estado: 'ACTIVA' | 'CANCELADA' = 'ACTIVA') {
  return getPrisma().suscripcion.create({
    data: { clienteId, inicio: aFechaUtc(inicio), vencimiento: aFechaUtc(vencimiento), estado },
  });
}

describe('suscripcionService.vigenteDe', () => {
  it('devuelve la suscripcion cuando la fecha esta dentro del periodo', async () => {
    const c = await cliente();
    const s = await suscripcion(c.id, '2026-08-01', '2026-08-31');
    expect((await suscripcionService.vigenteDe(c.id, '2026-08-15'))?.id).toBe(s.id);
  });

  it('el ultimo dia de vigencia todavia cuenta', async () => {
    const c = await cliente();
    const s = await suscripcion(c.id, '2026-08-01', '2026-08-31');
    expect((await suscripcionService.vigenteDe(c.id, '2026-08-31'))?.id).toBe(s.id);
  });

  it('el dia posterior al vencimiento ya no cuenta', async () => {
    const c = await cliente();
    await suscripcion(c.id, '2026-08-01', '2026-08-31');
    expect(await suscripcionService.vigenteDe(c.id, '2026-09-01')).toBeNull();
  });

  it('ignora las canceladas', async () => {
    const c = await cliente();
    await suscripcion(c.id, '2026-08-01', '2026-08-31', 'CANCELADA');
    expect(await suscripcionService.vigenteDe(c.id, '2026-08-15')).toBeNull();
  });

  it('sin suscripciones devuelve null', async () => {
    const c = await cliente();
    expect(await suscripcionService.vigenteDe(c.id, '2026-08-15')).toBeNull();
  });

  it('si hubiera dos que cubren la fecha, toma la de mayor vencimiento (determinista)', async () => {
    const c = await cliente();
    await suscripcion(c.id, '2026-08-01', '2026-08-31');
    const larga = await suscripcion(c.id, '2026-08-01', '2026-09-30');
    expect((await suscripcionService.vigenteDe(c.id, '2026-08-15'))?.id).toBe(larga.id);
  });

  it('no mezcla clientes', async () => {
    const a = await cliente('+5491100000011');
    const b = await cliente('+5491100000012');
    await suscripcion(a.id, '2026-08-01', '2026-08-31');
    expect(await suscripcionService.vigenteDe(b.id, '2026-08-15')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/suscripcion-vigente.test.ts
```

Esperado: FAIL — no se resuelve `suscripcion.service.js`.

- [ ] **Step 3: Escribir el repositorio**

Crear `backend/src/repositories/suscripcion.repo.ts`:

```ts
import { Prisma } from '../db/client.js';
import { prisma } from '../db/prisma.js';

export const suscripcionRepo = {
  create: (data: Prisma.SuscripcionUncheckedCreateInput, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).suscripcion.create({ data }),

  findById: (id: string) =>
    prisma.suscripcion.findUnique({ where: { id }, include: { cliente: true } }),

  /** ACTIVAS del cliente que cubren `fecha`, la de mayor vencimiento primero. */
  cubriendo: (clienteId: string, fecha: Date) =>
    prisma.suscripcion.findMany({
      where: { clienteId, estado: 'ACTIVA', inicio: { lte: fecha }, vencimiento: { gte: fecha } },
      orderBy: { vencimiento: 'desc' },
    }),

  /** ACTIVAS del cliente que se solapan con [inicio, vencimiento]. Dos rangos se solapan si a.inicio <= b.fin && b.inicio <= a.fin. */
  solapadas: (clienteId: string, inicio: Date, vencimiento: Date, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).suscripcion.findMany({
      where: { clienteId, estado: 'ACTIVA', inicio: { lte: vencimiento }, vencimiento: { gte: inicio } },
    }),

  list: () =>
    prisma.suscripcion.findMany({ include: { cliente: true }, orderBy: { creadoEn: 'desc' } }),

  listByCliente: (clienteId: string) =>
    prisma.suscripcion.findMany({ where: { clienteId }, orderBy: { inicio: 'desc' } }),

  cancelar: (id: string, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).suscripcion.update({ where: { id }, data: { estado: 'CANCELADA' } }),

  /** Turnos bonificados por suscripción, para el listado del panel. */
  contarReservasPorSuscripcion: async (ids: string[]): Promise<Map<string, number>> => {
    if (ids.length === 0) return new Map();
    const rows = await prisma.reserva.groupBy({
      by: ['suscripcionId'],
      where: { suscripcionId: { in: ids } },
      _count: { suscripcionId: true },
    });
    return new Map(rows.map((r) => [r.suscripcionId as string, r._count.suscripcionId]));
  },
};
```

- [ ] **Step 4: Escribir el service con `vigenteDe`**

Crear `backend/src/services/suscripcion.service.ts`:

```ts
import { getEnv } from '../config/env.js';
import { suscripcionRepo } from '../repositories/suscripcion.repo.js';
import { aFechaUtc, hoyEnTz } from './suscripcion.vigencia.js';

export const suscripcionService = {
  /**
   * ÚNICA función que decide si alguien es socio. Todo lo demás (reservas, panel, web)
   * consume esto; nunca reimplementa la regla.
   *
   * Recibe `clienteId` y no `whatsapp` porque `reserva.service.crear` ya buscó el cliente
   * unas líneas antes: así se reutiliza esa consulta en vez de hacer un join extra.
   */
  async vigenteDe(clienteId: string, fecha?: string) {
    const ymd = fecha ?? hoyEnTz(getEnv().TZ_NEGOCIO);
    const encontradas = await suscripcionRepo.cubriendo(clienteId, aFechaUtc(ymd));
    return encontradas[0] ?? null;
  },
};
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/suscripcion-vigente.test.ts
```

Esperado: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/repositories/suscripcion.repo.ts backend/src/services/suscripcion.service.ts backend/tests/integration/suscripcion-vigente.test.ts
git commit -m "feat(suscripciones): repo + vigenteDe"
```

---

### Task 6: Alta de suscripción (service + validator + ruta) con cobro de cuota

**Files:**
- Modify: `backend/src/services/suscripcion.service.ts`
- Create: `backend/src/validators/suscripcion.schema.ts`
- Create: `backend/src/routes/suscripcion.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/suscripcion-alta.test.ts`

**Interfaces:**
- Consumes: `suscripcionRepo` (Task 5), `cobroRepo`, `clienteRepo`, `adminUserRepo`, helpers de vigencia.
- Produces:
  - `suscripcionService.crear(input, adminId): Promise<Suscripcion>` donde `input` es `{ clienteId: string; inicio: string; vencimiento: string; precio?: number; medio?: 'EFECTIVO' | 'TRANSFERENCIA'; nota?: string }`
  - `POST /suscripciones` → 201 con la suscripción creada.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/suscripcion-alta.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });
const recep = () => signAdminToken({ adminId: 'r1', email: 'r@r.com', rol: 'RECEPCIONISTA' });

async function nuevoCliente(whatsapp = '+5491100000020') {
  return getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp } });
}

describe('POST /suscripciones', () => {
  it('crea la suscripcion sin cobro cuando no se manda precio', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app)
      .post('/suscripciones')
      .set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31' });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ACTIVA');
    expect(await getPrisma().cobro.count()).toBe(0);
  });

  it('crea la suscripcion y el cobro de la cuota cuando se manda precio + medio', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app)
      .post('/suscripciones')
      .set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31', precio: 20000, medio: 'EFECTIVO' });
    expect(res.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany();
    expect(cobros).toHaveLength(1);
    expect(cobros[0].suscripcionId).toBe(res.body.id);
    expect(cobros[0].reservaId).toBeNull();
    expect(cobros[0].origen).toBe('SUSCRIPCION');
    expect(Number(cobros[0].monto)).toBe(20000);
  });

  it('rechaza precio sin medio (400)', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app)
      .post('/suscripciones')
      .set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31', precio: 20000 });
    expect(res.status).toBe(400);
  });

  it('rechaza vencimiento anterior al inicio (400)', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app)
      .post('/suscripciones')
      .set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-31', vencimiento: '2026-08-01' });
    expect(res.status).toBe(400);
  });

  it('rechaza el solapamiento con otra suscripcion activa (409)', async () => {
    const c = await nuevoCliente();
    await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31' });
    const res = await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-15', vencimiento: '2026-09-15' });
    expect(res.status).toBe(409);
  });

  it('permite un periodo consecutivo sin solape', async () => {
    const c = await nuevoCliente();
    await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31' });
    const res = await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: c.id, inicio: '2026-09-01', vencimiento: '2026-09-30' });
    expect(res.status).toBe(201);
  });

  it('cliente inexistente → 404', async () => {
    const res = await supertest(app).post('/suscripciones').set('authorization', `Bearer ${admin()}`)
      .send({ clienteId: 'no-existe', inicio: '2026-08-01', vencimiento: '2026-08-31' });
    expect(res.status).toBe(404);
  });

  it('recepcionista no puede dar de alta socios (403)', async () => {
    const c = await nuevoCliente();
    const res = await supertest(app).post('/suscripciones').set('authorization', `Bearer ${recep()}`)
      .send({ clienteId: c.id, inicio: '2026-08-01', vencimiento: '2026-08-31' });
    expect(res.status).toBe(403);
  });

  it('sin autenticacion → 401', async () => {
    const res = await supertest(app).post('/suscripciones').send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/suscripcion-alta.test.ts
```

Esperado: FAIL — 404 en todas (la ruta no existe).

- [ ] **Step 3: Escribir el validator**

Crear `backend/src/validators/suscripcion.schema.ts`:

```ts
import { z } from 'zod';

const empty = z.looseObject({});
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
const medio = z.enum(['EFECTIVO', 'TRANSFERENCIA']);

/** Un cobro sin medio de pago no tiene sentido en Caja: si hay precio, el medio es obligatorio. */
const exigeMedioSiHayPrecio = (b: { precio?: number; medio?: 'EFECTIVO' | 'TRANSFERENCIA' }) =>
  !(b.precio != null && b.precio > 0) || b.medio != null;

export const crearSuscripcionSchema = z.object({
  body: z.object({
    clienteId: z.string().min(1),
    inicio: ymd,
    vencimiento: ymd,
    precio: z.coerce.number().nonnegative().optional(),
    medio: medio.optional(),
    nota: z.string().optional(),
  })
    .refine((b) => b.inicio <= b.vencimiento, { message: 'El vencimiento no puede ser anterior al inicio', path: ['vencimiento'] })
    .refine(exigeMedioSiHayPrecio, { message: 'Elegí el medio de pago de la cuota', path: ['medio'] }),
  query: empty,
  params: empty,
});

export const renovarSuscripcionSchema = z.object({
  body: z.object({
    precio: z.coerce.number().nonnegative().optional(),
    medio: medio.optional(),
  }).refine(exigeMedioSiHayPrecio, { message: 'Elegí el medio de pago de la cuota', path: ['medio'] }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});

export const idSuscripcionParamSchema = z.object({
  body: z.unknown(),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 4: Agregar `crear` al service**

En `backend/src/services/suscripcion.service.ts`, agregar los imports y el método:

```ts
import { prisma } from '../db/prisma.js';
import { clienteRepo } from '../repositories/cliente.repo.js';
import { cobroRepo } from '../repositories/cobro.repo.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { Conflict, NotFound } from '../utils/errors.js';
```

```ts
export interface CrearSuscripcionInput {
  clienteId: string;
  inicio: string;
  vencimiento: string;
  precio?: number;
  medio?: 'EFECTIVO' | 'TRANSFERENCIA';
  nota?: string;
}

/** Evita una violación de FK si el token trae un adminId que ya no existe (mismo guard que cobroService). */
async function adminValido(adminId: string | null): Promise<string | null> {
  if (!adminId) return null;
  return (await adminUserRepo.findById(adminId)) ? adminId : null;
}
```

Y dentro del objeto `suscripcionService`, después de `vigenteDe`:

```ts
  async crear(input: CrearSuscripcionInput, adminId: string | null) {
    const cliente = await clienteRepo.findById(input.clienteId);
    if (!cliente) throw NotFound('Cliente', input.clienteId);
    const inicio = aFechaUtc(input.inicio);
    const vencimiento = aFechaUtc(input.vencimiento);
    const registradoPorId = await adminValido(adminId);

    return prisma.$transaction(async (tx) => {
      const solapadas = await suscripcionRepo.solapadas(input.clienteId, inicio, vencimiento, tx);
      if (solapadas.length > 0) throw Conflict('El cliente ya tiene una suscripción activa en ese período');

      const s = await suscripcionRepo.create({
        clienteId: input.clienteId,
        inicio,
        vencimiento,
        precio: input.precio ?? null,
        nota: input.nota ?? null,
        creadoPorId: registradoPorId,
      }, tx);

      if (input.precio != null && input.precio > 0) {
        await cobroRepo.create({
          suscripcionId: s.id,
          reservaId: null,
          monto: input.precio,
          medio: input.medio!,
          origen: 'SUSCRIPCION',
          registradoPorId,
        }, tx);
      }
      return s;
    });
  },
```

- [ ] **Step 5: Escribir la ruta**

Crear `backend/src/routes/suscripcion.routes.ts`:

```ts
import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import { suscripcionService } from '../services/suscripcion.service.js';
import { auditService } from '../services/audit.service.js';
import { crearSuscripcionSchema } from '../validators/suscripcion.schema.js';

export const suscripcionRoutes = Router();

const adminId = (req: any) => (req.principal?.kind === 'admin' ? req.principal.adminId : null);

suscripcionRoutes.post('/', authJwt, requireRole('ADMIN'), validate(crearSuscripcionSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    const s = await suscripcionService.crear(body, adminId(req));
    await auditService.log(req, { accion: 'CREAR', entidad: 'Suscripcion', entidadId: s.id, descripcion: 'Dio de alta un socio' });
    res.status(201).json(s);
  } catch (e) { next(e); }
});
```

- [ ] **Step 6: Registrar el router**

En `backend/src/routes/index.ts`, agregar el import junto a los demás:

```ts
import { suscripcionRoutes } from './suscripcion.routes.js';
```

y el montaje al final de la lista:

```ts
apiRouter.use('/suscripciones', suscripcionRoutes);
```

- [ ] **Step 7: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/suscripcion-alta.test.ts
```

Esperado: PASS (9 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/suscripcion.service.ts backend/src/validators/suscripcion.schema.ts backend/src/routes/suscripcion.routes.ts backend/src/routes/index.ts backend/tests/integration/suscripcion-alta.test.ts
git commit -m "feat(suscripciones): alta con cobro de cuota"
```

---

### Task 7: Listado con estado derivado (`GET /suscripciones`)

**Files:**
- Modify: `backend/src/services/suscripcion.service.ts`
- Modify: `backend/src/routes/suscripcion.routes.ts`
- Test: `backend/tests/integration/suscripcion-listado.test.ts`

**Interfaces:**
- Consumes: `suscripcionRepo.list`, `contarReservasPorSuscripcion`, `estadoVista` (Task 4).
- Produces: `suscripcionService.listar()` → array de
  `{ id, clienteId, cliente: { id, nombre, whatsapp }, inicio: string, vencimiento: string, estado: 'ACTIVA'|'CANCELADA', estadoVista: 'ACTIVA'|'VENCIDA'|'CANCELADA', precio: number|null, nota: string|null, turnosBonificados: number, creadoEn: Date }`
  y `GET /suscripciones`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/suscripcion-listado.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { aFechaUtc, hoyEnTz, diaSiguiente } from '../../src/services/suscripcion.vigencia.js';

let app: any;
const TZ = 'America/Argentina/Buenos_Aires';

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });

describe('GET /suscripciones', () => {
  it('deriva ACTIVA / VENCIDA / CANCELADA sin persistir "vencida"', async () => {
    const hoy = hoyEnTz(TZ);
    const manana = diaSiguiente(hoy);
    const cA = await getPrisma().cliente.create({ data: { nombre: 'Activa', whatsapp: '+5491100000030' } });
    const cV = await getPrisma().cliente.create({ data: { nombre: 'Vencida', whatsapp: '+5491100000031' } });
    const cC = await getPrisma().cliente.create({ data: { nombre: 'Cancelada', whatsapp: '+5491100000032' } });

    await getPrisma().suscripcion.create({ data: { clienteId: cA.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc(manana) } });
    await getPrisma().suscripcion.create({ data: { clienteId: cV.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc('2026-01-31') } });
    await getPrisma().suscripcion.create({ data: { clienteId: cC.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc(manana), estado: 'CANCELADA' } });

    const res = await supertest(app).get('/suscripciones').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    const porCliente = Object.fromEntries(res.body.map((s: any) => [s.cliente.nombre, s.estadoVista]));
    expect(porCliente).toEqual({ Activa: 'ACTIVA', Vencida: 'VENCIDA', Cancelada: 'CANCELADA' });
    // "VENCIDA" es derivado: en la DB sigue siendo ACTIVA
    const enDb = await getPrisma().suscripcion.findFirst({ where: { clienteId: cV.id } });
    expect(enDb!.estado).toBe('ACTIVA');
  });

  it('devuelve las fechas como YYYY-MM-DD y cuenta los turnos bonificados', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000033' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 10000, jugadores: 5 } });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: c.id, estado: 'CONFIRMADA', esContacto: false, monto: 0,
        montoLista: 10000, suscripcionId: s.id,
        fechaInicio: new Date('2026-08-10T20:00:00.000Z'), fechaFin: new Date('2026-08-10T21:00:00.000Z'),
      },
    });
    const res = await supertest(app).get('/suscripciones').set('authorization', `Bearer ${admin()}`);
    expect(res.body[0].inicio).toBe('2026-08-01');
    expect(res.body[0].vencimiento).toBe('2026-08-31');
    expect(res.body[0].turnosBonificados).toBe(1);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/suscripcion-listado.test.ts
```

Esperado: FAIL — 404 (la ruta GET no existe).

- [ ] **Step 3: Agregar `listar` al service**

En `backend/src/services/suscripcion.service.ts`, agregar al import de vigencia `deFechaUtc` y `estadoVista`:

```ts
import { aFechaUtc, deFechaUtc, estadoVista, hoyEnTz } from './suscripcion.vigencia.js';
```

Y el método dentro de `suscripcionService`:

```ts
  async listar() {
    const hoy = hoyEnTz(getEnv().TZ_NEGOCIO);
    const filas = await suscripcionRepo.list();
    const conteos = await suscripcionRepo.contarReservasPorSuscripcion(filas.map((s) => s.id));
    return filas.map((s) => ({
      id: s.id,
      clienteId: s.clienteId,
      cliente: { id: s.cliente.id, nombre: s.cliente.nombre, whatsapp: s.cliente.whatsapp },
      inicio: deFechaUtc(s.inicio),
      vencimiento: deFechaUtc(s.vencimiento),
      estado: s.estado,
      estadoVista: estadoVista(s, hoy),
      precio: s.precio == null ? null : Number(s.precio),
      nota: s.nota,
      turnosBonificados: conteos.get(s.id) ?? 0,
      creadoEn: s.creadoEn,
    }));
  },
```

- [ ] **Step 4: Agregar la ruta**

En `backend/src/routes/suscripcion.routes.ts`, antes del `POST`:

```ts
suscripcionRoutes.get('/', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json(await suscripcionService.listar()); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/suscripcion-listado.test.ts
```

Esperado: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/suscripcion.service.ts backend/src/routes/suscripcion.routes.ts backend/tests/integration/suscripcion-listado.test.ts
git commit -m "feat(suscripciones): listado con estado derivado"
```

---

### Task 8: Renovación (`POST /suscripciones/:id/renovar`)

**Files:**
- Modify: `backend/src/services/suscripcion.service.ts`
- Modify: `backend/src/routes/suscripcion.routes.ts`
- Test: `backend/tests/integration/suscripcion-renovar.test.ts`

**Interfaces:**
- Consumes: `inicioRenovacion`, `sumarUnMes` (Task 4), `suscripcionService.crear` (Task 6).
- Produces: `suscripcionService.renovar(id, { precio?, medio? }, adminId)` → la **suscripción nueva**.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/suscripcion-renovar.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { aFechaUtc, hoyEnTz, diaSiguiente, sumarUnMes } from '../../src/services/suscripcion.vigencia.js';

let app: any;
const TZ = 'America/Argentina/Buenos_Aires';

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });

async function socioCon(inicio: string, vencimiento: string, whatsapp = '+5491100000040') {
  const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp } });
  const s = await getPrisma().suscripcion.create({ data: { clienteId: c.id, inicio: aFechaUtc(inicio), vencimiento: aFechaUtc(vencimiento) } });
  return { cliente: c, suscripcion: s };
}

describe('POST /suscripciones/:id/renovar', () => {
  it('renovacion anticipada: crea una fila nueva que arranca al dia siguiente del vencimiento', async () => {
    const hoy = hoyEnTz(TZ);
    const vence = sumarUnMes(hoy); // vencimiento futuro → renovación anticipada
    const { suscripcion } = await socioCon('2026-01-01', vence);
    const res = await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`)
      .set('authorization', `Bearer ${admin()}`).send({});
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(suscripcion.id);
    expect(res.body.inicio.slice(0, 10)).toBe(diaSiguiente(vence));
    expect(await getPrisma().suscripcion.count()).toBe(2);
  });

  it('renovacion tardia: arranca hoy, no regala dias retroactivos', async () => {
    const hoy = hoyEnTz(TZ);
    const { suscripcion } = await socioCon('2026-01-01', '2026-01-31');
    const res = await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`)
      .set('authorization', `Bearer ${admin()}`).send({});
    expect(res.status).toBe(201);
    expect(res.body.inicio.slice(0, 10)).toBe(hoy);
    expect(res.body.vencimiento.slice(0, 10)).toBe(sumarUnMes(hoy));
  });

  it('registra el cobro de la cuota si se manda precio + medio', async () => {
    const { suscripcion } = await socioCon('2026-01-01', '2026-01-31');
    const res = await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`)
      .set('authorization', `Bearer ${admin()}`).send({ precio: 25000, medio: 'TRANSFERENCIA' });
    const cobros = await getPrisma().cobro.findMany();
    expect(cobros).toHaveLength(1);
    expect(cobros[0].suscripcionId).toBe(res.body.id);
    expect(Number(cobros[0].monto)).toBe(25000);
  });

  it('la suscripcion vieja no se modifica', async () => {
    const { suscripcion } = await socioCon('2026-01-01', '2026-01-31');
    await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`).set('authorization', `Bearer ${admin()}`).send({});
    const vieja = await getPrisma().suscripcion.findUnique({ where: { id: suscripcion.id } });
    expect(vieja!.vencimiento.toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(vieja!.estado).toBe('ACTIVA');
  });

  it('se puede renovar una cancelada (arranca desde hoy)', async () => {
    const { suscripcion } = await socioCon('2026-01-01', '2026-01-31');
    await getPrisma().suscripcion.update({ where: { id: suscripcion.id }, data: { estado: 'CANCELADA' } });
    const res = await supertest(app).post(`/suscripciones/${suscripcion.id}/renovar`)
      .set('authorization', `Bearer ${admin()}`).send({});
    expect(res.status).toBe(201);
  });

  it('suscripcion inexistente → 404', async () => {
    const res = await supertest(app).post('/suscripciones/no-existe/renovar')
      .set('authorization', `Bearer ${admin()}`).send({});
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/suscripcion-renovar.test.ts
```

Esperado: FAIL — 404 (la ruta no existe).

- [ ] **Step 3: Agregar `renovar` al service**

Ampliar el import de vigencia:

```ts
import { aFechaUtc, deFechaUtc, estadoVista, hoyEnTz, inicioRenovacion, sumarUnMes } from './suscripcion.vigencia.js';
```

Y agregar el método dentro de `suscripcionService`:

```ts
  /**
   * Renovar crea una fila NUEVA, no mueve la fecha de la existente: así queda historial de
   * períodos y "cliente con múltiples suscripciones" deja de ser un caso borde.
   */
  async renovar(id: string, input: { precio?: number; medio?: 'EFECTIVO' | 'TRANSFERENCIA' }, adminId: string | null) {
    const anterior = await suscripcionRepo.findById(id);
    if (!anterior) throw NotFound('Suscripción', id);
    const hoy = hoyEnTz(getEnv().TZ_NEGOCIO);
    const inicio = inicioRenovacion(deFechaUtc(anterior.vencimiento), hoy);
    return suscripcionService.crear(
      { clienteId: anterior.clienteId, inicio, vencimiento: sumarUnMes(inicio), precio: input.precio, medio: input.medio },
      adminId,
    );
  },
```

- [ ] **Step 4: Agregar la ruta**

En `backend/src/routes/suscripcion.routes.ts`, agregar el import del schema:

```ts
import { crearSuscripcionSchema, renovarSuscripcionSchema } from '../validators/suscripcion.schema.js';
```

y la ruta:

```ts
suscripcionRoutes.post('/:id/renovar', authJwt, requireRole('ADMIN'), validate(renovarSuscripcionSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const s = await suscripcionService.renovar(id, (req as any).valid.body, adminId(req));
    await auditService.log(req, { accion: 'CREAR', entidad: 'Suscripcion', entidadId: s.id, descripcion: 'Renovó la suscripción de un socio' });
    res.status(201).json(s);
  } catch (e) { next(e); }
});
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/suscripcion-renovar.test.ts
```

Esperado: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/suscripcion.service.ts backend/src/routes/suscripcion.routes.ts backend/tests/integration/suscripcion-renovar.test.ts
git commit -m "feat(suscripciones): renovacion manual"
```

---

### Task 9: Cancelación (`PATCH /suscripciones/:id/cancelar`)

**Files:**
- Modify: `backend/src/services/suscripcion.service.ts`
- Modify: `backend/src/routes/suscripcion.routes.ts`
- Test: `backend/tests/integration/suscripcion-cancelar.test.ts`

**Interfaces:**
- Consumes: `suscripcionRepo.cancelar`.
- Produces: `suscripcionService.cancelar(id): Promise<Suscripcion>`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/suscripcion-cancelar.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { aFechaUtc } from '../../src/services/suscripcion.vigencia.js';

let app: any;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });

describe('PATCH /suscripciones/:id/cancelar', () => {
  it('cancela y deja de estar vigente', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000050' } });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    const res = await supertest(app).patch(`/suscripciones/${s.id}/cancelar`).set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');
    const { suscripcionService } = await import('../../src/services/suscripcion.service.js');
    expect(await suscripcionService.vigenteDe(c.id, '2026-08-15')).toBeNull();
  });

  it('NO recalcula las reservas ya bonificadas', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000051' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 10000, jugadores: 5 } });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: c.id, estado: 'CONFIRMADA', esContacto: false, monto: 0,
        montoLista: 10000, suscripcionId: s.id,
        fechaInicio: new Date('2026-08-20T20:00:00.000Z'), fechaFin: new Date('2026-08-20T21:00:00.000Z'),
      },
    });
    await supertest(app).patch(`/suscripciones/${s.id}/cancelar`).set('authorization', `Bearer ${admin()}`);
    const despues = await getPrisma().reserva.findUnique({ where: { id: r.id } });
    expect(Number(despues!.monto)).toBe(0);
    expect(despues!.suscripcionId).toBe(s.id);
    expect(despues!.estado).toBe('CONFIRMADA');
  });

  it('suscripcion inexistente → 404', async () => {
    const res = await supertest(app).patch('/suscripciones/no-existe/cancelar').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/suscripcion-cancelar.test.ts
```

Esperado: FAIL — 404 en la ruta.

- [ ] **Step 3: Agregar `cancelar` al service**

Dentro de `suscripcionService`:

```ts
  /** Cancelar NO recalcula las reservas ya bonificadas: la bonificación se congela al reservar. */
  async cancelar(id: string) {
    const s = await suscripcionRepo.findById(id);
    if (!s) throw NotFound('Suscripción', id);
    return suscripcionRepo.cancelar(id);
  },
```

- [ ] **Step 4: Agregar la ruta**

Ampliar el import de schemas:

```ts
import { crearSuscripcionSchema, renovarSuscripcionSchema, idSuscripcionParamSchema } from '../validators/suscripcion.schema.js';
```

```ts
suscripcionRoutes.patch('/:id/cancelar', authJwt, requireRole('ADMIN'), validate(idSuscripcionParamSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const s = await suscripcionService.cancelar(id);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Suscripcion', entidadId: id, descripcion: 'Canceló la suscripción de un socio' });
    res.json(s);
  } catch (e) { next(e); }
});
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/suscripcion-cancelar.test.ts
```

Esperado: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/suscripcion.service.ts backend/src/routes/suscripcion.routes.ts backend/tests/integration/suscripcion-cancelar.test.ts
git commit -m "feat(suscripciones): cancelacion"
```

---

### Task 10: Caja separa turnos de cuotas

**Files:**
- Modify: `backend/src/repositories/cobro.repo.ts:19-27`
- Modify: `backend/src/services/caja.service.ts`
- Test: `backend/tests/integration/caja-cuotas.test.ts`

**Interfaces:**
- Consumes: `Cobro.suscripcionId` (Task 3).
- Produces: el reporte de `GET /caja` suma `porConcepto: { turnos: number; cuotas: number }` y cada fila de `cobros[]` suma `concepto: 'TURNO' | 'CUOTA'`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/caja-cuotas.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { aFechaUtc } from '../../src/services/suscripcion.vigencia.js';

let app: any;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });

describe('caja con cuotas de suscripcion', () => {
  it('separa el total por concepto y no rompe porCancha', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000060' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 10000, jugadores: 5 } });
    const r = await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: c.id, estado: 'CONFIRMADA', esContacto: true, monto: 10000,
        fechaInicio: new Date(), fechaFin: new Date(Date.now() + 3600000),
      },
    });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    await getPrisma().cobro.create({ data: { reservaId: r.id, monto: 10000, medio: 'EFECTIVO', origen: 'MANUAL' } });
    await getPrisma().cobro.create({ data: { suscripcionId: s.id, monto: 20000, medio: 'TRANSFERENCIA', origen: 'SUSCRIPCION' } });

    const res = await supertest(app).get('/caja').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(30000);
    expect(res.body.porConcepto.turnos).toBe(10000);
    expect(res.body.porConcepto.cuotas).toBe(20000);
    expect(res.body.porMedio.EFECTIVO).toBe(10000);
    expect(res.body.porMedio.TRANSFERENCIA).toBe(20000);
    // La cuota no tiene cancha: porCancha solo cuenta el turno.
    expect(res.body.porCancha).toHaveLength(1);
    expect(res.body.porCancha[0].total).toBe(10000);
    const cuota = res.body.cobros.find((x: any) => x.concepto === 'CUOTA');
    expect(cuota.cliente).toBe('Socio');
    expect(cuota.cancha).toBe('-');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/caja-cuotas.test.ts
```

Esperado: FAIL — `res.body.porConcepto` es `undefined`.

- [ ] **Step 3: Incluir la suscripción en la consulta del repo**

En `backend/src/repositories/cobro.repo.ts`, dentro de `listRange`, agregar al `include`:

```ts
        suscripcion: { select: { cliente: { select: { nombre: true } } } },
```

- [ ] **Step 4: Separar por concepto en el service**

Reemplazar el cuerpo de `reporte` en `backend/src/services/caja.service.ts`:

```ts
export const cajaService = {
  async reporte(desde: string, hasta: string) {
    const tz = getEnv().TZ_NEGOCIO;
    const start = dayWindowUtc(desde, tz).start;
    const end = dayWindowUtc(hasta, tz).end;
    const rows = await cobroRepo.listRange(start, end);
    const porMedio = { EFECTIVO: 0, TRANSFERENCIA: 0 };
    const porConcepto = { turnos: 0, cuotas: 0 };
    const porCanchaMap = new Map<string, { canchaId: string; nombre: string; total: number }>();
    let total = 0;
    for (const c of rows) {
      const m = Number(c.monto);
      total += m;
      porMedio[c.medio] += m;
      // Un cobro pertenece a una reserva O a una suscripción (constraint cobro_destino_unico).
      if (c.suscripcionId) porConcepto.cuotas += m;
      else porConcepto.turnos += m;
      const ca = c.reserva?.cancha;
      if (ca) {
        const e = porCanchaMap.get(ca.id) ?? { canchaId: ca.id, nombre: ca.nombre, total: 0 };
        e.total += m;
        porCanchaMap.set(ca.id, e);
      }
    }
    return {
      desde,
      hasta,
      total,
      porMedio,
      porConcepto,
      porCancha: [...porCanchaMap.values()].sort((a, b) => b.total - a.total),
      cobros: rows.map((c) => ({
        id: c.id,
        creadoEn: c.creadoEn,
        monto: Number(c.monto),
        medio: c.medio,
        concepto: c.suscripcionId ? ('CUOTA' as const) : ('TURNO' as const),
        cancha: c.reserva?.cancha?.nombre ?? '-',
        cliente: c.reserva?.cliente?.nombre ?? c.suscripcion?.cliente?.nombre ?? '-',
        registradoPor: c.registradoPor?.nombre ?? 'Sistema',
      })),
    };
  },
};
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/caja-cuotas.test.ts
```

Esperado: PASS.

- [ ] **Step 6: Regresión de caja**

```bash
cd backend && npx vitest run tests/integration/caja.test.ts
```

Esperado: PASS (los 5 tests existentes siguen verdes).

- [ ] **Step 7: Commit**

```bash
git add backend/src/repositories/cobro.repo.ts backend/src/services/caja.service.ts backend/tests/integration/caja-cuotas.test.ts
git commit -m "feat(suscripciones): caja separa turnos de cuotas"
```

---

# Fase 3 · Panel de administración

### Task 11: Tipos + server actions del panel

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/suscripciones-actions.ts`

**Interfaces:**
- Consumes: `GET/POST /suscripciones`, `POST /suscripciones/:id/renovar`, `PATCH /suscripciones/:id/cancelar`.
- Produces:
  - `interface Suscripcion` en `types.ts`
  - `crearSuscripcion(i)`, `renovarSuscripcion(id, i)`, `cancelarSuscripcion(id)`, todas `Promise<Result>`.

- [ ] **Step 1: Agregar los tipos**

En `frontend/src/lib/types.ts`, después de `export interface Usuario ...`:

```ts
export type EstadoSuscripcionVista = 'ACTIVA' | 'VENCIDA' | 'CANCELADA';
export interface Suscripcion {
  id: string;
  clienteId: string;
  cliente: { id: string; nombre: string; whatsapp: string };
  inicio: string;
  vencimiento: string;
  estado: 'ACTIVA' | 'CANCELADA';
  estadoVista: EstadoSuscripcionVista;
  precio: number | null;
  nota: string | null;
  turnosBonificados: number;
  creadoEn: string;
}
```

Y ampliar `Reserva` con los dos campos nuevos (agregar a la interfaz existente, después de `turnoFijoId`):

```ts
  suscripcionId?: string | null;
  montoLista?: number | null;
```

Y `CajaReporte` con el desglose por concepto — reemplazar la interfaz por:

```ts
export interface CajaReporte {
  desde: string; hasta: string; total: number;
  porMedio: { EFECTIVO: number; TRANSFERENCIA: number };
  porConcepto: { turnos: number; cuotas: number };
  porCancha: { canchaId: string; nombre: string; total: number }[];
  cobros: { id: string; creadoEn: string; monto: number; medio: MedioPago; concepto: 'TURNO' | 'CUOTA'; cancha: string; cliente: string; registradoPor: string }[];
}
```

- [ ] **Step 2: Escribir las server actions**

Crear `frontend/src/lib/suscripciones-actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

// Una suscripción afecta lo que se ve en /socios y el chip de pago de las reservas del socio.
async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath('/socios');
    revalidatePath('/reservas');
    revalidatePath('/caja');
    return { ok: true };
  }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

type AltaInput = { clienteId: string; inicio: string; vencimiento: string; precio?: number; medio?: 'EFECTIVO' | 'TRANSFERENCIA'; nota?: string };

// NOTE: este archivo es 'use server', así que TODOS los exports tienen que ser `async function`.
export async function crearSuscripcion(i: AltaInput): Promise<Result> {
  return run(() => apiFetch('/suscripciones', { method: 'POST', body: JSON.stringify(i) }));
}

export async function renovarSuscripcion(id: string, i: { precio?: number; medio?: 'EFECTIVO' | 'TRANSFERENCIA' }): Promise<Result> {
  return run(() => apiFetch(`/suscripciones/${id}/renovar`, { method: 'POST', body: JSON.stringify(i) }));
}

export async function cancelarSuscripcion(id: string): Promise<Result> {
  return run(() => apiFetch(`/suscripciones/${id}/cancelar`, { method: 'PATCH' }));
}
```

- [ ] **Step 3: Verificar lint y tipos**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/suscripciones-actions.ts
git commit -m "feat(suscripciones): tipos y server actions del panel"
```

---

### Task 12: Página `/socios` con listado

**Files:**
- Create: `frontend/src/app/(panel)/socios/page.tsx`
- Create: `frontend/src/components/socios/socios-table.tsx`

**Interfaces:**
- Consumes: `Suscripcion` (Task 11), `GET /suscripciones`.
- Produces: componente `SociosTable({ socios }: { socios: Suscripcion[] })`.

- [ ] **Step 1: Escribir la página**

Crear `frontend/src/app/(panel)/socios/page.tsx`:

```tsx
import { apiFetch } from '@/lib/api';
import { requireAdmin } from '@/lib/require-admin';
import type { Suscripcion } from '@/lib/types';
import { SociosTable } from '@/components/socios/socios-table';

export default async function SociosPage() {
  await requireAdmin();
  const socios = await apiFetch<Suscripcion[]>('/suscripciones');
  return <SociosTable socios={socios} />;
}
```

- [ ] **Step 2: Escribir la tabla**

Crear `frontend/src/components/socios/socios-table.tsx`:

```tsx
'use client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { EstadoSuscripcionVista, Suscripcion } from '@/lib/types';

const TONO: Record<EstadoSuscripcionVista, string> = {
  ACTIVA: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  VENCIDA: 'bg-neutral-100 text-neutral-600 ring-neutral-500/20',
  CANCELADA: 'bg-red-50 text-red-700 ring-red-600/20',
};
const LABEL: Record<EstadoSuscripcionVista, string> = { ACTIVA: 'Activa', VENCIDA: 'Vencida', CANCELADA: 'Cancelada' };

function EstadoBadge({ estado }: { estado: EstadoSuscripcionVista }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', TONO[estado])}>
      {LABEL[estado]}
    </span>
  );
}

/** '2026-08-01' → '01/08/2026' sin pasar por Date (evita corrimientos de zona horaria). */
function fmt(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export function SociosTable({ socios }: { socios: Suscripcion[] }) {
  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Socios</h1>
      </div>

      {socios.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay socios todavía.</p>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Turnos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {socios.map((s) => (
                  <TableRow key={s.id} className="hover:bg-neutral-50">
                    <TableCell className="font-medium">{s.cliente.nombre}</TableCell>
                    <TableCell className="text-neutral-600">{s.cliente.whatsapp}</TableCell>
                    <TableCell>{fmt(s.inicio)} – {fmt(s.vencimiento)}</TableCell>
                    <TableCell><EstadoBadge estado={s.estadoVista} /></TableCell>
                    <TableCell>{s.turnosBonificados}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {socios.map((s) => (
              <div key={s.id} className="rounded-lg border bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.cliente.nombre}</span>
                  <EstadoBadge estado={s.estadoVista} />
                </div>
                <p className="mt-2 text-sm text-neutral-600">{fmt(s.inicio)} – {fmt(s.vencimiento)}</p>
                <p className="text-xs text-neutral-500">{s.turnosBonificados} turnos bonificados</p>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
```

> La tabla arranca **sin** el botón "Nuevo socio": lo agrega la Task 13 junto con el diálogo que abre. Así esta tarea no deja estado ni imports sin usar, y el lint pasa limpio por sí sola.

- [ ] **Step 3: Verificar build**

```bash
cd frontend && pnpm lint && pnpm build
```

Esperado: compila. La página `/socios` todavía redirige a `/login` si no hay sesión — es lo esperado.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(panel\)/socios frontend/src/components/socios
git commit -m "feat(suscripciones): pantalla /socios con listado"
```

---

### Task 13: Diálogo de alta de socio

**Files:**
- Create: `frontend/src/components/socios/socio-dialog.tsx`
- Modify: `frontend/src/components/socios/socios-table.tsx`

**Interfaces:**
- Consumes: `crearSuscripcion` (Task 11), `useClienteAutocomplete`, `buscarClientePorWhatsapp`, `crearCliente` (existentes en `lib/clientes-actions.ts`).
- Produces: `SocioDialog({ open, onOpenChange })`.

- [ ] **Step 1: Escribir el diálogo**

Crear `frontend/src/components/socios/socio-dialog.tsx`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useClienteAutocomplete } from '@/lib/use-cliente-autocomplete';
import { buscarClientePorWhatsapp, crearCliente } from '@/lib/clientes-actions';
import { crearSuscripcion } from '@/lib/suscripciones-actions';

/** Hoy en formato YYYY-MM-DD, tomando la fecha local del navegador (el negocio opera en AR). */
function hoyYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Suma un mes recortando al último día del mes destino (31/01 → 28/02). Espeja sumarUnMes del backend. */
function sumarUnMes(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const anio = m === 12 ? y + 1 : y;
  const mes = m === 12 ? 1 : m + 1;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function SocioDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [whatsapp, setWhatsapp] = useState('');
  const [nombre, setNombre] = useState('');
  const [inicio, setInicio] = useState(hoyYmd);
  const [vencimiento, setVencimiento] = useState(() => sumarUnMes(hoyYmd()));
  const [precio, setPrecio] = useState('');
  const [medio, setMedio] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');
  const [pending, start] = useTransition();

  const encontrado = useClienteAutocomplete(whatsapp, setNombre);

  function guardar() {
    if (!whatsapp.trim() || !nombre.trim()) { toast.error('Completá WhatsApp y nombre'); return; }
    start(async () => {
      // El alta de socio necesita un clienteId: si el cliente no existe todavía, se crea primero.
      let cliente = await buscarClientePorWhatsapp(whatsapp);
      if (!cliente) {
        const alta = await crearCliente({ nombre, whatsapp, confiable: false });
        if (!alta.ok) { toast.error(alta.error); return; }
        cliente = await buscarClientePorWhatsapp(whatsapp);
      }
      if (!cliente) { toast.error('No se pudo resolver el cliente'); return; }

      const monto = precio.trim() === '' ? undefined : Number(precio);
      const r = await crearSuscripcion({
        clienteId: cliente.id,
        inicio,
        vencimiento,
        ...(monto != null && monto > 0 ? { precio: monto, medio } : {}),
      });
      if (r.ok) {
        toast.success('Socio dado de alta');
        onOpenChange(false);
        setWhatsapp(''); setNombre(''); setPrecio('');
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo socio</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="ws">WhatsApp</Label>
            <Input id="ws" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
            {encontrado && <p className="mt-1 text-xs text-emerald-700">Cliente existente</p>}
          </div>
          <div>
            <Label htmlFor="nombre">Nombre</Label>
            <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="inicio">Inicio</Label>
              <Input id="inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vto">Vencimiento</Label>
              <Input id="vto" type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="precio">Cuota (opcional)</Label>
              <Input id="precio" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="20000" />
            </div>
            <div>
              <Label htmlFor="medio">Medio</Label>
              <Select id="medio" value={medio} onChange={(e) => setMedio(e.target.value as 'EFECTIVO' | 'TRANSFERENCIA')}>
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={pending}>{pending ? 'Guardando…' : 'Dar de alta'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

> **Antes de escribir este archivo:** abrir `frontend/src/components/ui/select.tsx`, `dialog.tsx` e `input.tsx` y ajustar las props al API real de esos componentes (están construidos sobre `@base-ui/react`, cuya API difiere de shadcn clásico). Copiar el uso de un diálogo existente, por ejemplo `components/fijos/turno-fijo-dialog.tsx`.

- [ ] **Step 2: Conectar el diálogo a la tabla**

En `frontend/src/components/socios/socios-table.tsx`, agregar los imports:

```tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SocioDialog } from './socio-dialog';
```

Agregar el estado como primera línea del componente:

```tsx
  const [dialogOpen, setDialogOpen] = useState(false);
```

Agregar el botón dentro del `<div className="mb-5 flex items-center justify-between">`, después del `<h1>`:

```tsx
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nuevo socio</Button>
```

Y renderizar el diálogo justo antes del `</>` de cierre:

```tsx
      <SocioDialog open={dialogOpen} onOpenChange={setDialogOpen} />
```

- [ ] **Step 3: Verificar build**

```bash
cd frontend && pnpm lint && pnpm build
```

Esperado: compila sin errores ni warnings de variables sin usar.

- [ ] **Step 4: QA manual**

Levantar backend (`cd backend && npm run dev`) y panel (`cd frontend && pnpm dev`), entrar como ADMIN a `/socios`, dar de alta un socio con cuota y verificar en `/caja` que aparece con concepto "cuota".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/socios
git commit -m "feat(suscripciones): dialogo de alta de socio"
```

---

### Task 14: Renovar y cancelar desde el panel

**Files:**
- Modify: `frontend/src/components/socios/socios-table.tsx`

**Interfaces:**
- Consumes: `renovarSuscripcion`, `cancelarSuscripcion` (Task 11), `useConfirm` (`components/ui/confirm`).
- Produces: hoja lateral (`Sheet`) con acciones por socio.

- [ ] **Step 1: Agregar la hoja con acciones**

En `frontend/src/components/socios/socios-table.tsx`, agregar imports:

```tsx
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useConfirm } from '@/components/ui/confirm';
import { renovarSuscripcion, cancelarSuscripcion } from '@/lib/suscripciones-actions';
```

Dentro del componente, agregar el estado y las acciones:

```tsx
  const [seleccion, setSeleccion] = useState<Suscripcion | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMsg); setSeleccion(null); }
      else { toast.error(r.error ?? 'Error'); }
    });
  }

  async function cancelar(s: Suscripcion) {
    if (await confirm({
      title: '¿Cancelar la suscripción?',
      description: `${s.cliente.nombre} va a dejar de tener turnos bonificados. Los turnos que ya reservó se mantienen bonificados.`,
      confirmLabel: 'Cancelar suscripción',
      destructive: true,
    })) {
      act(() => cancelarSuscripcion(s.id), 'Suscripción cancelada');
    }
  }
```

Hacer las filas clickeables agregando a `<TableRow>` y a la card mobile:

```tsx
onClick={() => setSeleccion(s)} className="cursor-pointer hover:bg-neutral-50"
```

Y renderizar la hoja antes del `<SocioDialog ... />`:

```tsx
      <Sheet open={!!seleccion} onOpenChange={(v) => !v && setSeleccion(null)}>
        <SheetContent>
          {seleccion && (
            <>
              <SheetHeader><SheetTitle>{seleccion.cliente.nombre}</SheetTitle></SheetHeader>
              <div className="space-y-4 p-4">
                <p className="text-sm text-neutral-600">
                  Vigencia: {fmt(seleccion.inicio)} – {fmt(seleccion.vencimiento)}
                </p>
                <p className="text-sm text-neutral-600">{seleccion.turnosBonificados} turnos bonificados</p>
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={() => act(() => renovarSuscripcion(seleccion.id, {}), 'Suscripción renovada')}
                    disabled={pending}
                  >
                    Renovar un mes
                  </Button>
                  {seleccion.estado === 'ACTIVA' && (
                    <Button variant="ghost" onClick={() => cancelar(seleccion)} disabled={pending}>
                      Cancelar suscripción
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
```

> Verificar el API real de `Sheet` y `useConfirm` copiando de `components/fijos/turnos-fijos-table.tsx`, que ya usa ambos.

- [ ] **Step 2: Verificar build**

```bash
cd frontend && pnpm lint && pnpm build
```

- [ ] **Step 3: QA manual**

Renovar un socio y verificar que aparece una fila nueva con el período siguiente y que la anterior no cambió. Cancelar y verificar que el badge pasa a "Cancelada".

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/socios/socios-table.tsx
git commit -m "feat(suscripciones): renovar y cancelar desde el panel"
```

---

### Task 15: Entrada en el menú

**Files:**
- Modify: `frontend/src/components/nav-items.ts:1,27-31`
- Test: `frontend/src/components/nav-items.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: entrada `/socios` visible solo para `ADMIN`, en el grupo `Administración`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `frontend/src/components/nav-items.test.ts`:

```ts
import { nav, navAgrupado } from './nav-items';

describe('socios en el menu', () => {
  it('es visible para ADMIN dentro de Administración', () => {
    const grupos = navAgrupado('ADMIN');
    const admin = grupos.find((g) => g.grupo === 'Administración')!;
    expect(admin.items.some((i) => i.href === '/socios')).toBe(true);
  });
  it('NO es visible para RECEPCIONISTA', () => {
    expect(navAgrupado('RECEPCIONISTA').flatMap((g) => g.items).some((i) => i.href === '/socios')).toBe(false);
  });
  it('esta declarado una sola vez', () => {
    expect(nav.filter((i) => i.href === '/socios')).toHaveLength(1);
  });
});
```

> Si el archivo ya tiene imports de `describe/it/expect`, no duplicarlos.

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd frontend && npx vitest run src/components/nav-items.test.ts
```

Esperado: FAIL — no encuentra `/socios`.

- [ ] **Step 3: Agregar la entrada**

En `frontend/src/components/nav-items.ts`, agregar `BadgeCheck` al import de `lucide-react` y la entrada en el grupo Administración, después de `/dashboard`:

```ts
  { href: '/socios', label: 'Socios', icon: BadgeCheck, roles: SOLO_ADMIN, grupo: 'Administración' },
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd frontend && npx vitest run src/components/nav-items.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/nav-items.ts frontend/src/components/nav-items.test.ts
git commit -m "feat(suscripciones): entrada Socios en el menu"
```

---

# Fase 4 · Integración con reservas

### Task 16: Extraer `resolverCondiciones` (refactor puro)

**Files:**
- Create: `backend/src/services/reserva.condiciones.ts`
- Modify: `backend/src/services/reserva.service.ts:76-84`
- Test: `backend/tests/unit/reserva.condiciones.test.ts`

**Interfaces:**
- Consumes: `precioEfectivo`, `senaService.montoParaCancha`.
- Produces:
  ```ts
  resolverCondiciones(args: {
    esContacto: boolean;
    porStaff: boolean;
    clienteConfiable: boolean;
    precio: number;
    montoSenaPedido?: number;
    senaPorDefecto: number;
    suscripcionId?: string | null;  // se empieza a usar en la Task 17
  }): { estado: 'CONFIRMADA' | 'ESPERANDO_SENA'; monto: number; montoLista: number | null; montoSena: number | null; suscripcionId: string | null }
  ```

> **Este paso NO cambia comportamiento.** Solo mueve la decisión económica a una función pura. Los tests existentes de reservas tienen que seguir verdes sin tocarlos.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/unit/reserva.condiciones.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolverCondiciones } from '../../src/services/reserva.condiciones.js';

const base = { esContacto: false, porStaff: false, clienteConfiable: false, precio: 12000, senaPorDefecto: 6000 };

describe('resolverCondiciones (sin suscripción)', () => {
  it('cliente nuevo → ESPERANDO_SENA con la seña por defecto', () => {
    expect(resolverCondiciones(base)).toEqual({
      estado: 'ESPERANDO_SENA', monto: 12000, montoLista: null, montoSena: 6000, suscripcionId: null,
    });
  });
  it('reserva por staff → CONFIRMADA sin seña', () => {
    const r = resolverCondiciones({ ...base, porStaff: true });
    expect(r.estado).toBe('CONFIRMADA');
    expect(r.montoSena).toBeNull();
    expect(r.monto).toBe(12000);
  });
  it('cliente de confianza → CONFIRMADA sin seña', () => {
    expect(resolverCondiciones({ ...base, clienteConfiable: true }).estado).toBe('CONFIRMADA');
  });
  it('esContacto → CONFIRMADA sin seña', () => {
    expect(resolverCondiciones({ ...base, esContacto: true }).estado).toBe('CONFIRMADA');
  });
  it('respeta la seña explícita cuando queda ESPERANDO_SENA', () => {
    expect(resolverCondiciones({ ...base, montoSenaPedido: 3000 }).montoSena).toBe(3000);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/reserva.condiciones.test.ts
```

Esperado: FAIL — no se resuelve el módulo.

- [ ] **Step 3: Escribir la función pura**

Crear `backend/src/services/reserva.condiciones.ts`:

```ts
import type { EstadoReserva } from '../db/client.js';

export interface CondicionesArgs {
  esContacto: boolean;
  porStaff: boolean;
  clienteConfiable: boolean;
  precio: number;
  montoSenaPedido?: number;
  senaPorDefecto: number;
  /** Suscripción vigente del cliente al momento de reservar, si la hay. */
  suscripcionId?: string | null;
}

export interface Condiciones {
  estado: EstadoReserva;
  monto: number;
  montoLista: number | null;
  montoSena: number | null;
  suscripcionId: string | null;
}

/**
 * Decisión económica de una reserva, aislada de la DB para poder testear todos los bordes
 * sin levantar un contenedor.
 *
 * Reserva creada por staff (panel/JWT): se considera confirmada — la seña se cobra en caja.
 * El flujo de seña queda solo para el autoservicio (bot / web).
 */
export function resolverCondiciones(a: CondicionesArgs): Condiciones {
  const confianza = a.porStaff || a.esContacto || a.clienteConfiable;
  const estado: EstadoReserva = confianza ? 'CONFIRMADA' : 'ESPERANDO_SENA';
  return {
    estado,
    monto: a.precio,
    montoLista: null,
    montoSena: estado === 'ESPERANDO_SENA' ? (a.montoSenaPedido ?? a.senaPorDefecto) : null,
    suscripcionId: null,
  };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/reserva.condiciones.test.ts
```

Esperado: PASS (5 tests).

- [ ] **Step 5: Usar la función en `reserva.service.crear`**

En `backend/src/services/reserva.service.ts`, agregar el import:

```ts
import { resolverCondiciones } from './reserva.condiciones.js';
```

y reemplazar el bloque de las líneas 76-84 (desde el comentario `// Reserva creada por staff...` hasta el cierre del `montoSena`) por:

```ts
    const cfg = await configService.get();
    const precio = precioEfectivo(cancha, input.fecha, input.horaInicio, cfg);
    const cond = resolverCondiciones({
      esContacto: input.esContacto,
      porStaff: !!opts.porStaff,
      clienteConfiable: !!clientePrevio?.confiable,
      precio,
      montoSenaPedido: input.montoSena,
      senaPorDefecto: await senaService.montoParaCancha(cancha, precio),
    });
    const { estado, montoSena } = cond;
```

Y en la llamada a `reservaRepo.create`, reemplazar `monto: precio,` por:

```ts
          monto: cond.monto,
          montoLista: cond.montoLista,
          suscripcionId: cond.suscripcionId,
```

- [ ] **Step 6: Correr toda la suite (verificar que no cambió el comportamiento)**

```bash
cd backend && npm test
```

Esperado: **todo verde sin haber tocado ningún test existente.** Si algo falla, el refactor cambió comportamiento y hay que corregirlo antes de seguir.

> Nota: `senaService.montoParaCancha` ahora se llama siempre, incluso cuando la reserva queda `CONFIRMADA`. Es una consulta a `Configuracion`, ya cacheada por `configService`, y mantiene la función pura. Si el costo molestara, se puede pasar como thunk — pero no antes de medirlo.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/reserva.condiciones.ts backend/src/services/reserva.service.ts backend/tests/unit/reserva.condiciones.test.ts
git commit -m "refactor(reservas): extraer resolverCondiciones a funcion pura"
```

---

### Task 17: La reserva de un socio nace bonificada

**Files:**
- Modify: `backend/src/services/reserva.condiciones.ts`
- Modify: `backend/src/services/reserva.service.ts`
- Test: `backend/tests/unit/reserva.condiciones.test.ts` (agregar casos)
- Test: `backend/tests/integration/reserva-socio.test.ts`

**Interfaces:**
- Consumes: `suscripcionService.vigenteDe` (Task 5), `resolverCondiciones` (Task 16).
- Produces: `POST /reservas` de un socio devuelve `CONFIRMADA` con `monto: 0`, `montoLista`, `suscripcionId` y sin `Pago`.

- [ ] **Step 1: Escribir los tests unitarios que fallan**

Agregar a `backend/tests/unit/reserva.condiciones.test.ts`:

```ts
describe('resolverCondiciones (con suscripción)', () => {
  const conSocio = { ...base, suscripcionId: 'sus_1' };

  it('socio → CONFIRMADA, monto 0, montoLista con el precio real, sin seña', () => {
    expect(resolverCondiciones(conSocio)).toEqual({
      estado: 'CONFIRMADA', monto: 0, montoLista: 12000, montoSena: null, suscripcionId: 'sus_1',
    });
  });

  it('la suscripción gana sobre el pedido explícito de seña', () => {
    expect(resolverCondiciones({ ...conSocio, montoSenaPedido: 5000 }).montoSena).toBeNull();
  });

  it('socio que además es confiable sigue bonificado', () => {
    expect(resolverCondiciones({ ...conSocio, clienteConfiable: true }).monto).toBe(0);
  });

  it('socio reservando desde el panel sigue bonificado', () => {
    expect(resolverCondiciones({ ...conSocio, porStaff: true }).monto).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/reserva.condiciones.test.ts
```

Esperado: FAIL — `monto` es 12000 y `suscripcionId` es null.

- [ ] **Step 3: Agregar la regla a la función pura**

Reemplazar el cuerpo de `resolverCondiciones` en `backend/src/services/reserva.condiciones.ts`:

```ts
export function resolverCondiciones(a: CondicionesArgs): Condiciones {
  // Socio: la reserva nace saldada. `monto` significa "lo que el cliente debe pagar", así que
  // va en 0; el precio real se conserva en `montoLista` para poder informar cuánto se bonificó.
  // Gana sobre esContacto/confiable: todos llevan a CONFIRMADA, pero solo la suscripción bonifica.
  if (a.suscripcionId) {
    return { estado: 'CONFIRMADA', monto: 0, montoLista: a.precio, montoSena: null, suscripcionId: a.suscripcionId };
  }
  const confianza = a.porStaff || a.esContacto || a.clienteConfiable;
  const estado: EstadoReserva = confianza ? 'CONFIRMADA' : 'ESPERANDO_SENA';
  return {
    estado,
    monto: a.precio,
    montoLista: null,
    montoSena: estado === 'ESPERANDO_SENA' ? (a.montoSenaPedido ?? a.senaPorDefecto) : null,
    suscripcionId: null,
  };
}
```

- [ ] **Step 4: Correr los unitarios para verificar que pasan**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/reserva.condiciones.test.ts
```

Esperado: PASS (9 tests).

- [ ] **Step 5: Escribir el test de integración que falla**

Crear `backend/tests/integration/reserva-socio.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { aFechaUtc, hoyEnTz, sumarUnMes } from '../../src/services/suscripcion.vigencia.js';

let app: any;
let canchaId: string;
const TZ = 'America/Argentina/Buenos_Aires';

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
  await getPrisma().configuracion.create({ data: { id: 'default' } });
});

/** Fecha futura dentro del horario de apertura, para que el slot sea válido. */
function manana(): string {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().slice(0, 10);
}

async function reservar(whatsapp: string) {
  return supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp, nombreCliente: 'Socio', esContacto: false,
    fecha: manana(), horaInicio: '18:00',
  });
}

describe('reserva de un socio', () => {
  it('queda CONFIRMADA, con monto 0, montoLista y sin Pago', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '5491178000001' } });
    const hoy = hoyEnTz(TZ);
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc(hoy), vencimiento: aFechaUtc(sumarUnMes(hoy)) },
    });

    const res = await reservar('5491178000001');
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(Number(res.body.monto)).toBe(0);
    expect(Number(res.body.montoLista)).toBe(12000);
    expect(res.body.suscripcionId).toBe(s.id);
    expect(res.body.montoSena).toBeNull();
    expect(await getPrisma().pago.count()).toBe(0);
  });

  it('un cliente sin suscripcion sigue el flujo normal (sin regresion)', async () => {
    const res = await reservar('5491178000002');
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(res.body.monto)).toBe(12000);
    expect(res.body.suscripcionId).toBeNull();
    expect(res.body.montoLista).toBeNull();
    expect(await getPrisma().pago.count()).toBe(1);
  });

  it('con la suscripcion vencida vuelve al flujo con seña', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Ex socio', whatsapp: '5491178000003' } });
    await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc('2026-01-31') },
    });
    const res = await reservar('5491178000003');
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(res.body.monto)).toBe(12000);
  });

  it('la reserva bonificada queda con saldo 0 en el listado', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '5491178000004' } });
    const hoy = hoyEnTz(TZ);
    await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc(hoy), vencimiento: aFechaUtc(sumarUnMes(hoy)) },
    });
    await reservar('5491178000004');
    const { reservaService } = await import('../../src/services/reserva.service.js');
    const lista = await reservaService.list({ fecha: manana() });
    expect(lista[0].pagado).toBe(0);
    expect(lista[0].saldo).toBe(0);
  });
});
```

- [ ] **Step 6: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/reserva-socio.test.ts
```

Esperado: FAIL — el primer test devuelve `ESPERANDO_SENA` (la suscripción todavía no se consulta).

- [ ] **Step 7: Consultar la suscripción en `crear`**

En `backend/src/services/reserva.service.ts`, agregar el import:

```ts
import { suscripcionService } from './suscripcion.service.js';
```

y, justo después de la línea que obtiene `clientePrevio`, agregar:

```ts
    // Congelado al reservar: vale la vigencia de HOY, no la del día del turno. Un socio vigente
    // puede agendar un turno más allá de su vencimiento y sigue bonificado. Mismo criterio que
    // reprogramar, que tampoco recalcula el monto.
    const suscripcion = clientePrevio ? await suscripcionService.vigenteDe(clientePrevio.id) : null;
```

y pasar el id a `resolverCondiciones`:

```ts
      suscripcionId: suscripcion?.id ?? null,
```

- [ ] **Step 8: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/reserva-socio.test.ts
```

Esperado: PASS (4 tests).

- [ ] **Step 9: Correr toda la suite (regresión)**

```bash
cd backend && npm test
```

Esperado: todo verde.

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/reserva.condiciones.ts backend/src/services/reserva.service.ts backend/tests/unit/reserva.condiciones.test.ts backend/tests/integration/reserva-socio.test.ts
git commit -m "feat(suscripciones): la reserva de un socio nace bonificada"
```

---

### Task 18: Chip "Socio" en el panel

**Files:**
- Modify: `frontend/src/lib/pago.ts`
- Test: `frontend/src/lib/pago.test.ts`

**Interfaces:**
- Consumes: `Reserva.suscripcionId` (Task 11).
- Produces: `estadoPago` acepta `suscripcionId` y devuelve `{ tono: 'pagado', label: 'Socio' }`.

> Sin este cambio, una reserva bonificada muestra **"Debe $0"**: `estadoPago` evalúa `saldo <= 0 && monto > 0`, y con `monto = 0` cae al caso final.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/lib/pago.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { estadoPago } from './pago';

describe('estadoPago', () => {
  it('reserva de socio → chip "Socio"', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 0, pagado: 0, saldo: 0, suscripcionId: 'sus_1' }))
      .toEqual({ tono: 'pagado', label: 'Socio' });
  });

  it('reserva de socio NO muestra "Debe $0"', () => {
    const r = estadoPago({ estado: 'CONFIRMADA', monto: 0, pagado: 0, saldo: 0, suscripcionId: 'sus_1' });
    expect(r.label).not.toContain('Debe');
  });

  it('esperando seña sigue igual', () => {
    expect(estadoPago({ estado: 'ESPERANDO_SENA', monto: 12000, pagado: 0, saldo: 12000 }))
      .toEqual({ tono: 'espera', label: 'Espera seña' });
  });

  it('pagada por completo sigue igual', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 12000, pagado: 12000, saldo: 0 }))
      .toEqual({ tono: 'pagado', label: 'Pagado' });
  });

  it('pago parcial sigue igual', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 12000, pagado: 5000, saldo: 7000 }).tono).toBe('parcial');
  });

  it('sin pagar sigue igual', () => {
    expect(estadoPago({ estado: 'CONFIRMADA', monto: 12000, pagado: 0, saldo: 12000 }).tono).toBe('debe');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd frontend && npx vitest run src/lib/pago.test.ts
```

Esperado: FAIL — devuelve `{ tono: 'debe', label: 'Debe $0' }`.

- [ ] **Step 3: Agregar el caso socio**

En `frontend/src/lib/pago.ts`, reemplazar la firma y agregar el primer caso:

```ts
/** Lógica pura del chip de pago de un turno. */
export function estadoPago(r: { estado: EstadoReserva; monto: number; pagado: number; saldo: number; suscripcionId?: string | null }): PagoVista {
  // Turno de socio: nace saldado con monto 0. Sin este caso caería en "Debe $0".
  if (r.suscripcionId) return { tono: 'pagado', label: 'Socio' };
  if (r.estado === 'ESPERANDO_SENA') return { tono: 'espera', label: 'Espera seña' };
  if (r.saldo <= 0 && r.monto > 0) return { tono: 'pagado', label: 'Pagado' };
  if (r.pagado > 0) return { tono: 'parcial', label: 'Debe ' + money(r.saldo) };
  return { tono: 'debe', label: 'Debe ' + money(r.saldo) };
}
```

- [ ] **Step 4: Actualizar el tipo del `PagoChip`**

En `frontend/src/components/hoy/pago-chip.tsx`, ampliar el `Pick`:

```tsx
export function PagoChip({ reserva, className }: { reserva: Pick<Reserva, 'estado' | 'monto' | 'pagado' | 'saldo' | 'suscripcionId'>; className?: string }) {
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd frontend && npx vitest run src/lib/pago.test.ts
```

Esperado: PASS (6 tests).

- [ ] **Step 6: Verificar build**

```bash
cd frontend && pnpm lint && pnpm build && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/pago.ts frontend/src/lib/pago.test.ts frontend/src/components/hoy/pago-chip.tsx
git commit -m "feat(suscripciones): chip Socio y fix del Debe \$0"
```

---

# Fase 5 · Web pública

### Task 19: La web no manda al socio a Mercado Pago

**Files:**
- Modify: `reservas/src/lib/types.ts`
- Modify: `reservas/src/components/pantalla-reserva.tsx`

**Interfaces:**
- Consumes: `POST /reservas` devolviendo `suscripcionId` (Task 17).
- Produces: `ReservaCreada` con `suscripcionId?: string | null`; la pantalla saltea el checkout.

- [ ] **Step 1: Ampliar el tipo**

En `reservas/src/lib/types.ts`, reemplazar la línea de `ReservaCreada`:

```ts
export interface ReservaCreada { id: string; montoSena: number | null; suscripcionId?: string | null }
```

- [ ] **Step 2: Agregar el flag de socio al estado de éxito**

En `reservas/src/components/pantalla-reserva.tsx:31`, reemplazar:

```tsx
  const [ok, setOk] = useState<{ senia: number | null; contacto?: string } | null>(null);
```

por:

```tsx
  const [ok, setOk] = useState<{ senia: number | null; contacto?: string; socio?: boolean } | null>(null);
```

- [ ] **Step 3: Saltear el checkout para socios**

En `confirmar()` (línea 58), justo **después** del `if (!r.ok) {...}` y **antes** de la línea que calcula `senia`, insertar:

```tsx
      // Socio: la reserva ya vuelve CONFIRMADA y bonificada. No hay seña que cobrar,
      // así que no se genera preferencia de Mercado Pago.
      if (r.data.suscripcionId) { setOk({ senia: null, socio: true }); recargar(); return; }
```

- [ ] **Step 4: Mensaje propio en el modal de éxito**

En el modal (línea 187), reemplazar el `<h3>` y el bloque de mensajes por:

```tsx
                <h3 className="text-xl font-bold">{ok.socio ? '¡Turno confirmado!' : '¡Reserva registrada!'}</h3>
                <p className="text-neutral-400">{sel.canchaNombre} · {fechaLarga(fecha)} · {sel.hora}</p>
                {ok.contacto
                  ? <p className="text-amber-400">{ok.contacto}</p>
                  : ok.socio
                  ? <p>Quedó <b>bonificado</b> por tu suscripción. ¡Te esperamos!</p>
                  : ok.senia != null && ok.senia > 0
                  ? <p>Para confirmarla, aboná la seña de <b>{money(ok.senia)}</b>.</p>
                  : <p>Te contactamos para confirmarla.</p>}
```

- [ ] **Step 5: Verificar build**

```bash
cd reservas && pnpm lint && pnpm build
```

Esperado: compila.

- [ ] **Step 6: QA manual**

Con el backend corriendo y un socio vigente cargado, reservar desde la web con el WhatsApp del socio: tiene que quedar confirmado sin pasar por Mercado Pago. Repetir con un número sin suscripción para confirmar que el checkout sigue apareciendo.

- [ ] **Step 7: Commit**

```bash
git add reservas/src/lib/types.ts reservas/src/components/pantalla-reserva.tsx
git commit -m "feat(suscripciones): la web no cobra seña a los socios"
```

---

# Fase 6 · Validaciones y bordes

### Task 20: No se puede eliminar un cliente con suscripciones

**Files:**
- Modify: `backend/src/repositories/cliente.repo.ts`
- Modify: `backend/src/services/cliente.service.ts:32-38`
- Test: `backend/tests/integration/cliente-suscripcion.test.ts`

**Interfaces:**
- Consumes: modelo `Suscripcion` (Task 1).
- Produces: `DELETE /clientes/:id` devuelve 409 si el cliente tiene suscripciones.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/cliente-suscripcion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { aFechaUtc } from '../../src/services/suscripcion.vigencia.js';

let app: any;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });

describe('DELETE /clientes/:id con suscripciones', () => {
  it('rechaza el borrado (409)', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000070' } });
    await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    const res = await supertest(app).delete(`/clientes/${c.id}`).set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(409);
    expect(await getPrisma().cliente.count()).toBe(1);
  });

  it('un cliente sin reservas ni suscripciones se puede borrar', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Comun', whatsapp: '+5491100000071' } });
    const res = await supertest(app).delete(`/clientes/${c.id}`).set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    expect(await getPrisma().cliente.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/cliente-suscripcion.test.ts
```

Esperado: FAIL — el primer test devuelve 200 o un error de FK.

- [ ] **Step 3: Incluir las suscripciones al buscar el cliente**

En `backend/src/repositories/cliente.repo.ts`, en `findById`, agregar `suscripciones: true` al `include` que ya trae `reservas`.

- [ ] **Step 4: Agregar el guard al service**

En `backend/src/services/cliente.service.ts`, dentro de `eliminar`, después del chequeo de reservas:

```ts
    if (c.suscripciones.length > 0) throw Conflict('No se puede eliminar: el cliente tiene suscripciones');
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/cliente-suscripcion.test.ts
```

Esperado: PASS (2 tests).

- [ ] **Step 6: Regresión de clientes**

```bash
cd backend && npx vitest run tests/integration/clientes-confianza.test.ts tests/integration/cliente.routes.test.ts
```

Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/repositories/cliente.repo.ts backend/src/services/cliente.service.ts backend/tests/integration/cliente-suscripcion.test.ts
git commit -m "feat(suscripciones): no eliminar clientes con suscripciones"
```

---

# Fase 7 · Testing de bordes

### Task 21: Suite de casos borde

**Files:**
- Create: `backend/tests/integration/suscripcion-bordes.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: cobertura de los bordes de la sección 4 del spec que no quedaron cubiertos por tarea.

- [ ] **Step 1: Escribir la suite**

Crear `backend/tests/integration/suscripcion-bordes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { suscripcionService } from '../../src/services/suscripcion.service.js';
import { aFechaUtc, hoyEnTz, sumarUnMes } from '../../src/services/suscripcion.vigencia.js';

let app: any;
let canchaId: string;
const TZ = 'America/Argentina/Buenos_Aires';

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
  await getPrisma().configuracion.create({ data: { id: 'default' } });
});

async function socioVigenteHasta(vencimiento: string, whatsapp: string) {
  const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp } });
  const s = await getPrisma().suscripcion.create({
    data: { clienteId: c.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc(vencimiento) },
  });
  return { cliente: c, suscripcion: s };
}

function enDias(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

async function reservar(whatsapp: string, fecha: string) {
  return supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp, nombreCliente: 'Socio', esContacto: false, fecha, horaInicio: '18:00',
  });
}

describe('bordes de suscripcion', () => {
  it('socio cuya suscripcion vence HOY: el turno de mañana queda bonificado (vencimiento inclusive)', async () => {
    const hoy = hoyEnTz(TZ);
    await socioVigenteHasta(hoy, '5491178100001');
    const res = await reservar('5491178100001', enDias(1));
    expect(res.status).toBe(201);
    expect(res.body.suscripcionId).not.toBeNull();
    expect(Number(res.body.monto)).toBe(0);
  });

  it('turno para DESPUES del vencimiento queda bonificado igual (congelado al reservar)', async () => {
    const vence = enDias(2);
    await socioVigenteHasta(vence, '5491178100002');
    const res = await reservar('5491178100002', enDias(10)); // el turno cae después del vencimiento
    expect(res.status).toBe(201);
    // La vigencia se evalúa contra HOY, no contra la fecha del turno: el socio está vigente
    // al momento de reservar, así que el turno queda bonificado para siempre.
    expect(res.body.suscripcionId).not.toBeNull();
    expect(Number(res.body.monto)).toBe(0);
  });

  it('turno DENTRO del periodo queda bonificado', async () => {
    const vence = enDias(10);
    await socioVigenteHasta(vence, '5491178100003');
    const res = await reservar('5491178100003', enDias(3));
    expect(res.body.suscripcionId).not.toBeNull();
    expect(Number(res.body.monto)).toBe(0);
  });

  it('reprogramar un turno bonificado NO recalcula el monto', async () => {
    const vence = enDias(10);
    await socioVigenteHasta(vence, '5491178100004');
    const creada = await reservar('5491178100004', enDias(3));
    const { reservaService } = await import('../../src/services/reserva.service.js');
    await reservaService.reprogramar(creada.body.id, { adminId: 'a1' }, { fecha: enDias(4), horaInicio: '19:00' });
    const r = await getPrisma().reserva.findUnique({ where: { id: creada.body.id } });
    expect(Number(r!.monto)).toBe(0);
    expect(r!.suscripcionId).toBe(creada.body.suscripcionId);
  });

  it('cancelar un turno bonificado no deja cobros colgados', async () => {
    const vence = enDias(10);
    await socioVigenteHasta(vence, '5491178100005');
    const creada = await reservar('5491178100005', enDias(3));
    const { reservaService } = await import('../../src/services/reserva.service.js');
    await reservaService.cancelar(creada.body.id, { adminId: 'a1' });
    const r = await getPrisma().reserva.findUnique({ where: { id: creada.body.id } });
    expect(r!.estado).toBe('CANCELADA');
    expect(await getPrisma().cobro.count({ where: { reservaId: creada.body.id } })).toBe(0);
  });

  it('dar de alta una suscripcion nueva tras cancelar la anterior no choca por solapamiento', async () => {
    const hoy = hoyEnTz(TZ);
    const { cliente, suscripcion } = await socioVigenteHasta(sumarUnMes(hoy), '5491178100006');
    await suscripcionService.cancelar(suscripcion.id);
    const nueva = await suscripcionService.crear(
      { clienteId: cliente.id, inicio: hoy, vencimiento: sumarUnMes(hoy) },
      null,
    );
    expect(nueva.id).not.toBe(suscripcion.id);
  });

  it('el socio ocupa la cancha igual: un tercero no puede reservar el mismo slot', async () => {
    const vence = enDias(10);
    await socioVigenteHasta(vence, '5491178100007');
    const fecha = enDias(3);
    const primera = await reservar('5491178100007', fecha);
    expect(primera.status).toBe(201);
    const segunda = await reservar('5491178100008', fecha);
    expect(segunda.status).toBe(409);
  });
});
```

> **El segundo test es el que blinda la decisión 5 del spec** ("congelado al reservar"). Depende de que la Task 17 llame a `vigenteDe(clientePrevio.id)` **sin** pasarle `input.fecha`. Si alguien "optimiza" eso pasando la fecha del turno, este test se pone rojo — que es exactamente para lo que está.

- [ ] **Step 2: Correr la suite**

```bash
cd backend && npx vitest run tests/integration/suscripcion-bordes.test.ts
```

Esperado: PASS (7 tests).

- [ ] **Step 3: Correr toda la suite del backend**

```bash
cd backend && npm test && npm run typecheck
```

Esperado: todo verde.

- [ ] **Step 4: Correr todo el frontend**

```bash
cd frontend && pnpm lint && pnpm test && pnpm build
cd ../reservas && pnpm lint && pnpm build
```

Esperado: todo verde.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/integration/suscripcion-bordes.test.ts
git commit -m "test(suscripciones): suite de casos borde"
```

---

## Desvíos respecto del spec

Uno solo, detectado al revisar el plan contra el diseño:

- **`GET /suscripciones/:id` no se implementa.** El spec lo listaba para "detalle + historial de períodos del cliente", pero `GET /suscripciones` ya devuelve **todos** los períodos (incluidos los vencidos y cancelados), así que el panel puede agrupar por cliente del lado del cliente sin una segunda llamada. Construirlo ahora sería un endpoint muerto. `suscripcionRepo.listByCliente` queda escrito en la Task 5 porque es una línea y es el gancho natural si más adelante se quiere una vista de detalle por socio.

## Checklist final antes de mergear

- [ ] `cd backend && npm test` verde (Docker corriendo)
- [ ] `cd backend && npm run typecheck` sin errores
- [ ] `cd frontend && pnpm lint && pnpm test && pnpm build` verde
- [ ] `cd reservas && pnpm lint && pnpm build` verde
- [ ] QA manual: alta de socio con cuota → aparece en `/caja` como concepto CUOTA
- [ ] QA manual: reserva de socio desde el panel → chip "Socio", sin deuda
- [ ] QA manual: reserva de socio desde la web → confirmada sin pasar por Mercado Pago
- [ ] QA manual: reserva de un no socio → sin cambios respecto de hoy
- [ ] Deploy: `migrate deploy` corre solo al arrancar el contenedor; verificar en los logs que las 3 migraciones aplican en orden

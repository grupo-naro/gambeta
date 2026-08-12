# Método de pago de la seña — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cliente elija entre Mercado Pago y transferencia al reservar, y que con transferencia vea los datos bancarios y el WhatsApp del comprobante, todo salido de la configuración del panel.

**Architecture:** La reserva guarda con qué método se creó (`Reserva.metodoSena`, nullable). `GET /config/sena` suma los datos que al sitio le faltan para armar la pantalla de transferencia. El modal del sitio público pasa a tener dos pasos: datos, y elección de método — la reserva se crea recién al elegir.

**Tech Stack:** Express 5, Prisma 7 (cliente en `src/generated/prisma`, singleton `src/db/prisma.ts`), zod, vitest + Testcontainers. Sitio público en Next.js 16 (`reservas/`, pnpm). Panel en Next.js 16 (`frontend/`, pnpm).

**Diseño de referencia:** `docs/superpowers/specs/2026-08-12-metodo-pago-sena-design.md`

## Global Constraints

- **Código, comentarios y vocabulario en español.** No traducir `cancha`, `seña`, `turno fijo`, `bloqueo`, `cobro`.
- **Nunca importar de `@prisma/client`.** Tipos desde `src/db/client.ts`; runtime desde `src/db/prisma.ts`.
- Errores esperados = factories de `src/utils/errors.ts`. Nunca `Error` crudo, incluidos errores de Prisma sin mapear.
- Capas en una sola dirección: `routes/ → services/ → repositories/ → db/prisma.ts`. Las rutas son finas.
- **Migraciones a mano, NUNCA `prisma migrate dev`**: la base de dev tiene una deriva preexistente (`Cobro.suscripcionId`) que hace que Prisma pida un reset destructivo. No aceptarlo. Escribir el `.sql`, aplicarlo, y `npx prisma migrate resolve --applied <nombre>` + `npx prisma generate`. En Prisma 7.8 los flags de `migrate diff` son `--from-config-datasource` y `--to-schema`.
- El timestamp de la migración nueva tiene que ser **mayor que `20260811140000`**.
- Backend usa **npm**; `frontend/` y `reservas/` usan **pnpm**.
- Tests de integración necesitan Docker. **Correr archivos puntuales, nunca `npm test` entero.**
- `tsconfig.json` del backend excluye `tests/`, así que **`npm run typecheck` no valida los archivos de test**. Un cambio de firma no aparece ahí: hay que correr los tests.
- `reservas/` **no tiene setup de tests**. Sus tasks se verifican a mano, con los pasos que cada una detalla.
- **El sitio público nunca recibe la `SERVICE_API_KEY` en el browser**: `reservas/src/lib/api.ts` es `server-only`. Nada de `NEXT_PUBLIC_`.
- **No pushear `main`**: tiene el backend del buffet de dos mostradores sin sus pantallas, y desplegarlo deja el mostrador caído. No es parte de este plan, pero no lo empeoremos.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/prisma/schema.prisma` (modificar) | Enum `MetodoSena` y `Reserva.metodoSena`. |
| `backend/prisma/migrations/20260812120000_reserva_metodo_sena/migration.sql` (crear) | El enum y la columna, aditivo. |
| `backend/src/repositories/reserva.repo.ts` (modificar) | `CreateReservaData` gana `metodoSena`. |
| `backend/src/services/reserva.service.ts` (modificar) | `CreateReservaInput` gana `metodoSena`; `crear` lo descarta si la reserva no queda en `ESPERANDO_SENA`. |
| `backend/src/validators/reserva.schema.ts` (modificar) | `metodoSena` opcional en `createReservaSchema`. |
| `backend/src/services/sena.service.ts` (modificar) | `datosPago()` suma `adminWhatsapp`, `transferenciaDisponible` y `senaTimeoutMinutos`. |
| `frontend/src/lib/metodo-sena.ts` (crear) | Etiqueta legible del método, con su test. |
| `frontend/src/lib/types.ts` (modificar) | `Reserva.metodoSena`. |
| `frontend/src/components/reservas/accion-reserva-sheet.tsx` (modificar) | Muestra el método en la reserva que espera seña. |
| `reservas/src/lib/types.ts` (modificar) | `MetodoSena`, `MetodosPago`, `metodoSena` en el input de crear. |
| `reservas/src/lib/actions.ts` (modificar) | `getMetodosPago()` reemplaza a `getCobrosOnline()`; `crearReserva` manda el método. |
| `reservas/src/app/reservar/page.tsx` (modificar) | Usa la compuerta nueva y le pasa los métodos al modal. |
| `reservas/src/components/datos-transferencia.tsx` (crear) | Pantalla de datos bancarios + comprobante. Presentacional. |
| `reservas/src/components/pantalla-reserva.tsx` (modificar) | El modal en dos pasos. |

---

### Task 1: `Reserva.metodoSena` — schema, migración y persistencia

Es la base: sin la columna, el sitio no tiene dónde guardar la elección.

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260812120000_reserva_metodo_sena/migration.sql`
- Modify: `backend/src/repositories/reserva.repo.ts`
- Modify: `backend/src/services/reserva.service.ts`
- Modify: `backend/src/validators/reserva.schema.ts`
- Test: `backend/tests/integration/reserva-metodo-sena.test.ts`

**Interfaces:**
- Produces: enum `MetodoSena` = `MERCADO_PAGO | TRANSFERENCIA`.
- Produces: `Reserva.metodoSena: MetodoSena | null`, devuelto por `GET /reservas/:id` y por `POST /reservas`.
- Produces: `createReservaSchema` acepta `metodoSena` opcional en el body.

- [ ] **Step 1: Escribir el test**

Crear `backend/tests/integration/reserva-metodo-sena.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

let canchaId: string;
beforeEach(async () => {
  await resetTables();
  await getPrisma().configuracion.create({ data: { id: 'default' } });
  canchaId = (await getPrisma().cancha.create({
    data: { nombre: 'Cancha 1', tipo: 'futbol', precioHora: 20000 },
  })).id;
});

const svc = (r: any) => r.set('x-api-key', process.env.SERVICE_API_KEY!);

/** Mañana a las 18:00: siempre futuro y dentro del horario de apertura por defecto. */
function manana(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
}

const crear = (body: Record<string, unknown>) =>
  svc(supertest(app).post('/reservas')).send({
    canchaId, whatsapp: '1136620274', nombreCliente: 'Ana',
    fecha: manana(), horaInicio: '18:00', esContacto: false, ...body,
  });

describe('método de pago de la seña', () => {
  it('guarda TRANSFERENCIA y lo devuelve', async () => {
    const res = await crear({ metodoSena: 'TRANSFERENCIA' });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(res.body.metodoSena).toBe('TRANSFERENCIA');
  });

  it('guarda MERCADO_PAGO y lo devuelve', async () => {
    const res = await crear({ metodoSena: 'MERCADO_PAGO' });
    expect(res.body.metodoSena).toBe('MERCADO_PAGO');
  });

  it('sin método queda en null: los consumidores viejos no se rompen', async () => {
    const res = await crear({});
    expect(res.status).toBe(201);
    expect(res.body.metodoSena).toBeNull();
  });

  it('un método inventado se rechaza', async () => {
    const res = await crear({ metodoSena: 'BITCOIN' });
    expect(res.status).toBe(400);
  });

  it('si la reserva NO queda esperando seña, el método se descarta', async () => {
    // Un cliente confiable nace CONFIRMADA: no hay seña que pagar, así que guardar
    // "iba a pagar por transferencia" sería registrar una intención que nunca se ejecuta.
    await getPrisma().cliente.create({
      data: { whatsapp: '5491136620274', nombre: 'Ana', esContacto: false, confiable: true },
    });
    const res = await crear({ metodoSena: 'TRANSFERENCIA' });
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(res.body.metodoSena).toBeNull();
  });
});
```

**Ojo con el whatsapp:** el validador lo canoniza (`whatsappCanonico`), por eso el cliente
confiable del último caso se crea con `5491136620274` mientras el request manda `1136620274`.
Si al correr el test el cliente no matchea, imprimí el `whatsapp` que quedó en la base y ajustá
el literal — **no** cambies la aserción para que pase.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/reserva-metodo-sena.test.ts`
Expected: FAIL — `metodoSena` no existe ni en el schema ni en el validador; los casos devuelven `undefined`.

- [ ] **Step 3: El schema**

En `backend/prisma/schema.prisma`, antes de `model Reserva`:

```prisma
/// Cómo dijo el cliente que iba a pagar la seña. Solo lo elige la web pública; las reservas
/// que carga el staff y las de socio no tienen método.
enum MetodoSena {
  MERCADO_PAGO
  TRANSFERENCIA
}
```

Y dentro de `model Reserva`, después de `montoSena`:

```prisma
  /// Nullable y sin default a propósito: las reservas anteriores a este campo, las que carga el
  /// panel y las de socio no eligieron nada, y `null` es la lectura honesta. Un default
  /// fabricaría un método que nadie eligió.
  metodoSena    MetodoSena?
```

- [ ] **Step 4: La migración a mano**

**No uses `prisma migrate dev`** (ver Global Constraints).

Crear `backend/prisma/migrations/20260812120000_reserva_metodo_sena/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "MetodoSena" AS ENUM ('MERCADO_PAGO', 'TRANSFERENCIA');

-- AlterTable
-- Nullable y sin default: no hay nada que rellenar. Las reservas existentes no eligieron método.
ALTER TABLE "Reserva" ADD COLUMN "metodoSena" "MetodoSena";
```

Después:

```bash
npx prisma migrate resolve --applied 20260812120000_reserva_metodo_sena
npx prisma generate
```

La base de dev local está en deriva y le faltan tablas, así que **puede que no se pueda aplicar
ahí, y está bien**: los tests corren contra un contenedor limpio que aplica todas las migraciones
desde cero, y ése es el verificador real.

- [ ] **Step 5: El tipo del repositorio**

En `backend/src/repositories/reserva.repo.ts`, dentro de `CreateReservaData` (después de `montoSena`):

```ts
  metodoSena?: MetodoSena | null;
```

Importar el tipo desde `src/db/client.ts` (**nunca** desde `@prisma/client`), junto a `EstadoReserva`, que ya se importa ahí.

- [ ] **Step 6: El input y la regla del servicio**

En `backend/src/services/reserva.service.ts`, dentro de `CreateReservaInput` (después de `montoSena?: number;`):

```ts
  metodoSena?: 'MERCADO_PAGO' | 'TRANSFERENCIA';
```

Y en la llamada a `reservaRepo.create` dentro de `crear`, agregar como último campo del objeto de datos (después de `notas: input.notas ?? null,`):

```ts
          // El método solo tiene sentido mientras haya una seña pendiente. Si la reserva sale
          // CONFIRMADA (socio, staff, cliente confiable), guardarlo registraría una intención
          // que nunca se va a ejecutar. La condición es el ESTADO, no el monto.
          metodoSena: estado === 'ESPERANDO_SENA' ? (input.metodoSena ?? null) : null,
```

**No hace falta tocar `reserva.routes.ts`**: la ruta ya pasa el body validado entero a
`reservaService.crear(body, ...)`.

- [ ] **Step 7: El validador**

En `backend/src/validators/reserva.schema.ts`, dentro de `createReservaSchema.body`, después de `montoSena`:

```ts
    metodoSena: z.enum(['MERCADO_PAGO', 'TRANSFERENCIA']).optional(),
```

- [ ] **Step 8: Correr y verificar**

Run: `npx vitest run tests/integration/reserva-metodo-sena.test.ts && npm run typecheck`
Expected: PASS los 5 casos, typecheck limpio.

- [ ] **Step 9: Regresión de reservas**

Run: `npx vitest run tests/integration/reserva.routes.test.ts tests/integration/reserva.repo.test.ts tests/integration/sena.test.ts tests/integration/reserva-socio.test.ts tests/integration/clientes-confianza.test.ts`

Tienen que seguir pasando sin tocarlos: el campo es opcional y nullable. Si alguno rompe, es un
bug tuyo, no un test que haya que actualizar.

- [ ] **Step 10: Commit**

```bash
git add backend/prisma backend/src backend/tests
git commit -m "feat(reservas): la reserva guarda con que metodo se va a pagar la sena"
```

---

### Task 2: `/config/sena` con lo que el sitio necesita

**Files:**
- Modify: `backend/src/services/sena.service.ts`
- Test: `backend/tests/integration/config-sena-datos-pago.test.ts`

**Interfaces:**
- Consumes: nada de la Task 1.
- Produces: `DatosPago` gana `adminWhatsapp: string`, `transferenciaDisponible: boolean`, `senaTimeoutMinutos: number`. Los campos existentes (`modo`, `porcentaje`, `cbu`, `alias`, `titular`, `cobrosOnline`) **no cambian de nombre ni de significado**.

- [ ] **Step 1: Escribir el test**

Crear `backend/tests/integration/config-sena-datos-pago.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const pedir = () => supertest(app).get('/config/sena').set('x-api-key', process.env.SERVICE_API_KEY!);

describe('GET /config/sena', () => {
  it('devuelve el whatsapp del comprobante y el plazo de la seña', async () => {
    await getPrisma().configuracion.create({
      data: { id: 'default', adminWhatsapp: '5491136620274', alias: 'complejo.mp', cbu: '0000003100010000000001', titular: 'Complejo SA' },
    });
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.body.adminWhatsapp).toBe('5491136620274');
    expect(res.body.senaTimeoutMinutos).toBe(Number(process.env.SENA_TIMEOUT_MINUTOS ?? 30));
  });

  it('con alias o CBU cargado, la transferencia está disponible', async () => {
    await getPrisma().configuracion.create({ data: { id: 'default', alias: 'complejo.mp' } });
    expect((await pedir()).body.transferenciaDisponible).toBe(true);
  });

  it('solo con CBU también alcanza', async () => {
    await getPrisma().configuracion.create({ data: { id: 'default', cbu: '0000003100010000000001' } });
    expect((await pedir()).body.transferenciaDisponible).toBe(true);
  });

  it('sin alias ni CBU, no se puede transferir', async () => {
    await getPrisma().configuracion.create({ data: { id: 'default' } });
    expect((await pedir()).body.transferenciaDisponible).toBe(false);
  });

  it('espacios en blanco no cuentan como datos cargados', async () => {
    // Si contaran, el sitio ofrecería transferencia y mostraría un alias vacío.
    await getPrisma().configuracion.create({ data: { id: 'default', alias: '   ', cbu: '  ' } });
    expect((await pedir()).body.transferenciaDisponible).toBe(false);
  });

  it('no se rompe lo que ya devolvía', async () => {
    await getPrisma().configuracion.create({ data: { id: 'default', alias: 'complejo.mp', titular: 'Complejo SA' } });
    const res = await pedir();
    expect(res.body.alias).toBe('complejo.mp');
    expect(res.body.titular).toBe('Complejo SA');
    expect(res.body).toHaveProperty('cobrosOnline');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/config-sena-datos-pago.test.ts`
Expected: FAIL — `adminWhatsapp`, `transferenciaDisponible` y `senaTimeoutMinutos` son `undefined`.

- [ ] **Step 3: Implementar**

Reemplazar `backend/src/services/sena.service.ts` por:

```ts
import { configService } from './config.service.js';
import { mercadoPagoOauthService } from './mercadoPagoOauth.service.js';
import { getEnv } from '../config/env.js';

export interface DatosPago {
  modo: 'fijo';
  porcentaje: number;
  cbu: string;
  alias: string;
  titular: string;
  cobrosOnline: boolean;
  /** El número al que el cliente manda el comprobante de la transferencia. */
  adminWhatsapp: string;
  /** Si el complejo cargó datos bancarios. Sin esto, ofrecer transferencia mostraría un alias vacío. */
  transferenciaDisponible: boolean;
  /** Cuánto aguanta la reserva sin pagar antes de que el job libere el horario. */
  senaTimeoutMinutos: number;
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
      modo: 'fijo', porcentaje: c.senaPorcentaje, cbu: c.cbu, alias: c.alias, titular: c.titular,
      // La web pública lo usa para decidir si ofrece Mercado Pago. Sin cuenta vinculada no hay
      // checkout, pero sí puede haber transferencia: ya no apaga el sitio por sí solo.
      cobrosOnline: await mercadoPagoOauthService.cobrosOnlineActivos(),
      adminWhatsapp: c.adminWhatsapp,
      // La regla vive acá y no en el sitio: es la misma pregunta que se hace el panel al mostrar
      // los datos, y duplicarla garantiza que se desincronicen.
      transferenciaDisponible: c.cbu.trim() !== '' || c.alias.trim() !== '',
      senaTimeoutMinutos: getEnv().SENA_TIMEOUT_MINUTOS,
    };
  },
};
```

- [ ] **Step 4: Correr y verificar**

Run: `npx vitest run tests/integration/config-sena-datos-pago.test.ts && npm run typecheck`
Expected: PASS los 6 casos.

- [ ] **Step 5: Regresión de config y seña**

Run: `npx vitest run tests/integration/config.test.ts tests/integration/config-cuenta2.test.ts tests/integration/sena.test.ts tests/integration/cancha-sena.test.ts`

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(config): /config/sena expone el whatsapp del comprobante y si se puede transferir"
```

---

### Task 3: El panel muestra el método

Sin esto, en el panel una reserva esperando transferencia y una que abandonó el checkout se ven idénticas.

**Files:**
- Create: `frontend/src/lib/metodo-sena.ts`
- Create: `frontend/src/lib/metodo-sena.test.ts`
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/components/reservas/accion-reserva-sheet.tsx`

**Interfaces:**
- Consumes: `Reserva.metodoSena` de la Task 1.
- Produces: `etiquetaMetodoSena(metodo: MetodoSena | null | undefined): string | null`.

- [ ] **Step 1: Escribir el test**

Crear `frontend/src/lib/metodo-sena.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { etiquetaMetodoSena } from './metodo-sena';

describe('etiquetaMetodoSena', () => {
  it('traduce los dos métodos a algo legible', () => {
    expect(etiquetaMetodoSena('MERCADO_PAGO')).toBe('Mercado Pago');
    expect(etiquetaMetodoSena('TRANSFERENCIA')).toBe('Transferencia');
  });

  it('sin método no inventa una etiqueta', () => {
    // Las reservas del panel y las viejas no eligieron nada: mostrar "Mercado Pago"
    // por defecto sería decirle al staff que espere un pago que nadie prometió.
    expect(etiquetaMetodoSena(null)).toBeNull();
    expect(etiquetaMetodoSena(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run (desde `frontend/`): `npx vitest run src/lib/metodo-sena.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar el helper**

Crear `frontend/src/lib/metodo-sena.ts`:

```ts
import type { MetodoSena } from './types';

const ETIQUETAS: Record<MetodoSena, string> = {
  MERCADO_PAGO: 'Mercado Pago',
  TRANSFERENCIA: 'Transferencia',
};

/**
 * Cómo dijo el cliente que iba a pagar la seña, para mostrar en el panel.
 *
 * Devuelve `null` cuando no hay método: las reservas que carga el staff y las anteriores a
 * este campo no eligieron nada, y poner una etiqueta por defecto le haría creer al staff
 * que va a llegar un pago que nadie prometió.
 */
export function etiquetaMetodoSena(metodo: MetodoSena | null | undefined): string | null {
  return metodo ? ETIQUETAS[metodo] : null;
}
```

- [ ] **Step 4: El tipo**

En `frontend/src/lib/types.ts`, antes de `export interface Reserva`:

```ts
export type MetodoSena = 'MERCADO_PAGO' | 'TRANSFERENCIA';
```

Y dentro de `interface Reserva`, después de `montoSena: number | null;`:

```ts
  metodoSena?: MetodoSena | null;
```

Opcional además de nullable a propósito: `reservas/` y el panel se deployan por separado del
backend, así que puede haber skew de versiones y el campo puede no venir.

- [ ] **Step 5: Correr el test**

Run (desde `frontend/`): `npx vitest run src/lib/metodo-sena.test.ts`
Expected: PASS los 2 casos.

- [ ] **Step 6: Mostrarlo en el sheet**

En `frontend/src/components/reservas/accion-reserva-sheet.tsx`, importar el helper:

```tsx
import { etiquetaMetodoSena } from '@/lib/metodo-sena';
```

En el bloque que se renderiza cuando `esEspera` es true (el que tiene el botón "Aprobar seña",
alrededor de la línea 96), agregar **arriba del botón**:

```tsx
{etiquetaMetodoSena(reserva.metodoSena) && (
  <p className="mb-2 text-sm text-muted-foreground">
    El cliente eligió pagar por <b>{etiquetaMetodoSena(reserva.metodoSena)}</b>.
    {reserva.metodoSena === 'TRANSFERENCIA' && ' Esperá el comprobante por WhatsApp.'}
  </p>
)}
```

Si las clases de Tailwind del archivo no usan `text-muted-foreground`, usá la que ese archivo ya
use para texto secundario — seguí el estilo del componente, no el de este plan.

- [ ] **Step 7: Verificar**

Run (desde `frontend/`): `npx vitest run src/lib/metodo-sena.test.ts && pnpm lint && pnpm build`
Expected: test PASS, lint y build limpios.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "feat(panel): mostrar con que metodo va a pagar la sena el cliente"
```

---

### Task 4: El sitio deja de depender de Mercado Pago para vender

Hoy `getCobrosOnline()` apaga el sitio entero si Mercado Pago no está. Con transferencia disponible eso deja de tener sentido.

**Files:**
- Modify: `reservas/src/lib/types.ts`
- Modify: `reservas/src/lib/actions.ts`
- Modify: `reservas/src/app/reservar/page.tsx`

**Interfaces:**
- Consumes: los campos nuevos de `/config/sena` (Task 2).
- Produces: `MetodosPago` = `{ mercadoPago: boolean; transferencia: boolean; cbu: string; alias: string; titular: string; adminWhatsapp: string; senaTimeoutMinutos: number }`.
- Produces: `getMetodosPago(): Promise<MetodosPago>` — **reemplaza** a `getCobrosOnline()`.
- Produces: `crearReserva` acepta `metodoSena` en su input.

- [ ] **Step 1: Los tipos**

En `reservas/src/lib/types.ts`, agregar:

```ts
export type MetodoSena = 'MERCADO_PAGO' | 'TRANSFERENCIA';

/** Qué le podemos ofrecer al cliente y con qué datos, resuelto en el server. */
export interface MetodosPago {
  mercadoPago: boolean;
  transferencia: boolean;
  cbu: string;
  alias: string;
  titular: string;
  adminWhatsapp: string;
  senaTimeoutMinutos: number;
}
```

- [ ] **Step 2: La action**

En `reservas/src/lib/actions.ts`, **reemplazar** `getCobrosOnline` por:

```ts
/**
 * Qué métodos de pago puede ofrecer el sitio, con los datos que la pantalla de transferencia
 * necesita. Antes esto era `getCobrosOnline()` y devolvía un booleano: sin Mercado Pago el sitio
 * no tomaba ninguna reserva. Ya no es cierto — con CBU cargado se puede cobrar igual.
 *
 * Ante cualquier error devuelve todo en falso, y el sitio manda a reservar por WhatsApp. Es
 * deliberado: preferimos eso antes que tomar una reserva que después no vamos a poder cobrar.
 */
export async function getMetodosPago(): Promise<MetodosPago> {
  const vacio: MetodosPago = {
    mercadoPago: false, transferencia: false,
    cbu: '', alias: '', titular: '', adminWhatsapp: '', senaTimeoutMinutos: 30,
  };
  try {
    const d = await apiReservas<{
      cobrosOnline?: boolean; transferenciaDisponible?: boolean;
      cbu?: string; alias?: string; titular?: string;
      adminWhatsapp?: string; senaTimeoutMinutos?: number;
    }>('/config/sena');
    return {
      mercadoPago: d.cobrosOnline === true,
      transferencia: d.transferenciaDisponible === true,
      cbu: d.cbu ?? '', alias: d.alias ?? '', titular: d.titular ?? '',
      adminWhatsapp: d.adminWhatsapp ?? '',
      // Si el backend es viejo y no manda el plazo, 30 es el default del backend.
      senaTimeoutMinutos: d.senaTimeoutMinutos ?? 30,
    };
  } catch (e) {
    console.error('[config] no se pudieron consultar los métodos de pago', { error: e instanceof Error ? e.message : e });
    return vacio;
  }
}
```

Actualizar el `import type` de la primera línea para incluir `MetodosPago` y `MetodoSena`.

- [ ] **Step 3: `crearReserva` manda el método**

En el mismo archivo, cambiar la firma y el body de `crearReserva`:

```ts
export async function crearReserva(input: { canchaId: string; fecha: string; horaInicio: string; nombre: string; telefono: string; duracionMin?: number; metodoSena?: MetodoSena }): Promise<Resultado<ReservaCreada>> {
  try {
    const data = await apiReservas<ReservaCreada>('/reservas', {
      method: 'POST',
      body: JSON.stringify({
        canchaId: input.canchaId,
        whatsapp: input.telefono,
        nombreCliente: input.nombre,
        fecha: input.fecha,
        horaInicio: input.horaInicio,
        esContacto: false,
        ...(input.duracionMin != null ? { duracionMin: input.duracionMin } : {}),
        ...(input.metodoSena ? { metodoSena: input.metodoSena } : {}),
      }),
    });
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}
```

- [ ] **Step 4: La página**

Reemplazar `reservas/src/app/reservar/page.tsx` entero por:

```tsx
import { PantallaReserva } from "@/components/pantalla-reserva";
import { ReservasCerradas } from "@/components/reservas-cerradas";
import { getMetodosPago } from "@/lib/actions";

export default async function ReservarPage() {
  // Se decide acá, del lado del servidor, y no dentro de PantallaReserva: si no hay con qué
  // cobrar la seña, ni siquiera se manda al navegador la pantalla de reserva.
  //
  // Antes la condición era "¿hay cuenta de Mercado Pago?". Ya no: con el CBU cargado se puede
  // cobrar igual, así que el sitio solo cierra cuando no hay NINGÚN método.
  const metodos = await getMetodosPago();
  const hayAlgunMetodo = metodos.mercadoPago || metodos.transferencia;
  return (
    <main className="flex min-h-screen flex-1 flex-col bg-neutral-950 text-neutral-100">
      {hayAlgunMetodo ? <PantallaReserva metodos={metodos} /> : <ReservasCerradas />}
    </main>
  );
}
```

- [ ] **Step 5: Verificar**

Run (desde `reservas/`): `pnpm lint && pnpm build`
Expected: limpio. `PantallaReserva` todavía no acepta la prop `metodos` — si el build falla por
eso, agregale la prop al componente con el tipo `MetodosPago` y no la uses todavía; la Task 5 la
consume.

- [ ] **Step 6: Commit**

```bash
git add reservas/src
git commit -m "feat(reservas): el sitio toma reservas mientras haya algun metodo de pago"
```

---

### Task 5: La pantalla de datos de transferencia

Componente aparte y presentacional: `pantalla-reserva.tsx` ya tiene 285 líneas y meterle esto adentro la vuelve inmanejable.

**Files:**
- Create: `reservas/src/components/datos-transferencia.tsx`

**Interfaces:**
- Consumes: `MetodosPago` (Task 4).
- Produces: `<DatosTransferencia metodos={...} montoSena={...} resumenTurno={...} onCerrar={...} />`.

- [ ] **Step 1: Escribir el componente**

Crear `reservas/src/components/datos-transferencia.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { MetodosPago } from '@/lib/types';

const money = (n: number | null) => (n == null ? '' : '$' + Number(n).toLocaleString('es-AR'));

function Copiable({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const [copiado, setCopiado] = useState(false);
  if (!valor.trim()) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-neutral-800 p-3">
      <div className="min-w-0">
        <p className="text-xs uppercase text-neutral-500">{etiqueta}</p>
        <p className="truncate font-semibold text-neutral-100">{valor}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(valor).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          });
        }}
        className="shrink-0 rounded-lg border border-neutral-600 px-3 py-1 text-xs font-semibold text-neutral-200"
      >
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

/**
 * Qué hacer para pagar la seña por transferencia.
 *
 * El monto sale de la reserva ya creada, no de la configuración: cada cancha puede tener su
 * propia seña, así que recién se conoce cuando el backend responde.
 */
export function DatosTransferencia({
  metodos, montoSena, resumenTurno, onCerrar,
}: {
  metodos: MetodosPago;
  montoSena: number;
  resumenTurno: string;
  onCerrar: () => void;
}) {
  const wa = metodos.adminWhatsapp.replace(/\D/g, '');
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xl font-bold">Transferí para confirmar</h3>
      <p className="text-sm text-neutral-400">{resumenTurno}</p>

      <p className="text-neutral-200">
        Seña a transferir: <b className="text-lime-400">{money(montoSena)}</b>
      </p>

      <div className="flex flex-col gap-2">
        <Copiable etiqueta="Alias" valor={metodos.alias} />
        <Copiable etiqueta="CBU" valor={metodos.cbu} />
        {metodos.titular.trim() && (
          <p className="text-sm text-neutral-400">Titular: {metodos.titular}</p>
        )}
      </div>

      {/* Sin número cargado no se muestra el pedido: un wa.me roto es peor que no pedirlo. */}
      {wa ? (
        <p className="text-neutral-200">
          Mandá el comprobante por{' '}
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-lime-400 underline">
            WhatsApp
          </a>{' '}
          para que confirmemos el turno.
        </p>
      ) : (
        <p className="text-neutral-200">Mandanos el comprobante para que confirmemos el turno.</p>
      )}

      <p className="text-sm text-amber-400">
        Tenés {metodos.senaTimeoutMinutos} minutos para transferir y mandar el comprobante. Pasado
        ese tiempo, el horario se libera.
      </p>

      <button type="button" onClick={onCerrar} className="mt-2 rounded-xl bg-lime-500 px-6 py-2 font-bold text-black">
        Listo
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

Run (desde `reservas/`): `pnpm lint && pnpm build`
Expected: limpio. El componente todavía no se usa en ningún lado — es esperable.

- [ ] **Step 3: Commit**

```bash
git add reservas/src/components/datos-transferencia.tsx
git commit -m "feat(reservas): pantalla con los datos para transferir la sena"
```

---

### Task 6: El modal en dos pasos

**Files:**
- Modify: `reservas/src/components/pantalla-reserva.tsx`

**Interfaces:**
- Consumes: `MetodosPago` y `getMetodosPago` (Task 4), `DatosTransferencia` (Task 5), `crearReserva` con `metodoSena` (Task 4).

- [ ] **Step 1: La prop y el estado nuevo**

`PantallaReserva` pasa a recibir `{ metodos }: { metodos: MetodosPago }`.

Agregar dos estados junto a los que ya existen:

```tsx
const [paso, setPaso] = useState<'datos' | 'metodo'>('datos');
const [transferencia, setTransferencia] = useState<{ montoSena: number } | null>(null);
```

Importar el componente y el tipo:

```tsx
import { DatosTransferencia } from './datos-transferencia';
import type { MetodosPago } from '@/lib/types';
```

En `abrirForm`, resetear también los nuevos: `setPaso('datos'); setTransferencia(null);`
En `cerrarModal`, lo mismo.

- [ ] **Step 2: Partir `confirmar()` en dos**

La función `confirmar()` actual hace validación **y** creación. Se parte:

```tsx
  // Paso 1 -> 2: solo valida. La reserva se crea recién cuando el cliente elige cómo pagar,
  // porque el método viaja en el POST y no se puede agregar después.
  function irAMetodo() {
    if (!sel) return;
    if (nombre.trim().length < 2) { setErrorForm('Ingresá tu nombre'); return; }
    if (telefono.replace(/\D/g, '').length < 10) { setErrorForm('Ingresá un teléfono válido (10 dígitos)'); return; }
    setErrorForm('');
    setPaso('metodo');
  }

  function elegir(metodoSena: 'MERCADO_PAGO' | 'TRANSFERENCIA') {
    if (!sel) return;
    start(async () => {
      const r = await crearReserva({
        canchaId: sel.canchaId, fecha: sel.fecha, horaInicio: sel.hora,
        nombre: nombre.trim(), telefono, duracionMin: duracionSel, metodoSena,
      });
      if (!r.ok) {
        // El backend rechazó por concurrencia (otro cliente ocupó el turno mientras este
        // elegía). Se vuelve al paso 1 con las duraciones que sigan disponibles.
        const g = await recargar();
        const nuevas = g?.duraciones?.[sel.canchaId]?.[sel.hora] ?? [];
        setSel({ ...sel, duraciones: nuevas });
        setPaso('datos');
        if (nuevas.length === 0) setErrorForm('Ese turno se acaba de ocupar. Elegí otro horario.');
        else if (!nuevas.some((d) => d.min === duracionSel)) {
          setDuracionSel(nuevas[0].min);
          setErrorForm(`Ya no queda lugar para ${etiquetaDuracion(duracionSel)}. Todavía podés reservar ${etiquetaDuracion(nuevas[0].min)}.`);
        } else setErrorForm(r.error);
        return;
      }

      // Socio: la reserva ya vuelve CONFIRMADA y bonificada. El método que eligió no aplica —
      // el backend lo descarta — y se le muestra la pantalla de confirmación de siempre.
      if (r.data.suscripcionId) { setOk({ senia: null, socio: true }); void recargar(); return; }

      const senia = r.data.montoSena == null ? null : Number(r.data.montoSena);
      if (senia == null || senia <= 0) { setOk({ senia }); void recargar(); return; }

      if (metodoSena === 'TRANSFERENCIA') {
        setTransferencia({ montoSena: senia });
        void recargar();
        return;
      }

      const pref = await crearPreferenciaPago(r.data.id);
      if (pref.ok) { window.location.href = pref.data.checkoutUrl; return; }
      // La reserva quedó registrada igual; avisamos que no se pudo generar el link de pago.
      setOk({ senia, contacto: 'No pudimos generar el link de pago. Te contactaremos para coordinarlo.' });
      void recargar();
    });
  }
```

- [ ] **Step 3: El botón del paso 1**

En el JSX del modal, el botón "Confirmar" pasa a llamar a `irAMetodo` y a decir "Continuar":

```tsx
<button type="button" onClick={irAMetodo} className="flex-[2] rounded-xl bg-lime-500 py-2 font-bold text-black">Continuar</button>
```

Ya no necesita `disabled={pending}`: en el paso 1 no hay request en vuelo.

- [ ] **Step 4: El paso 2**

Dentro del modal, el contenido se elige en este orden: `transferencia` → `ok` → `paso === 'metodo'` → formulario. El bloque nuevo:

```tsx
{paso === 'metodo' && (
  <>
    <h3 className="text-lg font-bold">¿Cómo querés pagar la seña?</h3>
    <p className="mt-1 text-sm text-neutral-400">{resumenTurno}</p>
    <div className="mt-4 flex flex-col gap-2">
      {metodos.mercadoPago && (
        <button type="button" disabled={pending} onClick={() => elegir('MERCADO_PAGO')}
          className="rounded-xl border-2 border-neutral-700 bg-neutral-800 p-4 text-left disabled:opacity-50">
          <span className="block font-bold text-neutral-100">Mercado Pago</span>
          <span className="block text-sm text-neutral-400">Pagás ahora y el turno queda confirmado solo.</span>
        </button>
      )}
      {metodos.transferencia && (
        <button type="button" disabled={pending} onClick={() => elegir('TRANSFERENCIA')}
          className="rounded-xl border-2 border-neutral-700 bg-neutral-800 p-4 text-left disabled:opacity-50">
          <span className="block font-bold text-neutral-100">Transferencia</span>
          <span className="block text-sm text-neutral-400">Te damos el alias y el CBU. Confirmás mandando el comprobante.</span>
        </button>
      )}
    </div>
    {errorForm && <p className="mt-2 text-red-400">{errorForm}</p>}
    <button type="button" disabled={pending} onClick={() => setPaso('datos')} className="mt-4 w-full rounded-xl border border-neutral-600 py-2 font-semibold">
      {pending ? 'Reservando…' : 'Volver'}
    </button>
  </>
)}
```

Y el bloque de transferencia, antes del de `ok`:

```tsx
{transferencia ? (
  <DatosTransferencia metodos={metodos} montoSena={transferencia.montoSena} resumenTurno={resumenTurno} onCerrar={cerrarModal} />
) : ok ? (
  /* …la pantalla de éxito que ya existe, sin cambios… */
) : paso === 'metodo' ? (
  /* …el bloque de arriba… */
) : (
  /* …el formulario que ya existe… */
)}
```

- [ ] **Step 5: Verificar que compila**

Run (desde `reservas/`): `pnpm lint && pnpm build`
Expected: limpio.

- [ ] **Step 6: Verificación manual**

`reservas/` no tiene tests. Levantá el backend (`npm run dev` en `backend/`) y el sitio
(`pnpm dev` en `reservas/`, con `PORT` distinto) y recorré **todos** estos casos. Anotá el
resultado de cada uno en el reporte:

| Caso | Cómo prepararlo | Qué tiene que pasar |
|---|---|---|
| Los dos métodos | Cuenta de MP vinculada + alias/CBU en el panel | El paso 2 muestra las dos opciones |
| Solo transferencia | Desvincular MP, dejar el alias | El paso 2 muestra solo Transferencia |
| Solo Mercado Pago | Vaciar alias y CBU en el panel | El paso 2 muestra solo Mercado Pago |
| Ninguno | Desvincular MP y vaciar alias/CBU | El sitio muestra "reservas cerradas" |
| Flujo de transferencia | Elegir Transferencia | Se ve el monto de la seña, alias, CBU, titular, el link de WhatsApp y el plazo |
| Copiar | Tocar "Copiar" en alias y CBU | Dice "Copiado" y el portapapeles tiene el valor |
| Sin WhatsApp cargado | Vaciar `adminWhatsapp` en el panel | Se ven los datos bancarios, sin link roto |
| Flujo de Mercado Pago | Elegir Mercado Pago | Redirige al checkout, como antes |
| Volver | Tocar "Volver" en el paso 2 | Vuelve al formulario con los datos cargados |
| Turno ocupado | Reservar el mismo turno desde otra pestaña antes de elegir | Vuelve al paso 1 con el mensaje de turno ocupado |
| Socio | Usar el teléfono de un cliente con suscripción vigente | Elige método y ve "¡Turno confirmado!" bonificado |

Verificá además, en la base, que la reserva de transferencia quedó con
`metodoSena = 'TRANSFERENCIA'` y la de socio con `metodoSena = null`.

- [ ] **Step 7: Commit**

```bash
git add reservas/src
git commit -m "feat(reservas): elegir entre Mercado Pago y transferencia al reservar"
```

---

## Notas para el deploy

- **Una migración**, puramente aditiva (un enum y una columna nullable). No hay backfill ni
  reescritura de tabla: es segura de aplicar con tráfico.
- **Sin variables de entorno nuevas.** `SENA_TIMEOUT_MINUTOS` ya existe; ahora además viaja al
  sitio para mostrarle el plazo al cliente.
- **El orden importa**: `reservas/` se deploya a Vercel por separado. Si sale antes que el
  backend, `getMetodosPago()` no va a encontrar `transferenciaDisponible` y va a resolver todo en
  falso — el sitio queda cerrado. **Desplegar el backend primero.**
- El panel tolera el skew en la otra dirección: `metodoSena` es opcional y sin él no muestra nada.

## Lo que queda afuera

- Unificar las dos fuentes de número de WhatsApp (`reservas/src/lib/negocio.ts` hardcodeado y hoy
  vacío, vs `Configuracion.adminWhatsapp`).
- Confirmar la transferencia automáticamente: el admin sigue aprobando a mano con
  `PATCH /reservas/:id/aprobar-sena`.
- Ofrecer la cuenta secundaria (`cbu2`/`alias2`) como destino.
- Darle a la transferencia una ventana de vencimiento propia: decidido y descartado en el spec.

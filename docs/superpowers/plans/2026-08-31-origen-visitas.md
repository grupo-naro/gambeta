# Origen de visitas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar por qué canal llega cada visita al sitio público de reservas (WhatsApp, QR, redes, landing) y mostrarlo en el dashboard del panel admin.

**Architecture:** Los links de entrada son `/r/<etiqueta>`; esa ruta sólo deja una cookie y redirige a `/`, sin escribir en la base. La visita la registra el navegador desde `/` con un beacon, así las previsualizaciones de links y los crawlers no inflan los números. El backend guarda una fila `Visita` por sesión y el dashboard la lee agregada por tipo y por etiqueta.

**Tech Stack:** Express 5 + Prisma 7 + Postgres (backend, npm), Next.js 16 App Router (reservas y frontend, pnpm), vitest + supertest + Testcontainers, recharts.

**Spec:** [`docs/superpowers/specs/2026-08-31-origen-visitas-design.md`](../specs/2026-08-31-origen-visitas-design.md)

## Global Constraints

- **Rama:** trabajar en `feat/origen-visitas`, no en `main`. Un push a `main` dispara el deploy de producción por el runner self-hosted. Crear la rama antes de la Tarea 1: `git checkout -b feat/origen-visitas`.
- **Idioma:** código, comentarios, nombres y mensajes en español. No traducir `cancha`, `seña`, `reserva`, `visita`, `origen`, `etiqueta`.
- **Prisma 7:** nunca importar de `@prisma/client`. Los tipos salen de `src/db/client.js`; el cliente en runtime es `src/db/prisma.js`. Después de tocar el schema, `npx prisma generate`.
- **Package managers:** `backend/` usa **npm**; `frontend/` y `reservas/` usan **pnpm**.
- **Errores:** usar las factories de `src/utils/errors.ts`, nunca `new Error` para fallas esperadas.
- **Next.js 16:** es más nuevo que la mayoría de los datos de entrenamiento. Antes de escribir código específico de Next (route handlers, `cookies()`, `params`), leer la guía correspondiente en `node_modules/next/dist/docs/`.
- **Etiquetas iniciales:** exactamente tres — `landing`, `ig-bio`, `whatsapp`. Los QR quedan soportados por el tipo `QR` pero no se imprime ninguno todavía.
- **Cookies:** todas `httpOnly`, `sameSite: 'lax'`, `secure` sólo en producción, `path: '/'`.
- **Dominio del sitio de reservas:** `https://reserva.gambeteandopadelyfutbol.ar`.

---

## Estructura de archivos

**backend/**

| Archivo | Responsabilidad |
|---|---|
| `prisma/schema.prisma` (modificar) | `enum TipoOrigen`, `model Visita`, columnas `origenEtiqueta`/`origenTipo` en `Reserva` |
| `src/repositories/visita.repo.ts` (crear) | El único `INSERT` de visitas, idempotente por `sesionId` |
| `src/services/visita.service.ts` (crear) | `clasificarOrigen` (función pura) + `visitaService.registrar` |
| `src/validators/visita.schema.ts` (crear) | Schema zod de `POST /visitas` |
| `src/routes/visita.routes.ts` (crear) | `POST /visitas` |
| `src/routes/index.ts` (modificar) | Montar `/visitas` |
| `src/services/analytics.service.ts` (modificar) | `origenes(desde, hasta)` |
| `src/routes/analytics.routes.ts` (modificar) | `GET /analytics/origenes` |
| `src/services/reserva.service.ts` (modificar) | Aceptar `origenEtiqueta` y derivar `origenTipo` |
| `src/repositories/reserva.repo.ts` (modificar) | Pasar las dos columnas nuevas al `create` |
| `src/validators/reserva.schema.ts` (modificar) | `origenEtiqueta` opcional en el body |
| `tests/helpers/db.ts` (modificar) | `Visita` en `resetTables()` |

**reservas/**

| Archivo | Responsabilidad |
|---|---|
| `vitest.config.ts` (crear) | Setup de tests, hoy inexistente |
| `package.json` (modificar) | devDep `vitest` + script `test` |
| `src/lib/origen.ts` (crear) | Nombres de cookie y lógica pura de lectura |
| `src/app/r/[etiqueta]/route.ts` (crear) | Etiquetar y redirigir a `/` |
| `src/app/api/visita/route.ts` (crear) | Registrar la visita contra el backend |
| `src/components/registro-visita.tsx` (crear) | Beacon en el navegador |
| `src/app/page.tsx` (modificar) | Montar el beacon |
| `src/lib/actions.ts` (modificar) | Mandar `origenEtiqueta` al crear la reserva |

**frontend/**

| Archivo | Responsabilidad |
|---|---|
| `src/lib/origen.ts` (crear) | Nombre legible de cada tipo de origen |
| `src/lib/types.ts` (modificar) | Tipos de la respuesta de `/analytics/origenes` |
| `src/components/dashboard/origenes-chart.tsx` (crear) | Barras por tipo |
| `src/components/dashboard/origenes-tabla.tsx` (crear) | Detalle por etiqueta |
| `src/app/(panel)/dashboard/page.tsx` (modificar) | Fetch + métricas + montaje |

---

### Task 1: Modelo de datos

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/tests/helpers/db.ts`
- Create: `backend/prisma/migrations/<timestamp>_add_visita_origen/migration.sql` (la genera Prisma)
- Test: `backend/tests/integration/visita-modelo.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `TipoOrigen` (`'WHATSAPP' | 'QR' | 'REDES' | 'LANDING' | 'DIRECTO' | 'OTRO'`) y el modelo `Visita` con campos `id`, `etiqueta: string | null`, `tipo: TipoOrigen`, `sesionId: string` (único), `visitanteId: string`, `referer: string | null`, `creadoEn: Date`. `Reserva` gana `origenEtiqueta: string | null` y `origenTipo: TipoOrigen | null`.

- [ ] **Step 1: Crear la rama**

```bash
git checkout -b feat/origen-visitas
```

- [ ] **Step 2: Escribir el test que falla**

Crear `backend/tests/integration/visita-modelo.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('modelo Visita', () => {
  it('guarda una visita con etiqueta, tipo y referer', async () => {
    const v = await getPrisma().visita.create({
      data: { etiqueta: 'ig-bio', tipo: 'REDES', sesionId: 's1', visitanteId: 'v1', referer: 'https://instagram.com/' },
    });
    expect(v.tipo).toBe('REDES');
    expect(v.etiqueta).toBe('ig-bio');
  });

  it('la visita directa no tiene etiqueta', async () => {
    const v = await getPrisma().visita.create({
      data: { etiqueta: null, tipo: 'DIRECTO', sesionId: 's2', visitanteId: 'v2', referer: null },
    });
    expect(v.etiqueta).toBeNull();
  });

  it('sesionId es único: una sesión es una visita', async () => {
    await getPrisma().visita.create({ data: { tipo: 'QR', etiqueta: 'qr-entrada', sesionId: 'dup', visitanteId: 'v3' } });
    await expect(
      getPrisma().visita.create({ data: { tipo: 'QR', etiqueta: 'qr-entrada', sesionId: 'dup', visitanteId: 'v3' } }),
    ).rejects.toThrow();
  });

  it('Reserva puede guardar el origen, y queda en null si no vino de ningún link', async () => {
    const p = getPrisma();
    const cancha = await p.cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000 } });
    const cliente = await p.cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    const base = {
      canchaId: cancha.id, clienteId: cliente.id, estado: 'CONFIRMADA' as const, esContacto: false, monto: 1000,
      fechaInicio: new Date('2026-06-12T22:00:00.000Z'), fechaFin: new Date('2026-06-12T23:00:00.000Z'),
    };
    const conOrigen = await p.reserva.create({ data: { ...base, origenEtiqueta: 'whatsapp', origenTipo: 'WHATSAPP' } });
    expect(conOrigen.origenTipo).toBe('WHATSAPP');
    const sinOrigen = await p.reserva.create({
      data: { ...base, fechaInicio: new Date('2026-06-12T23:00:00.000Z'), fechaFin: new Date('2026-06-13T00:00:00.000Z') },
    });
    expect(sinOrigen.origenEtiqueta).toBeNull();
    expect(sinOrigen.origenTipo).toBeNull();
  });
});
```

- [ ] **Step 3: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/visita-modelo.test.ts
```

Esperado: FAIL — `Property 'visita' does not exist` / error de tipos en `origenEtiqueta`.

- [ ] **Step 4: Agregar el enum y el modelo al schema**

En `backend/prisma/schema.prisma`, junto a los otros enums:

```prisma
/// Canal por el que llegó la visita. La etiqueta del link es libre (`qr-entrada`, `ig-bio`);
/// el tipo la agrupa para que el panel muestre un resumen estable aunque los QR cambien.
enum TipoOrigen {
  WHATSAPP
  QR
  REDES
  LANDING
  DIRECTO
  OTRO
}
```

Y al final del archivo:

```prisma
model Visita {
  id           String     @id @default(cuid())
  /// Etiqueta cruda del link, tal como vino en /r/<etiqueta>. `null` en la visita directa.
  etiqueta     String?
  tipo         TipoOrigen
  /// Una fila por sesión. `@unique` hace idempotente el registro: si el navegador manda el
  /// beacon dos veces (remount, doble pestaña), la segunda no duplica.
  sesionId     String     @unique
  visitanteId  String
  referer      String?
  creadoEn     DateTime   @default(now()) @db.Timestamptz(3)

  @@index([creadoEn])
  @@index([tipo, creadoEn])
  @@index([etiqueta, creadoEn])
}
```

- [ ] **Step 5: Agregar las dos columnas a `Reserva`**

En `model Reserva`, debajo de `metodoSena`:

```prisma
  /// Por qué link llegó el cliente que hizo esta reserva (last-touch). Nullable y sin default
  /// por el mismo motivo que `metodoSena`: las reservas que carga el panel, las del bot y las
  /// anteriores a este campo no vinieron de ningún link, y `null` es la lectura honesta.
  origenEtiqueta String?
  origenTipo     TipoOrigen?
```

- [ ] **Step 6: Generar la migración**

```bash
cd backend && npx prisma migrate dev --name add_visita_origen
```

- [ ] **Step 7: Sumar `Visita` a `resetTables()`**

En `backend/tests/helpers/db.ts`, dentro del `p.$transaction([...])`, agregar como primera línea de la lista (no tiene relaciones, el orden no importa, pero conviene que quede visible):

```ts
    p.visita.deleteMany(),
```

- [ ] **Step 8: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/visita-modelo.test.ts
```

Esperado: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma backend/tests/helpers/db.ts backend/tests/integration/visita-modelo.test.ts
git commit -m "feat(visitas): modelo Visita y origen en Reserva"
```

---

### Task 2: Clasificador de etiquetas

**Files:**
- Create: `backend/src/services/visita.service.ts`
- Test: `backend/tests/unit/visita.service.test.ts`

**Interfaces:**
- Consumes: el tipo `TipoOrigen` de la Tarea 1.
- Produces: `clasificarOrigen(etiqueta: string | null | undefined): TipoOrigen`, exportada desde `src/services/visita.service.ts`. La usan la Tarea 3 (registrar la visita) y la Tarea 5 (derivar `origenTipo` de la reserva).

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/unit/visita.service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clasificarOrigen } from '../../src/services/visita.service.js';

describe('clasificarOrigen', () => {
  it('las tres etiquetas que se usan hoy', () => {
    expect(clasificarOrigen('whatsapp')).toBe('WHATSAPP');
    expect(clasificarOrigen('ig-bio')).toBe('REDES');
    expect(clasificarOrigen('landing')).toBe('LANDING');
  });

  it('mira el primer segmento, así que la etiqueta puede llevar sufijo o no', () => {
    expect(clasificarOrigen('whatsapp-bot')).toBe('WHATSAPP');
    expect(clasificarOrigen('wsp-bot')).toBe('WHATSAPP');
    expect(clasificarOrigen('qr')).toBe('QR');
    expect(clasificarOrigen('qr-entrada')).toBe('QR');
    expect(clasificarOrigen('qr-cancha-1')).toBe('QR');
  });

  it('agrupa las redes', () => {
    for (const e of ['ig-bio', 'fb-post', 'tt-perfil', 'yt-video', 'redes-varias']) {
      expect(clasificarOrigen(e)).toBe('REDES');
    }
  });

  it('sin etiqueta es una visita directa', () => {
    expect(clasificarOrigen(null)).toBe('DIRECTO');
    expect(clasificarOrigen(undefined)).toBe('DIRECTO');
    expect(clasificarOrigen('')).toBe('DIRECTO');
  });

  it('una etiqueta desconocida no se pierde: cae en OTRO', () => {
    expect(clasificarOrigen('volante-papel')).toBe('OTRO');
    expect(clasificarOrigen('xyz')).toBe('OTRO');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/unit/visita.service.test.ts
```

Esperado: FAIL — no existe `src/services/visita.service.ts`.

- [ ] **Step 3: Escribir el clasificador**

Crear `backend/src/services/visita.service.ts`:

```ts
import type { TipoOrigen } from '../db/client.js';

// El primer segmento de la etiqueta —lo que va antes del primer guion— manda el tipo. Así
// `whatsapp`, `whatsapp-bot` y `wsp-bot` caen todas en WHATSAPP sin que cada etiqueta tenga
// que llevar guion, y sumar un QR nuevo (`qr-entrada`, `qr-buffet`) es imprimir un link
// distinto: no toca ni código ni base.
const TIPO_POR_SEGMENTO: Record<string, TipoOrigen> = {
  whatsapp: 'WHATSAPP',
  wsp: 'WHATSAPP',
  qr: 'QR',
  ig: 'REDES',
  fb: 'REDES',
  tt: 'REDES',
  yt: 'REDES',
  redes: 'REDES',
  landing: 'LANDING',
  web: 'LANDING',
};

/** Sin etiqueta la visita es DIRECTA; una etiqueta que no reconocemos cae en OTRO y no se pierde. */
export function clasificarOrigen(etiqueta: string | null | undefined): TipoOrigen {
  if (!etiqueta) return 'DIRECTO';
  return TIPO_POR_SEGMENTO[etiqueta.split('-')[0]!] ?? 'OTRO';
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/unit/visita.service.test.ts
```

Esperado: PASS, 5 tests. No necesita Docker.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/visita.service.ts backend/tests/unit/visita.service.test.ts
git commit -m "feat(visitas): clasificador de etiquetas de origen"
```

---

### Task 3: `POST /visitas`

**Files:**
- Create: `backend/src/repositories/visita.repo.ts`
- Create: `backend/src/validators/visita.schema.ts`
- Create: `backend/src/routes/visita.routes.ts`
- Modify: `backend/src/services/visita.service.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/visita.test.ts`

**Interfaces:**
- Consumes: `clasificarOrigen` de la Tarea 2; el modelo `Visita` de la Tarea 1.
- Produces: el endpoint `POST /visitas`, body `{ etiqueta?: string | null, sesionId: string, visitanteId: string, referer?: string | null }`, respuesta `204 No Content`, autenticado con `authAny`. Lo consume la Tarea 8.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/visita.test.ts`:

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

// `tests/helpers/global-setup.ts` setea SERVICE_API_KEY='svc'; el resto de los tests de
// integración usan ese literal (ver `tests/integration/sena.test.ts`).
const clave = 'svc';

describe('POST /visitas', () => {
  it('registra la visita y le deriva el tipo a partir de la etiqueta', async () => {
    const res = await supertest(app).post('/visitas').set('x-api-key', clave)
      .send({ etiqueta: 'ig-bio', sesionId: 's1', visitanteId: 'v1', referer: 'https://instagram.com/' });
    expect(res.status).toBe(204);
    const v = await getPrisma().visita.findUnique({ where: { sesionId: 's1' } });
    expect(v?.tipo).toBe('REDES');
    expect(v?.etiqueta).toBe('ig-bio');
  });

  it('sin etiqueta la visita queda como DIRECTO', async () => {
    await supertest(app).post('/visitas').set('x-api-key', clave)
      .send({ sesionId: 's2', visitanteId: 'v2' }).expect(204);
    const v = await getPrisma().visita.findUnique({ where: { sesionId: 's2' } });
    expect(v?.tipo).toBe('DIRECTO');
    expect(v?.etiqueta).toBeNull();
  });

  it('es idempotente por sesionId: el beacon puede dispararse dos veces', async () => {
    const body = { etiqueta: 'whatsapp', sesionId: 'dup', visitanteId: 'v3' };
    await supertest(app).post('/visitas').set('x-api-key', clave).send(body).expect(204);
    await supertest(app).post('/visitas').set('x-api-key', clave).send(body).expect(204);
    expect(await getPrisma().visita.count()).toBe(1);
  });

  it('rechaza etiquetas que no matchean el formato de los links', async () => {
    await supertest(app).post('/visitas').set('x-api-key', clave)
      .send({ etiqueta: 'IG Bio!', sesionId: 's4', visitanteId: 'v4' }).expect(400);
    expect(await getPrisma().visita.count()).toBe(0);
  });

  it('exige autenticación', async () => {
    await supertest(app).post('/visitas')
      .send({ sesionId: 's5', visitanteId: 'v5' }).expect(401);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/visita.test.ts
```

Esperado: FAIL — 404 en vez de 204, la ruta no existe.

- [ ] **Step 3: Escribir el repositorio**

Crear `backend/src/repositories/visita.repo.ts`:

```ts
import type { TipoOrigen } from '../db/client.js';
import { prisma } from '../db/prisma.js';

export interface CreateVisitaData {
  etiqueta: string | null;
  tipo: TipoOrigen;
  sesionId: string;
  visitanteId: string;
  referer: string | null;
}

export const visitaRepo = {
  // `skipDuplicates` se apoya en el índice único de `sesionId`: si el navegador manda el
  // beacon dos veces (remount de React, dos pestañas), la segunda no duplica la visita ni
  // hace fallar la request. Registrar una visita nunca debe devolver un error al sitio.
  async registrar(data: CreateVisitaData): Promise<void> {
    await prisma.visita.createMany({ data: [data], skipDuplicates: true });
  },
};
```

- [ ] **Step 4: Agregar `registrar` al servicio**

En `backend/src/services/visita.service.ts`, debajo de `clasificarOrigen`:

```ts
import { visitaRepo } from '../repositories/visita.repo.js';

export interface RegistrarVisitaInput {
  etiqueta?: string | null;
  sesionId: string;
  visitanteId: string;
  referer?: string | null;
}

export const visitaService = {
  registrar(input: RegistrarVisitaInput): Promise<void> {
    return visitaRepo.registrar({
      etiqueta: input.etiqueta ?? null,
      tipo: clasificarOrigen(input.etiqueta),
      sesionId: input.sesionId,
      visitanteId: input.visitanteId,
      referer: input.referer ?? null,
    });
  },
};
```

El `import` va arriba del todo, junto al `import type`.

- [ ] **Step 5: Escribir el validador**

Crear `backend/src/validators/visita.schema.ts`:

```ts
import { z } from 'zod';

const empty = z.looseObject({});

// Mismo formato que valida el sitio de reservas antes de setear la cookie. Si acá entrara
// texto libre, el detalle por etiqueta del panel se llenaría de basura imposible de agrupar.
export const registrarVisitaSchema = z.object({
  body: z.object({
    etiqueta: z.string().regex(/^[a-z0-9-]{1,40}$/).nullish(),
    sesionId: z.string().min(1).max(64),
    visitanteId: z.string().min(1).max(64),
    referer: z.string().max(500).nullish(),
  }),
  query: empty,
  params: empty,
});
```

- [ ] **Step 6: Escribir la ruta**

Crear `backend/src/routes/visita.routes.ts`:

```ts
import { Router } from 'express';
import { authAny } from '../middlewares/authAny.js';
import { validate } from '../middlewares/validate.js';
import { registrarVisitaSchema } from '../validators/visita.schema.js';
import { visitaService } from '../services/visita.service.js';

export const visitaRoutes = Router();

// Lo llama el server del sitio de reservas con `x-api-key`, igual que el resto de los
// endpoints públicos. Sin `auditService.log`: esto no es una acción de admin sobre una
// entidad del negocio, es telemetría de la web pública, y una fila de auditoría por visita
// ahogaría el listado de actividad.
visitaRoutes.post('/', authAny, validate(registrarVisitaSchema), async (req, res, next) => {
  try {
    await visitaService.registrar((req as any).valid.body);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
```

- [ ] **Step 7: Montar la ruta**

En `backend/src/routes/index.ts`, agregar el import junto a los otros y la línea de montaje al final de la lista:

```ts
import { visitaRoutes } from './visita.routes.js';
```

```ts
apiRouter.use('/visitas', visitaRoutes);
```

- [ ] **Step 8: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/visita.test.ts
```

Esperado: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add backend/src/repositories/visita.repo.ts backend/src/validators/visita.schema.ts backend/src/routes/visita.routes.ts backend/src/services/visita.service.ts backend/src/routes/index.ts backend/tests/integration/visita.test.ts
git commit -m "feat(visitas): endpoint POST /visitas idempotente por sesion"
```

---

### Task 4: `GET /analytics/origenes`

**Files:**
- Modify: `backend/src/services/analytics.service.ts`
- Modify: `backend/src/routes/analytics.routes.ts`
- Test: `backend/tests/integration/analytics-origenes.test.ts`

**Interfaces:**
- Consumes: el modelo `Visita` de la Tarea 1.
- Produces: `GET /analytics/origenes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` → `{ total: number, unicos: number, porTipo: { tipo, visitas, unicos }[], porEtiqueta: { etiqueta, tipo, visitas, unicos }[] }`, sólo admin. Lo consume la Tarea 10.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/analytics-origenes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTables();
  // v1 entra dos veces por Instagram (dos sesiones), v2 una vez por Instagram y v3 por
  // WhatsApp. Total 4 visitas, 3 visitantes únicos.
  await getPrisma().visita.createMany({ data: [
    { etiqueta: 'ig-bio', tipo: 'REDES', sesionId: 'a', visitanteId: 'v1', creadoEn: new Date('2026-06-12T15:00:00.000Z') },
    { etiqueta: 'ig-bio', tipo: 'REDES', sesionId: 'b', visitanteId: 'v1', creadoEn: new Date('2026-06-12T18:00:00.000Z') },
    { etiqueta: 'ig-bio', tipo: 'REDES', sesionId: 'c', visitanteId: 'v2', creadoEn: new Date('2026-06-13T15:00:00.000Z') },
    { etiqueta: 'whatsapp', tipo: 'WHATSAPP', sesionId: 'd', visitanteId: 'v3', creadoEn: new Date('2026-06-13T16:00:00.000Z') },
  ]});
});

const qs = 'desde=2026-06-10&hasta=2026-06-15';

describe('GET /analytics/origenes', () => {
  it('cuenta visitas y visitantes únicos', async () => {
    const res = await supertest(app).get(`/analytics/origenes?${qs}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.unicos).toBe(3);
  });

  it('agrupa por tipo', async () => {
    const res = await supertest(app).get(`/analytics/origenes?${qs}`).set('authorization', `Bearer ${token}`);
    const redes = res.body.porTipo.find((r: any) => r.tipo === 'REDES');
    expect(redes.visitas).toBe(3);
    expect(redes.unicos).toBe(2);
    const wsp = res.body.porTipo.find((r: any) => r.tipo === 'WHATSAPP');
    expect(wsp.visitas).toBe(1);
  });

  it('agrupa por etiqueta', async () => {
    const res = await supertest(app).get(`/analytics/origenes?${qs}`).set('authorization', `Bearer ${token}`);
    const ig = res.body.porEtiqueta.find((r: any) => r.etiqueta === 'ig-bio');
    expect(ig.visitas).toBe(3);
    expect(ig.tipo).toBe('REDES');
  });

  it('respeta el rango de fechas', async () => {
    const res = await supertest(app).get('/analytics/origenes?desde=2026-01-01&hasta=2026-01-31').set('authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(0);
    expect(res.body.porTipo).toEqual([]);
  });

  it('es sólo para admin: la service key no alcanza', async () => {
    await supertest(app).get('/analytics/origenes').set('x-api-key', 'svc').expect(401);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/analytics-origenes.test.ts
```

Esperado: FAIL — 404, la ruta no existe.

- [ ] **Step 3: Agregar `origenes` al servicio**

En `backend/src/services/analytics.service.ts`, dentro de `analyticsService`, después de `ingresosPorDia`:

```ts
  // Tres consultas y no una: `COUNT(DISTINCT visitanteId)` no se puede derivar sumando los
  // subtotales (el mismo visitante puede aparecer en dos filas), así que cada nivel de
  // agregación tiene que contar sus propios únicos.
  async origenes(desde: Date, hasta: Date) {
    const [totales, porTipo, porEtiqueta] = await Promise.all([
      prisma.$queryRaw<Array<{ visitas: bigint; unicos: bigint }>>`
        SELECT COUNT(*) AS visitas, COUNT(DISTINCT "visitanteId") AS unicos
        FROM "Visita"
        WHERE "creadoEn" >= ${desde} AND "creadoEn" < ${hasta}`,
      prisma.$queryRaw<Array<{ tipo: string; visitas: bigint; unicos: bigint }>>`
        SELECT tipo::text AS tipo, COUNT(*) AS visitas, COUNT(DISTINCT "visitanteId") AS unicos
        FROM "Visita"
        WHERE "creadoEn" >= ${desde} AND "creadoEn" < ${hasta}
        GROUP BY 1 ORDER BY visitas DESC`,
      prisma.$queryRaw<Array<{ etiqueta: string | null; tipo: string; visitas: bigint; unicos: bigint }>>`
        SELECT etiqueta, tipo::text AS tipo, COUNT(*) AS visitas, COUNT(DISTINCT "visitanteId") AS unicos
        FROM "Visita"
        WHERE "creadoEn" >= ${desde} AND "creadoEn" < ${hasta}
        GROUP BY 1, 2 ORDER BY visitas DESC`,
    ]);
    return {
      total: Number(totales[0]?.visitas ?? 0),
      unicos: Number(totales[0]?.unicos ?? 0),
      porTipo,
      porEtiqueta,
    };
  },
```

- [ ] **Step 4: Agregar la ruta**

En `backend/src/routes/analytics.routes.ts`, al final:

```ts
analyticsRoutes.get('/origenes', async (req, res, next) => {
  try {
    const { desde, hasta } = rango(req);
    const r = await analyticsService.origenes(desde, hasta);
    // `total` y `unicos` ya vienen convertidos; los agrupados son filas crudas con BigInt.
    res.json({ ...r, porTipo: serializeBigInt(r.porTipo), porEtiqueta: serializeBigInt(r.porEtiqueta) });
  } catch (e) { next(e); }
});
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/analytics-origenes.test.ts
```

Esperado: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/analytics.service.ts backend/src/routes/analytics.routes.ts backend/tests/integration/analytics-origenes.test.ts
git commit -m "feat(visitas): GET /analytics/origenes"
```

---

### Task 5: La reserva guarda su origen

**Files:**
- Modify: `backend/src/validators/reserva.schema.ts`
- Modify: `backend/src/services/reserva.service.ts`
- Modify: `backend/src/repositories/reserva.repo.ts`
- Test: `backend/tests/integration/reserva-origen.test.ts`

**Interfaces:**
- Consumes: `clasificarOrigen` de la Tarea 2; las columnas de la Tarea 1.
- Produces: `POST /reservas` acepta `origenEtiqueta?: string | null` en el body y completa `origenTipo` solo. Lo consume la Tarea 9.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/reserva-origen.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } })).id;
});

// Fecha RELATIVA a hoy, no literal: `crear()` rechaza reservas en el pasado, así que una fecha
// hardcodeada rompe el test en cuanto queda atrás. Mismo helper que `sena.test.ts`.
const manana = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const body = (over: Partial<any> = {}) => ({
  canchaId,
  whatsapp: '+5491150000000',
  nombreCliente: 'Juan',
  esContacto: false,
  fecha: manana(),
  horaInicio: '18:00',
  ...over,
});

describe('origen de la reserva', () => {
  it('guarda la etiqueta y deriva el tipo', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send(body({ origenEtiqueta: 'ig-bio' }));
    expect(res.status).toBe(201);
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    expect(r?.origenEtiqueta).toBe('ig-bio');
    expect(r?.origenTipo).toBe('REDES');
  });

  it('sin etiqueta las dos columnas quedan en null, no en DIRECTO', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send(body({ horaInicio: '19:00', whatsapp: '+5491150000001' }));
    expect(res.status).toBe(201);
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    expect(r?.origenEtiqueta).toBeNull();
    expect(r?.origenTipo).toBeNull();
  });

  it('rechaza una etiqueta con formato inválido', async () => {
    await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send(body({ horaInicio: '20:00', whatsapp: '+5491150000002', origenEtiqueta: 'IG Bio!' }))
      .expect(400);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/reserva-origen.test.ts
```

Esperado: FAIL — `origenEtiqueta` es `null` en el primer caso (el schema descarta el campo desconocido).

- [ ] **Step 3: Aceptar el campo en el validador**

En `backend/src/validators/reserva.schema.ts`, dentro del `body` de `createReservaSchema`, después de `notas`:

```ts
    // La manda sólo la web pública, con la etiqueta del link por el que llegó el cliente.
    // Mismo formato que valida `POST /visitas`.
    origenEtiqueta: z.string().regex(/^[a-z0-9-]{1,40}$/).nullish(),
```

- [ ] **Step 4: Pasarlo por el servicio**

En `backend/src/services/reserva.service.ts`:

Agregar el import junto a los otros servicios:

```ts
import { clasificarOrigen } from './visita.service.js';
```

En `interface CreateReservaInput`, después de `notas?: string;`:

```ts
  origenEtiqueta?: string | null;
```

En el objeto que se le pasa a `reservaRepo.create(...)`, después de la línea de `metodoSena`:

```ts
          // Mismo criterio que `metodoSena`: si el cliente no vino de ningún link, `null`.
          // El panel y el bot nunca mandan etiqueta, y fabricarles un DIRECTO sería mentir:
          // esa reserva no entró por la web.
          origenEtiqueta: input.origenEtiqueta ?? null,
          origenTipo: input.origenEtiqueta ? clasificarOrigen(input.origenEtiqueta) : null,
```

- [ ] **Step 5: Aceptar los campos en el repositorio**

En `backend/src/repositories/reserva.repo.ts`, agregar `TipoOrigen` al import de `../db/client.js` y a `CreateReservaData`, después de `turnoFijoId`:

```ts
  origenEtiqueta?: string | null;
  origenTipo?: TipoOrigen | null;
```

- [ ] **Step 6: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run tests/integration/reserva-origen.test.ts
```

Esperado: PASS, 3 tests.

- [ ] **Step 7: Correr toda la suite del backend**

```bash
cd backend && npm run typecheck && npm test
```

Esperado: todo verde. Este es el punto donde se vería si `resetTables` quedó incompleto.

- [ ] **Step 8: Commit**

```bash
git add backend/src backend/tests/integration/reserva-origen.test.ts
git commit -m "feat(visitas): la reserva guarda el link por el que llego el cliente"
```

---

### Task 6: `reservas/` — setup de tests y lógica de cookies

**Files:**
- Create: `reservas/vitest.config.ts`
- Modify: `reservas/package.json`
- Create: `reservas/src/lib/origen.ts`
- Test: `reservas/src/lib/origen.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces, todo exportado desde `reservas/src/lib/origen.ts`:
  - `COOKIE_VISITANTE = 'gb_vid'`, `COOKIE_SESION = 'gb_sid'`, `COOKIE_ORIGEN = 'gb_org'`
  - `DIAS_ORIGEN = 30`, `MINUTOS_SESION = 30`, `MINUTOS_ORIGEN_FRESCO = 5`
  - `esEtiquetaValida(v: string): boolean`
  - `serializarOrigen(etiqueta: string, ahora: number): string`
  - `etiquetaDeVisita(valor: string | undefined, ahora: number): string | null`
  - `etiquetaDeReserva(valor: string | undefined): string | null`

  Los consumen las Tareas 7, 8 y 9.

- [ ] **Step 1: Instalar vitest y agregar el script**

```bash
cd reservas && pnpm add -D vitest@^4.1.8
```

En `reservas/package.json`, agregar a `scripts`:

```json
    "test": "vitest run"
```

- [ ] **Step 2: Crear la config de vitest**

Crear `reservas/vitest.config.ts` (copia reducida de la del panel — acá no hace falta el mock de
`server-only`, porque `origen.ts` es lógica pura y no toca el server):

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
```

- [ ] **Step 3: Escribir el test que falla**

Crear `reservas/src/lib/origen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  esEtiquetaValida, serializarOrigen, etiquetaDeVisita, etiquetaDeReserva, MINUTOS_ORIGEN_FRESCO,
} from './origen';

const AHORA = 1_800_000_000_000;
const MIN = 60_000;

describe('esEtiquetaValida', () => {
  it('acepta las etiquetas que usamos', () => {
    for (const e of ['landing', 'ig-bio', 'whatsapp', 'qr-entrada']) expect(esEtiquetaValida(e)).toBe(true);
  });
  it('rechaza mayúsculas, espacios, vacío y demasiado largo', () => {
    for (const e of ['IG-Bio', 'ig bio', '', 'a'.repeat(41), '../etc']) expect(esEtiquetaValida(e)).toBe(false);
  });
});

describe('etiquetaDeVisita', () => {
  it('vale si la cookie se escribió en esta llegada', () => {
    const v = serializarOrigen('ig-bio', AHORA);
    expect(etiquetaDeVisita(v, AHORA + 10_000)).toBe('ig-bio');
  });

  it('no vale pasada la ventana de frescura: si no, quien entró una vez por el QR seguiría contando como QR', () => {
    const v = serializarOrigen('qr-entrada', AHORA);
    expect(etiquetaDeVisita(v, AHORA + (MINUTOS_ORIGEN_FRESCO + 1) * MIN)).toBeNull();
  });

  it('sin cookie o con basura, la visita es directa', () => {
    expect(etiquetaDeVisita(undefined, AHORA)).toBeNull();
    expect(etiquetaDeVisita('sin-punto', AHORA)).toBeNull();
    expect(etiquetaDeVisita('IG BIO.123', AHORA)).toBeNull();
    expect(etiquetaDeVisita('ig-bio.no-es-numero', AHORA)).toBeNull();
  });
});

describe('etiquetaDeReserva', () => {
  it('vale toda la vida de la cookie: la atribución es last-touch', () => {
    const v = serializarOrigen('whatsapp', AHORA);
    expect(etiquetaDeReserva(v)).toBe('whatsapp');
  });
  it('sin cookie no hay atribución', () => {
    expect(etiquetaDeReserva(undefined)).toBeNull();
    expect(etiquetaDeReserva('basura')).toBeNull();
  });
});
```

- [ ] **Step 4: Correr el test para verificar que falla**

```bash
cd reservas && pnpm test
```

Esperado: FAIL — no existe `src/lib/origen.ts`.

- [ ] **Step 5: Escribir `origen.ts`**

Crear `reservas/src/lib/origen.ts`:

```ts
// Cookies propias del sitio de reservas. Todas first-party, sin datos personales: no se
// guarda ni IP ni user-agent, sólo identificadores opacos que genera este mismo server.
export const COOKIE_VISITANTE = 'gb_vid';
export const COOKIE_SESION = 'gb_sid';
export const COOKIE_ORIGEN = 'gb_org';

/** Cuánto dura la atribución del origen a una reserva (last-touch). */
export const DIAS_ORIGEN = 30;
/** Una sesión es una visita: quien recarga tres veces en media hora cuenta una. */
export const MINUTOS_SESION = 30;
/**
 * Ventana en la que la cookie de origen se considera "de esta llegada". El redirect de
 * /r/<etiqueta> a / y el montaje del beacon tardan segundos; 5 minutos es pura holgura.
 */
export const MINUTOS_ORIGEN_FRESCO = 5;

const ETIQUETA_RE = /^[a-z0-9-]{1,40}$/;

export function esEtiquetaValida(v: string): boolean {
  return ETIQUETA_RE.test(v);
}

/** Valor de `gb_org`: `<etiqueta>.<epochMs>`. El timestamp es lo que permite las dos lecturas. */
export function serializarOrigen(etiqueta: string, ahora: number): string {
  return `${etiqueta}.${ahora}`;
}

function parsear(valor: string | undefined): { etiqueta: string; puestoEn: number } | null {
  if (!valor) return null;
  // `lastIndexOf` y no `split`: la etiqueta puede tener guiones, pero nunca un punto.
  const i = valor.lastIndexOf('.');
  if (i <= 0) return null;
  const etiqueta = valor.slice(0, i);
  const puestoEn = Number(valor.slice(i + 1));
  if (!esEtiquetaValida(etiqueta) || !Number.isFinite(puestoEn)) return null;
  return { etiqueta, puestoEn };
}

/**
 * Etiqueta con la que se registra una VISITA. Sólo vale si la cookie se escribió recién, o
 * sea en esta llegada. Sin esta regla, alguien que entró una vez por el QR y después escribe
 * la URL a mano seguiría contando como QR durante 30 días, y el conteo por canal mentiría.
 */
export function etiquetaDeVisita(valor: string | undefined, ahora: number): string | null {
  const o = parsear(valor);
  if (!o) return null;
  const transcurrido = ahora - o.puestoEn;
  if (transcurrido < 0 || transcurrido > MINUTOS_ORIGEN_FRESCO * 60_000) return null;
  return o.etiqueta;
}

/** Etiqueta con la que se ATRIBUYE una reserva: vale toda la vida de la cookie (last-touch). */
export function etiquetaDeReserva(valor: string | undefined): string | null {
  return parsear(valor)?.etiqueta ?? null;
}
```

- [ ] **Step 6: Correr el test para verificar que pasa**

```bash
cd reservas && pnpm test
```

Esperado: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add reservas/package.json reservas/pnpm-lock.yaml reservas/vitest.config.ts reservas/src/lib/origen.ts reservas/src/lib/origen.test.ts
git commit -m "feat(visitas): logica de cookies de origen en el sitio de reservas"
```

---

### Task 7: `reservas/` — la ruta `/r/<etiqueta>`

**Files:**
- Create: `reservas/src/app/r/[etiqueta]/route.ts`

**Interfaces:**
- Consumes: `COOKIE_ORIGEN`, `DIAS_ORIGEN`, `esEtiquetaValida`, `serializarOrigen` de la Tarea 6.
- Produces: la ruta `GET /r/<etiqueta>` que setea `gb_org` y responde 302 a `/`. La consumen los links impresos y publicados.

- [ ] **Step 1: Leer la documentación de route handlers de Next 16**

```bash
ls reservas/node_modules/next/dist/docs/
```

Leer la guía de route handlers y de `params` asíncronos antes de escribir el archivo. En Next 16
`params` llega como `Promise`.

- [ ] **Step 2: Escribir la ruta**

Crear `reservas/src/app/r/[etiqueta]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { COOKIE_ORIGEN, DIAS_ORIGEN, esEtiquetaValida, serializarOrigen } from '@/lib/origen';

/**
 * Punto de entrada de todos los links del complejo: /r/whatsapp, /r/ig-bio, /r/landing, y
 * el día que se impriman, /r/qr-entrada y compañía.
 *
 * Esta ruta SÓLO etiqueta y redirige — deliberadamente no escribe nada en la base. Cuando el
 * bot manda el link, WhatsApp hace su propio fetch de la página para armar la previsualización:
 * si registráramos la visita acá, contaríamos como visita algo que ninguna persona miró, y
 * justo en el canal que más interesa medir. El registro real lo dispara el navegador desde `/`.
 *
 * La etiqueta inválida no es un error para el visitante: llega igual a reservar, sólo que sin
 * quedar atribuida. Romperle la reserva a alguien por un link mal tipeado sería peor.
 */
export async function GET(req: Request, ctx: { params: Promise<{ etiqueta: string }> }) {
  const { etiqueta } = await ctx.params;
  const res = NextResponse.redirect(new URL('/', req.url), 302);
  if (esEtiquetaValida(etiqueta)) {
    res.cookies.set(COOKIE_ORIGEN, serializarOrigen(etiqueta, Date.now()), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: DIAS_ORIGEN * 24 * 60 * 60,
    });
  }
  return res;
}
```

- [ ] **Step 3: Verificar a mano contra el server de desarrollo**

```bash
cd reservas && pnpm dev
```

En otra terminal:

```bash
curl -si http://localhost:3000/r/ig-bio | grep -iE '^(HTTP|location|set-cookie)'
```

Esperado: `HTTP/1.1 302`, `location: /` (o la URL absoluta), y un `set-cookie: gb_org=ig-bio.<numero>; ... HttpOnly; SameSite=lax`.

```bash
curl -si 'http://localhost:3000/r/NO%20VALE' | grep -iE '^(HTTP|set-cookie)'
```

Esperado: `HTTP/1.1 302` y **ningún** `set-cookie`.

Cortar el server con Ctrl-C.

- [ ] **Step 4: Verificar que compila**

```bash
cd reservas && pnpm build && pnpm lint
```

Esperado: build y lint sin errores.

- [ ] **Step 5: Commit**

```bash
git add reservas/src/app/r
git commit -m "feat(visitas): ruta /r/<etiqueta> que etiqueta y redirige"
```

---

### Task 8: `reservas/` — el registro de la visita

**Files:**
- Create: `reservas/src/app/api/visita/route.ts`
- Create: `reservas/src/components/registro-visita.tsx`
- Modify: `reservas/src/app/page.tsx`

**Interfaces:**
- Consumes: las constantes y `etiquetaDeVisita` de la Tarea 6; `apiReservas` de `@/lib/api`; el endpoint `POST /visitas` de la Tarea 3.
- Produces: `POST /api/visita` (body `{ referer?: string | null }`, respuesta 204) y el componente `<RegistroVisita />`.

- [ ] **Step 1: Escribir el route handler**

Crear `reservas/src/app/api/visita/route.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiReservas } from '@/lib/api';
import {
  COOKIE_ORIGEN, COOKIE_SESION, COOKIE_VISITANTE, MINUTOS_SESION, etiquetaDeVisita,
} from '@/lib/origen';

const ANIO_EN_SEG = 365 * 24 * 60 * 60;

/**
 * El único lugar que registra una visita. Lo llama el beacon del navegador, nunca un bot:
 * las previsualizaciones de links y los crawlers no ejecutan JavaScript.
 */
export async function POST(req: Request) {
  const jar = await cookies();
  const res = new NextResponse(null, { status: 204 });
  const base = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };

  const visitanteId = jar.get(COOKIE_VISITANTE)?.value ?? randomUUID();
  res.cookies.set(COOKIE_VISITANTE, visitanteId, { ...base, maxAge: ANIO_EN_SEG });

  // La cookie de sesión expira sola a los 30 minutos: que exista significa que esta visita ya
  // se contó, así que sólo se le renueva la ventana y se corta acá. Es lo que hace que quien
  // recarga o navega entre pantallas cuente una vez.
  const sesionVigente = jar.get(COOKIE_SESION)?.value;
  const sesionId = sesionVigente ?? randomUUID();
  res.cookies.set(COOKIE_SESION, sesionId, { ...base, maxAge: MINUTOS_SESION * 60 });
  if (sesionVigente) return res;

  let referer: string | null = null;
  try {
    const body = (await req.json()) as { referer?: unknown };
    if (typeof body.referer === 'string' && body.referer) referer = body.referer.slice(0, 500);
  } catch {
    // Body vacío o mal formado: el referer es opcional, seguimos sin él.
  }

  try {
    await apiReservas('/visitas', {
      method: 'POST',
      body: JSON.stringify({
        etiqueta: etiquetaDeVisita(jar.get(COOKIE_ORIGEN)?.value, Date.now()),
        sesionId,
        visitanteId,
        referer,
      }),
    });
  } catch (e) {
    // Una estadística que no se pudo guardar no puede romperle la pantalla a nadie.
    console.error('[visita] no se pudo registrar', { error: e instanceof Error ? e.message : e });
  }

  return res;
}
```

- [ ] **Step 2: Escribir el beacon**

Crear `reservas/src/components/registro-visita.tsx`:

```tsx
'use client';
import { useEffect } from 'react';

// Guarda a nivel de módulo, no `useRef`: en desarrollo React monta dos veces con StrictMode y
// serían dos requests. El backend igual deduplica por sesión; esto sólo ahorra el viaje.
let enviado = false;

/**
 * Avisa que alguien entró al sitio. Vive en el navegador a propósito: es lo que deja afuera a
 * las previsualizaciones de links y a los crawlers, que no ejecutan JavaScript.
 */
export function RegistroVisita() {
  useEffect(() => {
    if (enviado) return;
    enviado = true;
    fetch('/api/visita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referer: document.referrer || null }),
    }).catch(() => {
      // Registrar una visita nunca puede romper una reserva.
    });
  }, []);
  return null;
}
```

- [ ] **Step 3: Montarlo en la home**

En `reservas/src/app/page.tsx`, agregar el import:

```tsx
import { RegistroVisita } from "@/components/registro-visita";
```

Y dentro del `<main>`, como primer hijo:

```tsx
      <RegistroVisita />
```

El `<main>` queda así:

```tsx
    <main className="flex flex-1 flex-col bg-neutral-950 text-neutral-100">
      <RegistroVisita />
      {hayAlgunMetodo ? <PantallaReserva metodos={metodos} /> : <ReservasCerradas />}
    </main>
```

Va antes del condicional a propósito: la visita se cuenta aunque el sitio esté mostrando
`ReservasCerradas`. Saber que entró gente mientras no se podía reservar es justamente el tipo
de cosa que uno quiere ver en el panel.

- [ ] **Step 4: Verificar a mano el camino completo**

Con el backend corriendo (`cd backend && npm run dev`) y el sitio en otro puerto
(`cd reservas && PORT=3001 pnpm dev`), abrir en el navegador
`http://localhost:3001/r/ig-bio`, y después:

```bash
cd backend && npx prisma studio
```

Esperado: una fila en `Visita` con `etiqueta = 'ig-bio'` y `tipo = 'REDES'`. Recargar `/` en el
navegador y comprobar que **no** aparece una segunda fila (la sesión sigue vigente).

- [ ] **Step 5: Verificar que compila**

```bash
cd reservas && pnpm build && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add reservas/src/app/api reservas/src/components/registro-visita.tsx reservas/src/app/page.tsx
git commit -m "feat(visitas): beacon de registro de visita en el sitio publico"
```

---

### Task 9: `reservas/` — atribuir la reserva

**Files:**
- Modify: `reservas/src/lib/actions.ts`

**Interfaces:**
- Consumes: `COOKIE_ORIGEN` y `etiquetaDeReserva` de la Tarea 6; el `origenEtiqueta` que acepta `POST /reservas` desde la Tarea 5.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Leer el `crearReserva` actual**

```bash
sed -n '/export async function crearReserva/,/^}/p' reservas/src/lib/actions.ts
```

- [ ] **Step 2: Agregar la lectura de la cookie**

En `reservas/src/lib/actions.ts`, agregar los imports arriba:

```ts
import { cookies } from 'next/headers';
import { COOKIE_ORIGEN, etiquetaDeReserva } from './origen';
```

Y dentro de `crearReserva`, como primera línea del `try`:

```ts
    // Last-touch: el último link por el que pasó el cliente, dentro de los 30 días de la
    // cookie. No se manda nada si no hay cookie — el backend deja las columnas en null.
    const origenEtiqueta = etiquetaDeReserva((await cookies()).get(COOKIE_ORIGEN)?.value);
```

Y en el `body` del `apiReservas`, después de la línea de `metodoSena`:

```ts
        ...(origenEtiqueta ? { origenEtiqueta } : {}),
```

- [ ] **Step 3: Verificar a mano**

Con el backend y el sitio corriendo, entrar por `http://localhost:3001/r/whatsapp`, completar
una reserva de punta a punta, y confirmar en Prisma Studio que la fila de `Reserva` tiene
`origenEtiqueta = 'whatsapp'` y `origenTipo = 'WHATSAPP'`.

- [ ] **Step 4: Verificar que compila y que los tests siguen verdes**

```bash
cd reservas && pnpm build && pnpm lint && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add reservas/src/lib/actions.ts
git commit -m "feat(visitas): la reserva publica viaja con su etiqueta de origen"
```

---

### Task 10: Panel — el bloque en el dashboard

**Files:**
- Create: `frontend/src/lib/origen.ts`
- Test: `frontend/src/lib/origen.test.ts`
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/components/dashboard/origenes-chart.tsx`
- Create: `frontend/src/components/dashboard/origenes-tabla.tsx`
- Modify: `frontend/src/app/(panel)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /analytics/origenes` de la Tarea 4.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/lib/origen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nombreOrigen, nombreEtiqueta } from './origen';

describe('nombreOrigen', () => {
  it('traduce cada tipo a algo legible', () => {
    expect(nombreOrigen('WHATSAPP')).toBe('WhatsApp');
    expect(nombreOrigen('QR')).toBe('QR');
    expect(nombreOrigen('REDES')).toBe('Redes');
    expect(nombreOrigen('LANDING')).toBe('Landing');
    expect(nombreOrigen('DIRECTO')).toBe('Directo');
    expect(nombreOrigen('OTRO')).toBe('Otro');
  });
});

describe('nombreEtiqueta', () => {
  it('la visita sin etiqueta se muestra como directa, no como un guion suelto', () => {
    expect(nombreEtiqueta(null)).toBe('(sin link)');
  });
  it('la etiqueta se muestra tal cual: es lo que está impreso en el QR', () => {
    expect(nombreEtiqueta('ig-bio')).toBe('ig-bio');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd frontend && npx vitest run src/lib/origen.test.ts
```

Esperado: FAIL — no existe `src/lib/origen.ts`.

- [ ] **Step 3: Agregar los tipos**

Va antes de los helpers porque `origen.ts` importa `TipoOrigen` de acá.

En `frontend/src/lib/types.ts`, al final:

```ts
export type TipoOrigen = 'WHATSAPP' | 'QR' | 'REDES' | 'LANDING' | 'DIRECTO' | 'OTRO';
export interface OrigenPorTipo { tipo: TipoOrigen; visitas: number; unicos: number }
export interface OrigenPorEtiqueta extends OrigenPorTipo { etiqueta: string | null }
export interface Origenes {
  total: number;
  unicos: number;
  porTipo: OrigenPorTipo[];
  porEtiqueta: OrigenPorEtiqueta[];
}
```

- [ ] **Step 4: Escribir los helpers**

Crear `frontend/src/lib/origen.ts`:

```ts
import type { TipoOrigen } from './types';

const NOMBRE: Record<TipoOrigen, string> = {
  WHATSAPP: 'WhatsApp',
  QR: 'QR',
  REDES: 'Redes',
  LANDING: 'Landing',
  DIRECTO: 'Directo',
  OTRO: 'Otro',
};

export function nombreOrigen(tipo: TipoOrigen): string {
  return NOMBRE[tipo] ?? tipo;
}

/** La etiqueta se muestra cruda porque es lo que está impreso en el QR o pegado en el link. */
export function nombreEtiqueta(etiqueta: string | null): string {
  return etiqueta ?? '(sin link)';
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd frontend && npx vitest run src/lib/origen.test.ts
```

Esperado: PASS, 2 tests.

- [ ] **Step 6: Escribir el gráfico**

Crear `frontend/src/components/dashboard/origenes-chart.tsx` (mismo molde que `horarios-chart.tsx`):

```tsx
'use client';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { nombreOrigen } from '@/lib/origen';
import type { OrigenPorTipo } from '@/lib/types';

export function OrigenesChart({ data }: { data: OrigenPorTipo[] }) {
  const filas = data.map((d) => ({ canal: nombreOrigen(d.tipo), visitas: d.visitas }));
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">De dónde llegan</CardTitle></CardHeader>
      <CardContent className="h-64">
        {filas.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay visitas en este período.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filas}>
              <XAxis dataKey="canal" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip />
              <Bar dataKey="visitas" fill="#171717" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Escribir la tabla**

Crear `frontend/src/components/dashboard/origenes-tabla.tsx`. Es un server component: no tiene
interactividad, así que no lleva `'use client'`.

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { nombreEtiqueta, nombreOrigen } from '@/lib/origen';
import type { OrigenPorEtiqueta } from '@/lib/types';

export function OrigenesTabla({ data }: { data: OrigenPorEtiqueta[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">Detalle por link</CardTitle></CardHeader>
      <CardContent className="h-64 overflow-y-auto">
        {data.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay visitas en este período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr>
                <th className="pb-2 font-medium">Link</th>
                <th className="pb-2 font-medium">Canal</th>
                <th className="pb-2 text-right font-medium">Visitas</th>
                <th className="pb-2 text-right font-medium">Personas</th>
              </tr>
            </thead>
            <tbody>
              {data.map((f) => (
                <tr key={`${f.etiqueta ?? 'directo'}-${f.tipo}`} className="border-t border-neutral-100">
                  <td className="py-2 font-medium text-neutral-900">{nombreEtiqueta(f.etiqueta)}</td>
                  <td className="py-2 text-neutral-600">{nombreOrigen(f.tipo)}</td>
                  <td className="py-2 text-right tabular-nums">{f.visitas}</td>
                  <td className="py-2 text-right tabular-nums text-neutral-600">{f.unicos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: Montarlo en el dashboard**

En `frontend/src/app/(panel)/dashboard/page.tsx`:

Agregar `Eye` y `Users` al import de `lucide-react`:

```tsx
import { DollarSign, CalendarDays, Trophy, Eye, Users } from 'lucide-react';
```

Agregar `Origenes` al import de tipos y los dos componentes nuevos:

```tsx
import type { Reserva, Cancha, Config, IngresoDia, OcupacionCelda, HorarioPico, Origenes } from '@/lib/types';
import { OrigenesChart } from '@/components/dashboard/origenes-chart';
import { OrigenesTabla } from '@/components/dashboard/origenes-tabla';
```

Agregar la novena promesa al `Promise.all` (y `origenes` al destructuring, al final):

```tsx
    safe(apiFetch<Origenes>(`/analytics/origenes?${qs}`), { total: 0, unicos: 0, porTipo: [], porEtiqueta: [] }),
```

Agregar las dos métricas a la grilla de `MetricCard`:

```tsx
        <MetricCard title="Visitas al sitio" value={String(origenes.total)} hint="Sesiones en la web de reservas" Icon={Eye} />
        <MetricCard title="Personas distintas" value={String(origenes.unicos)} Icon={Users} />
```

Y el bloque nuevo, después de la grilla de `HorariosChart` / `OcupacionHeatmap`:

```tsx
      <div className="grid gap-4 lg:grid-cols-2">
        <OrigenesChart data={origenes.porTipo} />
        <OrigenesTabla data={origenes.porEtiqueta} />
      </div>
```

- [ ] **Step 9: Verificar**

```bash
cd frontend && pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

Esperado: todo verde.

- [ ] **Step 10: Mirarlo con datos**

Con el backend corriendo, entrar al panel en `/dashboard` y confirmar que las dos métricas y las
dos tarjetas aparecen, y que cambiar el período con el `PeriodoSelector` las actualiza.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/lib/origen.ts frontend/src/lib/origen.test.ts frontend/src/lib/types.ts frontend/src/components/dashboard/origenes-chart.tsx frontend/src/components/dashboard/origenes-tabla.tsx "frontend/src/app/(panel)/dashboard/page.tsx"
git commit -m "feat(visitas): bloque de origen de visitas en el dashboard"
```

---

## Cierre

- [ ] **Verificación final**

```bash
cd backend && npm run typecheck && npm test
cd ../frontend && pnpm typecheck && pnpm lint && pnpm test && pnpm build
cd ../reservas && pnpm lint && pnpm test && pnpm build
```

Los tres tienen que quedar verdes antes de abrir el PR.

- [ ] **Links para publicar**

Una vez desplegado, los tres links a usar:

- `https://reserva.gambeteandopadelyfutbol.ar/r/whatsapp` — el que manda el bot en el primer mensaje
- `https://reserva.gambeteandopadelyfutbol.ar/r/ig-bio` — bio de Instagram
- `https://reserva.gambeteandopadelyfutbol.ar/r/landing` — botón de la landing

El flujo de n8n que manda el primer mensaje por WhatsApp hay que actualizarlo para que mande
`/r/whatsapp` en vez de la raíz. Si no, todo WhatsApp cuenta como `DIRECTO`.

- [ ] **PR**

```bash
git push -u origin feat/origen-visitas
gh pr create --title "feat: origen de visitas al sitio de reservas" --body "Implementa docs/superpowers/specs/2026-08-31-origen-visitas-design.md"
```

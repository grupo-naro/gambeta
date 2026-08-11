# Buffet con dos mostradores — Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el backend distinga dos mostradores de buffet, permita que el principal le entregue stock al secundario, y concilie al cierre lo entregado contra lo vendido.

**Architecture:** Una tabla `Mostrador` con un PIN por puesto; `CajaBuffet` pasa a pertenecer a un mostrador y la unicidad de "caja abierta" pasa de global a por mostrador. El stock general sigue siendo el del principal; el secundario tiene su propio stock asignado, que la entrega mueve y la venta descuenta. Al cerrar, el principal carga el conteo físico y **lo contado** vuelve al general.

**Tech Stack:** Express 5, Prisma 7 (cliente en `src/generated/prisma`, singleton `src/db/prisma.ts`), zod, vitest + Testcontainers.

**Diseño de referencia:** `docs/superpowers/specs/2026-08-07-buffet-dos-mostradores-design.md`

**Alcance:** solo backend. Las pantallas del mostrador y del panel van en un plan aparte.

## Global Constraints

- **Código, comentarios y vocabulario en español.** No traducir `cancha`, `seña`, `mostrador`, `caja`, `buffet`.
- **Nunca importar de `@prisma/client`.** Tipos desde `src/db/client.ts`; runtime desde `src/db/prisma.ts`.
- Errores esperados = factories de `src/utils/errors.ts`. Nunca `Error` crudo.
- Capas en una sola dirección: `routes/ → services/ → repositories/ → db/prisma.ts`.
- **`authBuffet` no acepta el JWT de admin ni la `SERVICE_API_KEY`**, y eso no cambia.
- Los invariantes de integridad van **en la base**, no en el código, siguiendo el criterio que ya usa el proyecto (índice único parcial de caja abierta, restricción de exclusión de reservas).
- Tests de integración necesitan Docker. **Correr archivos puntuales, nunca `npm test` entero.**
- Backend usa **npm**.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/prisma/schema.prisma` (modificar) | Modelos `Mostrador`, `StockMostrador`, `EntregaMostrador`, `EntregaMostradorLinea`, `ConteoCierreLinea`; `CajaBuffet.mostradorId`. |
| `backend/src/services/buffetPin.service.ts` (modificar) | El PIN pasa a resolver **qué mostrador** es, no solo si es válido. |
| `backend/src/utils/mostradorToken.ts` (crear) | Firmar y verificar el token que identifica al mostrador en cada request. |
| `backend/src/middlewares/authBuffet.ts` (modificar) | Además de la key, resuelve el mostrador y lo deja en `req.mostrador`. |
| `backend/src/services/buffetEntrega.service.ts` (crear) | La entrega principal → secundario. Mueve stock en las dos direcciones. |
| `backend/src/services/buffetCaja.service.ts` (modificar) | Caja por mostrador; la venta del secundario descuenta del asignado. |
| `backend/src/services/buffetConciliacion.service.ts` (crear) | El conteo físico, la diferencia, y la devolución de lo contado. |
| `backend/src/routes/buffet.routes.ts` (modificar) | Rutas de entrega y de conciliación. |
| `backend/src/validators/buffet.schema.ts` (modificar) | Schemas zod de lo nuevo. |

---

### Task 1: Mostradores y caja por mostrador

Sin esto no hay nada: es el cambio que hace que el sistema sepa quién vendió.

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/tests/helpers/db.ts` (`resetTables`)
- Test: `backend/tests/integration/buffet-mostradores.test.ts`

**Interfaces:**
- Produces: modelo `Mostrador` con `{ id, nombre, tipo: TipoMostrador, pinHash, activo }`.
- Produces: `TipoMostrador` = `PRINCIPAL | SECUNDARIO`.
- Produces: `CajaBuffet.mostradorId` (obligatorio).

- [ ] **Step 1: Agregar los modelos**

En `backend/prisma/schema.prisma`:

```prisma
enum TipoMostrador {
  PRINCIPAL
  SECUNDARIO
}

/// Un puesto de atención del buffet. Cada uno tiene su propio PIN: es lo que permite
/// saber QUIÉN vendió, y sin eso la conciliación del cierre es imposible.
model Mostrador {
  id        String        @id @default(cuid())
  nombre    String
  tipo      TipoMostrador
  pinHash   String        @default("")
  activo    Boolean       @default(true)
  cajas     CajaBuffet[]
  stock     StockMostrador[]
  entregas  EntregaMostrador[]

  /// Un solo mostrador de cada tipo. El diseño es para dos puestos, no N.
  @@unique([tipo])
}
```

Y en `CajaBuffet`, agregar la relación:

```prisma
  mostradorId   String
  mostrador     Mostrador        @relation(fields: [mostradorId], references: [id])
```

más `@@index([mostradorId])`.

- [ ] **Step 2: Escribir la migración a mano**

**No uses `prisma migrate dev`**: la base de desarrollo tiene una deriva preexistente
(`Cobro.suscripcionId`) que hace que Prisma pida un reset destructivo. No lo aceptes.

Creá `backend/prisma/migrations/<timestamp>_buffet_mostradores/migration.sql` con este contenido
exacto:

```sql
-- CreateEnum
CREATE TYPE "TipoMostrador" AS ENUM ('PRINCIPAL', 'SECUNDARIO');

-- CreateTable
CREATE TABLE "Mostrador" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoMostrador" NOT NULL,
    "pinHash" TEXT NOT NULL DEFAULT '',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Mostrador_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Mostrador_tipo_key" ON "Mostrador"("tipo");

-- Los dos mostradores se crean acá, no en el seed: el backfill de más abajo necesita que el
-- principal exista, y una base sin mostradores dejaría el buffet inutilizable.
INSERT INTO "Mostrador" ("id", "nombre", "tipo", "pinHash")
SELECT 'mostrador-principal', 'Principal', 'PRINCIPAL', COALESCE((SELECT "buffetPinHash" FROM "Configuracion" WHERE id = 'default'), '');
INSERT INTO "Mostrador" ("id", "nombre", "tipo", "pinHash")
VALUES ('mostrador-secundario', 'Secundario', 'SECUNDARIO', '');

-- CajaBuffet pasa a pertenecer a un mostrador. Se agrega nullable, se rellena, y recién
-- después se vuelve obligatoria: si se creara NOT NULL de una, fallaría con filas existentes.
ALTER TABLE "CajaBuffet" ADD COLUMN "mostradorId" TEXT;
UPDATE "CajaBuffet" SET "mostradorId" = 'mostrador-principal' WHERE "mostradorId" IS NULL;
ALTER TABLE "CajaBuffet" ALTER COLUMN "mostradorId" SET NOT NULL;
ALTER TABLE "CajaBuffet" ADD CONSTRAINT "CajaBuffet_mostradorId_fkey"
  FOREIGN KEY ("mostradorId") REFERENCES "Mostrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CajaBuffet_mostradorId_idx" ON "CajaBuffet"("mostradorId");

-- La unicidad de "caja abierta" pasa de GLOBAL a POR MOSTRADOR. Sin esto, abrir la caja del
-- secundario fallaría con P2002 porque el principal ya tiene una abierta.
DROP INDEX "CajaBuffet_una_abierta";
CREATE UNIQUE INDEX "CajaBuffet_una_abierta_por_mostrador"
  ON "CajaBuffet"("mostradorId") WHERE "estado" = 'ABIERTA'::"EstadoCajaBuffet";
```

Aplicala y marcala como aplicada:

```bash
docker exec -i <contenedor-postgres> psql -U <usuario> -d <base> < prisma/migrations/<timestamp>_buffet_mostradores/migration.sql
npx prisma migrate resolve --applied <timestamp>_buffet_mostradores
npx prisma generate
```

Si no tenés la base de desarrollo levantada, saltá la aplicación local: los tests corren contra
un contenedor limpio que aplica todas las migraciones desde cero.

- [ ] **Step 3: Sumar las tablas al reseteo entre tests**

En `backend/tests/helpers/db.ts`, agregá `StockMostrador`, `EntregaMostradorLinea`,
`EntregaMostrador`, `ConteoCierreLinea` y `Mostrador` a `resetTables()`, **respetando el orden de
las dependencias** (las hijas antes que las madres, como ya hace el resto del archivo).

**Ojo:** borrar `Mostrador` entre tests deja al buffet sin los dos puestos que creó la migración.
Que `resetTables()` los vuelva a insertar después de truncar, con los mismos ids
(`mostrador-principal`, `mostrador-secundario`) y `pinHash` vacío.

- [ ] **Step 4: Escribir el test**

Crear `backend/tests/integration/buffet-mostradores.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('mostradores', () => {
  it('existen el principal y el secundario', async () => {
    const ms = await getPrisma().mostrador.findMany({ orderBy: { tipo: 'asc' } });
    expect(ms.map((m) => m.tipo)).toEqual(['PRINCIPAL', 'SECUNDARIO']);
  });

  it('no se puede crear un tercer mostrador del mismo tipo', async () => {
    await expect(
      getPrisma().mostrador.create({ data: { nombre: 'Otro', tipo: 'PRINCIPAL' } }),
    ).rejects.toThrow();
  });

  it('cada mostrador puede tener su propia caja abierta a la vez', async () => {
    const p = await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } });
    const s = await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-secundario' } });
    expect(p.estado).toBe('ABIERTA');
    expect(s.estado).toBe('ABIERTA');
  });

  it('un mismo mostrador NO puede tener dos cajas abiertas', async () => {
    // La garantía es del índice único parcial, no del código: el servicio hace
    // "buscar o crear" y sin esta restricción una carrera abriría dos cajas.
    await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } });
    await expect(
      getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } }),
    ).rejects.toThrow();
  });

  it('cerrar una libera el lugar para abrir otra en el mismo mostrador', async () => {
    const c = await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } });
    await getPrisma().cajaBuffet.update({ where: { id: c.id }, data: { estado: 'CERRADA', cerradaEn: new Date() } });
    const nueva = await getPrisma().cajaBuffet.create({ data: { mostradorId: 'mostrador-principal' } });
    expect(nueva.id).not.toBe(c.id);
  });
});
```

- [ ] **Step 5: Correr y verificar**

Run: `npx vitest run tests/integration/buffet-mostradores.test.ts && npm run typecheck`
Expected: PASS los 5 casos, typecheck limpio.

Si `buffetCaja.service.ts` no compila porque `cajaBuffet.create({ data: {} })` ahora exige
`mostradorId`, dejalo apuntando a `'mostrador-principal'` por ahora — la Task 3 lo hace bien.

- [ ] **Step 6: Correr la regresión del buffet**

Run: `npx vitest run tests/integration/buffet.test.ts tests/integration/buffet-caja.test.ts`

Si esos archivos no existen, buscá los que haya con `ls tests/integration | grep -i buffet` y corré
esos. Tienen que seguir pasando: el mostrador principal no cambia de comportamiento.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/tests backend/src
git commit -m "feat(buffet): modelo de mostradores y caja por mostrador"
```

---

### Task 2: El PIN identifica al mostrador

Hoy `authBuffet` valida una `x-buffet-key` compartida y nada más; el PIN gatea el frontend, no la
API. Si el mostrador simplemente declarara quién es en un header, la conciliación se apoyaría en la
palabra del que está siendo controlado. Por eso el servidor firma un token al verificar el PIN.

**Files:**
- Create: `backend/src/utils/mostradorToken.ts`
- Modify: `backend/src/services/buffetPin.service.ts`
- Modify: `backend/src/middlewares/authBuffet.ts`
- Modify: `backend/src/routes/buffet.routes.ts` (la ruta `PUT /buffet/pin`)
- Test: `backend/tests/integration/buffet-identidad.test.ts`

**Interfaces:**
- Consumes: modelo `Mostrador` (Task 1).
- Produces: `firmarTokenMostrador(mostradorId: string): string` y `verificarTokenMostrador(token: string | undefined): string | null` (devuelve el `mostradorId` o `null`).
- Produces: `buffetPinService.verificar(pin: string): Promise<{ mostradorId: string; tipo: 'PRINCIPAL' | 'SECUNDARIO'; nombre: string } | null>` — **cambia**: antes devolvía `boolean`.
- Produces: `buffetPinService.setear(mostradorId: string, pin: string): Promise<void>` — **cambia**: antes no recibía mostrador.
- Produces: `req.mostrador` = `{ id: string; tipo: 'PRINCIPAL' | 'SECUNDARIO' }` en las rutas con `authBuffet`.

- [ ] **Step 1: Escribir el test**

Crear `backend/tests/integration/buffet-identidad.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  await getPrisma().mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  await getPrisma().mostrador.update({ where: { id: 'mostrador-secundario' }, data: { pinHash: await hashPassword('2222') } });
});

const key = (r: any) => r.set('x-buffet-key', process.env.BUFFET_API_KEY!);

describe('el PIN identifica al mostrador', () => {
  it('el PIN del principal devuelve al principal y un token', async () => {
    const res = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '1111' });
    expect(res.status).toBe(200);
    expect(res.body.tipo).toBe('PRINCIPAL');
    expect(res.body.token).toBeTruthy();
  });

  it('el PIN del secundario devuelve al secundario', async () => {
    const res = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '2222' });
    expect(res.status).toBe(200);
    expect(res.body.tipo).toBe('SECUNDARIO');
  });

  it('un PIN que no es de nadie no entra', async () => {
    const res = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '9999' });
    expect(res.status).toBe(401);
  });

  it('el token no lleva el PIN ni el hash', async () => {
    const res = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '1111' });
    expect(res.body.token).not.toContain('1111');
    expect(res.body.token).not.toContain('$');
  });

  it('un token adulterado se rechaza: no se puede decir que sos otro mostrador', async () => {
    // Es el punto entero de firmar el token. Si esto pasara, el secundario podría cargar
    // su propio conteo de cierre haciéndose pasar por el principal.
    const { firmarTokenMostrador, verificarTokenMostrador } = await import('../../src/utils/mostradorToken.js');
    const token = firmarTokenMostrador('mostrador-secundario');
    expect(verificarTokenMostrador(token)).toBe('mostrador-secundario');
    const falso = token.replace('mostrador-secundario', 'mostrador-principal');
    expect(verificarTokenMostrador(falso)).toBeNull();
    expect(verificarTokenMostrador('cualquier-cosa')).toBeNull();
    expect(verificarTokenMostrador(undefined)).toBeNull();
  });

  it('sin token, una ruta del mostrador responde 401', async () => {
    const res = await key(supertest(app).get('/buffet/caja/actual'));
    expect(res.status).toBe(401);
  });

  it('con token válido, la ruta responde', async () => {
    const login = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '1111' });
    const res = await key(supertest(app).get('/buffet/caja/actual')).set('x-mostrador', login.body.token);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/buffet-identidad.test.ts`
Expected: FAIL — no existe `mostradorToken.ts` y `/pin/verificar` todavía devuelve otra forma.

- [ ] **Step 3: El token firmado**

Crear `backend/src/utils/mostradorToken.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../config/env.js';

/**
 * Identifica al mostrador en cada request, firmado por el servidor.
 *
 * No alcanza con que el mostrador diga quién es en un header: la `x-buffet-key` es compartida
 * entre los dos puestos, así que cualquiera podría hacerse pasar por el otro — y toda la
 * conciliación del cierre depende de que "quién vendió" sea confiable. El token solo se emite
 * contra el PIN correcto.
 *
 * Formato: `<mostradorId>.<firma>`. No lleva vencimiento a propósito: la sesión del mostrador
 * dura todo el turno y expirarla a mitad de una venta sería peor que el riesgo que evita.
 */
function firma(mostradorId: string): string {
  return createHmac('sha256', getEnv().BUFFET_API_KEY).update(mostradorId).digest('hex');
}

export function firmarTokenMostrador(mostradorId: string): string {
  return `${mostradorId}.${firma(mostradorId)}`;
}

export function verificarTokenMostrador(token: string | undefined): string | null {
  if (!token) return null;
  const corte = token.lastIndexOf('.');
  if (corte < 1) return null;
  const id = token.slice(0, corte);
  const dada = Buffer.from(token.slice(corte + 1));
  const esperada = Buffer.from(firma(id));
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  return id;
}
```

- [ ] **Step 4: El PIN resuelve el mostrador**

Reemplazar `backend/src/services/buffetPin.service.ts`:

```ts
import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

export interface MostradorIdentificado { mostradorId: string; tipo: 'PRINCIPAL' | 'SECUNDARIO'; nombre: string }

export const buffetPinService = {
  async setear(mostradorId: string, pin: string): Promise<void> {
    await prisma.mostrador.update({ where: { id: mostradorId }, data: { pinHash: await hashPassword(pin) } });
  },

  /**
   * Devuelve QUÉ mostrador es, no solo si el PIN sirve. Recorre los mostradores activos y
   * compara contra cada hash: son dos, así que el costo es irrelevante.
   */
  async verificar(pin: string): Promise<MostradorIdentificado | null> {
    const mostradores = await prisma.mostrador.findMany({ where: { activo: true } });
    for (const m of mostradores) {
      // Un hash vacío nunca matchea: un mostrador sin PIN configurado no deja entrar a nadie.
      if (!m.pinHash) continue;
      if (await verifyPassword(pin, m.pinHash)) {
        return { mostradorId: m.id, tipo: m.tipo as 'PRINCIPAL' | 'SECUNDARIO', nombre: m.nombre };
      }
    }
    return null;
  },
};
```

- [ ] **Step 5: El middleware resuelve el mostrador**

En `backend/src/middlewares/authBuffet.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { isValidBuffetKey } from '../utils/buffetAuth.js';
import { verificarTokenMostrador } from '../utils/mostradorToken.js';
import { prisma } from '../db/prisma.js';
import { Unauthorized } from '../utils/errors.js';

// Auth de menor privilegio: solo abre las rutas del mostrador del buffet.
// A propósito NO acepta el JWT de admin ni la SERVICE_API_KEY.
export function authBuffet(req: Request, _res: Response, next: NextFunction) {
  if (!isValidBuffetKey(req.header('x-buffet-key'))) return next(Unauthorized('Buffet key inválida'));
  next();
}

/**
 * Además de la key, exige el token que identifica al mostrador. Va en las rutas donde importa
 * QUIÉN está operando: vender, entregar, conciliar.
 */
export async function authMostrador(req: Request, _res: Response, next: NextFunction) {
  if (!isValidBuffetKey(req.header('x-buffet-key'))) return next(Unauthorized('Buffet key inválida'));
  const id = verificarTokenMostrador(req.header('x-mostrador'));
  if (!id) return next(Unauthorized('Sesión de mostrador inválida'));
  const m = await prisma.mostrador.findUnique({ where: { id } });
  if (!m || !m.activo) return next(Unauthorized('Sesión de mostrador inválida'));
  (req as any).mostrador = { id: m.id, tipo: m.tipo };
  next();
}
```

Declarar el tipo de `req.mostrador` donde el proyecto ya declara `req.principal` y `req.valid`
(buscar en `src/types/`).

- [ ] **Step 6: Las rutas**

En `backend/src/routes/buffet.routes.ts`:

- `POST /buffet/pin/verificar` (sigue con `authBuffet` + `loginLimiter`): si el PIN resuelve un
  mostrador, responder `{ token: firmarTokenMostrador(m.mostradorId), tipo: m.tipo, nombre: m.nombre }`;
  si no, `throw Unauthorized('PIN incorrecto')`.
- Cambiar `authBuffet` por `authMostrador` en las rutas de operación:
  `/caja/abrir`, `/caja/actual`, `/caja/cerrar`, `/cobrar`, `/producto`,
  `/productos/botonera`, `/productos/activos`.
- `PUT /buffet/pin` (admin) pasa a recibir también qué mostrador: agregarle `mostradorId` al body y
  al schema `setPinSchema`, validando que sea uno de los dos ids existentes.

- [ ] **Step 7: Correr y verificar**

Run: `npx vitest run tests/integration/buffet-identidad.test.ts tests/integration/buffet-mostradores.test.ts && npm run typecheck`
Expected: PASS, typecheck limpio.

Después corré la regresión del buffet (`ls tests/integration | grep -i buffet`). Los tests
existentes que peguen a rutas del mostrador **van a fallar por falta del header `x-mostrador`**:
es el cambio buscado. Actualizalos para que primero verifiquen el PIN y manden el token, y
**decí en el reporte cuáles tocaste**.

- [ ] **Step 8: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(buffet): el PIN identifica que mostrador esta operando"
```

---

### Task 3: Stock asignado y entrega

**Files:**
- Modify: `backend/prisma/schema.prisma` (+ migración a mano)
- Create: `backend/src/services/buffetEntrega.service.ts`
- Modify: `backend/src/routes/buffet.routes.ts`, `backend/src/validators/buffet.schema.ts`
- Test: `backend/tests/integration/buffet-entrega.test.ts`

**Interfaces:**
- Consumes: `req.mostrador` (Task 2).
- Produces: `buffetEntregaService.entregar(input: { desdeMostradorId: string; items: { productoId: string; cantidad: number }[] }): Promise<{ entregaId: string }>`
- Produces: `buffetEntregaService.stockAsignado(mostradorId: string): Promise<{ productoId: string; cantidad: number }[]>`

- [ ] **Step 1: Modelos y migración**

En `schema.prisma`:

```prisma
/// Cuánto tiene asignado un mostrador de cada producto. Solo lo usa el SECUNDARIO: el stock
/// del principal es `ProductoBuffet.stock`, que no se migra para no tocar a sus consumidores
/// (panel, alerta de stock bajo, planilla de Google).
model StockMostrador {
  mostradorId String
  mostrador   Mostrador      @relation(fields: [mostradorId], references: [id])
  productoId  String
  producto    ProductoBuffet @relation(fields: [productoId], references: [id])
  cantidad    Int            @default(0)

  @@id([mostradorId, productoId])
}

/// Una entrega del principal al secundario: el "cuánto le di".
model EntregaMostrador {
  id          String                  @id @default(cuid())
  mostradorId String
  mostrador   Mostrador               @relation(fields: [mostradorId], references: [id])
  creadaEn    DateTime                @default(now())
  /// En qué cierre se rindió esta entrega. `null` = todavía pendiente de conciliar.
  ///
  /// Es lo que define el "entregado" de un cierre, y a propósito NO se usa un rango de fechas
  /// contra la apertura de la caja: en la vida real el principal entrega mercadería ANTES de
  /// que el secundario abra su caja, y esa entrega quedaría fuera de la ventana. Con esta
  /// marca, el orden de los hechos deja de importar.
  conciliadaEnCajaId String?
  conciliadaEnCaja   CajaBuffet?      @relation(fields: [conciliadaEnCajaId], references: [id])
  lineas      EntregaMostradorLinea[]

  @@index([mostradorId, conciliadaEnCajaId])
}

model EntregaMostradorLinea {
  id         String           @id @default(cuid())
  entregaId  String
  entrega    EntregaMostrador @relation(fields: [entregaId], references: [id], onDelete: Cascade)
  productoId String
  producto   ProductoBuffet   @relation(fields: [productoId], references: [id])
  cantidad   Int
}
```

Agregar los campos inversos en `ProductoBuffet`: `stockMostradores StockMostrador[]` y
`entregas EntregaMostradorLinea[]`.

Migración a mano (mismo procedimiento que la Task 1), con las tres tablas, sus claves foráneas
—incluida la de `EntregaMostrador.conciliadaEnCajaId` hacia `CajaBuffet`, nullable—, el índice
`EntregaMostrador(mostradorId, conciliadaEnCajaId)`, y esta restricción:

```sql
-- El stock asignado nunca puede quedar negativo. La garantía es de la base: el servicio hace
-- decrement dentro de una transacción, y sin esto una carrera entre dos ventas del mismo
-- producto lo dejaría en negativo sin que nada avise.
ALTER TABLE "StockMostrador" ADD CONSTRAINT "StockMostrador_cantidad_no_negativa" CHECK ("cantidad" >= 0);
```

Sumar las tres tablas a `resetTables()`.

- [ ] **Step 2: Escribir el test**

Crear `backend/tests/integration/buffet-entrega.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 20 } })).id;
});

const asignado = async () =>
  (await getPrisma().stockMostrador.findUnique({
    where: { mostradorId_productoId: { mostradorId: 'mostrador-secundario', productoId } },
  }))?.cantidad ?? 0;

const general = async () =>
  (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;

describe('entrega del principal al secundario', () => {
  it('mueve el stock: baja el general y sube el asignado', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 12 }] });
    expect(await general()).toBe(8);
    expect(await asignado()).toBe(12);
  });

  it('no inventa unidades: dos entregas suman', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 5 }] });
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 3 }] });
    expect(await general()).toBe(12);
    expect(await asignado()).toBe(8);
    // El total sigue siendo 20: nada se creó ni se perdió.
    expect((await general()) + (await asignado())).toBe(20);
  });

  it('no se puede entregar más de lo que hay en el general', async () => {
    await expect(
      buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 21 }] }),
    ).rejects.toThrow();
    expect(await general()).toBe(20);
    expect(await asignado()).toBe(0);
  });

  it('queda registrado quién y qué', async () => {
    const { entregaId } = await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 4 }] });
    const e = await getPrisma().entregaMostrador.findUniqueOrThrow({ where: { id: entregaId }, include: { lineas: true } });
    expect(e.mostradorId).toBe('mostrador-secundario');
    expect(e.lineas).toHaveLength(1);
    expect(e.lineas[0].cantidad).toBe(4);
  });

  it('una entrega con varias líneas es todo o nada', async () => {
    const otro = await getPrisma().productoBuffet.create({ data: { nombre: 'Agua', precio: 1000, stock: 2 } });
    await expect(
      buffetEntregaService.entregar({
        desdeMostradorId: 'mostrador-principal',
        items: [{ productoId, cantidad: 5 }, { productoId: otro.id, cantidad: 99 }],
      }),
    ).rejects.toThrow();
    // La primera línea NO se aplicó: si se aplicara, quedaría stock movido por una entrega
    // que el operador vio fallar.
    expect(await general()).toBe(20);
    expect(await asignado()).toBe(0);
  });

  it('cantidad cero o negativa se rechaza', async () => {
    await expect(
      buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 0 }] }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npx vitest run tests/integration/buffet-entrega.test.ts`
Expected: FAIL — no existe el servicio.

- [ ] **Step 4: El servicio**

Crear `backend/src/services/buffetEntrega.service.ts`:

```ts
import { prisma } from '../db/prisma.js';
import { BusinessRule, Forbidden, NotFound } from '../utils/errors.js';

const SECUNDARIO = 'mostrador-secundario';

export interface EntregarInput {
  desdeMostradorId: string;
  items: { productoId: string; cantidad: number }[];
}

export const buffetEntregaService = {
  /**
   * Mueve stock del general (el del principal) al asignado del secundario.
   *
   * Todo dentro de una transacción: una entrega de varias líneas es todo o nada. Si la
   * segunda línea no tiene stock, la primera tampoco se aplica — mover mercadería por una
   * entrega que el operador vio fallar sería peor que no moverla.
   */
  async entregar(input: EntregarInput): Promise<{ entregaId: string }> {
    if (input.desdeMostradorId !== 'mostrador-principal') {
      throw Forbidden('Solo el mostrador principal puede entregar stock');
    }
    if (!input.items.length) throw BusinessRule('No hay productos para entregar');
    for (const it of input.items) {
      if (!Number.isInteger(it.cantidad) || it.cantidad < 1) throw BusinessRule('Cantidad inválida');
    }

    return prisma.$transaction(async (tx) => {
      const entrega = await tx.entregaMostrador.create({ data: { mostradorId: SECUNDARIO } });
      for (const it of input.items) {
        const p = await tx.productoBuffet.findUnique({ where: { id: it.productoId } });
        if (!p) throw NotFound('ProductoBuffet', it.productoId);
        if (p.stock < it.cantidad) {
          throw BusinessRule(`No hay stock suficiente de ${p.nombre}: hay ${p.stock} y querés entregar ${it.cantidad}`);
        }
        await tx.productoBuffet.update({ where: { id: p.id }, data: { stock: { decrement: it.cantidad } } });
        await tx.stockMostrador.upsert({
          where: { mostradorId_productoId: { mostradorId: SECUNDARIO, productoId: p.id } },
          create: { mostradorId: SECUNDARIO, productoId: p.id, cantidad: it.cantidad },
          update: { cantidad: { increment: it.cantidad } },
        });
        await tx.entregaMostradorLinea.create({ data: { entregaId: entrega.id, productoId: p.id, cantidad: it.cantidad } });
      }
      return { entregaId: entrega.id };
    });
  },

  async stockAsignado(mostradorId: string) {
    const filas = await prisma.stockMostrador.findMany({ where: { mostradorId } });
    return filas.map((f) => ({ productoId: f.productoId, cantidad: f.cantidad }));
  },
};
```

- [ ] **Step 5: La ruta**

En `buffet.routes.ts`, con `authMostrador`:

```ts
buffetRoutes.post('/entregas', authMostrador, validate(entregarSchema), async (req, res, next) => {
  try {
    const { items } = (req as any).valid.body;
    res.json(await buffetEntregaService.entregar({ desdeMostradorId: (req as any).mostrador.id, items }));
  } catch (e) { next(e); }
});

buffetRoutes.get('/stock-asignado', authMostrador, async (req, res, next) => {
  try { res.json(await buffetEntregaService.stockAsignado((req as any).mostrador.id)); } catch (e) { next(e); }
});
```

`entregarSchema` en `buffet.schema.ts`, con el estilo de los que ya están ahí:

```ts
export const entregarSchema = z.object({
  body: z.object({
    items: z.array(z.object({ productoId: z.string().min(1), cantidad: z.number().int().positive() })).min(1),
  }),
});
```

- [ ] **Step 6: Correr y commitear**

Run: `npx vitest run tests/integration/buffet-entrega.test.ts && npm run typecheck`

```bash
git add backend/prisma backend/src backend/tests
git commit -m "feat(buffet): entrega de stock del principal al secundario"
```

---

### Task 4: La venta del secundario descuenta del asignado

**Files:**
- Modify: `backend/src/services/buffetCaja.service.ts`
- Test: `backend/tests/integration/buffet-venta-secundario.test.ts`

**Interfaces:**
- Consumes: `StockMostrador` (Task 3), `CajaBuffet.mostradorId` (Task 1).
- Produces: `buffetCajaService.abrir(mostradorId)`, `.actual(mostradorId)`, `.cerrar(mostradorId)`, y `cobrar(input)` con `input.mostradorId` agregado.

- [ ] **Step 1: Escribir el test**

Crear `backend/tests/integration/buffet-venta-secundario.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 20 } })).id;
});

const general = async () => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;
const asignado = async () =>
  (await getPrisma().stockMostrador.findUnique({
    where: { mostradorId_productoId: { mostradorId: 'mostrador-secundario', productoId } },
  }))?.cantidad ?? 0;

const vender = (mostradorId: string, uid: string, cantidad: number) =>
  buffetCajaService.cobrar({ mostradorId, uid, medioPago: 'EFECTIVO', montoPagado: 999999, items: [{ productoId, cantidad }] });

describe('venta del secundario', () => {
  it('descuenta del asignado y NO del general', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
    await buffetCajaService.abrir('mostrador-secundario');
    const generalAntes = await general(); // 10

    await vender('mostrador-secundario', 'uid-1', 3);

    expect(await asignado()).toBe(7);
    // Esas 3 unidades ya habían salido del general al entregarlas: descontarlas otra vez
    // sería contarlas dos veces.
    expect(await general()).toBe(generalAntes);
  });

  it('vender sin stock asignado se rechaza y dice qué falta', async () => {
    await buffetCajaService.abrir('mostrador-secundario');
    await expect(vender('mostrador-secundario', 'uid-2', 1)).rejects.toThrow(/Coca/);
  });

  it('vender más de lo asignado se rechaza', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 2 }] });
    await buffetCajaService.abrir('mostrador-secundario');
    await expect(vender('mostrador-secundario', 'uid-3', 3)).rejects.toThrow();
    expect(await asignado()).toBe(2);
  });

  it('el principal sigue descontando del general, como siempre', async () => {
    await buffetCajaService.abrir('mostrador-principal');
    await vender('mostrador-principal', 'uid-4', 5);
    expect(await general()).toBe(15);
    expect(await asignado()).toBe(0);
  });

  it('dos ventas simultáneas del mismo producto no dejan el asignado en negativo', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 3 }] });
    await buffetCajaService.abrir('mostrador-secundario');
    // La restricción CHECK de la base es la garantía: una de las dos tiene que fallar.
    const r = await Promise.allSettled([
      vender('mostrador-secundario', 'uid-5', 2),
      vender('mostrador-secundario', 'uid-6', 2),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await asignado()).toBe(1);
  });

  it('cada mostrador ve su propia caja', async () => {
    await buffetCajaService.abrir('mostrador-principal');
    await buffetCajaService.abrir('mostrador-secundario');
    await vender('mostrador-principal', 'uid-7', 1);
    const p = await buffetCajaService.actual('mostrador-principal');
    const s = await buffetCajaService.actual('mostrador-secundario');
    expect(p!.totalUnidades).toBe(1);
    expect(s!.totalUnidades).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/buffet-venta-secundario.test.ts`
Expected: FAIL — las firmas todavía no reciben `mostradorId`.

- [ ] **Step 3: Modificar el servicio de caja**

En `buffetCaja.service.ts`:

- `cajaAbierta()` pasa a recibir `mostradorId` y filtrar por él:
  `prisma.cajaBuffet.findFirst({ where: { estado: 'ABIERTA', mostradorId } })`.
- `abrir(mostradorId)`, `actual(mostradorId)` y `cerrar(mostradorId)` reciben y propagan el id;
  `abrir` crea con `data: { mostradorId }`.
- `CobrarInput` gana `mostradorId: string`, y `cobrar` lo usa para buscar la caja del mostrador.
- **El descuento de stock se bifurca** dentro de la transacción que ya existe:

```ts
        // El principal vende contra el stock general; el secundario, contra lo que se le
        // asignó. Descontar del general una venta del secundario contaría dos veces la misma
        // unidad: ya había salido del general cuando se la entregaron.
        if (esSecundario) {
          const asignado = await tx.stockMostrador.findUnique({
            where: { mostradorId_productoId: { mostradorId: input.mostradorId, productoId: p.id } },
          });
          if (!asignado || asignado.cantidad < it.cantidad) {
            throw BusinessRule(`No tenés stock asignado de ${p.nombre}. Pedile al mostrador principal que te entregue.`);
          }
          await tx.stockMostrador.update({
            where: { mostradorId_productoId: { mostradorId: input.mostradorId, productoId: p.id } },
            data: { cantidad: { decrement: it.cantidad } },
          });
        } else {
          await tx.productoBuffet.update({ where: { id: p.id }, data: { stock: { decrement: it.cantidad } } });
        }
```

donde `esSecundario` se resuelve una sola vez antes de la transacción, leyendo el tipo del
mostrador. `listCierres()` pasa a aceptar un `mostradorId` opcional para filtrar.

Actualizar las rutas de `/caja/abrir`, `/caja/actual`, `/caja/cerrar` y `/cobrar` para pasar
`(req as any).mostrador.id`.

- [ ] **Step 4: Correr y verificar**

Run: `npx vitest run tests/integration/buffet-venta-secundario.test.ts && npm run typecheck`
Expected: PASS los 6 casos.

Después corré toda la regresión de buffet (`ls tests/integration | grep -i buffet`) y actualizá los
tests que pasen a necesitar `mostradorId`. **Decí en el reporte cuáles tocaste.**

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(buffet): la venta del secundario descuenta de su stock asignado"
```

---

### Task 5: Cierre y conciliación

La razón de ser de todo lo anterior.

**Files:**
- Modify: `backend/prisma/schema.prisma` (+ migración a mano)
- Create: `backend/src/services/buffetConciliacion.service.ts`
- Modify: `backend/src/routes/buffet.routes.ts`, `backend/src/validators/buffet.schema.ts`
- Test: `backend/tests/integration/buffet-conciliacion.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `buffetConciliacionService.pendiente(cajaId: string): Promise<LineaConciliacion[]>` donde `LineaConciliacion = { productoId: string; nombre: string; entregado: number; vendido: number; esperado: number }`.
- Produces: `buffetConciliacionService.conciliar(input: { cajaId: string; porMostradorId: string; conteos: { productoId: string; contado: number }[] }): Promise<{ lineas: (LineaConciliacion & { contado: number; diferencia: number })[] }>`

- [ ] **Step 1: Modelo y migración**

```prisma
/// Conteo físico al cerrar una caja del secundario. Guarda las cuatro cifras para poder mirar
/// el histórico y ver si el faltante es siempre del mismo producto.
model ConteoCierreLinea {
  id         String         @id @default(cuid())
  cajaId     String
  caja       CajaBuffet     @relation(fields: [cajaId], references: [id], onDelete: Cascade)
  productoId String
  producto   ProductoBuffet @relation(fields: [productoId], references: [id])
  entregado  Int
  vendido    Int
  esperado   Int
  contado    Int
  diferencia Int
  creadaEn   DateTime       @default(now())

  @@unique([cajaId, productoId])
}
```

Campos inversos en `CajaBuffet`: `conteos ConteoCierreLinea[]` y `entregasRendidas EntregaMostrador[]`.
Migración a mano, con el índice
único `(cajaId, productoId)` — es lo que impide conciliar dos veces la misma caja. Sumar a
`resetTables()`.

- [ ] **Step 2: Escribir el test**

Crear `backend/tests/integration/buffet-conciliacion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { buffetConciliacionService } from '../../src/services/buffetConciliacion.service.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 20 } })).id;
});

const general = async () => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;
const asignado = async () =>
  (await getPrisma().stockMostrador.findUnique({
    where: { mostradorId_productoId: { mostradorId: 'mostrador-secundario', productoId } },
  }))?.cantidad ?? 0;

/**
 * Entrega 10, vende `vendidas`, y cierra la caja del secundario. Devuelve el id de la caja.
 *
 * Ojo al orden: la entrega ocurre ANTES de abrir la caja, que es como pasa en la vida real
 * (el principal deja la mercadería y después el otro abre). Si el "entregado" se calculara por
 * rango de fechas contra la apertura, esta entrega quedaría afuera y todos estos tests darían
 * entregado 0.
 */
async function turnoDelSecundario(vendidas: number): Promise<string> {
  await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
  const caja = await buffetCajaService.abrir('mostrador-secundario');
  if (vendidas > 0) {
    await buffetCajaService.cobrar({
      mostradorId: 'mostrador-secundario', uid: 'uid-conc', medioPago: 'EFECTIVO',
      montoPagado: 999999, items: [{ productoId, cantidad: vendidas }],
    });
  }
  await buffetCajaService.cerrar('mostrador-secundario');
  return caja.id;
}

describe('conciliación del cierre', () => {
  it('calcula esperado = entregado - vendido', async () => {
    const cajaId = await turnoDelSecundario(4);
    const lineas = await buffetConciliacionService.pendiente(cajaId);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({ entregado: 10, vendido: 4, esperado: 6 });
  });

  it('sin faltante: la diferencia es cero y vuelven 6 al general', async () => {
    const cajaId = await turnoDelSecundario(4);
    const generalAntes = await general(); // 10
    const r = await buffetConciliacionService.conciliar({
      cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 6 }],
    });
    expect(r.lineas[0].diferencia).toBe(0);
    expect(await general()).toBe(generalAntes + 6);
    expect(await asignado()).toBe(0);
  });

  it('CON faltante: vuelve lo CONTADO, no lo esperado', async () => {
    // El corazón del diseño. Se esperaban 6 y hay 4: faltan 2. Si volvieran las 6, el stock
    // general del complejo empezaría a mentir un poco más cada día.
    const cajaId = await turnoDelSecundario(4);
    const generalAntes = await general(); // 10
    const r = await buffetConciliacionService.conciliar({
      cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 4 }],
    });
    expect(r.lineas[0].diferencia).toBe(-2);
    expect(await general()).toBe(generalAntes + 4);
    expect(await asignado()).toBe(0);
  });

  it('contar de más se permite y se muestra como diferencia positiva', async () => {
    const cajaId = await turnoDelSecundario(4);
    const generalAntes = await general();
    const r = await buffetConciliacionService.conciliar({
      cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 8 }],
    });
    expect(r.lineas[0].diferencia).toBe(2);
    expect(await general()).toBe(generalAntes + 8);
  });

  it('el secundario NO puede conciliar su propia caja', async () => {
    const cajaId = await turnoDelSecundario(4);
    await expect(
      buffetConciliacionService.conciliar({ cajaId, porMostradorId: 'mostrador-secundario', conteos: [{ productoId, contado: 6 }] }),
    ).rejects.toThrow();
  });

  it('no se puede conciliar una caja todavía abierta', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
    const caja = await buffetCajaService.abrir('mostrador-secundario');
    await expect(
      buffetConciliacionService.conciliar({ cajaId: caja.id, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 10 }] }),
    ).rejects.toThrow();
  });

  it('conciliar dos veces la misma caja se rechaza', async () => {
    const cajaId = await turnoDelSecundario(4);
    await buffetConciliacionService.conciliar({ cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 6 }] });
    await expect(
      buffetConciliacionService.conciliar({ cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 6 }] }),
    ).rejects.toThrow();
    // Y el stock no se devolvió dos veces.
    expect(await general()).toBe(16);
  });

  it('cuenta también la entrega hecha en medio del turno', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 10 }] });
    const caja = await buffetCajaService.abrir('mostrador-secundario');
    // Se le acabó a mitad de turno y el principal le repone.
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 5 }] });
    await buffetCajaService.cerrar('mostrador-secundario');

    const lineas = await buffetConciliacionService.pendiente(caja.id);
    expect(lineas[0]).toMatchObject({ entregado: 15, vendido: 0, esperado: 15 });
  });

  it('las entregas de un cierre no se cuentan en el siguiente', async () => {
    const primera = await turnoDelSecundario(4);
    await buffetConciliacionService.conciliar({ cajaId: primera, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 6 }] });

    // Segundo turno: solo se le entregan 3.
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 3 }] });
    const segunda = await buffetCajaService.abrir('mostrador-secundario');
    await buffetCajaService.cerrar('mostrador-secundario');

    const lineas = await buffetConciliacionService.pendiente(segunda.id);
    expect(lineas[0]).toMatchObject({ entregado: 3, vendido: 0, esperado: 3 });
  });

  it('el faltante queda guardado, no solo mostrado', async () => {
    const cajaId = await turnoDelSecundario(4);
    await buffetConciliacionService.conciliar({ cajaId, porMostradorId: 'mostrador-principal', conteos: [{ productoId, contado: 4 }] });
    const filas = await getPrisma().conteoCierreLinea.findMany({ where: { cajaId } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entregado: 10, vendido: 4, esperado: 6, contado: 4, diferencia: -2 });
  });
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npx vitest run tests/integration/buffet-conciliacion.test.ts`
Expected: FAIL — no existe el servicio.

- [ ] **Step 4: El servicio**

Crear `backend/src/services/buffetConciliacion.service.ts`:

```ts
import { prisma } from '../db/prisma.js';
import { BusinessRule, Conflict, Forbidden, NotFound } from '../utils/errors.js';

const PRINCIPAL = 'mostrador-principal';

export interface LineaConciliacion {
  productoId: string; nombre: string;
  entregado: number; vendido: number; esperado: number;
}
export interface LineaConciliada extends LineaConciliacion { contado: number; diferencia: number }

/** Entregado y vendido que le corresponden a esa caja, producto por producto. */
async function resumenDe(cajaId: string): Promise<LineaConciliacion[]> {
  const caja = await prisma.cajaBuffet.findUnique({ where: { id: cajaId }, include: { mostrador: true } });
  if (!caja) throw NotFound('CajaBuffet', cajaId);

  // Entregas todavía sin rendir de ESE mostrador, no un rango de fechas: el principal suele
  // entregar antes de que el secundario abra la caja, y por fecha esa entrega quedaría afuera.
  const entregas = await prisma.entregaMostradorLinea.findMany({
    where: { entrega: { mostradorId: caja.mostradorId, conciliadaEnCajaId: null } },
    include: { producto: { select: { nombre: true } } },
  });
  const ventas = await prisma.ventaBuffet.findMany({
    where: { ticket: { cajaId } },
    include: { producto: { select: { nombre: true } } },
  });

  const mapa = new Map<string, LineaConciliacion>();
  const tomar = (id: string, nombre: string) => {
    const cur = mapa.get(id) ?? { productoId: id, nombre, entregado: 0, vendido: 0, esperado: 0 };
    mapa.set(id, cur);
    return cur;
  };
  for (const e of entregas) tomar(e.productoId, e.producto.nombre).entregado += e.cantidad;
  for (const v of ventas) tomar(v.productoId, v.producto.nombre).vendido += v.cantidad;
  for (const l of mapa.values()) l.esperado = l.entregado - l.vendido;
  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export const buffetConciliacionService = {
  pendiente: resumenDe,

  /**
   * Cierra la conciliación: guarda las cuatro cifras y devuelve al stock general **lo contado**,
   * no lo esperado.
   *
   * Esa es la decisión de fondo: devolviendo lo esperado, cada unidad regalada volvería al
   * general como una unidad que no existe, y el stock del complejo mentiría un poco más cada
   * día sin que nadie se entere. Devolviendo lo contado, el faltante desaparece del sistema,
   * que es lo que pasó en la realidad.
   */
  async conciliar(input: { cajaId: string; porMostradorId: string; conteos: { productoId: string; contado: number }[] }) {
    // Lo carga el principal, no el secundario: si quien pudo haberse llevado la mercadería es
    // también quien declara cuánto quedó, el control no controla nada.
    if (input.porMostradorId !== PRINCIPAL) throw Forbidden('El conteo lo carga el mostrador principal');

    const caja = await prisma.cajaBuffet.findUnique({ where: { id: input.cajaId } });
    if (!caja) throw NotFound('CajaBuffet', input.cajaId);
    if (caja.estado !== 'CERRADA') throw Conflict('La caja todavía está abierta');

    const ya = await prisma.conteoCierreLinea.count({ where: { cajaId: input.cajaId } });
    if (ya > 0) throw Conflict('Esta caja ya fue conciliada');

    for (const c of input.conteos) {
      if (!Number.isInteger(c.contado) || c.contado < 0) throw BusinessRule('Conteo inválido');
    }

    const resumen = await resumenDe(input.cajaId);
    const contadoPorProducto = new Map(input.conteos.map((c) => [c.productoId, c.contado]));

    return prisma.$transaction(async (tx) => {
      // Marcar las entregas como rendidas en ESTA caja. Va dentro de la transacción: si algo
      // falla después, no pueden quedar entregas rendidas contra un cierre que no existió.
      await tx.entregaMostrador.updateMany({
        where: { mostradorId: caja.mostradorId, conciliadaEnCajaId: null },
        data: { conciliadaEnCajaId: input.cajaId },
      });

      const lineas: LineaConciliada[] = [];
      for (const l of resumen) {
        // Un producto que no se contó cuenta como cero: si quedaba algo y nadie lo declaró,
        // aparece como faltante, que es la lectura honesta.
        const contado = contadoPorProducto.get(l.productoId) ?? 0;
        const diferencia = contado - l.esperado;
        await tx.conteoCierreLinea.create({
          data: { cajaId: input.cajaId, productoId: l.productoId, entregado: l.entregado, vendido: l.vendido, esperado: l.esperado, contado, diferencia },
        });
        if (contado > 0) {
          await tx.productoBuffet.update({ where: { id: l.productoId }, data: { stock: { increment: contado } } });
        }
        // El asignado queda en cero: el secundario arranca cada día limpio.
        await tx.stockMostrador.updateMany({
          where: { mostradorId: caja.mostradorId, productoId: l.productoId },
          data: { cantidad: 0 },
        });
        lineas.push({ ...l, contado, diferencia });
      }
      return { lineas };
    });
  },
};
```

- [ ] **Step 5: Las rutas**

```ts
buffetRoutes.get('/cajas/:id/conciliacion', authMostrador, validate(idParamSchema), async (req, res, next) => {
  try { res.json(await buffetConciliacionService.pendiente(String(req.params.id))); } catch (e) { next(e); }
});

buffetRoutes.post('/cajas/:id/conciliacion', authMostrador, validate(conciliarSchema), async (req, res, next) => {
  try {
    const { conteos } = (req as any).valid.body;
    res.json(await buffetConciliacionService.conciliar({
      cajaId: String(req.params.id), porMostradorId: (req as any).mostrador.id, conteos,
    }));
  } catch (e) { next(e); }
});
```

`conciliarSchema` en `buffet.schema.ts`:

```ts
export const conciliarSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    conteos: z.array(z.object({ productoId: z.string().min(1), contado: z.number().int().nonnegative() })),
  }),
});
```

- [ ] **Step 6: Correr todo y commitear**

Run: `npx vitest run tests/integration/buffet-conciliacion.test.ts && npm run typecheck`
Después: toda la regresión de buffet.

```bash
git add backend/prisma backend/src backend/tests
git commit -m "feat(buffet): conciliacion del cierre del mostrador secundario"
```

---

## Lo que queda para el plan de las pantallas

- El mostrador: PIN → identidad, pantalla de entrega del principal, pantalla de conteo al cerrar.
- El panel: histórico de conciliaciones, PIN por mostrador, y mostrar en la vista de productos las
  dos cifras de stock (en el principal / asignadas al secundario) para que la alerta de stock bajo
  no dispare por unidades que sí existen.
- `frontend/src/lib/buffet-session.ts` tiene que guardar el token del mostrador y mandarlo en el
  header `x-mostrador`.

## Notas para el deploy

- **Tres migraciones**, todas aditivas salvo el índice de caja abierta, que se reemplaza.
- **El PIN actual pasa a ser el del principal** automáticamente. El secundario **arranca sin PIN y
  con eso no entra nadie**: hay que cargárselo desde el panel antes de usarlo.
- Sin variables de entorno nuevas.

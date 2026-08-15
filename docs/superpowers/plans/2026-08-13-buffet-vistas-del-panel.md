# Buffet: las vistas del panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el administrador vea en el panel si falta siempre el mismo producto, qué se entregó, de qué mostrador es cada cierre, y una alerta de stock que no mienta.

**Architecture:** Los datos ya existen en la base (`ConteoCierreLinea`, `EntregaMostrador`, `StockMostrador`); falta exponerlos. Cuatro adiciones de backend, todas de solo lectura y para admin, más dos páginas nuevas y dos arregladas en el panel.

**Tech Stack:** Express 5, Prisma 7 (cliente en `src/generated/prisma`, singleton `src/db/prisma.ts`), zod, vitest + Testcontainers. Panel en Next.js 16 (`frontend/`, pnpm).

**Spec:** `docs/superpowers/specs/2026-08-13-buffet-vistas-del-panel-design.md`

## Global Constraints

- **Código, comentarios y vocabulario en español.** No traducir `cancha`, `seña`, `mostrador`, `caja`, `buffet`.
- **Nunca importar de `@prisma/client`.** Tipos desde `src/db/client.ts`; runtime desde `src/db/prisma.ts`.
- Errores esperados = factories de `src/utils/errors.ts`. Nunca `Error` crudo, incluidos errores de Prisma sin mapear.
- Capas en una sola dirección: `routes/ → services/ → repositories/ → db/prisma.ts`. Las rutas son finas.
- Todo lo de esta pieza es **admin**: `authJwt` + `requireRole('ADMIN')`. Nada acá usa `authMostrador`.
- Las fechas del negocio se interpretan en `TZ_NEGOCIO` con `dayWindowUtc(fecha, tz)` de `src/utils/tz.ts`, que devuelve `{ start, end }`. **Nunca `new Date(fecha)` a pelo.**
- **Esta pieza NO toca el schema de Prisma ni agrega migraciones.** Si parece que hace falta, pará y consultá.
- Backend usa **npm**; `frontend/` usa **pnpm**. Los tests de integración necesitan Docker.
- **`backend/tsconfig.json` excluye `tests/`**, así que `npm run typecheck` no valida los archivos de test. Hay que correr los tests: este hueco ya causó dos regresiones en este repo.
- `frontend/` **sí tiene** `pnpm typecheck` (se agregó en la pieza B). Corrélo: `pnpm build` no typechequea los tests.
- **Vara de lint**: `pnpm lint` en `frontend/` ya falla en `nueva-reserva-dialog.tsx`, `usuarios-table.tsx` y `use-cliente-autocomplete.ts`, y `validators.test.ts` tiene 2 casos rojos preexistentes sobre `jugadores=6`. Nada de eso es de esta pieza; la vara es **no introducir errores nuevos**.
- El panel es **server-first**: las páginas son server components que hacen `apiFetch`. No agregar fetch del lado del cliente.
- **Next.js 16** es más nuevo que la mayoría de los datos de entrenamiento: antes de escribir algo específico de Next, leer la guía en `frontend/node_modules/next/dist/docs/`.
- **No pushear `main`** ni ninguna rama sin que lo pida el humano.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/src/services/buffetCaja.service.ts` (modificar) | `CierreDTO` gana el mostrador. |
| `backend/src/services/buffetConciliacion.service.ts` (modificar) | `resumenPorProducto()`. |
| `backend/src/services/buffetEntrega.service.ts` (modificar) | `listar()` de entregas. |
| `backend/src/services/buffetProducto.service.ts` (modificar) | `list()` suma `asignado`. |
| `backend/src/validators/buffet.schema.ts` (modificar) | `rangoFechasSchema`, `cierresSchema`. |
| `backend/src/utils/rango.ts` (crear) | Traducir `?desde=&hasta=` a un rango UTC, con default de 90 días. |
| `backend/src/routes/buffet.routes.ts` (modificar) | Las tres rutas nuevas y el filtro de cierres. |
| `backend/tests/integration/buffet-panel.test.ts` (crear) | Todo el backend de esta pieza. |
| `frontend/src/lib/types.ts` (modificar) | `ProductoBuffet.asignado`, `CierreBuffet` con mostrador, `ResumenConciliacion`, `EntregaPanel`. |
| `frontend/src/lib/stock-buffet.ts` (crear) | `stockTotal` y `estaBajo`, con su test. |
| `frontend/src/app/(panel)/buffet/page.tsx` (modificar) | La alerta pasa a medir el total. |
| `frontend/src/components/buffet/productos-table.tsx` (modificar) | Columna con lo asignado. |
| `frontend/src/app/(panel)/buffet/cierres/page.tsx` (modificar) | Etiqueta y filtro por mostrador. |
| `frontend/src/app/(panel)/buffet/conciliaciones/page.tsx` (crear) | El resumen por producto. |
| `frontend/src/app/(panel)/buffet/entregas/page.tsx` (crear) | La lista de entregas. |
| `frontend/src/components/buffet/sub-nav.tsx` (crear) | Los links entre las cuatro páginas de buffet. |

---

### Task 1: Los cierres dicen de qué mostrador son

Hoy `/buffet/cierres` mezcla los dos puestos sin etiquetar. Los datos no están mal: están sin identificar.

**Files:**
- Modify: `backend/src/services/buffetCaja.service.ts`
- Modify: `backend/src/validators/buffet.schema.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-panel.test.ts`

**Interfaces:**
- Produces: `CierreDTO` gana `mostradorId: string` y `mostradorNombre: string`.
- Produces: `GET /buffet/cajas?mostradorId=<id>` filtra. Sin query, devuelve todos.

- [ ] **Step 1: Escribir el test**

Crear `backend/tests/integration/buffet-panel.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let jwt: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  jwt = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  await getPrisma().mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  await getPrisma().mostrador.update({ where: { id: 'mostrador-secundario' }, data: { pinHash: await hashPassword('2222') } });
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 100 } })).id;
});

const admin = (r: any) => r.set('authorization', `Bearer ${jwt}`);

/** Cachea el token por PIN: `loginLimiter` corta a los 10 intentos por proceso. */
const tokens = new Map<string, string>();
async function tokenDe(pin: string): Promise<string> {
  const c = tokens.get(pin);
  if (c) return c;
  const r = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin });
  tokens.set(pin, r.body.token);
  return r.body.token;
}
const comoMostrador = (r: any, t: string) => r.set('x-buffet-key', KEY).set('x-mostrador', t);

/** Abre caja en ese puesto, vende `unidades` y cierra. Devuelve el id de la caja. */
async function turno(pin: string, unidades: number): Promise<string> {
  const t = await tokenDe(pin);
  const caja = await comoMostrador(supertest(app).post('/buffet/caja/abrir'), t);
  if (unidades > 0) {
    await comoMostrador(supertest(app).post('/buffet/cobrar'), t).send({
      uid: `uid-${Date.now()}-${Math.random()}`, medioPago: 'EFECTIVO',
      montoPagado: 999999, items: [{ productoId, cantidad: unidades }],
    });
  }
  await comoMostrador(supertest(app).post('/buffet/caja/cerrar'), t);
  return caja.body.id;
}

describe('cierres etiquetados por mostrador', () => {
  it('cada cierre dice de que mostrador es', async () => {
    await turno('1111', 2);
    const r = await admin(supertest(app).get('/buffet/cajas'));
    expect(r.status).toBe(200);
    expect(r.body[0].mostradorId).toBe('mostrador-principal');
    expect(r.body[0].mostradorNombre).toBeTruthy();
  });

  it('filtra por mostrador', async () => {
    // El principal vende del general; al secundario hay que entregarle antes.
    await turno('1111', 2);
    const p = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), p).send({ items: [{ productoId, cantidad: 10 }] });
    await turno('2222', 3);

    const todos = await admin(supertest(app).get('/buffet/cajas'));
    expect(todos.body).toHaveLength(2);

    const soloSec = await admin(supertest(app).get('/buffet/cajas?mostradorId=mostrador-secundario'));
    expect(soloSec.body).toHaveLength(1);
    expect(soloSec.body[0].mostradorId).toBe('mostrador-secundario');
  });

  it('sin JWT de admin no se puede listar', async () => {
    const r = await supertest(app).get('/buffet/cajas').set('x-buffet-key', KEY);
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/buffet-panel.test.ts`
Expected: FAIL — `mostradorId` viene `undefined` y el filtro se ignora (devuelve 2 en vez de 1).

- [ ] **Step 3: El DTO y el servicio**

En `backend/src/services/buffetCaja.service.ts`, agregar a `CierreDTO`:

```ts
  mostradorId: string; mostradorNombre: string;
```

En `detalleCierre`, la caja ya se lee con `findUnique`; cambiarlo para traer el mostrador y devolver los dos campos:

```ts
  const caja = await prisma.cajaBuffet.findUnique({
    where: { id: cajaId },
    include: { mostrador: { select: { nombre: true } } },
  });
```

y en el objeto que retorna, junto a `id`:

```ts
    mostradorId: caja.mostradorId, mostradorNombre: caja.mostrador.nombre,
```

- [ ] **Step 4: El validador y la ruta**

En `backend/src/validators/buffet.schema.ts`, al final:

```ts
export const cierresSchema = z.object({
  body: z.unknown(),
  query: z.object({ mostradorId: z.string().min(1).optional() }),
  params: empty,
});
```

En `backend/src/routes/buffet.routes.ts`, reemplazar la ruta de `/cajas`:

```ts
buffetRoutes.get('/cajas', authJwt, requireRole('ADMIN'), validate(cierresSchema), async (req, res, next) => {
  try { res.json(await buffetCajaService.listCierres((req as any).valid.query.mostradorId)); } catch (e) { next(e); }
});
```

`listCierres(mostradorId?)` ya acepta el filtro desde la pieza B: lo único que faltaba era pasárselo.

Agregar `cierresSchema` al `import` de `../validators/buffet.schema.js`.

- [ ] **Step 5: Correr y verificar**

Run: `npx vitest run tests/integration/buffet-panel.test.ts && npm run typecheck`
Expected: PASS los 3 casos.

- [ ] **Step 6: Regresión y commit**

Run: `npx vitest run tests/integration/buffet-*.test.ts`

```bash
git add backend/src backend/tests
git commit -m "feat(buffet): los cierres del panel dicen de que mostrador son"
```

---

### Task 2: El rango de fechas

Las tres vistas nuevas filtran por período. Una sola pieza, testeada aparte, en vez de repetir la aritmética.

**Files:**
- Create: `backend/src/utils/rango.ts`
- Modify: `backend/src/validators/buffet.schema.ts`
- Test: `backend/tests/unit/rango.test.ts`

**Interfaces:**
- Produces: `rangoDeFechas(desde?: string, hasta?: string): { start: Date; end: Date }`
- Produces: `rangoFechasSchema` — `query: { desde?: string; hasta?: string }` en formato `YYYY-MM-DD`.

- [ ] **Step 1: Escribir el test**

Crear `backend/tests/unit/rango.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rangoDeFechas } from '../../src/utils/rango.js';

describe('rangoDeFechas', () => {
  it('sin parametros abarca los ultimos 90 dias', () => {
    const { start, end } = rangoDeFechas();
    const dias = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(dias)).toBe(90);
    expect(end.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('con desde y hasta cubre el dia entero de `hasta`', () => {
    // El cierre de las 23:00 del dia `hasta` tiene que entrar: si el rango terminara a las
    // 00:00 de ese dia, el ultimo turno quedaria afuera y el reporte mentiria.
    const { start, end } = rangoDeFechas('2026-08-01', '2026-08-10');
    const dias = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(dias)).toBe(10);
  });

  it('solo `desde` llega hasta ahora', () => {
    const { end } = rangoDeFechas('2026-08-01');
    expect(end.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('`desde` posterior a `hasta` se rechaza', () => {
    expect(() => rangoDeFechas('2026-08-10', '2026-08-01')).toThrow();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/unit/rango.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Crear `backend/src/utils/rango.ts`:

```ts
import { getEnv } from '../config/env.js';
import { dayWindowUtc } from './tz.js';
import { BadRequest } from './errors.js';

const DIAS_POR_DEFECTO = 90;

/**
 * Traduce `?desde=&hasta=` a un rango UTC.
 *
 * Las fechas son del negocio, así que se interpretan en `TZ_NEGOCIO`: un cierre de las 23:00
 * del día `hasta` tiene que entrar en el reporte, y por eso el fin del rango es el comienzo
 * del día SIGUIENTE (`dayWindowUtc(...).end`), no el del propio `hasta`.
 *
 * Sin parámetros, los últimos 90 días: sin ventana la consulta crece sin techo, y "faltó
 * siempre lo mismo" pierde valor cuanto más viejo es el dato.
 */
export function rangoDeFechas(desde?: string, hasta?: string): { start: Date; end: Date } {
  const tz = getEnv().TZ_NEGOCIO;
  const end = hasta ? dayWindowUtc(hasta, tz).end : new Date();
  const start = desde
    ? dayWindowUtc(desde, tz).start
    : new Date(end.getTime() - DIAS_POR_DEFECTO * 24 * 60 * 60 * 1000);
  if (start >= end) throw BadRequest('El rango de fechas está invertido');
  return { start, end };
}
```

- [ ] **Step 4: El validador**

En `backend/src/validators/buffet.schema.ts`, al final:

```ts
const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const rangoFechasSchema = z.object({
  body: z.unknown(),
  query: z.object({ desde: fechaISO.optional(), hasta: fechaISO.optional() }),
  params: empty,
});
```

- [ ] **Step 5: Correr y commitear**

Run: `npx vitest run tests/unit/rango.test.ts && npm run typecheck`

```bash
git add backend/src backend/tests
git commit -m "feat(buffet): rango de fechas para los reportes del panel"
```

---

### Task 3: El resumen de conciliaciones

La consulta que responde "¿falta siempre lo mismo?".

> **Desvío del spec, deliberado.** El spec también listaba `GET /buffet/cajas/:id/conteo` (el detalle de un cierre ya conciliado). **No se implementa acá**: ninguna pantalla de este plan lo consume, y un endpoint sin consumidor es código muerto — el mismo criterio que ya se aplicó en la pieza B al recortar tres acciones que nadie llamaba. Queda anotado al final del plan; cablearlo cuando exista la pantalla que lo use es una tarea chica.

**Files:**
- Modify: `backend/src/services/buffetConciliacion.service.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-panel.test.ts` (agregar un `describe`)

**Interfaces:**
- Consumes: `rangoDeFechas` y `rangoFechasSchema` (Task 2).
- Produces: `buffetConciliacionService.resumenPorProducto(desde?, hasta?)` → `{ productoId, nombre, cierres, entregado, vendido, contado, diferencia }[]`
- Produces: `GET /buffet/conciliaciones/resumen?desde=&hasta=` (admin).

- [ ] **Step 1: Escribir el test**

Agregar al final de `backend/tests/integration/buffet-panel.test.ts`:

```ts
describe('resumen de conciliaciones', () => {
  /** Entrega `entregado`, el secundario vende `vendido`, cierra, y el principal cuenta `contado`. */
  async function turnoConciliado(entregado: number, vendido: number, contado: number): Promise<string> {
    const p = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), p).send({ items: [{ productoId, cantidad: entregado }] });
    const cajaId = await turno('2222', vendido);
    await comoMostrador(supertest(app).post(`/buffet/cajas/${cajaId}/conciliacion`), p)
      .send({ conteos: [{ productoId, contado }] });
    return cajaId;
  }

  it('suma la diferencia de varios cierres del mismo producto', async () => {
    await turnoConciliado(10, 4, 5); // esperaba 6, contó 5 -> -1
    await turnoConciliado(10, 2, 6); // esperaba 8, contó 6 -> -2

    const r = await admin(supertest(app).get('/buffet/conciliaciones/resumen'));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({
      productoId, nombre: 'Coca', cierres: 2, entregado: 20, vendido: 6, contado: 11, diferencia: -3,
    });
  });

  it('lo que mas falta va primero', async () => {
    const otro = await getPrisma().productoBuffet.create({ data: { nombre: 'Agua', precio: 1000, stock: 100 } });
    const p = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), p)
      .send({ items: [{ productoId, cantidad: 10 }, { productoId: otro.id, cantidad: 10 }] });
    const cajaId = await turno('2222', 0);
    await comoMostrador(supertest(app).post(`/buffet/cajas/${cajaId}/conciliacion`), p).send({
      conteos: [{ productoId, contado: 9 }, { productoId: otro.id, contado: 5 }],
    });

    const r = await admin(supertest(app).get('/buffet/conciliaciones/resumen'));
    expect(r.body[0].nombre).toBe('Agua');   // -5
    expect(r.body[1].nombre).toBe('Coca');   // -1
  });

  it('un cierre fuera de la ventana no entra', async () => {
    await turnoConciliado(10, 4, 6);
    const r = await admin(supertest(app).get('/buffet/conciliaciones/resumen?desde=2020-01-01&hasta=2020-12-31'));
    expect(r.body).toHaveLength(0);
  });

  it('desde posterior a hasta da 400', async () => {
    const r = await admin(supertest(app).get('/buffet/conciliaciones/resumen?desde=2026-08-10&hasta=2026-08-01'));
    expect(r.status).toBe(400);
  });

  it('sin JWT de admin no se puede ver', async () => {
    const r = await supertest(app).get('/buffet/conciliaciones/resumen').set('x-buffet-key', KEY);
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/buffet-panel.test.ts -t "resumen"`
Expected: FAIL con 404 — las rutas no existen.

- [ ] **Step 3: El servicio**

En `backend/src/services/buffetConciliacion.service.ts`, agregar al objeto `buffetConciliacionService`:

```ts
  /**
   * El faltante acumulado por producto, para ver si siempre falta lo mismo.
   *
   * Se agrega en memoria y no con `groupBy`: hacen falta los nombres de producto y la cuenta de
   * cierres distintos en la misma pasada, y el volumen de una ventana de 90 días de un buffet
   * es chico. `esperado` no se devuelve porque es `entregado - vendido`, un dato derivable.
   */
  async resumenPorProducto(desde?: string, hasta?: string) {
    const { start, end } = rangoDeFechas(desde, hasta);
    const filas = await prisma.conteoCierreLinea.findMany({
      where: { caja: { cerradaEn: { gte: start, lt: end } } },
      include: { producto: { select: { nombre: true } } },
    });

    const mapa = new Map<string, { productoId: string; nombre: string; cierres: number; entregado: number; vendido: number; contado: number; diferencia: number }>();
    for (const f of filas) {
      const cur = mapa.get(f.productoId) ?? {
        productoId: f.productoId, nombre: f.producto.nombre,
        cierres: 0, entregado: 0, vendido: 0, contado: 0, diferencia: 0,
      };
      cur.cierres += 1;
      cur.entregado += f.entregado;
      cur.vendido += f.vendido;
      cur.contado += f.contado;
      cur.diferencia += f.diferencia;
      mapa.set(f.productoId, cur);
    }
    // Ascendente: el faltante es negativo, así que lo que más falta queda primero.
    return [...mapa.values()].sort((a, b) => a.diferencia - b.diferencia);
  },
```

Agregar el import: `import { rangoDeFechas } from '../utils/rango.js';`

- [ ] **Step 4: Las rutas**

En `backend/src/routes/buffet.routes.ts`, en la sección de admin:

```ts
buffetRoutes.get('/conciliaciones/resumen', authJwt, requireRole('ADMIN'), validate(rangoFechasSchema), async (req, res, next) => {
  try {
    const { desde, hasta } = (req as any).valid.query;
    res.json(await buffetConciliacionService.resumenPorProducto(desde, hasta));
  } catch (e) { next(e); }
});

```

Agregar `rangoFechasSchema` al import de los validadores.

**Ojo con el orden de las rutas**: ya existe `GET /buffet/conciliaciones/pendientes` (del mostrador, de la pieza B). Poné `/conciliaciones/resumen` **junto a ella**, en la sección de admin, y no toques el orden existente.

- [ ] **Step 5: Correr y verificar**

Run: `npx vitest run tests/integration/buffet-panel.test.ts && npm run typecheck`
Expected: PASS los 8 casos del archivo.

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(buffet): resumen de conciliaciones por producto y detalle de un cierre"
```

---

### Task 4: Las entregas y el stock asignado en el catálogo

Dos adiciones chicas: la lista que vuelve visible un doble tap, y el dato que arregla la alerta.

**Files:**
- Modify: `backend/src/services/buffetEntrega.service.ts`
- Modify: `backend/src/services/buffetProducto.service.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-panel.test.ts` (agregar un `describe`)

**Interfaces:**
- Consumes: `rangoDeFechas` y `rangoFechasSchema` (Task 2).
- Produces: `buffetEntregaService.listar(desde?, hasta?)` → `{ id, creadaEn, conciliada, lineas: { productoId, nombre, cantidad }[] }[]`
- Produces: `ProductoDTO` gana `asignado: number`.
- Produces: `GET /buffet/entregas?desde=&hasta=` (admin).

- [ ] **Step 1: Escribir el test**

Agregar al final de `backend/tests/integration/buffet-panel.test.ts`:

```ts
describe('entregas y stock asignado en el catalogo', () => {
  it('lista las entregas con sus lineas, la mas nueva primero', async () => {
    const p = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), p).send({ items: [{ productoId, cantidad: 4 }] });
    await comoMostrador(supertest(app).post('/buffet/entregas'), p).send({ items: [{ productoId, cantidad: 7 }] });

    const r = await admin(supertest(app).get('/buffet/entregas'));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0].lineas[0]).toMatchObject({ nombre: 'Coca', cantidad: 7 });
    expect(r.body[0].conciliada).toBe(false);
    expect(r.body[0].creadaEn).toBeTruthy();
  });

  it('marca conciliada la entrega que ya se rindio', async () => {
    // Es lo unico que distingue una entrega vieja de una pendiente de rendir.
    const p = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), p).send({ items: [{ productoId, cantidad: 10 }] });
    const cajaId = await turno('2222', 2);
    await comoMostrador(supertest(app).post(`/buffet/cajas/${cajaId}/conciliacion`), p)
      .send({ conteos: [{ productoId, contado: 8 }] });

    const r = await admin(supertest(app).get('/buffet/entregas'));
    expect(r.body[0].conciliada).toBe(true);
  });

  it('una entrega fuera de la ventana no entra', async () => {
    const p = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), p).send({ items: [{ productoId, cantidad: 4 }] });
    const r = await admin(supertest(app).get('/buffet/entregas?desde=2020-01-01&hasta=2020-12-31'));
    expect(r.body).toHaveLength(0);
  });

  it('sin JWT de admin no se pueden ver', async () => {
    const r = await supertest(app).get('/buffet/entregas').set('x-buffet-key', KEY);
    expect(r.status).toBe(401);
  });

  it('el catalogo dice cuanto de cada producto esta en el secundario', async () => {
    const p = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), p).send({ items: [{ productoId, cantidad: 15 }] });

    const r = await admin(supertest(app).get('/buffet/productos'));
    const coca = r.body.find((x: any) => x.id === productoId);
    expect(coca.asignado).toBe(15);
    // El general bajó: esas unidades salieron de ahí al entregarlas.
    expect(coca.stock).toBe(85);
  });

  it('un producto sin nada asignado trae 0, no undefined', async () => {
    const r = await admin(supertest(app).get('/buffet/productos'));
    expect(r.body.find((x: any) => x.id === productoId).asignado).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/buffet-panel.test.ts -t "entregas y stock"`
Expected: FAIL — 404 en `/buffet/entregas`, y `asignado` viene `undefined`.

- [ ] **Step 3: Listar entregas**

En `backend/src/services/buffetEntrega.service.ts`, agregar al objeto `buffetEntregaService`:

```ts
  /**
   * Las entregas del período, la más nueva primero.
   *
   * Existe sobre todo para poder VER una entrega duplicada: `entregar()` no es idempotente,
   * así que un doble tap mueve el stock dos veces y hoy no queda registro visible de eso.
   * La ventana filtra por `creadaEn`: interesa cuándo se entregó, no en qué cierre se rindió.
   */
  async listar(desde?: string, hasta?: string) {
    const { start, end } = rangoDeFechas(desde, hasta);
    const filas = await prisma.entregaMostrador.findMany({
      where: { creadaEn: { gte: start, lt: end } },
      include: { lineas: { include: { producto: { select: { nombre: true } } } } },
      orderBy: { creadaEn: 'desc' },
    });
    return filas.map((e) => ({
      id: e.id,
      creadaEn: e.creadaEn.toISOString(),
      conciliada: e.conciliadaEnCajaId !== null,
      lineas: e.lineas.map((l) => ({ productoId: l.productoId, nombre: l.producto.nombre, cantidad: l.cantidad })),
    }));
  },
```

Agregar el import: `import { rangoDeFechas } from '../utils/rango.js';`

- [ ] **Step 4: El stock asignado en el catálogo**

En `backend/src/services/buffetProducto.service.ts`, agregar `asignado: number;` a `ProductoDTO`, y reemplazar `list()`:

```ts
  /**
   * El catálogo para el panel, con lo que cada producto tiene en el secundario.
   *
   * Sin `asignado`, la alerta de stock bajo compara contra el general y avisa por unidades que
   * sí existen, solo que están en el otro mostrador.
   */
  async list(): Promise<ProductoDTO[]> {
    const [rows, asignados] = await Promise.all([
      prisma.productoBuffet.findMany({ orderBy: [{ activo: 'desc' }, { nombre: 'asc' }] }),
      prisma.stockMostrador.findMany({ where: { mostradorId: 'mostrador-secundario' } }),
    ]);
    const porProducto = new Map(asignados.map((a) => [a.productoId, a.cantidad]));
    return rows.map((p) => ({ ...toDTO(p), asignado: porProducto.get(p.id) ?? 0 }));
  },
```

`toDTO` no cambia: las otras listas (`listBotonera`, `listActivos`) no necesitan `asignado`, así que se le agrega solo acá. Si `ProductoDTO` con `asignado` requerido hace fallar el typecheck en esas otras funciones, dejá `asignado` fuera de `ProductoDTO` y tipá el retorno de `list()` como `(ProductoDTO & { asignado: number })[]` — **decilo en el reporte si tomás ese camino**.

- [ ] **Step 5: La ruta**

En `backend/src/routes/buffet.routes.ts`, en la sección de admin:

```ts
buffetRoutes.get('/entregas', authJwt, requireRole('ADMIN'), validate(rangoFechasSchema), async (req, res, next) => {
  try {
    const { desde, hasta } = (req as any).valid.query;
    res.json(await buffetEntregaService.listar(desde, hasta));
  } catch (e) { next(e); }
});
```

**Ojo**: ya existe `buffetRoutes.post('/entregas', authMostrador, ...)`. Son el mismo path con verbos distintos, así que no colisionan — pero no borres ni muevas el POST.

- [ ] **Step 6: Correr y verificar**

Run: `npx vitest run tests/integration/buffet-panel.test.ts && npm run typecheck`
Expected: PASS los 14 casos.

- [ ] **Step 7: Regresión y commit**

Run: `npx vitest run tests/integration/buffet-*.test.ts`

```bash
git add backend/src backend/tests
git commit -m "feat(buffet): listar entregas y exponer el stock asignado en el catalogo"
```

---

### Task 5: La alerta de stock deja de mentir

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/stock-buffet.ts`
- Create: `frontend/src/lib/stock-buffet.test.ts`
- Modify: `frontend/src/app/(panel)/buffet/page.tsx`
- Modify: `frontend/src/components/buffet/productos-table.tsx`

**Interfaces:**
- Consumes: `asignado` en `GET /buffet/productos` (Task 4).
- Produces: `stockTotal(p): number` y `estaBajo(p): boolean`.

- [ ] **Step 1: Escribir el test**

Crear `frontend/src/lib/stock-buffet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stockTotal, estaBajo } from './stock-buffet';

const prod = (stock: number, asignado: number, stockMinimo: number) =>
  ({ stock, asignado, stockMinimo, activo: true }) as Parameters<typeof estaBajo>[0];

describe('stockTotal', () => {
  it('suma el general y lo que esta en el secundario', () => {
    expect(stockTotal(prod(5, 15, 6))).toBe(20);
  });

  it('sin nada asignado es el general', () => {
    expect(stockTotal(prod(5, 0, 6))).toBe(5);
  });
});

describe('estaBajo', () => {
  it('NO avisa si el total alcanza aunque el general este por debajo', () => {
    // El caso que motivó todo: 20 unidades en el complejo, 15 en el otro mostrador.
    // Avisar acá seria pedir que compres algo que ya compraste.
    expect(estaBajo(prod(5, 15, 6))).toBe(false);
  });

  it('avisa cuando el total esta en el minimo', () => {
    expect(estaBajo(prod(2, 4, 6))).toBe(true);
  });

  it('avisa cuando no queda nada en ningun lado', () => {
    expect(estaBajo(prod(0, 0, 6))).toBe(true);
  });

  it('un producto inactivo nunca avisa', () => {
    expect(estaBajo({ stock: 0, asignado: 0, stockMinimo: 6, activo: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run (desde `frontend/`): `npx vitest run src/lib/stock-buffet.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Los helpers**

Crear `frontend/src/lib/stock-buffet.ts`:

```ts
/** Lo mínimo que hace falta para decidir si hay que reponer. */
type ConStock = { stock: number; asignado: number; stockMinimo: number; activo: boolean };

/**
 * Todo lo que hay en el complejo: el general más lo que está en el secundario.
 *
 * `stock` es el general, y las unidades entregadas al secundario SALIERON de ahí, así que mirar
 * solo ese campo cuenta de menos.
 */
export function stockTotal(p: ConStock): number {
  return p.stock + p.asignado;
}

/**
 * Si hay que reponer comprando.
 *
 * Mide el total y no el general a propósito: la alerta existe para disparar una compra, y las
 * unidades que están en el otro mostrador ya se compraron.
 */
export function estaBajo(p: ConStock): boolean {
  return p.activo && stockTotal(p) <= p.stockMinimo;
}
```

- [ ] **Step 4: El tipo**

En `frontend/src/lib/types.ts`, agregar `asignado` a `ProductoBuffet`:

```ts
export interface ProductoBuffet {
  id: string; nombre: string; codigoBarra: string | null; precio: number;
  stock: number; stockMinimo: number; enBotonera: boolean; orden: number; activo: boolean;
  /** Unidades de este producto que están en el mostrador secundario. */
  asignado: number;
}
```

- [ ] **Step 5: La página y la tabla**

En `frontend/src/app/(panel)/buffet/page.tsx`, reemplazar el cálculo de `bajos` y el texto de la alerta:

```tsx
  const bajos = productos.filter(estaBajo);
```

y en el bloque del aviso, mostrar el total en vez del general:

```tsx
          <p className="mt-1 text-sm text-amber-800">
            {bajos.map((p) => `${p.nombre} (${stockTotal(p)})`).join(' · ')}
          </p>
```

Agregar `import { estaBajo, stockTotal } from '@/lib/stock-buffet';`.

En `frontend/src/components/buffet/productos-table.tsx` hay **dos** renders del stock —una tabla para pantallas grandes y una lista para chicas—, y los dos calculan `const bajo = p.stock <= p.stockMinimo;` (líneas 56 y 74). Ese cálculo es el mismo que la alerta, así que pasa a usar el helper, y junto al número del general se muestra lo asignado.

En la versión de tabla (alrededor de la línea 56 y 62):

```tsx
                  const bajo = estaBajo(p);
```

```tsx
                      <TableCell className={bajo ? 'font-medium text-red-600' : ''}>
                        {p.stock}
                        {p.asignado > 0 && (
                          <span className="ml-1 text-xs font-normal text-neutral-500">+{p.asignado} en el secundario</span>
                        )}
                      </TableCell>
```

En la versión de lista (alrededor de la línea 74 y 81), el mismo cambio:

```tsx
              const bajo = estaBajo(p);
```

```tsx
                    <span className="block">
                      <span className="text-xs text-neutral-500">Stock</span>{' '}
                      <span className={bajo ? 'font-medium text-red-600' : ''}>{p.stock}</span>
                      {p.asignado > 0 && <span className="text-xs text-neutral-500"> +{p.asignado} en el secundario</span>}
                    </span>
```

Agregar `import { estaBajo } from '@/lib/stock-buffet';`.

El `+15 en el secundario` solo aparece cuando hay algo asignado: en un buffet donde el segundo puesto no se usa, esa columna sería ruido en todas las filas.

- [ ] **Step 6: Verificar y commitear**

Run (desde `frontend/`): `npx vitest run src/lib/stock-buffet.test.ts && pnpm typecheck && pnpm build && pnpm lint`
Expected: tests PASS, typecheck y build limpios, lint sin errores nuevos.

```bash
git add frontend/src
git commit -m "feat(buffet): la alerta de stock mide el total del complejo"
```

---

### Task 6: Los cierres etiquetados y la navegación del buffet

`/buffet/cierres` ya existe pero **no está en la navegación**: hoy se llega solo tipeando la URL. Esta task lo arregla y deja el lugar donde van a colgarse las dos páginas nuevas.

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/components/buffet/sub-nav.tsx`
- Modify: `frontend/src/app/(panel)/buffet/page.tsx`
- Modify: `frontend/src/app/(panel)/buffet/cierres/page.tsx`

**Interfaces:**
- Consumes: `mostradorId`/`mostradorNombre` en `GET /buffet/cajas` (Task 1).
- Produces: `<SubNavBuffet activa="catalogo" | "cierres" | "conciliaciones" | "entregas" />`

- [ ] **Step 1: El tipo**

En `frontend/src/lib/types.ts`, agregar a `CierreBuffet`:

```ts
  mostradorId: string; mostradorNombre: string;
```

- [ ] **Step 2: La sub-navegación**

Crear `frontend/src/components/buffet/sub-nav.tsx`:

```tsx
import Link from 'next/link';

const PAGINAS = [
  { clave: 'catalogo', href: '/buffet', label: 'Catálogo' },
  { clave: 'cierres', href: '/buffet/cierres', label: 'Cierres' },
  { clave: 'conciliaciones', href: '/buffet/conciliaciones', label: 'Faltantes' },
  { clave: 'entregas', href: '/buffet/entregas', label: 'Entregas' },
] as const;

export type PaginaBuffet = (typeof PAGINAS)[number]['clave'];

/**
 * Los links entre las páginas del buffet.
 *
 * Existe porque el menú principal solo lleva a `/buffet`: sin esto, las otras tres son
 * inalcanzables salvo tipeando la URL — que es como quedó `cierres` hasta ahora.
 */
export function SubNavBuffet({ activa }: { activa: PaginaBuffet }) {
  return (
    <nav className="flex flex-wrap gap-2">
      {PAGINAS.map((p) => (
        <Link
          key={p.clave}
          href={p.href}
          className={`rounded-lg px-3 py-1 text-sm font-medium ${
            p.clave === activa ? 'bg-neutral-900 text-white' : 'border text-neutral-700'
          }`}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Colgarla en el catálogo**

En `frontend/src/app/(panel)/buffet/page.tsx`, debajo del `<header>`:

```tsx
      <SubNavBuffet activa="catalogo" />
```

con `import { SubNavBuffet } from '@/components/buffet/sub-nav';`.

- [ ] **Step 4: Los cierres, etiquetados y filtrables**

Reemplazar `frontend/src/app/(panel)/buffet/cierres/page.tsx`:

```tsx
import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { CierreBuffet } from '@/lib/types';
import { SubNavBuffet } from '@/components/buffet/sub-nav';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

const FILTROS = [
  { clave: '', label: 'Todos' },
  { clave: 'mostrador-principal', label: 'Principal' },
  { clave: 'mostrador-secundario', label: 'Secundario' },
] as const;

export default async function CierresBuffetPage({ searchParams }: { searchParams: Promise<{ mostradorId?: string }> }) {
  await requireAdmin();
  const { mostradorId } = await searchParams;
  const qs = mostradorId ? `?mostradorId=${encodeURIComponent(mostradorId)}` : '';
  const cierres = await apiFetch<CierreBuffet[]>(`/buffet/cajas${qs}`);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Cierres del buffet</h1>
      </header>
      <SubNavBuffet activa="cierres" />

      <nav className="flex gap-2">
        {FILTROS.map((f) => (
          <a
            key={f.clave}
            href={f.clave ? `/buffet/cierres?mostradorId=${f.clave}` : '/buffet/cierres'}
            className={`rounded-lg px-3 py-1 text-sm ${(mostradorId ?? '') === f.clave ? 'bg-neutral-900 text-white' : 'border text-neutral-700'}`}
          >
            {f.label}
          </a>
        ))}
      </nav>

      {cierres.length === 0 ? (
        <p className="text-neutral-600">No hay cajas cerradas para ese filtro.</p>
      ) : cierres.map((c) => (
        <article key={c.id} className="rounded-xl border bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-neutral-600">
              {fmt(c.cerradaEn)} · <b className="text-neutral-800">{c.mostradorNombre}</b>
            </span>
            <span className="text-lg font-semibold tabular-nums">{money(c.totalMonto)}</span>
          </div>
          <p className="text-sm text-neutral-600">{c.totalUnidades} productos</p>
          <p className="text-sm text-neutral-600">Efectivo <span className="tabular-nums">{money(c.totalEfectivo)}</span> · Transferencia <span className="tabular-nums">{money(c.totalTransferencia)}</span></p>
          <ul className="mt-2 space-y-1 text-sm">
            {c.porProducto.map((l) => (
              <li key={l.productoId} className="flex justify-between">
                <span>{l.nombre} × {l.unidades}</span>
                <span className="tabular-nums">{money(l.monto)}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
```

**Antes de escribir esto, leé la guía de `searchParams` en `frontend/node_modules/next/dist/docs/`**: en Next.js 16 son asíncronos y hay que await-earlos, como muestra el código.

- [ ] **Step 5: Verificar y commitear**

Run (desde `frontend/`): `pnpm typecheck && pnpm build && pnpm lint`

```bash
git add frontend/src
git commit -m "feat(buffet): cierres etiquetados por mostrador y navegacion entre las vistas"
```

---

### Task 7: Las dos vistas nuevas

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/app/(panel)/buffet/conciliaciones/page.tsx`
- Create: `frontend/src/app/(panel)/buffet/entregas/page.tsx`

**Interfaces:**
- Consumes: `GET /buffet/conciliaciones/resumen` y `GET /buffet/entregas` (Tasks 3 y 4); `<SubNavBuffet>` (Task 6).

- [ ] **Step 1: Los tipos**

En `frontend/src/lib/types.ts`:

```ts
export interface ResumenConciliacion {
  productoId: string; nombre: string; cierres: number;
  entregado: number; vendido: number; contado: number; diferencia: number;
}
export interface EntregaPanel {
  id: string; creadaEn: string; conciliada: boolean;
  lineas: { productoId: string; nombre: string; cantidad: number }[];
}
```

- [ ] **Step 2: La vista de faltantes**

Crear `frontend/src/app/(panel)/buffet/conciliaciones/page.tsx`:

```tsx
import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { ResumenConciliacion } from '@/lib/types';
import { SubNavBuffet } from '@/components/buffet/sub-nav';

export default async function ConciliacionesPage() {
  await requireAdmin();
  const filas = await apiFetch<ResumenConciliacion[]>('/buffet/conciliaciones/resumen');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Faltantes del buffet</h1>
        <p className="text-sm text-neutral-600">Últimos 90 días, lo que más falta primero.</p>
      </header>
      <SubNavBuffet activa="conciliaciones" />

      {filas.length === 0 ? (
        <p className="text-neutral-600">No hay cierres conciliados en este período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="p-3">Producto</th>
                <th className="p-3">Cierres</th>
                <th className="p-3">Entregado</th>
                <th className="p-3">Vendido</th>
                <th className="p-3">Contado</th>
                <th className="p-3">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.productoId} className="border-t">
                  <td className="p-3 font-medium">{f.nombre}</td>
                  <td className="p-3 tabular-nums">{f.cierres}</td>
                  <td className="p-3 tabular-nums">{f.entregado}</td>
                  <td className="p-3 tabular-nums">{f.vendido}</td>
                  <td className="p-3 tabular-nums">{f.contado}</td>
                  {/* Cero se muestra como texto y no como 0: que NO falte nada es la lectura
                      importante, y un 0 en una columna de numeros se lee como un dato mas. */}
                  <td className={`p-3 tabular-nums ${f.diferencia < 0 ? 'font-semibold text-red-700' : 'text-neutral-500'}`}>
                    {f.diferencia === 0 ? 'sin diferencia' : f.diferencia}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: La vista de entregas**

Crear `frontend/src/app/(panel)/buffet/entregas/page.tsx`:

```tsx
import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { EntregaPanel } from '@/lib/types';
import { SubNavBuffet } from '@/components/buffet/sub-nav';

const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

export default async function EntregasPage() {
  await requireAdmin();
  const entregas = await apiFetch<EntregaPanel[]>('/buffet/entregas');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Entregas al secundario</h1>
        <p className="text-sm text-neutral-600">
          Últimos 90 días. Dos entregas iguales y pegadas en el tiempo pueden ser un doble toque.
        </p>
      </header>
      <SubNavBuffet activa="entregas" />

      {entregas.length === 0 ? (
        <p className="text-neutral-600">No hay entregas en este período.</p>
      ) : (
        <ul className="space-y-2">
          {entregas.map((e) => (
            <li key={e.id} className="rounded-xl border bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-neutral-600">{fmt(e.creadaEn)}</span>
                <span className={`text-xs font-medium ${e.conciliada ? 'text-neutral-500' : 'text-amber-700'}`}>
                  {e.conciliada ? 'rendida' : 'pendiente de rendir'}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {e.lineas.map((l) => (
                  <li key={l.productoId}>{l.nombre} × <span className="tabular-nums">{l.cantidad}</span></li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verificar**

Run (desde `frontend/`): `npx vitest run && pnpm typecheck && pnpm build && pnpm lint`
Expected: tests como antes (los 2 rojos preexistentes de `validators.test.ts` y nada más), typecheck y build limpios, lint sin errores nuevos.

- [ ] **Step 5: Verificación manual**

El panel no tiene tests de render. Con el backend corriendo y el panel levantado, entrá como admin y recorré, anotando el resultado de cada uno:

| Caso | Qué tiene que pasar |
|---|---|
| `/buffet` | La alerta ya no salta por un producto cuyo total alcanza; la tabla muestra las dos cifras |
| Los cuatro links de la sub-nav | Llevan a las cuatro páginas y marcan la activa |
| `/buffet/cierres` | Cada cierre dice de qué mostrador es |
| Filtrar por Secundario | Solo quedan los cierres de ese puesto |
| `/buffet/conciliaciones` | Lo que más falta arriba; un producto sin diferencia dice "sin diferencia" |
| Sin cierres conciliados | Mensaje de que no hay datos, no una tabla vacía |
| `/buffet/entregas` | Las entregas más nuevas primero, con "pendiente de rendir" o "rendida" |

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(buffet): vistas de faltantes y de entregas en el panel"
```

---

## Notas para el deploy

- **Sin migraciones ni variables de entorno nuevas.** Todo el backend es aditivo: tres rutas nuevas y dos campos agregados a DTOs existentes.
- **Desplegar el backend antes que el panel.** Las páginas nuevas llaman a rutas que un backend viejo no tiene: contra 404, la página cae en el error boundary. Al revés no hay problema.
- Recordá que el deploy del backend es **manual por SSH**: el workflow de `backend/.github/workflows/deploy.yml` está fuera de la raíz del repo y GitHub Actions nunca lo ejecuta.

## Lo que queda afuera

- **Arreglar el doble tap de la entrega.** Esta pieza lo vuelve *visible*, no imposible. La solución real es una clave de idempotencia en `POST /buffet/entregas`, como ya usa `cobrar` con el `uid` del ticket.
- **Anular o revertir una entrega.**
- **Que cambiar el PIN revoque los tokens ya emitidos** (la palanca sigue siendo desactivar el mostrador).
- **Auditar `PATCH /buffet/mostradores/:id`.**
- **El detalle por cierre.** El spec listaba `GET /buffet/cajas/:id/conteo` y "al abrir un producto se ven sus cierres", y **ninguna de las dos cosas se implementa acá**: la vista de faltantes muestra el agregado, que es lo que respondía la pregunta que motivó guardar las cuatro cifras. Se sacó el endpoint del plan porque quedaba sin consumidor, y un endpoint que nadie llama es código muerto — el mismo criterio con el que la pieza B recortó tres acciones. Cuando exista la pantalla que lo use, son las dos cosas juntas y es trabajo chico.

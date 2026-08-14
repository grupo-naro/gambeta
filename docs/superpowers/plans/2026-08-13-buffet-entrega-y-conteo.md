# Buffet: pantallas de entrega y de conteo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el mostrador principal pueda entregarle stock al secundario y cargar el conteo del cierre desde una pantalla, y que el secundario vea cuánto tiene de cada producto antes de vender.

**Architecture:** El backend de la operación ya existe y está testeado; faltan tres datos que las pantallas necesitan (el asignado de otro puesto, las cajas pendientes de conciliar, y el stock general por producto). Encima de eso van tres pantallas nuevas bajo `/mostrador`, todas del principal salvo la de venta.

**Tech Stack:** Express 5, Prisma 7 (cliente en `src/generated/prisma`, singleton `src/db/prisma.ts`), zod, vitest + Testcontainers. Panel y POS en Next.js 16 (`frontend/`, pnpm).

**Spec:** `docs/superpowers/specs/2026-08-13-buffet-entrega-y-conteo-design.md`

## Global Constraints

- **Código, comentarios y vocabulario en español.** No traducir `cancha`, `seña`, `mostrador`, `caja`, `buffet`.
- **Nunca importar de `@prisma/client`.** Tipos desde `src/db/client.ts`; runtime desde `src/db/prisma.ts`.
- Errores esperados = factories de `src/utils/errors.ts` (`BadRequest`, `NotFound`, `Conflict`, `BusinessRule`, `Forbidden`, …). Nunca `Error` crudo, incluidos errores de Prisma sin mapear.
- Capas en una sola dirección: `routes/ → services/ → repositories/ → db/prisma.ts`. Las rutas son finas.
- **`authBuffet` no acepta el JWT de admin ni la `SERVICE_API_KEY`**, y eso no cambia. Las rutas donde importa QUIÉN opera usan `authMostrador`, que exige el token de `x-mostrador` y deja `req.mostrador = { id, tipo }`.
- Los ids de los mostradores son fijos: `'mostrador-principal'` y `'mostrador-secundario'`.
- **Esta pieza NO toca el schema de Prisma ni agrega migraciones.** Si parece que hace falta, pará y consultá.
- Backend usa **npm**; `frontend/` usa **pnpm**. Los tests de integración necesitan Docker.
- **`backend/tsconfig.json` excluye `tests/`**, así que `npm run typecheck` **no** valida los archivos de test. Hay que correr los tests: este error ya causó dos regresiones reales en este repo.
- `frontend/` tiene vitest sobre `src/**/*.test.{ts,tsx}`, y **testea funciones puras, no render**. No montar Testing Library.
- **`pnpm lint` en `frontend/` ya falla** en archivos preexistentes (`nueva-reserva-dialog.tsx`, `usuarios-table.tsx`, `use-cliente-autocomplete.ts`). La vara es **no introducir errores nuevos**.
- **Next.js 16** es más nuevo que la mayoría de los datos de entrenamiento: antes de escribir algo específico de Next (rutas, params, caching, server components), leer la guía en `node_modules/next/dist/docs/`.
- **No pushear `main`**: dispara el deploy del backend a producción.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/src/services/buffetProducto.service.ts` (modificar) | `listActivos()` devuelve también el stock general. |
| `backend/src/services/buffetConciliacion.service.ts` (modificar) | `pendientes()`: las cajas que esperan conteo. |
| `backend/src/validators/buffet.schema.ts` (modificar) | `stockAsignadoSchema`. |
| `backend/src/routes/buffet.routes.ts` (modificar) | `?mostradorId=` en stock-asignado; ruta de pendientes. |
| `backend/tests/integration/buffet-pantallas.test.ts` (crear) | Los tres cambios de backend. |
| `frontend/src/lib/types.ts` (modificar) | `ProductoCobro.stock`, `StockAsignado`, `ConciliacionPendiente`, `LineaConciliacion`. |
| `frontend/src/lib/mostrador-stock.ts` (crear) | Helpers puros: cruzar productos con lo asignado, y la diferencia del conteo. |
| `frontend/src/lib/mostrador-stock.test.ts` (crear) | Sus tests. |
| `frontend/src/lib/buffet-actions.ts` (modificar) | Actions de entregar, stock asignado, pendientes y conciliar. |
| `frontend/src/app/mostrador/entregar/page.tsx` (crear) | Ruta de la pantalla de entrega. |
| `frontend/src/components/mostrador/pantalla-entrega.tsx` (crear) | La pantalla de entrega. |
| `frontend/src/app/mostrador/conciliar/[cajaId]/page.tsx` (crear) | Ruta de la pantalla de conteo. |
| `frontend/src/components/mostrador/pantalla-conteo.tsx` (crear) | La pantalla de conteo. |
| `frontend/src/app/mostrador/page.tsx` (modificar) | Trae pendientes y el asignado, y los pasa a la venta. |
| `frontend/src/components/mostrador/pantalla-venta.tsx` (modificar) | Aviso de conciliación pendiente y cantidades del secundario. |

---

### Task 1: El backend expone el stock que las pantallas necesitan

Sin esto la pantalla de entrega no puede mostrar ni cuánto hay para repartir ni cuánto ya se repartió.

**Files:**
- Modify: `backend/src/services/buffetProducto.service.ts`
- Modify: `backend/src/validators/buffet.schema.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-pantallas.test.ts`

**Interfaces:**
- Produces: `buffetProductoService.listActivos(): Promise<{ id: string; nombre: string; precio: number; stock: number }[]>`
- Produces: `GET /buffet/stock-asignado?mostradorId=<id>` — sin query, el del que llama; con query, el de ese puesto, permitido **solo al principal**.

- [ ] **Step 1: Escribir el test**

Crear `backend/tests/integration/buffet-pantallas.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { hashPassword } from '../../src/utils/password.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  await getPrisma().mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  await getPrisma().mostrador.update({ where: { id: 'mostrador-secundario' }, data: { pinHash: await hashPassword('2222') } });
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 20 } })).id;
});

/** Loguea un puesto por PIN y devuelve su token de `x-mostrador`. */
async function tokenDe(pin: string): Promise<string> {
  const r = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin });
  return r.body.token;
}
const comoMostrador = (r: any, token: string) => r.set('x-buffet-key', KEY).set('x-mostrador', token);

describe('stock que ven las pantallas', () => {
  it('los productos activos traen el stock general', async () => {
    const t = await tokenDe('1111');
    const r = await comoMostrador(supertest(app).get('/buffet/productos/activos'), t);
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ nombre: 'Coca', stock: 20 });
  });

  it('sin query, stock-asignado devuelve el del que llama', async () => {
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), principal)
      .send({ items: [{ productoId, cantidad: 7 }] });

    const secundario = await tokenDe('2222');
    const r = await comoMostrador(supertest(app).get('/buffet/stock-asignado'), secundario);
    expect(r.body).toEqual([{ productoId, cantidad: 7 }]);
  });

  it('el principal puede pedir el asignado del secundario', async () => {
    // Es lo que hace la pantalla de entrega para mostrar "cuanto ya le di".
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), principal)
      .send({ items: [{ productoId, cantidad: 7 }] });

    const r = await comoMostrador(
      supertest(app).get('/buffet/stock-asignado?mostradorId=mostrador-secundario'), principal,
    );
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ productoId, cantidad: 7 }]);
  });

  it('el secundario NO puede espiar el asignado de otro puesto', async () => {
    const secundario = await tokenDe('2222');
    const r = await comoMostrador(
      supertest(app).get('/buffet/stock-asignado?mostradorId=mostrador-principal'), secundario,
    );
    expect(r.status).toBe(403);
  });

  it('pedir explicitamente el propio si esta permitido', async () => {
    const secundario = await tokenDe('2222');
    const r = await comoMostrador(
      supertest(app).get('/buffet/stock-asignado?mostradorId=mostrador-secundario'), secundario,
    );
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/buffet-pantallas.test.ts`
Expected: FAIL — `stock` viene `undefined` en productos activos, y el caso del 403 devuelve 200 porque la query se ignora.

- [ ] **Step 3: El stock en los productos activos**

En `backend/src/services/buffetProducto.service.ts`, reemplazar `listActivos`:

```ts
  async listActivos(): Promise<{ id: string; nombre: string; precio: number; stock: number }[]> {
    const rows = await prisma.productoBuffet.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
    // `stock` es el general (el del principal). La pantalla de entrega lo necesita para no
    // ofrecer repartir lo que no hay; la de venta lo ignora.
    return rows.map((p) => ({ id: p.id, nombre: p.nombre, precio: Number(p.precio), stock: p.stock }));
  },
```

- [ ] **Step 4: El validador de la query**

En `backend/src/validators/buffet.schema.ts`, al final del archivo:

```ts
export const stockAsignadoSchema = z.object({
  body: z.unknown(),
  query: z.object({ mostradorId: z.string().min(1).optional() }),
  params: empty,
});
```

- [ ] **Step 5: La regla de autorización en la ruta**

En `backend/src/routes/buffet.routes.ts`, reemplazar la ruta de `/stock-asignado`:

```ts
buffetRoutes.get('/stock-asignado', authMostrador, validate(stockAsignadoSchema), async (req, res, next) => {
  try {
    const propio = (req as any).mostrador.id as string;
    const pedido = ((req as any).valid.query.mostradorId as string | undefined) ?? propio;
    // Ver el asignado de OTRO puesto es cosa del principal: es el que reparte y el que
    // concilia. Si cualquiera pudiera, el secundario vería el inventario ajeno.
    if (pedido !== propio && (req as any).mostrador.tipo !== 'PRINCIPAL') {
      return next(Forbidden('Solo el mostrador principal puede ver el stock de otro puesto'));
    }
    res.json(await buffetEntregaService.stockAsignado(pedido));
  } catch (e) { next(e); }
});
```

Agregar `stockAsignadoSchema` al `import` de `../validators/buffet.schema.js`. `Forbidden` ya está importado.

- [ ] **Step 6: Correr y verificar**

Run: `npx vitest run tests/integration/buffet-pantallas.test.ts && npm run typecheck`
Expected: PASS los 5 casos, typecheck limpio.

- [ ] **Step 7: Regresión del buffet**

Run: `npx vitest run tests/integration/buffet-*.test.ts`
Expected: todo verde. `listActivos` agrega un campo, así que es aditivo.

- [ ] **Step 8: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(buffet): el mostrador ve el stock general y el asignado del otro puesto"
```

---

### Task 2: Las cajas que esperan conteo

Cuando el secundario cierra, hoy el principal no tiene forma de enterarse.

**Files:**
- Modify: `backend/src/services/buffetConciliacion.service.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-pantallas.test.ts` (agregar un `describe`)

**Interfaces:**
- Consumes: `req.mostrador` (`{ id, tipo }`) del middleware `authMostrador`.
- Produces: `buffetConciliacionService.pendientes(): Promise<{ cajaId: string; mostradorNombre: string; cerradaEn: string; totalMonto: number }[]>`
- Produces: `GET /buffet/conciliaciones/pendientes` — solo el principal.

- [ ] **Step 1: Escribir el test**

Agregar al final de `backend/tests/integration/buffet-pantallas.test.ts`:

```ts
describe('cajas que esperan conteo', () => {
  /** Entrega 10, el secundario abre, vende `vendidas` y cierra. Devuelve el id de la caja. */
  async function turnoDelSecundario(vendidas: number): Promise<string> {
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), principal)
      .send({ items: [{ productoId, cantidad: 10 }] });

    const secundario = await tokenDe('2222');
    const caja = await comoMostrador(supertest(app).post('/buffet/caja/abrir'), secundario);
    if (vendidas > 0) {
      await comoMostrador(supertest(app).post('/buffet/cobrar'), secundario).send({
        uid: `uid-${Date.now()}-${Math.random()}`, medioPago: 'EFECTIVO', montoPagado: 999999,
        items: [{ productoId, cantidad: vendidas }],
      });
    }
    await comoMostrador(supertest(app).post('/buffet/caja/cerrar'), secundario);
    return caja.body.id;
  }

  it('lista la caja cerrada del secundario, con su total', async () => {
    const cajaId = await turnoDelSecundario(3);
    const principal = await tokenDe('1111');

    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), principal);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].cajaId).toBe(cajaId);
    expect(r.body[0].mostradorNombre).toBeTruthy();
    expect(r.body[0].totalMonto).toBe(6000);
    expect(r.body[0].cerradaEn).toBeTruthy();
  });

  it('deja de listarla una vez conciliada', async () => {
    const cajaId = await turnoDelSecundario(3);
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post(`/buffet/cajas/${cajaId}/conciliacion`), principal)
      .send({ conteos: [{ productoId, contado: 7 }] });

    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), principal);
    expect(r.body).toHaveLength(0);
  });

  it('no lista cajas todavia abiertas', async () => {
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/entregas'), principal)
      .send({ items: [{ productoId, cantidad: 10 }] });
    const secundario = await tokenDe('2222');
    await comoMostrador(supertest(app).post('/buffet/caja/abrir'), secundario);

    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), principal);
    expect(r.body).toHaveLength(0);
  });

  it('NO lista las cajas del propio principal', async () => {
    // Conciliar una caja del principal falla siempre: esas unidades ya salieron del general al
    // venderlas, asi que el conteo inventaria stock. Ofrecerla seria ofrecer un boton roto.
    const principal = await tokenDe('1111');
    await comoMostrador(supertest(app).post('/buffet/caja/abrir'), principal);
    await comoMostrador(supertest(app).post('/buffet/cobrar'), principal).send({
      uid: 'uid-del-principal', medioPago: 'EFECTIVO', montoPagado: 999999,
      items: [{ productoId, cantidad: 2 }],
    });
    await comoMostrador(supertest(app).post('/buffet/caja/cerrar'), principal);

    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), principal);
    expect(r.body).toHaveLength(0);
  });

  it('el secundario no puede ver los pendientes', async () => {
    const secundario = await tokenDe('2222');
    const r = await comoMostrador(supertest(app).get('/buffet/conciliaciones/pendientes'), secundario);
    expect(r.status).toBe(403);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/buffet-pantallas.test.ts -t "esperan conteo"`
Expected: FAIL con 404 — la ruta no existe.

- [ ] **Step 3: El servicio**

En `backend/src/services/buffetConciliacion.service.ts`, agregar al objeto `buffetConciliacionService` (después de `pendiente`):

```ts
  /**
   * Las cajas que esperan conteo: cerradas, sin conciliar, y de un puesto que no es el principal.
   *
   * Los tres filtros hacen falta. Excluir las del principal no es cosmético: `conciliar` las
   * rechaza, porque sobre una caja del principal el conteo devolvería al general unidades que
   * ya se descontaron al venderlas.
   */
  async pendientes(): Promise<{ cajaId: string; mostradorNombre: string; cerradaEn: string; totalMonto: number }[]> {
    const cajas = await prisma.cajaBuffet.findMany({
      where: { estado: 'CERRADA', mostradorId: { not: PRINCIPAL }, conteos: { none: {} } },
      include: { mostrador: { select: { nombre: true } } },
      orderBy: { cerradaEn: 'desc' },
    });

    const out = [];
    for (const c of cajas) {
      const { _sum } = await prisma.ticketBuffet.aggregate({
        where: { cajaId: c.id }, _sum: { total: true },
      });
      out.push({
        cajaId: c.id,
        mostradorNombre: c.mostrador.nombre,
        cerradaEn: (c.cerradaEn ?? c.abiertaEn).toISOString(),
        totalMonto: Number(_sum.total ?? 0),
      });
    }
    return out;
  },
```

`PRINCIPAL` ya está declarado como constante arriba en ese archivo.

- [ ] **Step 4: La ruta**

En `backend/src/routes/buffet.routes.ts`, **antes** de `buffetRoutes.get('/cajas/:id/conciliacion', ...)`:

```ts
buffetRoutes.get('/conciliaciones/pendientes', authMostrador, async (req, res, next) => {
  try {
    if ((req as any).mostrador.tipo !== 'PRINCIPAL') return next(Forbidden('La conciliación la ve el mostrador principal'));
    res.json(await buffetConciliacionService.pendientes());
  } catch (e) { next(e); }
});
```

- [ ] **Step 5: Correr y verificar**

Run: `npx vitest run tests/integration/buffet-pantallas.test.ts && npm run typecheck`
Expected: PASS los 10 casos del archivo.

- [ ] **Step 6: Regresión y commit**

Run: `npx vitest run tests/integration/buffet-*.test.ts`

```bash
git add backend/src backend/tests
git commit -m "feat(buffet): el principal ve que cajas esperan el conteo del cierre"
```

---

### Task 3: Tipos y helpers puros del frontend

Lo único de estas pantallas con lógica que valga aislar. El resto es cableado.

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/mostrador-stock.ts`
- Create: `frontend/src/lib/mostrador-stock.test.ts`

**Interfaces:**
- Produces: `type StockAsignado = { productoId: string; cantidad: number }`
- Produces: `type ConciliacionPendiente = { cajaId: string; mostradorNombre: string; cerradaEn: string; totalMonto: number }`
- Produces: `type LineaConciliacion = { productoId: string; nombre: string; entregado: number; vendido: number; esperado: number }`
- Produces: `asignadoPorProducto(filas: StockAsignado[]): Record<string, number>`
- Produces: `diferencia(esperado: number, contado: number): number`

- [ ] **Step 1: Escribir el test**

Crear `frontend/src/lib/mostrador-stock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { asignadoPorProducto, diferencia } from './mostrador-stock';

describe('asignadoPorProducto', () => {
  it('indexa las filas por producto', () => {
    expect(asignadoPorProducto([{ productoId: 'a', cantidad: 7 }])).toEqual({ a: 7 });
  });

  it('un producto sin fila no aparece, y se lee como cero', () => {
    // Es lo que permite que la botonera del secundario deshabilite lo que no tiene sin
    // pedirle al backend una fila en cero por cada producto del catalogo.
    const mapa = asignadoPorProducto([{ productoId: 'a', cantidad: 7 }]);
    expect(mapa['b'] ?? 0).toBe(0);
  });

  it('sin filas devuelve un mapa vacio', () => {
    expect(asignadoPorProducto([])).toEqual({});
  });
});

describe('diferencia', () => {
  it('contar lo esperado da cero', () => {
    expect(diferencia(6, 6)).toBe(0);
  });

  it('faltante da negativo', () => {
    expect(diferencia(6, 4)).toBe(-2);
  });

  it('sobrante da positivo', () => {
    expect(diferencia(6, 8)).toBe(2);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run (desde `frontend/`): `npx vitest run src/lib/mostrador-stock.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Los helpers**

Crear `frontend/src/lib/mostrador-stock.ts`:

```ts
import type { StockAsignado } from './types';

/**
 * Indexa el stock asignado por producto.
 *
 * El backend solo devuelve filas de lo que tiene asignado, así que un producto ausente vale
 * cero: el consumidor lee `mapa[id] ?? 0` y no necesita una fila por cada producto del catálogo.
 */
export function asignadoPorProducto(filas: StockAsignado[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of filas) out[f.productoId] = f.cantidad;
  return out;
}

/** Lo contado contra lo esperado: negativo es faltante, positivo es sobrante. */
export function diferencia(esperado: number, contado: number): number {
  return contado - esperado;
}
```

- [ ] **Step 4: Los tipos**

En `frontend/src/lib/types.ts`, reemplazar la línea de `ProductoCobro` y agregar los tipos nuevos:

```ts
export interface ProductoCobro { id: string; nombre: string; precio: number; stock: number }
export interface StockAsignado { productoId: string; cantidad: number }
export interface ConciliacionPendiente {
  cajaId: string; mostradorNombre: string; cerradaEn: string; totalMonto: number;
}
export interface LineaConciliacion {
  productoId: string; nombre: string; entregado: number; vendido: number; esperado: number;
}
```

- [ ] **Step 5: Correr y verificar**

Run (desde `frontend/`): `npx vitest run src/lib/mostrador-stock.test.ts`
Expected: PASS los 6 casos.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(buffet): tipos y helpers de stock del mostrador"
```

---

### Task 4: Las actions del mostrador

**Files:**
- Modify: `frontend/src/lib/buffet-actions.ts`

**Interfaces:**
- Consumes: los tipos de la Task 3; los endpoints de las Tasks 1 y 2.
- Produces: `entregarStock(items)`, `getStockAsignado(mostradorId?)`, `getPendientes()`, `getConciliacion(cajaId)`, `conciliarCaja(cajaId, conteos)` — todas devuelven `Resultado<T>`.

- [ ] **Step 1: Agregar las actions**

En `frontend/src/lib/buffet-actions.ts`, agregar al final (el helper `conSesion` y el tipo `Resultado` ya existen en ese archivo):

```ts
export async function entregarStock(items: { productoId: string; cantidad: number }[]): Promise<Resultado<{ entregaId: string }>> {
  return conSesion(() => buffetFetch<{ entregaId: string }>('/buffet/entregas', {
    method: 'POST', body: JSON.stringify({ items }),
  }));
}

export async function getStockAsignado(mostradorId?: string): Promise<Resultado<StockAsignado[]>> {
  const qs = mostradorId ? `?mostradorId=${encodeURIComponent(mostradorId)}` : '';
  return conSesion(() => buffetFetch<StockAsignado[]>(`/buffet/stock-asignado${qs}`));
}

export async function getPendientes(): Promise<Resultado<ConciliacionPendiente[]>> {
  return conSesion(() => buffetFetch<ConciliacionPendiente[]>('/buffet/conciliaciones/pendientes'));
}

export async function getConciliacion(cajaId: string): Promise<Resultado<LineaConciliacion[]>> {
  return conSesion(() => buffetFetch<LineaConciliacion[]>(`/buffet/cajas/${encodeURIComponent(cajaId)}/conciliacion`));
}

export async function conciliarCaja(
  cajaId: string,
  conteos: { productoId: string; contado: number }[],
): Promise<Resultado<{ lineas: (LineaConciliacion & { contado: number; diferencia: number })[] }>> {
  return conSesion(() => buffetFetch<{ lineas: (LineaConciliacion & { contado: number; diferencia: number })[] }>(
    `/buffet/cajas/${encodeURIComponent(cajaId)}/conciliacion`,
    { method: 'POST', body: JSON.stringify({ conteos }) },
  ));
}
```

Agregar `StockAsignado`, `ConciliacionPendiente` y `LineaConciliacion` al `import type` de `./types`.

- [ ] **Step 2: Verificar que compila**

Run (desde `frontend/`): `pnpm build`
Expected: compila. Las actions todavía no se usan — es esperable.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/buffet-actions.ts
git commit -m "feat(buffet): actions de entrega y conciliacion del mostrador"
```

---

### Task 5: La pantalla de entrega

**Files:**
- Create: `frontend/src/app/mostrador/entregar/page.tsx`
- Create: `frontend/src/components/mostrador/pantalla-entrega.tsx`

**Interfaces:**
- Consumes: `getStockAsignado`, `entregarStock` (Task 4); `asignadoPorProducto` (Task 3); `mostradorDeSesion` (ya existe en `buffet-session.ts`).

- [ ] **Step 1: La ruta**

Crear `frontend/src/app/mostrador/entregar/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { mostradorDeSesion } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { ProductoCobro, StockAsignado } from '@/lib/types';
import { PantallaEntrega } from '@/components/mostrador/pantalla-entrega';

export default async function EntregarPage() {
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');
  if (mostrador.tipo !== 'PRINCIPAL') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl font-semibold">Esto lo hace el mostrador principal.</p>
        <a href="/mostrador" className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white">Volver a vender</a>
      </main>
    );
  }

  const [productos, asignado] = await Promise.all([
    buffetFetch<ProductoCobro[]>('/buffet/productos/activos'),
    buffetFetch<StockAsignado[]>('/buffet/stock-asignado?mostradorId=mostrador-secundario'),
  ]);
  return <PantallaEntrega productos={productos} asignado={asignado} />;
}
```

- [ ] **Step 2: La pantalla**

Crear `frontend/src/components/mostrador/pantalla-entrega.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { entregarStock } from '@/lib/buffet-actions';
import { asignadoPorProducto } from '@/lib/mostrador-stock';
import type { ProductoCobro, StockAsignado } from '@/lib/types';

export function PantallaEntrega({ productos, asignado }: { productos: ProductoCobro[]; asignado: StockAsignado[] }) {
  const router = useRouter();
  const yaTiene = asignadoPorProducto(asignado);
  const [cant, setCant] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const items = Object.entries(cant)
    .map(([productoId, cantidad]) => ({ productoId, cantidad }))
    .filter((i) => i.cantidad > 0);

  function setear(id: string, valor: string, tope: number) {
    const n = Math.max(0, Math.min(tope, Number(valor.replace(/\D/g, '')) || 0));
    setCant((c) => ({ ...c, [id]: n }));
  }

  function entregar() {
    if (items.length === 0) { setError('Cargá al menos un producto'); return; }
    setError(''); setEnviando(true);
    void entregarStock(items).then((r) => {
      setEnviando(false);
      if (r.ok) { setCant({}); router.refresh(); }
      // La entrega es todo o nada: el servicio la hace en una transacción. Si falla, no se
      // movió nada, y decirlo evita que el operador entregue dos veces por las dudas.
      else setError(`${r.error} — no se entregó nada.`);
    });
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Entregar al secundario</h1>
        <a href="/mostrador" className="rounded-lg border px-3 py-1 text-sm font-medium">Volver</a>
      </header>

      {error && <p aria-live="polite" className="text-lg font-semibold text-red-600">{error}</p>}

      <ul className="divide-y rounded-2xl border bg-white">
        {productos.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="font-semibold">{p.nombre}</p>
              <p className="text-sm text-neutral-600">
                Hay {p.stock} · ya tiene {yaTiene[p.id] ?? 0}
              </p>
            </div>
            <input
              inputMode="numeric"
              aria-label={`Cantidad de ${p.nombre}`}
              value={cant[p.id] ?? ''}
              onChange={(e) => setear(p.id, e.target.value, p.stock)}
              placeholder="0"
              className="w-20 rounded-xl border p-2 text-center text-lg"
            />
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={entregar}
        disabled={enviando || items.length === 0}
        className="rounded-2xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:opacity-50"
      >
        {enviando ? 'Entregando…' : `Entregar ${items.length} producto(s)`}
      </button>
    </main>
  );
}
```

El tope del input es `p.stock`: la pantalla no deja pedir más de lo que hay, y el backend igual lo rechaza si llegara.

- [ ] **Step 3: Verificar**

Run (desde `frontend/`): `pnpm build && pnpm lint`
Expected: build limpio; lint sin errores nuevos (siguen los preexistentes de `nueva-reserva-dialog.tsx`, `usuarios-table.tsx` y `use-cliente-autocomplete.ts`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(buffet): pantalla de entrega del principal al secundario"
```

---

### Task 6: El aviso y la pantalla de conteo

**Files:**
- Create: `frontend/src/app/mostrador/conciliar/[cajaId]/page.tsx`
- Create: `frontend/src/components/mostrador/pantalla-conteo.tsx`

**Interfaces:**
- Consumes: `getConciliacion`, `conciliarCaja` (Task 4); `diferencia` (Task 3).

- [ ] **Step 1: La ruta**

**Antes de escribir esto, leé la guía de rutas dinámicas en `node_modules/next/dist/docs/`**: en Next.js 16 los `params` de una página son asíncronos y hay que await-earlos.

Crear `frontend/src/app/mostrador/conciliar/[cajaId]/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { mostradorDeSesion } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { LineaConciliacion } from '@/lib/types';
import { PantallaConteo } from '@/components/mostrador/pantalla-conteo';

export default async function ConciliarPage({ params }: { params: Promise<{ cajaId: string }> }) {
  const { cajaId } = await params;
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');
  if (mostrador.tipo !== 'PRINCIPAL') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl font-semibold">El conteo lo carga el mostrador principal.</p>
        <a href="/mostrador" className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white">Volver a vender</a>
      </main>
    );
  }

  const lineas = await buffetFetch<LineaConciliacion[]>(`/buffet/cajas/${encodeURIComponent(cajaId)}/conciliacion`);
  return <PantallaConteo cajaId={cajaId} lineas={lineas} />;
}
```

- [ ] **Step 2: La pantalla**

Crear `frontend/src/components/mostrador/pantalla-conteo.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { conciliarCaja } from '@/lib/buffet-actions';
import { diferencia } from '@/lib/mostrador-stock';
import type { LineaConciliacion } from '@/lib/types';

type Cerrada = (LineaConciliacion & { contado: number; diferencia: number })[];

export function PantallaConteo({ cajaId, lineas }: { cajaId: string; lineas: LineaConciliacion[] }) {
  const [contado, setContado] = useState<Record<string, number>>({});
  const [resultado, setResultado] = useState<Cerrada | null>(null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  function confirmar() {
    setError(''); setEnviando(true);
    const conteos = lineas.map((l) => ({ productoId: l.productoId, contado: contado[l.productoId] ?? 0 }));
    void conciliarCaja(cajaId, conteos).then((r) => {
      setEnviando(false);
      if (r.ok) setResultado(r.data.lineas);
      else setError(r.error);
    });
  }

  if (resultado) {
    return (
      <main className="flex min-h-screen flex-col gap-4 p-4">
        <h1 className="text-xl font-bold">Cierre conciliado</h1>
        <ul className="divide-y rounded-2xl border bg-white">
          {resultado.map((l) => (
            <li key={l.productoId} className="flex items-center justify-between p-3">
              <span className="font-semibold">{l.nombre}</span>
              <span className={l.diferencia === 0 ? 'text-neutral-600' : 'font-bold text-red-600'}>
                {l.diferencia === 0 ? 'sin diferencia' : `${l.diferencia > 0 ? '+' : ''}${l.diferencia}`}
              </span>
            </li>
          ))}
        </ul>
        <a href="/mostrador" className="rounded-2xl bg-emerald-600 py-4 text-center text-lg font-bold text-white">Listo</a>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-bold">Contar el cierre</h1>
        {/* Es contraintuitivo y hay que decirlo: si faltan unidades, al general vuelven las que
            hay, no las que deberian estar. El faltante queda registrado en el historico. */}
        <p className="text-sm text-neutral-600">
          Contá lo que quedó físicamente. Vuelve al stock general lo que contás, no lo esperado.
        </p>
      </header>

      {error && <p aria-live="polite" className="text-lg font-semibold text-red-600">{error}</p>}

      <ul className="divide-y rounded-2xl border bg-white">
        {lineas.map((l) => {
          const c = contado[l.productoId];
          const dif = c == null ? null : diferencia(l.esperado, c);
          return (
            <li key={l.productoId} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-semibold">{l.nombre}</p>
                <p className="text-sm text-neutral-600">
                  Entregado {l.entregado} · vendido {l.vendido} · deberían quedar <b>{l.esperado}</b>
                </p>
                {dif != null && dif !== 0 && (
                  <p className="text-sm font-semibold text-red-600">
                    {dif > 0 ? `Sobran ${dif}` : `Faltan ${Math.abs(dif)}`}
                  </p>
                )}
              </div>
              <input
                inputMode="numeric"
                aria-label={`Contado de ${l.nombre}`}
                value={contado[l.productoId] ?? ''}
                onChange={(e) => setContado((s) => ({ ...s, [l.productoId]: Number(e.target.value.replace(/\D/g, '')) || 0 }))}
                placeholder="0"
                className="w-20 rounded-xl border p-2 text-center text-lg"
              />
            </li>
          );
        })}
      </ul>

      {lineas.length === 0 && <p className="text-neutral-600">Esta caja no tiene nada para conciliar.</p>}

      <button
        type="button"
        onClick={confirmar}
        disabled={enviando || lineas.length === 0}
        className="rounded-2xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:opacity-50"
      >
        {enviando ? 'Guardando…' : 'Confirmar conteo'}
      </button>
    </main>
  );
}
```

- [ ] **Step 3: Verificar y commitear**

Run (desde `frontend/`): `pnpm build && pnpm lint`

```bash
git add frontend/src
git commit -m "feat(buffet): pantalla de conteo del cierre"
```

---

### Task 7: El POS avisa y el secundario ve sus cantidades

**Files:**
- Modify: `frontend/src/app/mostrador/page.tsx`
- Modify: `frontend/src/components/mostrador/pantalla-venta.tsx`

**Interfaces:**
- Consumes: `ConciliacionPendiente`, `StockAsignado` (Task 3); el endpoint de pendientes (Task 2); `asignadoPorProducto` (Task 3).

- [ ] **Step 1: La página trae lo nuevo**

Reemplazar `frontend/src/app/mostrador/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { mostradorDeSesion } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { CajaBuffetEstado, ProductoCobro, ConciliacionPendiente, StockAsignado } from '@/lib/types';
import { PantallaVenta } from '@/components/mostrador/pantalla-venta';

export default async function MostradorPage() {
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');
  const esPrincipal = mostrador.tipo === 'PRINCIPAL';

  const [caja, productos, pendientes, asignado] = await Promise.all([
    buffetFetch<CajaBuffetEstado | null>('/buffet/caja/actual'),
    buffetFetch<ProductoCobro[]>('/buffet/productos/activos'),
    // Cada puesto pide solo lo que le corresponde: pedir lo del otro da 403.
    esPrincipal ? buffetFetch<ConciliacionPendiente[]>('/buffet/conciliaciones/pendientes') : Promise.resolve([]),
    esPrincipal ? Promise.resolve([] as StockAsignado[]) : buffetFetch<StockAsignado[]>('/buffet/stock-asignado'),
  ]);

  return (
    <PantallaVenta
      inicial={caja}
      productos={productos}
      mostrador={mostrador}
      pendientes={pendientes}
      asignado={asignado}
    />
  );
}
```

- [ ] **Step 2: La pantalla de venta**

En `frontend/src/components/mostrador/pantalla-venta.tsx`:

Ampliar la firma:

```tsx
export function PantallaVenta({ inicial, productos, mostrador, pendientes, asignado }: {
  inicial: CajaBuffetEstado | null;
  productos: ProductoCobro[];
  mostrador: { nombre: string; tipo: 'PRINCIPAL' | 'SECUNDARIO' };
  pendientes: ConciliacionPendiente[];
  asignado: StockAsignado[];
}) {
```

Agregar a los imports:

```tsx
import type { ConciliacionPendiente, StockAsignado } from '@/lib/types';
import { asignadoPorProducto } from '@/lib/mostrador-stock';
```

Dentro del componente, junto a los demás cálculos:

```tsx
  const esSecundario = mostrador.tipo === 'SECUNDARIO';
  const yaTiene = asignadoPorProducto(asignado);
```

Justo **debajo** de la barra de identidad del mostrador, el aviso y el acceso a entregar:

```tsx
      {mostrador.tipo === 'PRINCIPAL' && (
        <div className="flex flex-wrap items-center gap-2">
          <a href="/mostrador/entregar" className="rounded-xl border border-emerald-600 px-4 py-2 font-semibold text-emerald-700">
            Entregar al secundario
          </a>
          {/* El conteo es presencial: el secundario cierra, trae lo que sobro y se cuenta ahi
              mismo. Por eso el aviso va arriba de todo y no escondido en un menu. */}
          {pendientes.map((p) => (
            <a
              key={p.cajaId}
              href={`/mostrador/conciliar/${p.cajaId}`}
              className="rounded-xl bg-amber-500 px-4 py-2 font-bold text-white"
            >
              Contar el cierre de {p.mostradorNombre}
            </a>
          ))}
        </div>
      )}
```

En la botonera de productos (alrededor de la línea 174, el bloque `filtrarProductos(productos, query).map(...)`), reemplazar el `map` y el mensaje de "Sin resultados" por:

```tsx
          {filtrarProductos(productos, query).map((p) => {
            const tiene = yaTiene[p.id] ?? 0;
            const sinAsignado = esSecundario && tiene === 0;
            return (
              <button key={p.id} type="button" disabled={ocupado || sinAsignado} onMouseDown={(e) => e.preventDefault()}
                onClick={() => agregar(p)}
                className="flex w-full items-center justify-between border-b p-3 text-left text-lg active:bg-neutral-100 disabled:opacity-40">
                <span>
                  {p.nombre}
                  {/* Sin esto, tocar un producto que no le entregaron termina en un error del
                      backend con el cliente adelante. */}
                  {esSecundario && <span className="block text-xs text-neutral-500">Tenés {tiene}</span>}
                </span>
                <span className="tabular-nums text-neutral-500">{money(p.precio)}</span>
              </button>
            );
          })}
          {filtrarProductos(productos, query).length === 0 && (
            <p className="p-4 text-center text-neutral-500">Sin resultados</p>
          )}
          {esSecundario && asignado.length === 0 && (
            <p className="p-4 text-center text-amber-700">
              No tenés stock asignado. Pedile al mostrador principal que te entregue.
            </p>
          )}
```

- [ ] **Step 3: Verificar**

Run (desde `frontend/`): `npx vitest run && pnpm build && pnpm lint`
Expected: los tests de `pantalla-venta.test.ts` (helpers puros) siguen pasando, build limpio, sin lint nuevo.

**Ojo:** `validators.test.ts` tiene 2 casos rojos preexistentes sobre `jugadores=6`, anteriores a esta rama. No los arregles ni los cuentes como tuyos.

- [ ] **Step 4: Verificación manual**

`frontend/` no testea render. Con el backend corriendo (`npm run dev`) y el panel (`pnpm dev`), recorré y anotá el resultado de cada caso:

| Caso | Qué tiene que pasar |
|---|---|
| Entrar como principal | Se ve "Entregar al secundario"; sin cierres pendientes, sin aviso ámbar |
| Entregar 10 de un producto | La pantalla vuelve y la fila muestra "ya tiene 10" |
| Entregar más de lo que hay | El input no deja pasar del stock general |
| Entrar como secundario | Cada producto muestra "Tenés N"; los que están en cero no se pueden tocar |
| Vender desde el secundario | Descuenta de lo asignado y el número baja |
| El secundario cierra su caja | En el principal aparece el aviso ámbar con su nombre |
| Contar con faltante | Al confirmar, la línea muestra "Faltan N" |
| Volver a entrar a esa conciliación | El backend responde que ya fue conciliada y la pantalla lo dice |
| Entrar como secundario a `/mostrador/entregar` | Mensaje de que lo hace el principal, sin formulario |
| Secundario sin nada asignado | La botonera queda toda deshabilitada y aparece el mensaje de pedirle al principal |

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(buffet): aviso de cierre pendiente y cantidades asignadas en la venta"
```

---

## Notas para el deploy

- **Sin migraciones ni variables de entorno nuevas.** Todo el cambio de backend es aditivo sobre endpoints existentes más una ruta nueva.
- **Desplegar el backend antes que el panel.** El POS nuevo llama a `/buffet/conciliaciones/pendientes`; contra un backend viejo eso da 404 y la pantalla de venta no carga. Al revés no hay problema: el backend nuevo es compatible con el POS viejo.
- Recordá que el workflow de `backend/.github/workflows/deploy.yml` **no se ejecuta** — está fuera de la raíz del repo, así que el deploy del backend sigue siendo manual por SSH.

## ⚠️ Verificación pendiente antes de mergear

Las pantallas **no tienen tests de render y no los van a tener** (decisión del proyecto), y la
verificación manual **nunca se corrió**: no hubo entorno levantado. La única red fue la lectura de
los revisores, que encontró varios defectos reales — incluido uno que el propio fix introdujo.
Esto hay que probarlo con dos dispositivos:

1. **El escenario de las 3 unidades**, que es el que expone si el refresco funciona: el principal
   entrega 3 → el secundario vende las 3 → **el botón tiene que deshabilitarse solo**, sin
   recargar, y aparecer el aviso de "pedile al principal".
2. **El aviso del cierre**: el secundario cierra su caja → en la pantalla del principal tiene que
   aparecer el banner ámbar **solo**, dentro de ~30 segundos (lo trae el polling).
3. **El conteo con faltante**: contar menos de lo esperado y verificar en la base que
   `ProductoBuffet.stock` sube por **lo contado** y que `StockMostrador` queda en 0. Es la
   decisión de fondo del diseño y la única que no se puede deshacer.
4. **Desactivar un puesto con el dispositivo abierto**: tiene que mandar al PIN con un mensaje de
   sesión revocada, no al error genérico ni a un loop. Es la palanca de revocación: conviene
   saber cómo se comporta antes de necesitarla.
5. **Volver a entrar a una conciliación ya hecha**: tiene que decir "Esta caja ya fue conciliada".

## Notas para el deploy (agregado tras la implementación)

- **Todos los dispositivos tienen que volver a poner el PIN una vez**: el formato viejo de cookie
  se rechaza a propósito, y hay un test que lo fija. Ojo con `loginLimiter` ese día — son 10
  intentos cada 15 minutos **por IP**, y como las llamadas salen del server de Next, todos los
  dispositivos comparten un bucket. Si hay que re-PINear varias tablets, espacialo.
- **Cargar el PIN del secundario** desde el panel antes de usarlo: nace con `pinHash = ''` y con
  eso no entra nadie. El panel ahora lo dice explícitamente. El principal hereda el PIN viejo.

## Lo que queda afuera

- **El secundario todavía puede pasarse de su cantidad asignada.** El guard es "tiene 0", no
  "tiene menos de lo que estás cargando al carrito", así que con 3 asignadas se pueden sumar 4 y
  el error aparece recién al cobrar — tirando abajo la venta entera, porque el cobro es una
  transacción. Es un hueco del **spec**, que solo pidió el caso cero.
- **`resumenDe` replica un solo guard de los tres que tiene `conciliar`**: rechaza la caja ya
  conciliada, pero no la del principal ni la abierta. Entrando por URL a la conciliación de una
  caja del principal se ven cifras negativas inventadas. Solo se llega tipeando la URL.
- **`PATCH /buffet/mostradores/:id` no audita.** Es la acción que da y quita acceso al POS.
- **`apiFetch` del panel sigue lanzando `ApiAuthError` antes de leer el body**, así que pierde el
  mensaje del backend — lo que se arregló en `buffetFetch` quedó inconsistente con su vecino.
- **Anular o corregir una entrega.** `entregar()` no es idempotente ni reversible: un doble tap mueve el stock dos veces. Resolverlo bien implica decidir entre anular la entrega o hacer una compensatoria.
- **El histórico de conciliaciones y de entregas**, y las vistas del panel: es la pieza C.
- **Etiquetar `GET /buffet/cajas` por mostrador**: también pieza C.

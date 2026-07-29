# Mostrador con cobro (caja POS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el mostrador en una caja POS: escanear/agregar al carrito, Cobrar, ver total, ingresar con cuánto pagó y ver el vuelto, registrando el medio de pago (efectivo/transferencia); el cierre separa efectivo vs transferencia.

**Architecture:** Se introduce `TicketBuffet` (la venta) con líneas `VentaBuffet` (con `cantidad`). El carrito vive en el navegador; al Cobrar, `POST /buffet/cobrar` recalcula el total en el server, crea el ticket + líneas y descuenta stock en una transacción (idempotente por `uid`). El escaneo resuelve el producto vía `GET /buffet/producto?codigoBarra=`. Se elimina el registro instantáneo (`/venta`, `/venta/ultima`).

**Tech Stack:** Node 22, Express, Prisma 7 + Postgres, Zod, vitest + supertest + testcontainers (backend); Next.js 16 + React 19 (frontend).

## Global Constraints

- Carrito en el navegador; la venta se persiste y el stock se descuenta recién al Cobrar.
- EFECTIVO: pide `montoPagado`, `vuelto = montoPagado - total`, y `montoPagado ≥ total` (si no, error). TRANSFERENCIA: `montoPagado = total`, `vuelto = 0`.
- El total se recalcula en el server con el precio actual de cada producto (no confía en el cliente).
- Idempotencia del cobro por `uid` (unique en `TicketBuffet`).
- El stock puede quedar negativo (no se bloquea la venta).
- Cierre y `caja/actual` separan `totalEfectivo` y `totalTransferencia`.
- Se elimina el registro instantáneo por escaneo (`POST /buffet/venta`, `DELETE /buffet/venta/ultima`).
- Nombres: `TicketBuffet` = venta; `VentaBuffet` = línea del ticket.
- Endpoints del mostrador usan `authBuffet` (header `x-buffet-key`). Tests: `BUFFET_API_KEY` se setea en cada archivo de test.
- La migración asume tablas de buffet vacías en la demo (el seed no crea ventas). No tocar `ortigoza/`.

---

## Task 1: Backend — modelo ticket, cobro, cierre por medio de pago

**Files:**
- Modify: `backend/prisma/schema.prisma` (+ migración `<ts>_ticket_buffet`)
- Modify: `backend/src/services/buffetCaja.service.ts`
- Modify: `backend/src/services/buffetProducto.service.ts`
- Modify: `backend/src/validators/buffet.schema.ts`
- Modify: `backend/src/routes/buffet.routes.ts`
- Modify: `backend/tests/helpers/db.ts` (resetTables)
- Replace: `backend/tests/integration/buffet-venta.test.ts` → `backend/tests/integration/buffet-cobro.test.ts`
- Modify: `backend/tests/integration/buffet-cierre.test.ts`

**Interfaces:**
- Produces (consumidos por el frontend en Tasks 2-3):
  - `buffetCajaService.cobrar(input: { uid: string; medioPago: 'EFECTIVO'|'TRANSFERENCIA'; montoPagado: number; items: { productoId: string; cantidad: number }[] }) → Promise<{ ticketId: string; total: number; vuelto: number; medioPago: string; caja: CajaEstado }>`
  - `CajaEstado = { id; abiertaEn; totalUnidades; totalMonto; totalEfectivo; totalTransferencia; ultimosTickets: TicketDTO[] }`
  - `TicketDTO = { id; total; medioPago; vuelto; creadoEn; lineas: { productoId; nombre; cantidad; precioUnit }[] }`
  - `CierreDTO` gana `totalEfectivo`, `totalTransferencia`.
  - `buffetProductoService.porCodigo(codigoBarra: string) → Promise<{ id; nombre; precio: number } | null>`
  - Ruta `POST /buffet/cobrar`, `GET /buffet/producto?codigoBarra=`.

- [ ] **Step 1: Reestructurar el schema**

En `backend/prisma/schema.prisma`, reemplazar el bloque de `CajaBuffet` y `VentaBuffet` por:
```prisma
model CajaBuffet {
  id            String           @id @default(cuid())
  abiertaEn     DateTime         @default(now())
  cerradaEn     DateTime?
  estado        EstadoCajaBuffet @default(ABIERTA)
  totalUnidades Int?
  totalMonto    Decimal?         @db.Decimal(10, 2)
  tickets       TicketBuffet[]
}

model TicketBuffet {
  id          String        @id @default(cuid())
  uid         String        @unique
  cajaId      String
  caja        CajaBuffet    @relation(fields: [cajaId], references: [id])
  total       Decimal       @db.Decimal(10, 2)
  medioPago   MedioPago
  montoPagado Decimal       @db.Decimal(10, 2)
  vuelto      Decimal       @db.Decimal(10, 2)
  creadoEn    DateTime      @default(now())
  lineas      VentaBuffet[]

  @@index([cajaId])
}

model VentaBuffet {
  id         String         @id @default(cuid())
  ticketId   String
  ticket     TicketBuffet   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  productoId String
  producto   ProductoBuffet @relation(fields: [productoId], references: [id])
  precioUnit Decimal        @db.Decimal(10, 2)
  cantidad   Int            @default(1)
  creadoEn   DateTime       @default(now())

  @@index([ticketId])
}
```
(No cambia `ProductoBuffet` ni el enum `MedioPago`/`EstadoCajaBuffet`.)

- [ ] **Step 2: Generar la migración**

```bash
docker run -d --name pos-pg -e POSTGRES_USER=canchitas -e POSTGRES_PASSWORD=canchitas -e POSTGRES_DB=canchitas -p 5603:5432 postgres:16-alpine
cd backend && DATABASE_URL=postgresql://canchitas:canchitas@localhost:5603/canchitas?schema=public npx prisma migrate dev --name ticket_buffet && DATABASE_URL=postgresql://canchitas:canchitas@localhost:5603/canchitas?schema=public npx prisma generate
```
Expected: crea la migración (drop de `uid`/`cajaId` en `VentaBuffet`, add `ticketId`/`cantidad`, create `TicketBuffet`). Asume las tablas vacías. Dejá `pos-pg` hasta terminar la Task 1; luego `docker rm -f pos-pg`.

- [ ] **Step 3: `porCodigo` en buffetProducto.service**

En `backend/src/services/buffetProducto.service.ts`, agregar al objeto exportado:
```ts
  porCodigo: async (codigoBarra: string) => {
    const p = await prisma.productoBuffet.findFirst({ where: { codigoBarra, activo: true } });
    return p ? { id: p.id, nombre: p.nombre, precio: Number(p.precio) } : null;
  },
```
(Si `prisma` no está importado en ese archivo, agregá `import { prisma } from '../db/prisma.js';`.)

- [ ] **Step 4: Reescribir buffetCaja.service**

Reemplazar el contenido de `backend/src/services/buffetCaja.service.ts` por:
```ts
import { prisma } from '../db/prisma.js';
import { Conflict, NotFound, BusinessRule } from '../utils/errors.js';

type Medio = 'EFECTIVO' | 'TRANSFERENCIA';
export interface TicketLineaDTO { productoId: string; nombre: string; cantidad: number; precioUnit: number }
export interface TicketDTO { id: string; total: number; medioPago: Medio; vuelto: number; creadoEn: string; lineas: TicketLineaDTO[] }
export interface CajaEstado {
  id: string; abiertaEn: string;
  totalUnidades: number; totalMonto: number;
  totalEfectivo: number; totalTransferencia: number;
  ultimosTickets: TicketDTO[];
}
export interface LineaCierre { productoId: string; nombre: string; unidades: number; monto: number }
export interface CierreDTO {
  id: string; abiertaEn: string; cerradaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  porProducto: LineaCierre[];
}
export interface CobrarInput { uid: string; medioPago: Medio; montoPagado: number; items: { productoId: string; cantidad: number }[] }
export interface CobroResultado { ticketId: string; total: number; vuelto: number; medioPago: Medio; caja: CajaEstado }

const ticketConLineas = { lineas: { include: { producto: { select: { nombre: true } } } } } as const;

async function estadoDe(cajaId: string): Promise<CajaEstado> {
  const caja = await prisma.cajaBuffet.findUniqueOrThrow({ where: { id: cajaId } });
  const tickets = await prisma.ticketBuffet.findMany({ where: { cajaId }, include: ticketConLineas, orderBy: { creadoEn: 'desc' } });
  let totalMonto = 0, totalUnidades = 0, totalEfectivo = 0, totalTransferencia = 0;
  for (const t of tickets) {
    totalMonto += Number(t.total);
    for (const l of t.lineas) totalUnidades += l.cantidad;
    if (t.medioPago === 'EFECTIVO') totalEfectivo += Number(t.total); else totalTransferencia += Number(t.total);
  }
  return {
    id: caja.id, abiertaEn: caja.abiertaEn.toISOString(),
    totalUnidades, totalMonto, totalEfectivo, totalTransferencia,
    ultimosTickets: tickets.slice(0, 10).map((t) => ({
      id: t.id, total: Number(t.total), medioPago: t.medioPago as Medio, vuelto: Number(t.vuelto), creadoEn: t.creadoEn.toISOString(),
      lineas: t.lineas.map((l) => ({ productoId: l.productoId, nombre: l.producto.nombre, cantidad: l.cantidad, precioUnit: Number(l.precioUnit) })),
    })),
  };
}

async function cajaAbierta() {
  return prisma.cajaBuffet.findFirst({ where: { estado: 'ABIERTA' } });
}

async function detalleCierre(cajaId: string): Promise<CierreDTO | null> {
  const caja = await prisma.cajaBuffet.findUnique({ where: { id: cajaId } });
  if (!caja || !caja.cerradaEn) return null;
  const tickets = await prisma.ticketBuffet.findMany({ where: { cajaId }, include: ticketConLineas });
  const mapa = new Map<string, LineaCierre>();
  let totalUnidades = 0, totalMonto = 0, totalEfectivo = 0, totalTransferencia = 0;
  for (const t of tickets) {
    totalMonto += Number(t.total);
    if (t.medioPago === 'EFECTIVO') totalEfectivo += Number(t.total); else totalTransferencia += Number(t.total);
    for (const l of t.lineas) {
      totalUnidades += l.cantidad;
      const cur = mapa.get(l.productoId) ?? { productoId: l.productoId, nombre: l.producto.nombre, unidades: 0, monto: 0 };
      cur.unidades += l.cantidad;
      cur.monto += Number(l.precioUnit) * l.cantidad;
      mapa.set(l.productoId, cur);
    }
  }
  return {
    id: caja.id, abiertaEn: caja.abiertaEn.toISOString(), cerradaEn: caja.cerradaEn.toISOString(),
    totalUnidades, totalMonto, totalEfectivo, totalTransferencia,
    porProducto: [...mapa.values()].sort((a, b) => b.monto - a.monto),
  };
}

export const buffetCajaService = {
  async abrir(): Promise<CajaEstado> {
    const ya = await cajaAbierta();
    if (ya) return estadoDe(ya.id);
    try {
      const creada = await prisma.cajaBuffet.create({ data: {} });
      return estadoDe(creada.id);
    } catch (e: any) {
      if (e?.code === 'P2002') { const ex = await cajaAbierta(); if (ex) return estadoDe(ex.id); }
      throw e;
    }
  },

  async actual(): Promise<CajaEstado | null> {
    const c = await cajaAbierta();
    return c ? estadoDe(c.id) : null;
  },

  async cobrar(input: CobrarInput): Promise<CobroResultado> {
    const previo = await prisma.ticketBuffet.findUnique({ where: { uid: input.uid } });
    if (previo) return { ticketId: previo.id, total: Number(previo.total), vuelto: Number(previo.vuelto), medioPago: previo.medioPago as Medio, caja: await estadoDe(previo.cajaId) };

    const caja = await cajaAbierta();
    if (!caja) throw Conflict('No hay una caja abierta');
    if (!input.items.length) throw BusinessRule('El carrito está vacío');

    const ids = input.items.map((i) => i.productoId);
    const productos = await prisma.productoBuffet.findMany({ where: { id: { in: ids }, activo: true } });
    const byId = new Map(productos.map((p) => [p.id, p]));
    for (const it of input.items) {
      if (!byId.has(it.productoId)) throw NotFound('ProductoBuffet', it.productoId);
      if (it.cantidad < 1) throw BusinessRule('Cantidad inválida');
    }
    const total = input.items.reduce((a, it) => a + Number(byId.get(it.productoId)!.precio) * it.cantidad, 0);

    let montoPagado: number; let vuelto: number;
    if (input.medioPago === 'EFECTIVO') {
      if (input.montoPagado < total) throw BusinessRule('El monto pagado es menor al total');
      montoPagado = input.montoPagado; vuelto = montoPagado - total;
    } else { montoPagado = total; vuelto = 0; }

    let ticketId = '';
    try {
      await prisma.$transaction(async (tx) => {
        const ticket = await tx.ticketBuffet.create({ data: { uid: input.uid, cajaId: caja.id, total, medioPago: input.medioPago, montoPagado, vuelto } });
        ticketId = ticket.id;
        for (const it of input.items) {
          const p = byId.get(it.productoId)!;
          await tx.ventaBuffet.create({ data: { ticketId: ticket.id, productoId: p.id, precioUnit: p.precio, cantidad: it.cantidad } });
          await tx.productoBuffet.update({ where: { id: p.id }, data: { stock: { decrement: it.cantidad } } });
        }
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const ya = await prisma.ticketBuffet.findUnique({ where: { uid: input.uid } });
        if (ya) return { ticketId: ya.id, total: Number(ya.total), vuelto: Number(ya.vuelto), medioPago: ya.medioPago as Medio, caja: await estadoDe(ya.cajaId) };
      }
      throw e;
    }
    return { ticketId, total, vuelto, medioPago: input.medioPago, caja: await estadoDe(caja.id) };
  },

  async cerrar(): Promise<CierreDTO> {
    const caja = await cajaAbierta();
    if (!caja) throw Conflict('No hay una caja abierta');
    const est = await estadoDe(caja.id);
    await prisma.cajaBuffet.update({
      where: { id: caja.id },
      data: { estado: 'CERRADA', cerradaEn: new Date(), totalUnidades: est.totalUnidades, totalMonto: est.totalMonto },
    });
    return (await detalleCierre(caja.id))!;
  },

  async listCierres(): Promise<CierreDTO[]> {
    const cajas = await prisma.cajaBuffet.findMany({ where: { estado: 'CERRADA' }, orderBy: { cerradaEn: 'desc' } });
    const out: CierreDTO[] = [];
    for (const c of cajas) { const d = await detalleCierre(c.id); if (d) out.push(d); }
    return out;
  },
};
```

- [ ] **Step 5: Validadores — quitar `ventaSchema`, agregar `cobrarSchema`**

En `backend/src/validators/buffet.schema.ts`, borrar el `export const ventaSchema = ...` y agregar:
```ts
export const cobrarSchema = z.object({
  body: z.object({
    uid: z.string().min(1),
    medioPago: z.enum(['EFECTIVO', 'TRANSFERENCIA']),
    montoPagado: z.coerce.number().nonnegative(),
    items: z.array(z.object({ productoId: z.string().min(1), cantidad: z.coerce.number().int().positive() })).min(1),
  }),
  query: empty, params: empty,
});

export const porCodigoSchema = z.object({
  body: z.unknown(),
  query: z.object({ codigoBarra: z.string().min(1) }),
  params: empty,
});
```

- [ ] **Step 6: Rutas — quitar `/venta*`, agregar `/cobrar` y `/producto`**

En `backend/src/routes/buffet.routes.ts`:
- En el import de validators, quitar `ventaSchema` y agregar `cobrarSchema, porCodigoSchema`.
- Borrar los bloques `buffetRoutes.post('/venta', ...)` y `buffetRoutes.delete('/venta/ultima', ...)`.
- Agregar (en la sección Mostrador, después de `caja/actual`):
```ts
buffetRoutes.get('/producto', authBuffet, validate(porCodigoSchema), async (req, res, next) => {
  try {
    const p = await buffetProductoService.porCodigo((req as any).valid.query.codigoBarra);
    if (!p) return next(NotFound('ProductoBuffet', (req as any).valid.query.codigoBarra));
    res.json(p);
  } catch (e) { next(e); }
});

buffetRoutes.post('/cobrar', authBuffet, validate(cobrarSchema), async (req, res, next) => {
  try { res.json(await buffetCajaService.cobrar((req as any).valid.body)); } catch (e) { next(e); }
});
```
- Agregar el import de `NotFound`: `import { NotFound } from '../utils/errors.js';` (arriba, junto a los demás imports).

- [ ] **Step 7: `resetTables` — incluir `ticketBuffet`**

En `backend/tests/helpers/db.ts`, dentro del `$transaction` de `resetTables`, reemplazar la línea `p.ventaBuffet.deleteMany(),` por estas dos (líneas → tickets → caja):
```ts
    p.ventaBuffet.deleteMany(),
    p.ticketBuffet.deleteMany(),
```
(Dejar `p.cajaBuffet.deleteMany(),` a continuación, como está.)

- [ ] **Step 8: Reescribir los tests de venta → cobro (fallan primero)**

Borrar `backend/tests/integration/buffet-venta.test.ts` y crear `backend/tests/integration/buffet-cobro.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any;
beforeAll(async () => { process.env.BUFFET_API_KEY = KEY; await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);
const mostrador = (r: any) => r.set('x-buffet-key', KEY);

async function sembrar() {
  const p = getPrisma();
  const coca = await p.productoBuffet.create({ data: { nombre: 'Coca 500', codigoBarra: '779089', precio: '1500', stock: 10 } });
  const pancho = await p.productoBuffet.create({ data: { nombre: 'Pancho', precio: '2500', stock: 5, enBotonera: true } });
  return { coca, pancho };
}

describe('buffet: cobrar', () => {
  it('sin caja abierta devuelve 409', async () => {
    const { coca } = await sembrar();
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'EFECTIVO', montoPagado: 2000, items: [{ productoId: coca.id, cantidad: 1 }] });
    expect(r.status).toBe(409);
  });

  it('efectivo: calcula total y vuelto, descuenta stock por cantidad', async () => {
    const { coca } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'EFECTIVO', montoPagado: 5000, items: [{ productoId: coca.id, cantidad: 2 }] });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3000);
    expect(r.body.vuelto).toBe(2000);
    expect(r.body.caja.totalEfectivo).toBe(3000);
    const p = await getPrisma().productoBuffet.findUnique({ where: { id: coca.id } });
    expect(p!.stock).toBe(8);
  });

  it('efectivo con monto menor al total falla y no registra', async () => {
    const { coca } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'EFECTIVO', montoPagado: 1000, items: [{ productoId: coca.id, cantidad: 1 }] });
    expect(r.status).toBe(422);
    expect(await getPrisma().ticketBuffet.count()).toBe(0);
  });

  it('transferencia: montoPagado = total, vuelto 0', async () => {
    const { pancho } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'TRANSFERENCIA', montoPagado: 0, items: [{ productoId: pancho.id, cantidad: 1 }] });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2500);
    expect(r.body.vuelto).toBe(0);
    expect(r.body.caja.totalTransferencia).toBe(2500);
  });

  it('el mismo uid dos veces NO duplica ni re-descuenta', async () => {
    const { coca } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const body = { uid: 'mismo', medioPago: 'EFECTIVO', montoPagado: 1500, items: [{ productoId: coca.id, cantidad: 1 }] };
    await mostrador(supertest(app).post('/buffet/cobrar')).send(body);
    const r2 = await mostrador(supertest(app).post('/buffet/cobrar')).send(body);
    expect(r2.status).toBe(200);
    expect(await getPrisma().ticketBuffet.count()).toBe(1);
    const p = await getPrisma().productoBuffet.findUnique({ where: { id: coca.id } });
    expect(p!.stock).toBe(9);
  });

  it('producto inexistente en items da 404 y no registra', async () => {
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    const r = await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 'u1', medioPago: 'TRANSFERENCIA', montoPagado: 0, items: [{ productoId: 'no-existe', cantidad: 1 }] });
    expect(r.status).toBe(404);
    expect(await getPrisma().ticketBuffet.count()).toBe(0);
  });

  it('GET /buffet/producto resuelve por código de barra', async () => {
    const { coca } = await sembrar();
    const r = await mostrador(supertest(app).get('/buffet/producto?codigoBarra=779089'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: coca.id, nombre: 'Coca 500', precio: 1500 });
    const no = await mostrador(supertest(app).get('/buffet/producto?codigoBarra=zzz'));
    expect(no.status).toBe(404);
  });
});
```

> Nota: el código de error de `BusinessRule` mapea a HTTP 422 (verificalo en `utils/errors.ts`;
> si `BusinessRule` usa otro status, ajustá los `expect(...).toBe(422)` al status real).

- [ ] **Step 9: Actualizar `buffet-cierre.test.ts`**

Reemplazar el contenido de `backend/tests/integration/buffet-cierre.test.ts` por (quita los tests de deshacer; agrega el desglose por medio):
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let token: string;
beforeAll(async () => { process.env.BUFFET_API_KEY = KEY; await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(resetTables);
const mostrador = (r: any) => r.set('x-buffet-key', KEY);

async function sembrar() {
  const p = getPrisma();
  const coca = await p.productoBuffet.create({ data: { nombre: 'Coca', codigoBarra: '111', precio: '1500', stock: 10 } });
  const pancho = await p.productoBuffet.create({ data: { nombre: 'Pancho', precio: '2500', stock: 5, enBotonera: true } });
  return { coca, pancho };
}

describe('buffet: cerrar y cierres', () => {
  it('cerrar separa efectivo y transferencia y agrega por producto', async () => {
    const { coca, pancho } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 't1', medioPago: 'EFECTIVO', montoPagado: 3000, items: [{ productoId: coca.id, cantidad: 2 }] });
    await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 't2', medioPago: 'TRANSFERENCIA', montoPagado: 0, items: [{ productoId: pancho.id, cantidad: 1 }] });

    const cierre = await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    expect(cierre.status).toBe(200);
    expect(cierre.body.totalMonto).toBe(5500);
    expect(cierre.body.totalEfectivo).toBe(3000);
    expect(cierre.body.totalTransferencia).toBe(2500);
    expect(cierre.body.totalUnidades).toBe(3);
    const cocaLinea = cierre.body.porProducto.find((l: any) => l.nombre === 'Coca');
    expect(cocaLinea.unidades).toBe(2);
    expect(cocaLinea.monto).toBe(3000);
  });

  it('cerrar sin caja abierta devuelve 409', async () => {
    const r = await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    expect(r.status).toBe(409);
  });

  it('admin ve los cierres con el desglose por medio', async () => {
    const { coca } = await sembrar();
    await mostrador(supertest(app).post('/buffet/caja/abrir'));
    await mostrador(supertest(app).post('/buffet/cobrar')).send({ uid: 't1', medioPago: 'EFECTIVO', montoPagado: 1500, items: [{ productoId: coca.id, cantidad: 1 }] });
    await mostrador(supertest(app).post('/buffet/caja/cerrar'));
    const r = await supertest(app).get('/buffet/cajas').set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body[0].totalEfectivo).toBe(1500);
    expect(r.body[0].totalTransferencia).toBe(0);
  });
});
```

- [ ] **Step 10: Correr los tests del buffet**

```bash
cd backend && npm test -- buffet
```
Expected: pasan `buffet-cobro`, `buffet-cierre`, `buffet-auth`, `buffet-pin`, `buffet-productos`. Luego `docker rm -f pos-pg`.

- [ ] **Step 11: Commit**

```bash
git add backend/prisma backend/src/services/buffetCaja.service.ts backend/src/services/buffetProducto.service.ts backend/src/validators/buffet.schema.ts backend/src/routes/buffet.routes.ts backend/tests/helpers/db.ts backend/tests/integration/buffet-cobro.test.ts backend/tests/integration/buffet-cierre.test.ts
git rm backend/tests/integration/buffet-venta.test.ts 2>/dev/null || true
git commit -m "feat(buffet): cobro con ticket (POS), medio de pago y cierre por efectivo/transferencia"
```

---

## Task 2: Frontend — mostrador con carrito y cobro

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/buffet-actions.ts`
- Modify: `frontend/src/components/mostrador/pantalla-venta.tsx`
- Modify: `frontend/src/components/mostrador/pantalla-venta.test.tsx`

**Interfaces:**
- Consumes: `POST /buffet/cobrar`, `GET /buffet/producto?codigoBarra=` (Task 1); `abrirCaja`, `cerrarCaja` (ya existen).
- Produces: mostrador con carrito + pantalla de cobro.

- [ ] **Step 1: Tipos**

En `frontend/src/lib/types.ts`, reemplazar `VentaBuffet`, `CajaBuffetEstado` y `CierreBuffet` por:
```ts
export interface TicketLineaBuffet { productoId: string; nombre: string; cantidad: number; precioUnit: number }
export interface TicketBuffet { id: string; total: number; medioPago: MedioPago; vuelto: number; creadoEn: string; lineas: TicketLineaBuffet[] }
export interface CajaBuffetEstado {
  id: string; abiertaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  ultimosTickets: TicketBuffet[];
}
export interface LineaCierreBuffet { productoId: string; nombre: string; unidades: number; monto: number }
export interface CierreBuffet {
  id: string; abiertaEn: string; cerradaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  porProducto: LineaCierreBuffet[];
}
export interface ProductoCobro { id: string; nombre: string; precio: number }
export interface CobroResultado { ticketId: string; total: number; vuelto: number; medioPago: MedioPago; caja: CajaBuffetEstado }
```

- [ ] **Step 2: Server actions — quitar vender/deshacer, agregar cobrar/buscar**

En `frontend/src/lib/buffet-actions.ts`:
- En el import de tipos, sumar `MedioPago, CobroResultado, ProductoCobro` (junto a `CajaBuffetEstado, CierreBuffet`).
- Borrar `vender` y `deshacerUltima`.
- Agregar:
```ts
export async function buscarPorCodigo(codigoBarra: string): Promise<Resultado<ProductoCobro>> {
  return conSesion(() => buffetFetch<ProductoCobro>(`/buffet/producto?codigoBarra=${encodeURIComponent(codigoBarra)}`));
}

export async function cobrar(input: { uid: string; medioPago: MedioPago; montoPagado: number; items: { productoId: string; cantidad: number }[] }): Promise<Resultado<CobroResultado>> {
  return conSesion(() => buffetFetch<CobroResultado>('/buffet/cobrar', { method: 'POST', body: JSON.stringify(input) }));
}
```

- [ ] **Step 3: Reescribir la pantalla del mostrador**

Reemplazar el contenido de `frontend/src/components/mostrador/pantalla-venta.tsx` por:
```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import type { CajaBuffetEstado, ProductoBuffet, MedioPago } from '@/lib/types';
import { abrirCaja, cerrarCaja, cobrar, buscarPorCodigo } from '@/lib/buffet-actions';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Acumulador del lector: es un teclado que "tipea" el código y cierra con Enter. */
export function parseEscaneo(buffer: string, key: string): { buffer: string; codigo: string | null } {
  if (key === 'Enter') return buffer ? { buffer: '', codigo: buffer } : { buffer: '', codigo: null };
  if (key.length !== 1) return { buffer, codigo: null };
  return { buffer: buffer + key, codigo: null };
}

/** Vuelto: nunca negativo. */
export function calcularVuelto(pagado: number, total: number): number {
  return Math.max(0, Number(pagado || 0) - total);
}

interface Item { productoId: string; nombre: string; precio: number; cantidad: number }

export function PantallaVenta({ inicial, botonera }: { inicial: CajaBuffetEstado | null; botonera: ProductoBuffet[] }) {
  const [caja, setCaja] = useState(inicial);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [pagoTxt, setPagoTxt] = useState('');
  const buffer = useRef('');
  const foco = useRef<HTMLInputElement>(null);

  const total = items.reduce((a, it) => a + it.precio * it.cantidad, 0);
  const vuelto = calcularVuelto(Number(pagoTxt), total);

  useEffect(() => {
    if (cobrando) return; // durante el cobro el foco va al input de pago
    const recuperar = () => foco.current?.focus();
    recuperar();
    const id = setInterval(recuperar, 1000);
    document.addEventListener('click', recuperar);
    return () => { clearInterval(id); document.removeEventListener('click', recuperar); };
  }, [cobrando]);

  function agregar(p: { id: string; nombre: string; precio: number }) {
    setError('');
    setItems((prev) => {
      const i = prev.findIndex((x) => x.productoId === p.id);
      if (i >= 0) { const cp = [...prev]; cp[i] = { ...cp[i], cantidad: cp[i].cantidad + 1 }; return cp; }
      return [...prev, { productoId: p.id, nombre: p.nombre, precio: p.precio, cantidad: 1 }];
    });
  }
  function cambiarCantidad(id: string, delta: number) {
    setItems((prev) => prev.flatMap((x) => x.productoId === id ? (x.cantidad + delta <= 0 ? [] : [{ ...x, cantidad: x.cantidad + delta }]) : [x]));
  }
  function vaciar() { setItems([]); }

  async function onCodigo(codigo: string) {
    if (ocupado || cobrando) return;
    setOcupado(true);
    const r = await buscarPorCodigo(codigo);
    setOcupado(false);
    if (r.ok) agregar(r.data);
    else setError(/no encontr|not found/i.test(r.error) ? 'Producto no cargado' : r.error);
  }

  async function confirmarCobro() {
    if (ocupado || items.length === 0) return;
    if (medio === 'EFECTIVO' && Number(pagoTxt) < total) { setError('El monto es menor al total'); return; }
    setOcupado(true);
    const r = await cobrar({
      uid: crypto.randomUUID(),
      medioPago: medio,
      montoPagado: medio === 'EFECTIVO' ? Number(pagoTxt) : total,
      items: items.map((it) => ({ productoId: it.productoId, cantidad: it.cantidad })),
    });
    setOcupado(false);
    if (!r.ok) { setError(r.error); return; }
    setCaja(r.data.caja);
    setItems([]); setPagoTxt(''); setMedio('EFECTIVO'); setCobrando(false); setError('');
  }

  if (!caja) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <button type="button" disabled={ocupado} onMouseDown={(e) => e.preventDefault()}
          onClick={async () => { setOcupado(true); const r = await abrirCaja(); setOcupado(false); if (r.ok) setCaja(r.data); else setError(r.error); }}
          className="h-32 w-full max-w-md rounded-3xl bg-emerald-600 text-4xl font-semibold text-white active:scale-95">
          Abrir caja
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <input ref={foco} className="sr-only" aria-hidden tabIndex={-1} autoFocus
        onKeyDown={(e) => { const r = parseEscaneo(buffer.current, e.key); buffer.current = r.buffer; if (r.codigo) { e.preventDefault(); void onCodigo(r.codigo); } }}
        onChange={() => { /* el valor real vive en buffer.current */ }} value="" />

      <header className="rounded-2xl bg-emerald-50 p-4 text-center ring-1 ring-emerald-600/20">
        <p className="text-sm font-medium text-emerald-700">Total del turno</p>
        <p className="text-3xl font-bold tabular-nums text-emerald-800">{money(caja.totalMonto)}</p>
        <p className="mt-1 text-sm text-emerald-700">Efectivo {money(caja.totalEfectivo)} · Transferencia {money(caja.totalTransferencia)}</p>
      </header>

      <div aria-live="polite" className="min-h-8 text-center text-xl font-semibold text-red-600">{error}</div>

      {/* Carrito */}
      <section className="rounded-2xl border-2 border-neutral-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold">Carrito</p>
          <p className="text-2xl font-bold tabular-nums">{money(total)}</p>
        </div>
        {items.length === 0 ? (
          <p className="py-4 text-center text-neutral-500">Escaneá o tocá un producto</p>
        ) : (
          <ul className="mt-2 divide-y">
            {items.map((it) => (
              <li key={it.productoId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{it.nombre} <span className="text-neutral-500">{money(it.precio)}</span></span>
                <div className="flex items-center gap-2">
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cambiarCantidad(it.productoId, -1)} className="h-9 w-9 rounded-lg border text-xl">–</button>
                  <span className="w-6 text-center tabular-nums">{it.cantidad}</span>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cambiarCantidad(it.productoId, +1)} className="h-9 w-9 rounded-lg border text-xl">+</button>
                  <span className="w-20 text-right tabular-nums">{money(it.precio * it.cantidad)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Botonera */}
      <section className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
        {botonera.map((p) => (
          <button key={p.id} type="button" disabled={ocupado} onMouseDown={(e) => e.preventDefault()}
            onClick={() => agregar({ id: p.id, nombre: p.nombre, precio: p.precio })}
            className="min-h-24 rounded-2xl border-2 border-neutral-300 bg-white p-3 text-xl font-semibold active:scale-95 disabled:opacity-50">
            {p.nombre}
            <span className="mt-1 block text-base font-normal text-neutral-500">{money(p.precio)}</span>
          </button>
        ))}
      </section>

      <footer className="flex gap-3">
        <button type="button" disabled={ocupado || items.length === 0} onMouseDown={(e) => e.preventDefault()} onClick={vaciar}
          className="h-16 flex-1 rounded-2xl border-2 border-neutral-300 bg-white text-xl font-semibold active:scale-95 disabled:opacity-40">
          Vaciar
        </button>
        <button type="button" disabled={ocupado || items.length === 0} onMouseDown={(e) => e.preventDefault()} onClick={() => { setPagoTxt(''); setMedio('EFECTIVO'); setCobrando(true); }}
          className="h-16 flex-[2] rounded-2xl bg-emerald-600 text-2xl font-bold text-white active:scale-95 disabled:opacity-40">
          Cobrar {money(total)}
        </button>
        <button type="button" disabled={ocupado} onMouseDown={(e) => e.preventDefault()}
          onClick={async () => { if (!confirm(`¿Cerrar la caja? Se vendieron ${money(caja.totalMonto)}.`)) return; setOcupado(true); const r = await cerrarCaja(); setOcupado(false); if (r.ok) { alert(`Caja cerrada.\nEfectivo ${money(r.data.totalEfectivo)} · Transferencia ${money(r.data.totalTransferencia)}`); setCaja(null); setItems([]); } else setError(r.error); }}
          className="h-16 flex-1 rounded-2xl bg-neutral-900 text-lg font-semibold text-white active:scale-95">
          Cerrar caja
        </button>
      </footer>

      {/* Pantalla de cobro */}
      {cobrando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCobrando(false)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-lg text-neutral-600">Total a cobrar</p>
            <p className="text-center text-5xl font-bold tabular-nums">{money(total)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMedio('EFECTIVO')} className={`h-14 rounded-xl border-2 text-lg font-semibold ${medio === 'EFECTIVO' ? 'border-emerald-600 bg-emerald-50' : 'border-neutral-300'}`}>Efectivo</button>
              <button type="button" onClick={() => setMedio('TRANSFERENCIA')} className={`h-14 rounded-xl border-2 text-lg font-semibold ${medio === 'TRANSFERENCIA' ? 'border-emerald-600 bg-emerald-50' : 'border-neutral-300'}`}>Transferencia</button>
            </div>
            {medio === 'EFECTIVO' && (
              <div className="mt-4">
                <label className="block text-sm text-neutral-600">¿Con cuánto paga?</label>
                <input autoFocus inputMode="numeric" value={pagoTxt} onChange={(e) => setPagoTxt(e.target.value.replace(/\D/g, ''))}
                  className="mt-1 w-full rounded-xl border-2 border-neutral-300 p-3 text-3xl tabular-nums" />
                <p className="mt-2 text-center text-2xl font-semibold">Vuelto: <span className="tabular-nums">{money(vuelto)}</span></p>
              </div>
            )}
            {error && <p className="mt-3 text-center text-red-600">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => { setCobrando(false); setError(''); }} className="h-14 flex-1 rounded-xl border-2 border-neutral-300 text-lg font-semibold">Cancelar</button>
              <button type="button" disabled={ocupado || (medio === 'EFECTIVO' && Number(pagoTxt) < total)} onClick={() => void confirmarCobro()}
                className="h-14 flex-[2] rounded-xl bg-emerald-600 text-xl font-bold text-white disabled:opacity-40">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Actualizar el test de la pantalla**

En `frontend/src/components/mostrador/pantalla-venta.test.tsx`, mantener los tests de `parseEscaneo` y agregar los de `calcularVuelto` (ajustar el import para incluir `calcularVuelto`):
```tsx
import { parseEscaneo, calcularVuelto } from './pantalla-venta';
// ... (dejar los tests existentes de parseEscaneo)

describe('calcularVuelto', () => {
  it('devuelve pagado - total', () => { expect(calcularVuelto(5000, 3000)).toBe(2000); });
  it('nunca es negativo', () => { expect(calcularVuelto(1000, 3000)).toBe(0); });
  it('trata vacío/NaN como 0', () => { expect(calcularVuelto(NaN, 3000)).toBe(0); });
});
```
(Si el archivo no tiene `describe`/`it` importados, seguí el patrón de imports que ya usa el archivo — vitest global o import explícito.)

- [ ] **Step 5: Verificar build/typecheck del frontend**

```bash
cd frontend && npm run build && npm test -- pantalla-venta
```
Expected: compila sin errores de tipo y pasan los tests de `pantalla-venta`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/buffet-actions.ts frontend/src/components/mostrador/pantalla-venta.tsx frontend/src/components/mostrador/pantalla-venta.test.tsx
git commit -m "feat(mostrador): carrito + pantalla de cobro (total, vuelto, medio de pago)"
```

---

## Task 3: Frontend — cierres del buffet con desglose por medio

**Files:**
- Modify: `frontend/src/app/(panel)/buffet/cierres/page.tsx`

**Interfaces:**
- Consumes: `CierreBuffet` con `totalEfectivo`/`totalTransferencia` (Task 1 + tipos de Task 2).

- [ ] **Step 1: Mostrar efectivo vs transferencia en cada cierre**

En `frontend/src/app/(panel)/buffet/cierres/page.tsx`, reemplazar la línea:
```tsx
          <p className="text-sm text-neutral-600">{c.totalUnidades} productos</p>
```
por:
```tsx
          <p className="text-sm text-neutral-600">{c.totalUnidades} productos</p>
          <p className="text-sm text-neutral-600">Efectivo <span className="tabular-nums">{money(c.totalEfectivo)}</span> · Transferencia <span className="tabular-nums">{money(c.totalTransferencia)}</span></p>
```

- [ ] **Step 2: Verificar build**

```bash
cd frontend && npm run build
```
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(panel)/buffet/cierres/page.tsx"
git commit -m "feat(buffet): cierres muestran total efectivo vs transferencia"
```

---

## Notas de cierre

- El total y el vuelto se recalculan/validan en el server; el frontend los muestra pero no es la
  fuente de verdad.
- La migración reestructura las tablas del buffet; asume que no hay ventas previas a preservar en
  la demo (confirmar que el seed no crea ventas de buffet antes de correrla).
- El "deshacer última venta" ya no existe como endpoint; en el mostrador se maneja con
  ±cantidad / Vaciar sobre el carrito antes de cobrar.

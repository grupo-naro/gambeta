# Módulo de alquileres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prestar raquetas, pelotas e indumentaria desde el mostrador, cobrando al entregar y controlando qué está afuera, con catálogo administrable desde el panel.

**Architecture:** Módulo backend propio (`ArticuloAlquiler` + `Alquiler`) con inventario `stock`/`prestado` garantizado por dos `CHECK` de Postgres. El cobro se registra en el alquiler y se suma a la caja abierta del mostrador tocando exactamente dos funciones de `buffetCaja.service.ts`. El buffet, su stock y su conciliación quedan intactos.

**Tech Stack:** Express 5, Prisma 7 (driver adapter `@prisma/adapter-pg`), zod, vitest + supertest + Testcontainers en el backend; Next.js 16 App Router, Tailwind v4, sonner y vitest en el frontend.

**Spec:** `docs/superpowers/specs/2026-08-19-alquileres-design.md`

## Global Constraints

- **Código, comentarios y vocabulario en español.** No traducir `alquiler`, `mostrador`, `caja`, `garantía`.
- **Backend con npm, frontend con pnpm.** Nunca mezclar.
- **Nunca importar de `@prisma/client`.** Los tipos salen de `src/db/client.ts`; el singleton runtime es `src/db/prisma.ts`.
- **Errores esperados con las factories de `src/utils/errors.ts`** (`NotFound`, `Conflict` → 409, `BusinessRule` → 422, `Forbidden` → 403). Nunca `new Error`.
- **Los alquileres son solo del mostrador PRINCIPAL.** El SECUNDARIO recibe `Forbidden` en todas las rutas de mostrador del módulo.
- **`CajaBuffet.totalUnidades` no se toca nunca.** Cuenta productos de buffet y lo consume la conciliación.
- **Todo export de un archivo `'use server'` tiene que ser `async function`.** El compilador RSC rechaza lo demás.
- Antes de escribir código específico de Next, leer la guía correspondiente en `frontend/node_modules/next/dist/docs/` (Next 16 es más nuevo que el training data).
- Tests de integración del backend necesitan Docker: `npx vitest run tests/integration/<archivo>`. Los unitarios no: `npm run test:unit`.

---

### Task 1: Modelo, migración y los dos CHECK

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_alquileres/migration.sql` (la genera Prisma, se le agregan los CHECK a mano)
- Modify: `backend/tests/helpers/db.ts`
- Test: `backend/tests/integration/alquiler-modelo.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: los modelos Prisma `ArticuloAlquiler` (campos `id`, `nombre`, `precio`, `stock`, `prestado`, `activo`, `orden`) y `Alquiler` (campos `id`, `uid`, `cajaId`, `articuloId`, `cantidad`, `quienRetira`, `garantia`, `precioUnit`, `total`, `medioPago`, `montoPagado`, `vuelto`, `estado`, `entregadoEn`, `cerradoEn`), el enum `EstadoAlquiler` con valores `ENTREGADO | DEVUELTO | PERDIDO | ROTO`, y la columna `CajaBuffet.totalAlquileres`. Los accesores Prisma son `prisma.articuloAlquiler` y `prisma.alquiler`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/alquiler-modelo.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('modelo de alquileres', () => {
  it('la base rechaza prestado mayor al stock', async () => {
    const p = getPrisma();
    const a = await p.articuloAlquiler.create({ data: { nombre: 'Raqueta', precio: '3000', stock: 2 } });
    await expect(
      p.articuloAlquiler.update({ where: { id: a.id }, data: { prestado: 3 } }),
    ).rejects.toThrow();
  });

  it('la base rechaza prestado negativo', async () => {
    const p = getPrisma();
    const a = await p.articuloAlquiler.create({ data: { nombre: 'Pelota', precio: '1000', stock: 5 } });
    await expect(
      p.articuloAlquiler.update({ where: { id: a.id }, data: { prestado: -1 } }),
    ).rejects.toThrow();
  });

  it('permite prestar todo el stock', async () => {
    const p = getPrisma();
    const a = await p.articuloAlquiler.create({ data: { nombre: 'Pechera', precio: '500', stock: 4 } });
    const upd = await p.articuloAlquiler.update({ where: { id: a.id }, data: { prestado: 4 } });
    expect(upd.prestado).toBe(4);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/alquiler-modelo.test.ts`
Expected: FAIL — TypeScript no conoce `p.articuloAlquiler` (`Property 'articuloAlquiler' does not exist`).

- [ ] **Step 3: Agregar los modelos al schema**

En `backend/prisma/schema.prisma`, al final del archivo:

```prisma
enum EstadoAlquiler {
  ENTREGADO
  DEVUELTO
  PERDIDO
  ROTO
}

model ArticuloAlquiler {
  id         String     @id @default(cuid())
  nombre     String
  precio     Decimal    @db.Decimal(10, 2)
  /// Unidades que tiene el complejo. Baja solo cuando algo se pierde o se rompe.
  stock      Int        @default(0)
  /// Unidades afuera AHORA. `stock - prestado` es lo que se puede prestar.
  prestado   Int        @default(0)
  activo     Boolean    @default(true)
  orden      Int        @default(0)
  alquileres Alquiler[]
}

model Alquiler {
  id          String           @id @default(cuid())
  /// Idempotencia del cobro, igual que `TicketBuffet.uid`: el mostrador es una pantalla táctil
  /// y un doble toque no puede cobrar ni prestar dos veces.
  uid         String           @unique
  cajaId      String
  caja        CajaBuffet       @relation(fields: [cajaId], references: [id])
  articuloId  String
  articulo    ArticuloAlquiler @relation(fields: [articuloId], references: [id])
  cantidad    Int
  quienRetira String
  garantia    String?
  /// Congelado al entregar: cambiar el precio del catálogo no reescribe la historia.
  precioUnit  Decimal          @db.Decimal(10, 2)
  total       Decimal          @db.Decimal(10, 2)
  medioPago   MedioPago
  montoPagado Decimal          @db.Decimal(10, 2)
  vuelto      Decimal          @db.Decimal(10, 2)
  estado      EstadoAlquiler   @default(ENTREGADO)
  entregadoEn DateTime         @default(now())
  cerradoEn   DateTime?

  @@index([estado])
  @@index([cajaId])
}
```

Y en el modelo `CajaBuffet` ya existente, agregar dos líneas (dejando el resto igual):

```prisma
  /// Plata de alquileres cobrada en esta caja. Va aparte de `totalMonto` almacenado, que
  /// sigue significando "lo que vendió el buffet" para no cambiarle el sentido a los cierres
  /// que ya están guardados.
  totalAlquileres Decimal?  @db.Decimal(10, 2)
  alquileres      Alquiler[]
```

- [ ] **Step 4: Generar la migración sin aplicarla**

Run: `cd backend && npx prisma migrate dev --name alquileres --create-only`
Expected: crea `prisma/migrations/<timestamp>_alquileres/migration.sql` y no lo aplica.

- [ ] **Step 5: Agregar los CHECK al SQL generado**

Al final de ese `migration.sql`:

```sql
-- La disponibilidad la garantiza la base, no el código: dos entregas concurrentes del mismo
-- artículo pueden ver ambas "queda 1". Mismo criterio que StockMostrador_cantidad_no_negativa.
ALTER TABLE "ArticuloAlquiler"
  ADD CONSTRAINT "ArticuloAlquiler_prestado_no_negativo" CHECK ("prestado" >= 0);
ALTER TABLE "ArticuloAlquiler"
  ADD CONSTRAINT "ArticuloAlquiler_prestado_no_supera_stock" CHECK ("prestado" <= "stock");
```

- [ ] **Step 6: Aplicar la migración**

Run: `cd backend && npx prisma migrate dev`
Expected: aplica la migración pendiente y regenera el cliente en `src/generated/prisma`.

- [ ] **Step 7: Agregar las tablas nuevas a `resetTables()`**

En `backend/tests/helpers/db.ts`, dentro del `$transaction`, agregar estas dos líneas **antes** de `p.ticketBuffet.deleteMany()` (el `Alquiler` tiene FK a `CajaBuffet`, así que se borra antes que ella):

```ts
    p.alquiler.deleteMany(),
    p.articuloAlquiler.deleteMany(),
```

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/alquiler-modelo.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/helpers/db.ts backend/tests/integration/alquiler-modelo.test.ts
git commit -m "feat(alquileres): modelo de articulos y alquileres con checks de inventario"
```

---

### Task 2: Catálogo — `alquilerArticulo.service.ts`

**Files:**
- Create: `backend/src/services/alquilerArticulo.service.ts`
- Test: `backend/tests/integration/alquiler-articulos.test.ts`

**Interfaces:**
- Consumes: los modelos Prisma de Task 1.
- Produces:
  ```ts
  export interface ArticuloAlquilerDTO {
    id: string; nombre: string; precio: number;
    stock: number; prestado: number; disponible: number;
    activo: boolean; orden: number;
  }
  export const alquilerArticuloService: {
    listBotonera(): Promise<ArticuloAlquilerDTO[]>;
    list(): Promise<ArticuloAlquilerDTO[]>;
    crear(input: { nombre: string; precio: number; stock?: number; orden?: number; activo?: boolean }): Promise<ArticuloAlquilerDTO>;
    actualizar(id: string, input: { nombre?: string; precio?: number; orden?: number; activo?: boolean }): Promise<ArticuloAlquilerDTO>;
    ajustarStock(id: string, cantidad: number, adminId: string): Promise<ArticuloAlquilerDTO>;
  };
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/alquiler-articulos.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { alquilerArticuloService } from '../../src/services/alquilerArticulo.service.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('catálogo de alquileres', () => {
  it('crear devuelve disponible = stock - prestado', async () => {
    const a = await alquilerArticuloService.crear({ nombre: 'Raqueta', precio: 3000, stock: 6 });
    expect(a.disponible).toBe(6);
    expect(a.precio).toBe(3000);
  });

  it('disponible descuenta lo prestado', async () => {
    const a = await alquilerArticuloService.crear({ nombre: 'Raqueta', precio: 3000, stock: 6 });
    await getPrisma().articuloAlquiler.update({ where: { id: a.id }, data: { prestado: 2 } });
    const [visto] = await alquilerArticuloService.list();
    expect(visto!.disponible).toBe(4);
  });

  it('la botonera solo trae los activos, por orden', async () => {
    await alquilerArticuloService.crear({ nombre: 'Segunda', precio: 100, orden: 2 });
    await alquilerArticuloService.crear({ nombre: 'Primera', precio: 100, orden: 1 });
    await alquilerArticuloService.crear({ nombre: 'Guardada', precio: 100, orden: 0, activo: false });
    const botonera = await alquilerArticuloService.listBotonera();
    expect(botonera.map((a) => a.nombre)).toEqual(['Primera', 'Segunda']);
  });

  it('ajustarStock suma y resta', async () => {
    const a = await alquilerArticuloService.crear({ nombre: 'Pelota', precio: 500, stock: 3 });
    const mas = await alquilerArticuloService.ajustarStock(a.id, 2, 'admin-1');
    expect(mas.stock).toBe(5);
    const menos = await alquilerArticuloService.ajustarStock(a.id, -1, 'admin-1');
    expect(menos.stock).toBe(4);
  });

  it('no deja bajar el stock por debajo de lo que está afuera', async () => {
    const a = await alquilerArticuloService.crear({ nombre: 'Pechera', precio: 500, stock: 4 });
    await getPrisma().articuloAlquiler.update({ where: { id: a.id }, data: { prestado: 3 } });
    await expect(alquilerArticuloService.ajustarStock(a.id, -2, 'admin-1')).rejects.toMatchObject({ status: 422 });
    const sinCambios = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(sinCambios.stock).toBe(4);
  });

  it('actualizar sobre un id inexistente da 404', async () => {
    await expect(alquilerArticuloService.actualizar('no-existe', { nombre: 'X' })).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/alquiler-articulos.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/alquilerArticulo.service.js'`.

- [ ] **Step 3: Escribir el servicio**

Crear `backend/src/services/alquilerArticulo.service.ts`:

```ts
import { prisma } from '../db/prisma.js';
import { BusinessRule, NotFound } from '../utils/errors.js';
import { auditService } from './audit.service.js';

export interface ArticuloAlquilerDTO {
  id: string; nombre: string; precio: number;
  stock: number; prestado: number; disponible: number;
  activo: boolean; orden: number;
}

const toDTO = (a: {
  id: string; nombre: string; precio: unknown; stock: number; prestado: number; activo: boolean; orden: number;
}): ArticuloAlquilerDTO => ({
  id: a.id, nombre: a.nombre, precio: Number(a.precio),
  stock: a.stock, prestado: a.prestado, disponible: a.stock - a.prestado,
  activo: a.activo, orden: a.orden,
});

export const alquilerArticuloService = {
  /** Lo que ve el mostrador: solo activos, en el orden en que se muestran los botones. */
  async listBotonera(): Promise<ArticuloAlquilerDTO[]> {
    const rows = await prisma.articuloAlquiler.findMany({
      where: { activo: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
    return rows.map(toDTO);
  },

  /** Lo que ve el panel: todo, con los dados de baja al final. */
  async list(): Promise<ArticuloAlquilerDTO[]> {
    const rows = await prisma.articuloAlquiler.findMany({ orderBy: [{ activo: 'desc' }, { nombre: 'asc' }] });
    return rows.map(toDTO);
  },

  async crear(input: {
    nombre: string; precio: number; stock?: number; orden?: number; activo?: boolean;
  }): Promise<ArticuloAlquilerDTO> {
    const creado = await prisma.articuloAlquiler.create({
      data: {
        nombre: input.nombre, precio: input.precio,
        stock: input.stock ?? 0, orden: input.orden ?? 0, activo: input.activo ?? true,
      },
    });
    return toDTO(creado);
  },

  /**
   * Edita los datos del artículo. `stock` y `prestado` NO se tocan por acá a propósito: el
   * inventario tiene un solo camino (`ajustarStock` y las transiciones del alquiler), que es
   * lo que mantiene la invariante en un lugar solo.
   */
  async actualizar(id: string, input: {
    nombre?: string; precio?: number; orden?: number; activo?: boolean;
  }): Promise<ArticuloAlquilerDTO> {
    const actual = await prisma.articuloAlquiler.findUnique({ where: { id } });
    if (!actual) throw NotFound('ArticuloAlquiler', id);
    const upd = await prisma.articuloAlquiler.update({ where: { id }, data: input });
    return toDTO(upd);
  },

  /**
   * Ajusta el inventario. `cantidad` puede ser negativa (se descartó una raqueta vieja).
   * No se puede dejar el stock por debajo de lo que está afuera: esas unidades existen y
   * todavía tienen que poder volver.
   */
  async ajustarStock(id: string, cantidad: number, adminId: string): Promise<ArticuloAlquilerDTO> {
    const actual = await prisma.articuloAlquiler.findUnique({ where: { id } });
    if (!actual) throw NotFound('ArticuloAlquiler', id);
    const nuevo = actual.stock + cantidad;
    if (nuevo < actual.prestado) {
      throw BusinessRule(`No podés dejar el stock en ${nuevo}: hay ${actual.prestado} ${actual.nombre} afuera`);
    }
    const upd = await prisma.articuloAlquiler.update({ where: { id }, data: { stock: nuevo } });
    await auditService.record(adminId, {
      accion: 'AJUSTAR_STOCK', entidad: 'ArticuloAlquiler', entidadId: id,
      descripcion: `Ajustó ${cantidad >= 0 ? '+' : ''}${cantidad} de ${actual.nombre} (${actual.stock} → ${nuevo})`,
    });
    return toDTO(upd);
  },
};
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/alquiler-articulos.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verificar tipos**

Run: `cd backend && npm run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/alquilerArticulo.service.ts backend/tests/integration/alquiler-articulos.test.ts
git commit -m "feat(alquileres): servicio de catalogo con disponible y ajuste de stock"
```

---

### Task 3: Entregar — `alquiler.service.ts`

**Files:**
- Create: `backend/src/services/alquiler.reglas.ts`
- Create: `backend/src/services/alquiler.service.ts`
- Test: `backend/tests/unit/alquiler.reglas.test.ts`
- Test: `backend/tests/integration/alquiler-entrega.test.ts`

**Interfaces:**
- Consumes: `cajaAbierta(mostradorId)` exportada por `backend/src/services/buffetCaja.service.ts`; los modelos de Task 1.
- Produces, en `alquiler.reglas.ts` (puro, sin Prisma, testeable sin Docker):
  ```ts
  export type MedioAlquiler = 'EFECTIVO' | 'TRANSFERENCIA';
  export type EstadoAlquiler = 'ENTREGADO' | 'DEVUELTO' | 'PERDIDO' | 'ROTO';
  export type EstadoCierre = Exclude<EstadoAlquiler, 'ENTREGADO'>;
  export interface Cobro { total: number; montoPagado: number; vuelto: number }
  export function calcularCobro(precio: number, cantidad: number, medioPago: MedioAlquiler, montoPagado: number): Cobro;
  export function saleDelInventario(estado: EstadoCierre): boolean;
  ```
- Produces, en `alquiler.service.ts` (que reexporta los tres tipos de arriba):
  ```ts
  export interface AlquilerDTO {
    id: string; articuloId: string; articuloNombre: string; cantidad: number;
    quienRetira: string; garantia: string | null;
    precioUnit: number; total: number; medioPago: MedioAlquiler;
    estado: EstadoAlquiler; entregadoEn: string; cerradoEn: string | null;
  }
  export interface EntregarInput {
    mostradorId: string; uid: string; articuloId: string; cantidad: number;
    quienRetira: string; garantia?: string | null;
    medioPago: MedioAlquiler; montoPagado: number;
  }
  export interface EntregaResultado { alquiler: AlquilerDTO; vuelto: number }
  export const alquilerService: { entregar(input: EntregarInput): Promise<EntregaResultado> };
  ```
  Task 4 le agrega `cerrar`, `afuera` e `historial` al mismo objeto.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/alquiler-entrega.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { alquilerService } from '../../src/services/alquiler.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';

const PRINCIPAL = 'mostrador-principal';
const SECUNDARIO = 'mostrador-secundario';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function raqueta(stock = 5) {
  return getPrisma().articuloAlquiler.create({ data: { nombre: 'Raqueta', precio: '3000', stock } });
}

const base = (articuloId: string) => ({
  mostradorId: PRINCIPAL, uid: 'u1', articuloId, cantidad: 1,
  quienRetira: 'Juan', medioPago: 'EFECTIVO' as const, montoPagado: 5000,
});

describe('alquileres: entregar', () => {
  it('sin caja abierta da 409', async () => {
    const a = await raqueta();
    await expect(alquilerService.entregar(base(a.id))).rejects.toMatchObject({ status: 409 });
  });

  it('efectivo: calcula total y vuelto, y aumenta prestado', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(PRINCIPAL);
    const r = await alquilerService.entregar({ ...base(a.id), cantidad: 2, montoPagado: 10000 });
    expect(r.alquiler.total).toBe(6000);
    expect(r.vuelto).toBe(4000);
    expect(r.alquiler.estado).toBe('ENTREGADO');
    expect(r.alquiler.articuloNombre).toBe('Raqueta');
    const art = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(art.prestado).toBe(2);
    expect(art.stock).toBe(5);
  });

  it('transferencia: no da vuelto', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(PRINCIPAL);
    const r = await alquilerService.entregar({ ...base(a.id), medioPago: 'TRANSFERENCIA', montoPagado: 0 });
    expect(r.alquiler.total).toBe(3000);
    expect(r.vuelto).toBe(0);
  });

  it('efectivo con monto menor al total falla y no presta nada', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(PRINCIPAL);
    await expect(alquilerService.entregar({ ...base(a.id), montoPagado: 100 })).rejects.toMatchObject({ status: 422 });
    expect(await getPrisma().alquiler.count()).toBe(0);
    const art = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(art.prestado).toBe(0);
  });

  it('no se puede entregar más de lo disponible', async () => {
    const a = await raqueta(2);
    await buffetCajaService.abrir(PRINCIPAL);
    await expect(alquilerService.entregar({ ...base(a.id), cantidad: 3, montoPagado: 20000 }))
      .rejects.toMatchObject({ status: 422 });
    expect(await getPrisma().alquiler.count()).toBe(0);
  });

  it('el mismo uid dos veces no duplica ni vuelve a prestar', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(PRINCIPAL);
    const primera = await alquilerService.entregar(base(a.id));
    const segunda = await alquilerService.entregar(base(a.id));
    expect(segunda.alquiler.id).toBe(primera.alquiler.id);
    expect(segunda.vuelto).toBe(2000);
    expect(await getPrisma().alquiler.count()).toBe(1);
    const art = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(art.prestado).toBe(1);
  });

  it('el mostrador secundario no puede alquilar', async () => {
    const a = await raqueta();
    await buffetCajaService.abrir(SECUNDARIO);
    await expect(alquilerService.entregar({ ...base(a.id), mostradorId: SECUNDARIO }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('un artículo dado de baja no se puede alquilar', async () => {
    const a = await raqueta();
    await getPrisma().articuloAlquiler.update({ where: { id: a.id }, data: { activo: false } });
    await buffetCajaService.abrir(PRINCIPAL);
    await expect(alquilerService.entregar(base(a.id))).rejects.toMatchObject({ status: 404 });
  });

  it('dos entregas simultáneas del último no prestan de más', async () => {
    const a = await raqueta(1);
    await buffetCajaService.abrir(PRINCIPAL);
    const dos = await Promise.allSettled([
      alquilerService.entregar({ ...base(a.id), uid: 'a' }),
      alquilerService.entregar({ ...base(a.id), uid: 'b' }),
    ]);
    expect(dos.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const perdedor = dos.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    // La carrera la puede ganar el pre-chequeo o el CHECK de la base: en los dos casos es una
    // regla de negocio (422), nunca un 500.
    expect(perdedor.reason).toMatchObject({ status: 422 });
    const art = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(art.prestado).toBe(1);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/alquiler-entrega.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/alquiler.service.js'`.

- [ ] **Step 3: Escribir el test unitario de las reglas de cobro**

Las reglas de plata y de inventario van en un módulo puro, sin Prisma, para poder probarlas sin
Docker. Crear `backend/tests/unit/alquiler.reglas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calcularCobro, saleDelInventario } from '../../src/services/alquiler.reglas.js';

describe('calcularCobro', () => {
  it('efectivo: total por cantidad y vuelto', () => {
    expect(calcularCobro(3000, 2, 'EFECTIVO', 10000)).toEqual({ total: 6000, montoPagado: 10000, vuelto: 4000 });
  });

  it('efectivo justo: vuelto 0', () => {
    expect(calcularCobro(3000, 1, 'EFECTIVO', 3000)).toEqual({ total: 3000, montoPagado: 3000, vuelto: 0 });
  });

  it('efectivo insuficiente: regla de negocio', () => {
    expect(() => calcularCobro(3000, 1, 'EFECTIVO', 100)).toThrow(/menor al total/);
  });

  it('transferencia: paga exacto y no da vuelto', () => {
    expect(calcularCobro(3000, 2, 'TRANSFERENCIA', 0)).toEqual({ total: 6000, montoPagado: 6000, vuelto: 0 });
  });
});

describe('saleDelInventario', () => {
  it('lo devuelto vuelve al inventario', () => { expect(saleDelInventario('DEVUELTO')).toBe(false); });
  it('lo perdido no vuelve', () => { expect(saleDelInventario('PERDIDO')).toBe(true); });
  it('lo roto no vuelve', () => { expect(saleDelInventario('ROTO')).toBe(true); });
});
```

- [ ] **Step 4: Correr el unitario y verificar que falla**

Run: `cd backend && npx vitest run tests/unit/alquiler.reglas.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/alquiler.reglas.js'`.

- [ ] **Step 5: Escribir el módulo de reglas**

Crear `backend/src/services/alquiler.reglas.ts`:

```ts
import { BusinessRule } from '../utils/errors.js';

export type MedioAlquiler = 'EFECTIVO' | 'TRANSFERENCIA';
export type EstadoAlquiler = 'ENTREGADO' | 'DEVUELTO' | 'PERDIDO' | 'ROTO';
export type EstadoCierre = Exclude<EstadoAlquiler, 'ENTREGADO'>;

export interface Cobro { total: number; montoPagado: number; vuelto: number }

/**
 * La plata de una entrega. Misma regla que el cobro del buffet: en efectivo hay que cubrir el
 * total y el resto es vuelto; por transferencia se paga exacto.
 */
export function calcularCobro(
  precio: number, cantidad: number, medioPago: MedioAlquiler, montoPagado: number,
): Cobro {
  const total = precio * cantidad;
  if (medioPago === 'TRANSFERENCIA') return { total, montoPagado: total, vuelto: 0 };
  if (montoPagado < total) throw BusinessRule('El monto pagado es menor al total');
  return { total, montoPagado, vuelto: montoPagado - total };
}

/** Si al cerrar así la unidad se va del inventario. Lo perdido y lo roto ya no existen. */
export function saleDelInventario(estado: EstadoCierre): boolean {
  return estado !== 'DEVUELTO';
}
```

- [ ] **Step 6: Correr el unitario y verificar que pasa**

Run: `cd backend && npx vitest run tests/unit/alquiler.reglas.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Escribir el servicio**

Crear `backend/src/services/alquiler.service.ts`:

```ts
import { prisma } from '../db/prisma.js';
import { BusinessRule, Conflict, Forbidden, NotFound } from '../utils/errors.js';
import { cajaAbierta } from './buffetCaja.service.js';
import { calcularCobro, saleDelInventario } from './alquiler.reglas.js';
import type { EstadoAlquiler, EstadoCierre, MedioAlquiler } from './alquiler.reglas.js';

// Se reexportan para que routes y tests tengan un solo lugar del que importar el módulo.
export type { EstadoAlquiler, EstadoCierre, MedioAlquiler };

export interface AlquilerDTO {
  id: string; articuloId: string; articuloNombre: string; cantidad: number;
  quienRetira: string; garantia: string | null;
  precioUnit: number; total: number; medioPago: MedioAlquiler;
  estado: EstadoAlquiler; entregadoEn: string; cerradoEn: string | null;
}

export interface EntregarInput {
  mostradorId: string; uid: string; articuloId: string; cantidad: number;
  quienRetira: string; garantia?: string | null;
  medioPago: MedioAlquiler; montoPagado: number;
}

export interface EntregaResultado { alquiler: AlquilerDTO; vuelto: number }

const conArticulo = { articulo: { select: { nombre: true } } } as const;

type FilaAlquiler = {
  id: string; articuloId: string; cantidad: number; quienRetira: string; garantia: string | null;
  precioUnit: unknown; total: unknown; medioPago: string; estado: string;
  entregadoEn: Date; cerradoEn: Date | null; articulo: { nombre: string };
};

const toDTO = (a: FilaAlquiler): AlquilerDTO => ({
  id: a.id, articuloId: a.articuloId, articuloNombre: a.articulo.nombre, cantidad: a.cantidad,
  quienRetira: a.quienRetira, garantia: a.garantia,
  precioUnit: Number(a.precioUnit), total: Number(a.total),
  medioPago: a.medioPago as MedioAlquiler, estado: a.estado as EstadoAlquiler,
  entregadoEn: a.entregadoEn.toISOString(), cerradoEn: a.cerradoEn?.toISOString() ?? null,
});

// Postgres check_violation es 23514, y con el driver adapter de Prisma 7 el código vive en
// e.cause.code — mismo patrón que esViolacionStockAsignadoNegativo en buffetCaja.service.ts.
// Se filtra por el prefijo del nombre porque las dos constraints del inventario empiezan igual.
function esViolacionInventario(e: unknown): boolean {
  const anyE = e as any;
  const esCheck = anyE?.code === '23514' || anyE?.cause?.code === '23514' || anyE?.meta?.code === '23514';
  return esCheck && String(anyE?.message ?? '').includes('ArticuloAlquiler_prestado');
}

export const alquilerService = {
  async entregar(input: EntregarInput): Promise<EntregaResultado> {
    const previo = await prisma.alquiler.findUnique({ where: { uid: input.uid }, include: conArticulo });
    if (previo) return { alquiler: toDTO(previo), vuelto: Number(previo.vuelto) };

    const mostrador = await prisma.mostrador.findUnique({ where: { id: input.mostradorId } });
    if (!mostrador) throw NotFound('Mostrador', input.mostradorId);
    // El secundario vende contra el stock que le asignaron y su cierre se concilia contra ese
    // conteo. El inventario de alquileres es el general, que es del principal.
    if (mostrador.tipo !== 'PRINCIPAL') throw Forbidden('Los alquileres los maneja el mostrador principal');

    const caja = await cajaAbierta(input.mostradorId);
    if (!caja) throw Conflict('No hay una caja abierta');

    if (!input.quienRetira.trim()) throw BusinessRule('Falta el nombre de quien retira');

    const art = await prisma.articuloAlquiler.findFirst({ where: { id: input.articuloId, activo: true } });
    if (!art) throw NotFound('ArticuloAlquiler', input.articuloId);
    const disponible = art.stock - art.prestado;
    if (input.cantidad > disponible) throw BusinessRule(`Solo quedan ${disponible} de ${art.nombre}`);

    const { total, montoPagado, vuelto } = calcularCobro(
      Number(art.precio), input.cantidad, input.medioPago, input.montoPagado,
    );

    try {
      const creado = await prisma.$transaction(async (tx) => {
        const a = await tx.alquiler.create({
          data: {
            uid: input.uid, cajaId: caja.id, articuloId: art.id, cantidad: input.cantidad,
            quienRetira: input.quienRetira.trim(), garantia: input.garantia?.trim() || null,
            precioUnit: art.precio, total, medioPago: input.medioPago, montoPagado, vuelto,
          },
          include: conArticulo,
        });
        await tx.articuloAlquiler.update({
          where: { id: art.id }, data: { prestado: { increment: input.cantidad } },
        });
        return a;
      });
      return { alquiler: toDTO(creado), vuelto };
    } catch (e: any) {
      // Dos toques simultáneos con el mismo uid: los dos vieron `null` arriba y entraron a la
      // transacción. El que pierde el índice único devuelve el alquiler que quedó, no un error.
      if (e?.code === 'P2002') {
        const ya = await prisma.alquiler.findUnique({ where: { uid: input.uid }, include: conArticulo });
        if (ya) return { alquiler: toDTO(ya), vuelto: Number(ya.vuelto) };
      }
      // La otra transacción se llevó la última unidad entre el pre-chequeo y el update: la base
      // lo frena con el CHECK. Es el mismo caso de negocio, descubierto más tarde.
      if (esViolacionInventario(e)) throw BusinessRule(`No quedan suficientes ${art.nombre}`);
      throw e;
    }
  },
};
```

- [ ] **Step 8: Correr el test de integración y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/alquiler-entrega.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/alquiler.reglas.ts backend/src/services/alquiler.service.ts backend/tests/unit/alquiler.reglas.test.ts backend/tests/integration/alquiler-entrega.test.ts
git commit -m "feat(alquileres): entregar cobra contra la caja y descuenta disponible"
```

---

### Task 4: Devolver, listar y el historial

**Files:**
- Modify: `backend/src/services/alquiler.service.ts`
- Test: `backend/tests/integration/alquiler-devolucion.test.ts`

**Interfaces:**
- Consumes: `alquilerService.entregar`, `AlquilerDTO`, `EstadoCierre` de Task 3.
- Produces, sobre el mismo objeto `alquilerService`:
  ```ts
  cerrar(id: string, estado: EstadoCierre): Promise<AlquilerDTO>;
  afuera(): Promise<AlquilerDTO[]>;
  historial(opts: { desde?: string; hasta?: string; estado?: EstadoAlquiler }): Promise<AlquilerDTO[]>;
  ```
  `desde` y `hasta` son fechas `YYYY-MM-DD` interpretadas en `TZ_NEGOCIO`; el rango incluye el día `hasta` completo.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/alquiler-devolucion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { alquilerService } from '../../src/services/alquiler.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';

const PRINCIPAL = 'mostrador-principal';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function prestar(cantidad = 1, stock = 5, uid = 'u1') {
  const art = await getPrisma().articuloAlquiler.create({ data: { nombre: 'Raqueta', precio: '3000', stock } });
  await buffetCajaService.abrir(PRINCIPAL);
  const r = await alquilerService.entregar({
    mostradorId: PRINCIPAL, uid, articuloId: art.id, cantidad,
    quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 100000,
  });
  return { art, alquiler: r.alquiler };
}

describe('alquileres: devolución', () => {
  it('devuelto libera el disponible sin tocar el stock', async () => {
    const { art, alquiler } = await prestar(2);
    const cerrado = await alquilerService.cerrar(alquiler.id, 'DEVUELTO');
    expect(cerrado.estado).toBe('DEVUELTO');
    expect(cerrado.cerradoEn).not.toBeNull();
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.prestado).toBe(0);
    expect(a.stock).toBe(5);
  });

  it('perdido saca la unidad del inventario', async () => {
    const { art, alquiler } = await prestar(2);
    await alquilerService.cerrar(alquiler.id, 'PERDIDO');
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.prestado).toBe(0);
    expect(a.stock).toBe(3);
  });

  it('roto saca la unidad del inventario', async () => {
    const { art, alquiler } = await prestar(1);
    await alquilerService.cerrar(alquiler.id, 'ROTO');
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.stock).toBe(4);
  });

  it('cerrar dos veces no descuenta dos veces', async () => {
    const { art, alquiler } = await prestar(1);
    await alquilerService.cerrar(alquiler.id, 'PERDIDO');
    await expect(alquilerService.cerrar(alquiler.id, 'PERDIDO')).rejects.toMatchObject({ status: 422 });
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.stock).toBe(4);
    expect(a.prestado).toBe(0);
  });

  it('dos cierres simultáneos solo cuentan una vez', async () => {
    const { art, alquiler } = await prestar(1);
    const dos = await Promise.allSettled([
      alquilerService.cerrar(alquiler.id, 'DEVUELTO'),
      alquilerService.cerrar(alquiler.id, 'DEVUELTO'),
    ]);
    expect(dos.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const a = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: art.id } });
    expect(a.prestado).toBe(0);
  });

  it('cerrar un id inexistente da 404', async () => {
    await expect(alquilerService.cerrar('no-existe', 'DEVUELTO')).rejects.toMatchObject({ status: 404 });
  });

  it('afuera trae solo lo que sigue prestado', async () => {
    const { alquiler } = await prestar(1, 5, 'u1');
    expect(await alquilerService.afuera()).toHaveLength(1);
    await alquilerService.cerrar(alquiler.id, 'DEVUELTO');
    expect(await alquilerService.afuera()).toHaveLength(0);
  });

  it('el historial filtra por estado', async () => {
    const { alquiler } = await prestar(1, 5, 'u1');
    await alquilerService.cerrar(alquiler.id, 'ROTO');
    expect(await alquilerService.historial({ estado: 'ROTO' })).toHaveLength(1);
    expect(await alquilerService.historial({ estado: 'DEVUELTO' })).toHaveLength(0);
    expect(await alquilerService.historial({})).toHaveLength(1);
  });

  it('el historial incluye el día `hasta` completo', async () => {
    await prestar(1, 5, 'u1');
    const hoy = new Date().toISOString().slice(0, 10);
    expect(await alquilerService.historial({ desde: hoy, hasta: hoy })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/alquiler-devolucion.test.ts`
Expected: FAIL — `alquilerService.cerrar is not a function`.

- [ ] **Step 3: Agregar los imports que faltan**

En `backend/src/services/alquiler.service.ts`, junto a los imports existentes:

```ts
import { getEnv } from '../config/env.js';
import { dayWindowUtc } from '../utils/tz.js';
```

- [ ] **Step 4: Agregar los tres métodos**

Dentro del objeto `alquilerService`, después de `entregar`:

```ts
  /**
   * Cierra un alquiler. DEVUELTO solo libera el disponible; PERDIDO y ROTO además sacan la
   * unidad del inventario, porque esa raqueta ya no existe.
   */
  async cerrar(id: string, estado: EstadoCierre): Promise<AlquilerDTO> {
    const actual = await prisma.alquiler.findUnique({ where: { id } });
    if (!actual) throw NotFound('Alquiler', id);

    const saleDelStock = saleDelInventario(estado);
    return prisma.$transaction(async (tx) => {
      // Compare-and-set: el filtro por estado es lo que hace atómica la transición. Leer el
      // estado y después escribir dejaría que dos toques simultáneos descuenten dos veces.
      const { count } = await tx.alquiler.updateMany({
        where: { id, estado: 'ENTREGADO' },
        data: { estado, cerradoEn: new Date() },
      });
      if (count === 0) throw BusinessRule('Ese alquiler ya está cerrado');

      await tx.articuloAlquiler.update({
        where: { id: actual.articuloId },
        data: {
          prestado: { decrement: actual.cantidad },
          ...(saleDelStock ? { stock: { decrement: actual.cantidad } } : {}),
        },
      });
      const cerrado = await tx.alquiler.findUniqueOrThrow({ where: { id }, include: conArticulo });
      return toDTO(cerrado);
    });
  },

  /** Lo que está afuera ahora: es la lista que el mostrador usa para recibir devoluciones. */
  async afuera(): Promise<AlquilerDTO[]> {
    const rows = await prisma.alquiler.findMany({
      where: { estado: 'ENTREGADO' }, include: conArticulo, orderBy: { entregadoEn: 'asc' },
    });
    return rows.map(toDTO);
  },

  async historial(opts: { desde?: string; hasta?: string; estado?: EstadoAlquiler }): Promise<AlquilerDTO[]> {
    const tz = getEnv().TZ_NEGOCIO;
    // `hasta` es inclusivo para el usuario: dayWindowUtc devuelve el arranque del día siguiente
    // como `end`, así que un `lt` sobre eso cubre el día entero.
    const desde = opts.desde ? dayWindowUtc(opts.desde, tz).start : undefined;
    const hasta = opts.hasta ? dayWindowUtc(opts.hasta, tz).end : undefined;
    const rows = await prisma.alquiler.findMany({
      where: {
        ...(opts.estado ? { estado: opts.estado } : {}),
        ...(desde || hasta
          ? { entregadoEn: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lt: hasta } : {}) } }
          : {}),
      },
      include: conArticulo,
      orderBy: { entregadoEn: 'desc' },
    });
    return rows.map(toDTO);
  },
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/alquiler-devolucion.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/alquiler.service.ts backend/tests/integration/alquiler-devolucion.test.ts
git commit -m "feat(alquileres): devolucion, perdida y rotura con compare-and-set"
```

---

### Task 5: Validadores y rutas

**Files:**
- Create: `backend/src/validators/alquiler.schema.ts`
- Create: `backend/src/routes/alquiler.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/alquiler-rutas.test.ts`

**Interfaces:**
- Consumes: `alquilerService` (Task 3 y 4), `alquilerArticuloService` (Task 2).
- Produces: el router `alquilerRoutes`, montado en `/alquileres`. Contrato HTTP: `POST /alquileres/entregas` responde `201` con `{ alquiler, vuelto }`; `POST /alquileres/:id/cerrar` responde `200` con el `AlquilerDTO`; `GET /alquileres/botonera` responde `ArticuloAlquilerDTO[]`; `GET /alquileres/afuera` responde `AlquilerDTO[]`; `GET /alquileres/articulos` responde `ArticuloAlquilerDTO[]`; `POST /alquileres/articulos` responde `201`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/alquiler-rutas.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { hashPassword } from '../../src/utils/password.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let tokenPrincipal: string; let tokenSecundario: string; let jwtAdmin: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  await p.mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  await p.mostrador.update({ where: { id: 'mostrador-secundario' }, data: { pinHash: await hashPassword('2222') } });
  const login = (pin: string) => supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin });
  tokenPrincipal = (await login('1111')).body.token;
  tokenSecundario = (await login('2222')).body.token;

  // El admin tiene que existir de verdad: el AuditLog tiene FK a AdminUser y `auditService`
  // traga sus errores, así que con un id inventado el log simplemente no se escribiría y el
  // test de auditoría pasaría a ser mentira.
  const admin = await p.adminUser.create({
    data: { nombre: 'Admin', email: 'admin@test.com', passwordHash: await hashPassword('secreta123'), rol: 'ADMIN' },
  });
  jwtAdmin = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

const comoMostrador = (r: any, token: string) => r.set('x-buffet-key', KEY).set('x-mostrador', token);
const comoAdmin = (r: any) => r.set('Authorization', `Bearer ${jwtAdmin}`);

describe('rutas de alquileres', () => {
  it('el admin crea un artículo y el mostrador lo ve en la botonera', async () => {
    const creado = await comoAdmin(supertest(app).post('/alquileres/articulos'))
      .send({ nombre: 'Raqueta', precio: 3000, stock: 4 });
    expect(creado.status).toBe(201);
    expect(creado.body.disponible).toBe(4);

    const botonera = await comoMostrador(supertest(app).get('/alquileres/botonera'), tokenPrincipal);
    expect(botonera.status).toBe(200);
    expect(botonera.body).toHaveLength(1);
  });

  it('el flujo completo: entregar y devolver', async () => {
    const art = await comoAdmin(supertest(app).post('/alquileres/articulos')).send({ nombre: 'Raqueta', precio: 3000, stock: 4 });
    await comoMostrador(supertest(app).post('/buffet/caja/abrir'), tokenPrincipal);

    const entrega = await comoMostrador(supertest(app).post('/alquileres/entregas'), tokenPrincipal)
      .send({ uid: 'u1', articuloId: art.body.id, cantidad: 1, quienRetira: 'Juan', garantia: 'DNI', medioPago: 'EFECTIVO', montoPagado: 5000 });
    expect(entrega.status).toBe(201);
    expect(entrega.body.vuelto).toBe(2000);

    const afuera = await comoMostrador(supertest(app).get('/alquileres/afuera'), tokenPrincipal);
    expect(afuera.body).toHaveLength(1);
    expect(afuera.body[0].garantia).toBe('DNI');

    const cierre = await comoMostrador(supertest(app).post(`/alquileres/${entrega.body.alquiler.id}/cerrar`), tokenPrincipal)
      .send({ estado: 'DEVUELTO' });
    expect(cierre.status).toBe(200);
    expect(cierre.body.estado).toBe('DEVUELTO');
    expect((await comoMostrador(supertest(app).get('/alquileres/afuera'), tokenPrincipal)).body).toHaveLength(0);
  });

  it('el secundario no llega a ninguna ruta de alquileres', async () => {
    expect((await comoMostrador(supertest(app).get('/alquileres/botonera'), tokenSecundario)).status).toBe(403);
    expect((await comoMostrador(supertest(app).get('/alquileres/afuera'), tokenSecundario)).status).toBe(403);
  });

  it('sin token de mostrador no se entrega', async () => {
    const r = await supertest(app).post('/alquileres/entregas').set('x-buffet-key', KEY)
      .send({ uid: 'u1', articuloId: 'x', cantidad: 1, quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 0 });
    expect(r.status).toBe(401);
  });

  it('el recepcionista no puede tocar el catálogo', async () => {
    const recep = signAdminToken({ adminId: 'recep-1', email: 'recep@test.com', rol: 'RECEPCIONISTA' });
    const r = await supertest(app).post('/alquileres/articulos').set('Authorization', `Bearer ${recep}`)
      .send({ nombre: 'Raqueta', precio: 3000 });
    expect(r.status).toBe(403);
  });

  it('el ajuste de stock queda auditado', async () => {
    const art = await comoAdmin(supertest(app).post('/alquileres/articulos')).send({ nombre: 'Raqueta', precio: 3000, stock: 4 });
    const r = await comoAdmin(supertest(app).post(`/alquileres/articulos/${art.body.id}/reponer`)).send({ cantidad: 3 });
    expect(r.status).toBe(200);
    expect(r.body.stock).toBe(7);
    const logs = await getPrisma().auditLog.findMany({ where: { entidad: 'ArticuloAlquiler' } });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('un estado inválido al cerrar no pasa la validación', async () => {
    const r = await comoMostrador(supertest(app).post('/alquileres/xyz/cerrar'), tokenPrincipal).send({ estado: 'PERDIDA' });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/alquiler-rutas.test.ts`
Expected: FAIL — las rutas devuelven 404 porque no existen.

- [ ] **Step 3: Escribir los validadores**

Crear `backend/src/validators/alquiler.schema.ts`:

```ts
import { z } from 'zod';

const empty = z.looseObject({});
const idParam = z.object({ id: z.string().min(1) });
const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const estadoAlquiler = z.enum(['ENTREGADO', 'DEVUELTO', 'PERDIDO', 'ROTO']);

export const crearArticuloSchema = z.object({
  body: z.object({
    nombre: z.string().min(1),
    precio: z.coerce.number().nonnegative(),
    stock: z.coerce.number().int().nonnegative().optional(),
    orden: z.coerce.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  query: empty, params: empty,
});

export const actualizarArticuloSchema = z.object({
  body: z.object({
    nombre: z.string().min(1).optional(),
    precio: z.coerce.number().nonnegative().optional(),
    orden: z.coerce.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  query: empty, params: idParam,
});

// La cantidad puede ser negativa (se descartó una raqueta), pero 0 no es un ajuste.
export const ajustarStockSchema = z.object({
  body: z.object({ cantidad: z.coerce.number().int().refine((n) => n !== 0, 'La cantidad no puede ser 0') }),
  query: empty, params: idParam,
});

export const entregarAlquilerSchema = z.object({
  body: z.object({
    uid: z.string().min(1),
    articuloId: z.string().min(1),
    cantidad: z.coerce.number().int().positive(),
    quienRetira: z.string().min(1),
    garantia: z.string().nullable().optional(),
    medioPago: z.enum(['EFECTIVO', 'TRANSFERENCIA']),
    montoPagado: z.coerce.number().nonnegative(),
  }),
  query: empty, params: empty,
});

export const cerrarAlquilerSchema = z.object({
  body: z.object({ estado: z.enum(['DEVUELTO', 'PERDIDO', 'ROTO']) }),
  query: empty, params: idParam,
});

export const historialAlquileresSchema = z.object({
  body: z.unknown(),
  query: z.object({ desde: fechaISO.optional(), hasta: fechaISO.optional(), estado: estadoAlquiler.optional() }),
  params: empty,
});
```

- [ ] **Step 4: Escribir las rutas**

Crear `backend/src/routes/alquiler.routes.ts`:

```ts
import { Router } from 'express';
import { authMostrador } from '../middlewares/authBuffet.js';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import { alquilerService } from '../services/alquiler.service.js';
import { alquilerArticuloService } from '../services/alquilerArticulo.service.js';
import { auditService } from '../services/audit.service.js';
import { Forbidden } from '../utils/errors.js';
import {
  crearArticuloSchema, actualizarArticuloSchema, ajustarStockSchema,
  entregarAlquilerSchema, cerrarAlquilerSchema, historialAlquileresSchema,
} from '../validators/alquiler.schema.js';

export const alquilerRoutes = Router();

const SOLO_PRINCIPAL = 'Los alquileres los maneja el mostrador principal';

// --- Mostrador (x-buffet-key + x-mostrador) ---
// OJO: las rutas literales van ANTES que /:id/cerrar, igual que en buffet.routes.ts.
alquilerRoutes.get('/botonera', authMostrador, async (req, res, next) => {
  try {
    if ((req as any).mostrador.tipo !== 'PRINCIPAL') return next(Forbidden(SOLO_PRINCIPAL));
    res.json(await alquilerArticuloService.listBotonera());
  } catch (e) { next(e); }
});

alquilerRoutes.get('/afuera', authMostrador, async (req, res, next) => {
  try {
    if ((req as any).mostrador.tipo !== 'PRINCIPAL') return next(Forbidden(SOLO_PRINCIPAL));
    res.json(await alquilerService.afuera());
  } catch (e) { next(e); }
});

// El guard de puesto vive en el servicio: `entregar` ya lo necesita para su propia invariante.
alquilerRoutes.post('/entregas', authMostrador, validate(entregarAlquilerSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    res.status(201).json(await alquilerService.entregar({ ...body, mostradorId: (req as any).mostrador.id }));
  } catch (e) { next(e); }
});

alquilerRoutes.post('/:id/cerrar', authMostrador, validate(cerrarAlquilerSchema), async (req, res, next) => {
  try {
    if ((req as any).mostrador.tipo !== 'PRINCIPAL') return next(Forbidden(SOLO_PRINCIPAL));
    const { id } = (req as any).valid.params;
    res.json(await alquilerService.cerrar(id, (req as any).valid.body.estado));
  } catch (e) { next(e); }
});

// --- Admin (JWT) ---
alquilerRoutes.get('/articulos', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json(await alquilerArticuloService.list()); } catch (e) { next(e); }
});

alquilerRoutes.post('/articulos', authJwt, requireRole('ADMIN'), validate(crearArticuloSchema), async (req, res, next) => {
  try {
    const creado = await alquilerArticuloService.crear((req as any).valid.body);
    await auditService.log(req, {
      accion: 'CREAR', entidad: 'ArticuloAlquiler', entidadId: creado.id,
      descripcion: `Creó el artículo de alquiler ${creado.nombre}`,
    });
    res.status(201).json(creado);
  } catch (e) { next(e); }
});

alquilerRoutes.patch('/articulos/:id', authJwt, requireRole('ADMIN'), validate(actualizarArticuloSchema), async (req, res, next) => {
  try {
    const { id } = (req as any).valid.params;
    const upd = await alquilerArticuloService.actualizar(id, (req as any).valid.body);
    await auditService.log(req, {
      accion: 'EDITAR', entidad: 'ArticuloAlquiler', entidadId: id,
      descripcion: `Editó el artículo de alquiler ${upd.nombre}`,
    });
    res.json(upd);
  } catch (e) { next(e); }
});

alquilerRoutes.post('/articulos/:id/reponer', authJwt, requireRole('ADMIN'), validate(ajustarStockSchema), async (req, res, next) => {
  try {
    const adminId = (req as any).principal.adminId as string;
    const { id } = (req as any).valid.params;
    res.json(await alquilerArticuloService.ajustarStock(id, (req as any).valid.body.cantidad, adminId));
  } catch (e) { next(e); }
});

alquilerRoutes.get('/', authJwt, requireRole('ADMIN'), validate(historialAlquileresSchema), async (req, res, next) => {
  try { res.json(await alquilerService.historial((req as any).valid.query)); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Montar el router**

En `backend/src/routes/index.ts`, agregar el import junto a los demás y el `use` al final:

```ts
import { alquilerRoutes } from './alquiler.routes.js';
```

```ts
apiRouter.use('/alquileres', alquilerRoutes);
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/alquiler-rutas.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Verificar tipos**

Run: `cd backend && npm run typecheck`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/validators/alquiler.schema.ts backend/src/routes/alquiler.routes.ts backend/src/routes/index.ts backend/tests/integration/alquiler-rutas.test.ts
git commit -m "feat(alquileres): rutas de mostrador y de administracion del catalogo"
```

---

### Task 6: La plata del alquiler entra a la caja

**Files:**
- Modify: `backend/src/services/buffetCaja.service.ts`
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/app/(panel)/buffet/cierres/page.tsx`
- Test: `backend/tests/integration/alquiler-caja.test.ts`

**Interfaces:**
- Consumes: `alquilerService.entregar` (Task 3).
- Produces: `CajaEstado` y `CierreDTO` de `buffetCaja.service.ts` ganan `totalAlquileres: number`, y `CierreDTO` gana `porArticulo: LineaCierreAlquiler[]` con `export interface LineaCierreAlquiler { articuloId: string; nombre: string; unidades: number; monto: number }`. En el frontend, `CajaBuffetEstado` y `CierreBuffet` (en `types.ts`) ganan los mismos campos.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/alquiler-caja.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { alquilerService } from '../../src/services/alquiler.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';

const PRINCIPAL = 'mostrador-principal';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

async function escenario() {
  const p = getPrisma();
  const art = await p.articuloAlquiler.create({ data: { nombre: 'Raqueta', precio: '3000', stock: 5 } });
  const coca = await p.productoBuffet.create({ data: { nombre: 'Coca', precio: '1500', stock: 10 } });
  await buffetCajaService.abrir(PRINCIPAL);
  return { art, coca };
}

describe('alquileres en la caja del mostrador', () => {
  it('el alquiler suma al total y al total de alquileres, no a las unidades', async () => {
    const { art, coca } = await escenario();
    await buffetCajaService.cobrar({
      mostradorId: PRINCIPAL, uid: 't1', medioPago: 'EFECTIVO', montoPagado: 1500,
      items: [{ productoId: coca.id, cantidad: 1 }],
    });
    await alquilerService.entregar({
      mostradorId: PRINCIPAL, uid: 'a1', articuloId: art.id, cantidad: 1,
      quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 3000,
    });

    const caja = await buffetCajaService.actual(PRINCIPAL);
    expect(caja!.totalAlquileres).toBe(3000);
    expect(caja!.totalMonto).toBe(4500);
    expect(caja!.totalEfectivo).toBe(4500);
    // Cuenta productos de buffet: la conciliación del secundario depende de esto.
    expect(caja!.totalUnidades).toBe(1);
  });

  it('separa efectivo de transferencia', async () => {
    const { art } = await escenario();
    await alquilerService.entregar({
      mostradorId: PRINCIPAL, uid: 'a1', articuloId: art.id, cantidad: 1,
      quienRetira: 'Juan', medioPago: 'TRANSFERENCIA', montoPagado: 0,
    });
    const caja = await buffetCajaService.actual(PRINCIPAL);
    expect(caja!.totalTransferencia).toBe(3000);
    expect(caja!.totalEfectivo).toBe(0);
  });

  it('un alquiler devuelto sigue contando: la plata se cobró igual', async () => {
    const { art } = await escenario();
    const r = await alquilerService.entregar({
      mostradorId: PRINCIPAL, uid: 'a1', articuloId: art.id, cantidad: 1,
      quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 3000,
    });
    await alquilerService.cerrar(r.alquiler.id, 'DEVUELTO');
    const caja = await buffetCajaService.actual(PRINCIPAL);
    expect(caja!.totalAlquileres).toBe(3000);
  });

  it('el cierre persiste el total de alquileres y lo desglosa por artículo', async () => {
    const { art } = await escenario();
    await alquilerService.entregar({
      mostradorId: PRINCIPAL, uid: 'a1', articuloId: art.id, cantidad: 2,
      quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 6000,
    });
    const cierre = await buffetCajaService.cerrar(PRINCIPAL);
    expect(cierre.totalAlquileres).toBe(6000);
    expect(cierre.totalMonto).toBe(6000);
    expect(cierre.porArticulo).toEqual([{ articuloId: art.id, nombre: 'Raqueta', unidades: 2, monto: 6000 }]);

    const fila = await getPrisma().cajaBuffet.findFirstOrThrow({ where: { mostradorId: PRINCIPAL } });
    expect(Number(fila.totalAlquileres)).toBe(6000);
    // El totalMonto guardado sigue siendo el del buffet: no se le cambia el sentido.
    expect(Number(fila.totalMonto)).toBe(0);
  });

  it('una caja sin alquileres reporta 0, no null', async () => {
    await escenario();
    const caja = await buffetCajaService.actual(PRINCIPAL);
    expect(caja!.totalAlquileres).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/alquiler-caja.test.ts`
Expected: FAIL — `totalAlquileres` no existe en `CajaEstado` (error de tipos) y es `undefined` en runtime.

- [ ] **Step 3: Agregar los campos a los tipos de la caja**

En `backend/src/services/buffetCaja.service.ts`, modificar las interfaces existentes:

```ts
export interface CajaEstado {
  id: string; abiertaEn: string;
  totalUnidades: number; totalMonto: number;
  totalEfectivo: number; totalTransferencia: number;
  /// Cuánto de `totalMonto` vino de alquileres. Aparte, para poder mirarlo solo.
  totalAlquileres: number;
  ultimosTickets: TicketDTO[];
}
export interface LineaCierreAlquiler { articuloId: string; nombre: string; unidades: number; monto: number }
export interface CierreDTO {
  id: string; abiertaEn: string; cerradaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  totalAlquileres: number;
  porProducto: LineaCierre[];
  porArticulo: LineaCierreAlquiler[];
}
```

- [ ] **Step 4: Sumar los alquileres en `estadoDe`**

En `estadoDe`, después del `for (const t of tickets) { ... }` y antes del `return`:

```ts
  // Los alquileres son plata de esta caja igual que un ticket, así que suman al total y a su
  // medio de pago. `totalUnidades` NO se toca: cuenta productos de buffet y es lo que mira la
  // conciliación del secundario. Tampoco se filtra por estado: un alquiler devuelto o perdido
  // se cobró igual cuando salió.
  const alquileres = await prisma.alquiler.findMany({ where: { cajaId } });
  let totalAlquileres = 0;
  for (const a of alquileres) {
    const monto = Number(a.total);
    totalAlquileres += monto;
    totalMonto += monto;
    if (a.medioPago === 'EFECTIVO') totalEfectivo += monto; else totalTransferencia += monto;
  }
```

Y agregar `totalAlquileres,` al objeto que devuelve, junto a `totalEfectivo, totalTransferencia,`.

- [ ] **Step 5: Sumar los alquileres en `detalleCierre`**

En `detalleCierre`, después del `for (const t of tickets) { ... }`:

```ts
  const alquileres = await prisma.alquiler.findMany({
    where: { cajaId }, include: { articulo: { select: { nombre: true } } },
  });
  const porArticulo = new Map<string, LineaCierreAlquiler>();
  let totalAlquileres = 0;
  for (const a of alquileres) {
    const monto = Number(a.total);
    totalAlquileres += monto;
    totalMonto += monto;
    if (a.medioPago === 'EFECTIVO') totalEfectivo += monto; else totalTransferencia += monto;
    const cur = porArticulo.get(a.articuloId)
      ?? { articuloId: a.articuloId, nombre: a.articulo.nombre, unidades: 0, monto: 0 };
    cur.unidades += a.cantidad;
    cur.monto += monto;
    porArticulo.set(a.articuloId, cur);
  }
```

Y en el objeto devuelto, agregar:

```ts
    totalAlquileres,
    porArticulo: [...porArticulo.values()].sort((a, b) => b.monto - a.monto),
```

- [ ] **Step 6: Persistir el total al cerrar**

En `cerrar`, reemplazar el `data` del `update` por:

```ts
      data: {
        estado: 'CERRADA', cerradaEn: new Date(),
        totalUnidades: est.totalUnidades,
        // `est.totalMonto` ya incluye los alquileres (Step 4), y esta columna NO puede
        // incluirlos: significa "lo que vendió el buffet" en todos los cierres ya guardados y
        // tiene que seguir significando eso. Por eso se resta.
        totalMonto: est.totalMonto - est.totalAlquileres,
        totalAlquileres: est.totalAlquileres,
      },
```

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/alquiler-caja.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 8: Verificar que el buffet no se rompió**

Run: `cd backend && npx vitest run tests/integration/buffet-cierre.test.ts tests/integration/buffet-cobro.test.ts tests/integration/buffet-conciliacion.test.ts`
Expected: PASS. Si algún test del buffet esperaba un `totalMonto` guardado, revisar que la resta del Step 6 lo dejó igual que antes.

- [ ] **Step 9: Espejar los tipos en el frontend**

En `frontend/src/lib/types.ts`, agregar a las interfaces existentes:

```ts
export interface CajaBuffetEstado {
  id: string; abiertaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  /** Cuánto de `totalMonto` vino de alquileres. */
  totalAlquileres: number;
  ultimosTickets: TicketBuffet[];
}
export interface LineaCierreAlquiler { articuloId: string; nombre: string; unidades: number; monto: number }
```

Y a `CierreBuffet`, junto a los otros totales:

```ts
  totalAlquileres: number;
  porArticulo: LineaCierreAlquiler[];
```

- [ ] **Step 10: Mostrar los alquileres en la pantalla de cierres**

En `frontend/src/app/(panel)/buffet/cierres/page.tsx`, debajo de la línea `<p className="text-sm text-neutral-600">{c.totalUnidades} productos</p>`:

```tsx
          {c.totalAlquileres > 0 && (
            <p className="text-sm text-neutral-600">
              Incluye {money(c.totalAlquileres)} de alquileres
              {c.porArticulo.length > 0 && ` · ${c.porArticulo.map((a) => `${a.nombre} ×${a.unidades}`).join(' · ')}`}
            </p>
          )}
```

- [ ] **Step 11: Verificar el frontend**

Run: `cd frontend && pnpm build`
Expected: build exitoso, sin errores de tipos.

- [ ] **Step 12: Commit**

```bash
git add backend/src/services/buffetCaja.service.ts backend/tests/integration/alquiler-caja.test.ts frontend/src/lib/types.ts "frontend/src/app/(panel)/buffet/cierres/page.tsx"
git commit -m "feat(alquileres): la plata del alquiler suma a la caja y al cierre"
```

---

### Task 7: Pantalla del mostrador

**Files:**
- Create: `frontend/src/lib/alquiler-actions.ts`
- Create: `frontend/src/components/mostrador/pantalla-alquileres.tsx`
- Create: `frontend/src/components/mostrador/pantalla-alquileres.test.tsx`
- Create: `frontend/src/app/mostrador/alquileres/page.tsx`
- Modify: `frontend/src/components/mostrador/pantalla-venta.tsx`
- Modify: `frontend/src/lib/types.ts`

**Interfaces:**
- Consumes: `GET /alquileres/botonera`, `GET /alquileres/afuera`, `POST /alquileres/entregas`, `POST /alquileres/:id/cerrar` (Task 5); `buffetFetch` y `Resultado<T>` que ya existen.
- Produces:
  ```ts
  // types.ts
  export interface ArticuloAlquiler { id: string; nombre: string; precio: number; stock: number; prestado: number; disponible: number; activo: boolean; orden: number }
  export type EstadoAlquiler = 'ENTREGADO' | 'DEVUELTO' | 'PERDIDO' | 'ROTO';
  export interface Alquiler { id: string; articuloId: string; articuloNombre: string; cantidad: number; quienRetira: string; garantia: string | null; precioUnit: number; total: number; medioPago: MedioPago; estado: EstadoAlquiler; entregadoEn: string; cerradoEn: string | null }
  // pantalla-alquileres.tsx
  export function calcularTotalAlquiler(precio: number, cantidad: number): number;
  export function puedeEntregar(a: { disponible: number }, cantidad: number): boolean;
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/components/mostrador/pantalla-alquileres.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { calcularTotalAlquiler, puedeEntregar } from './pantalla-alquileres';

describe('calcularTotalAlquiler', () => {
  it('multiplica precio por cantidad', () => { expect(calcularTotalAlquiler(3000, 2)).toBe(6000); });
  it('trata vacío/NaN como 0', () => { expect(calcularTotalAlquiler(3000, NaN)).toBe(0); });
  it('nunca es negativo', () => { expect(calcularTotalAlquiler(3000, -1)).toBe(0); });
});

describe('puedeEntregar', () => {
  it('deja entregar hasta el disponible', () => {
    expect(puedeEntregar({ disponible: 2 }, 2)).toBe(true);
  });
  it('no deja pasarse del disponible', () => {
    expect(puedeEntregar({ disponible: 2 }, 3)).toBe(false);
  });
  it('no deja entregar cero', () => {
    expect(puedeEntregar({ disponible: 5 }, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd frontend && npx vitest run src/components/mostrador/pantalla-alquileres.test.tsx`
Expected: FAIL — no existe el módulo `./pantalla-alquileres`.

- [ ] **Step 3: Agregar los tipos**

En `frontend/src/lib/types.ts`, al final:

```ts
export interface ArticuloAlquiler {
  id: string; nombre: string; precio: number;
  stock: number; prestado: number; disponible: number;
  activo: boolean; orden: number;
}
export type EstadoAlquiler = 'ENTREGADO' | 'DEVUELTO' | 'PERDIDO' | 'ROTO';
export type EstadoCierreAlquiler = Exclude<EstadoAlquiler, 'ENTREGADO'>;
export interface Alquiler {
  id: string; articuloId: string; articuloNombre: string; cantidad: number;
  quienRetira: string; garantia: string | null;
  precioUnit: number; total: number; medioPago: MedioPago;
  estado: EstadoAlquiler; entregadoEn: string; cerradoEn: string | null;
}
export interface EntregaAlquilerResultado { alquiler: Alquiler; vuelto: number }
```

- [ ] **Step 4: Escribir las server actions**

Crear `frontend/src/lib/alquiler-actions.ts`:

```ts
'use server';
import { buffetFetch } from './buffet-api';
import { requireSesionBuffet } from './buffet-session';
import { ApiError } from './types';
import type { Alquiler, EntregaAlquilerResultado, EstadoCierreAlquiler, MedioPago } from './types';
import type { Resultado } from './buffet-actions';

async function conSesion<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    await requireSesionBuffet();
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

export async function entregarAlquiler(input: {
  uid: string; articuloId: string; cantidad: number;
  quienRetira: string; garantia: string | null;
  medioPago: MedioPago; montoPagado: number;
}): Promise<Resultado<EntregaAlquilerResultado>> {
  return conSesion(() => buffetFetch<EntregaAlquilerResultado>('/alquileres/entregas', {
    method: 'POST', body: JSON.stringify(input),
  }));
}

export async function cerrarAlquiler(id: string, estado: EstadoCierreAlquiler): Promise<Resultado<Alquiler>> {
  return conSesion(() => buffetFetch<Alquiler>(`/alquileres/${encodeURIComponent(id)}/cerrar`, {
    method: 'POST', body: JSON.stringify({ estado }),
  }));
}
```

- [ ] **Step 5: Escribir el componente**

Crear `frontend/src/components/mostrador/pantalla-alquileres.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Alquiler, ArticuloAlquiler, EstadoCierreAlquiler, MedioPago } from '@/lib/types';
import { entregarAlquiler, cerrarAlquiler } from '@/lib/alquiler-actions';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Total del alquiler. Un NaN de un input vacío vale 0, no rompe la pantalla. */
export function calcularTotalAlquiler(precio: number, cantidad: number): number {
  const total = Number(precio) * Number(cantidad);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/** Si se puede entregar esa cantidad: al menos una, y nunca más de lo que hay. */
export function puedeEntregar(a: { disponible: number }, cantidad: number): boolean {
  return Number.isFinite(cantidad) && cantidad >= 1 && cantidad <= a.disponible;
}

export function PantallaAlquileres({
  articulos, afuera,
}: { articulos: ArticuloAlquiler[]; afuera: Alquiler[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<ArticuloAlquiler | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [quienRetira, setQuienRetira] = useState('');
  const [garantia, setGarantia] = useState('');
  const [medioPago, setMedioPago] = useState<MedioPago>('EFECTIVO');
  const [montoPagado, setMontoPagado] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = sel ? calcularTotalAlquiler(sel.precio, Number(cantidad)) : 0;

  function limpiar() {
    setSel(null); setCantidad('1'); setQuienRetira(''); setGarantia(''); setMontoPagado(''); setMedioPago('EFECTIVO');
  }

  async function confirmar() {
    if (!sel) return;
    if (!puedeEntregar(sel, Number(cantidad))) { setError(`Solo quedan ${sel.disponible}`); return; }
    if (!quienRetira.trim()) { setError('Poné a nombre de quién sale'); return; }
    setOcupado(true); setError(null);
    // El uid hace idempotente el cobro: si el toque se repite o la red reintenta, el backend
    // devuelve el mismo alquiler en vez de prestar otra raqueta.
    const r = await entregarAlquiler({
      uid: crypto.randomUUID(), articuloId: sel.id, cantidad: Number(cantidad),
      quienRetira: quienRetira.trim(), garantia: garantia.trim() || null,
      medioPago, montoPagado: medioPago === 'EFECTIVO' ? Number(montoPagado) || 0 : 0,
    });
    setOcupado(false);
    if (!r.ok) { setError(r.error); return; }
    limpiar();
    router.refresh();
  }

  async function cerrar(a: Alquiler, estado: EstadoCierreAlquiler) {
    setOcupado(true); setError(null);
    const r = await cerrarAlquiler(a.id, estado);
    setOcupado(false);
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Alquileres</h1>
        <a href="/mostrador" className="rounded-lg border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700">
          Volver al mostrador
        </a>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-3 text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-neutral-500">Entregar</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {articulos.map((a) => (
            <button
              key={a.id} type="button" disabled={a.disponible < 1}
              onClick={() => { setSel(a); setCantidad('1'); }}
              className={`rounded-2xl p-4 text-left ${
                sel?.id === a.id ? 'bg-emerald-600 text-white' : 'border bg-white'
              } ${a.disponible < 1 ? 'opacity-40' : ''}`}
            >
              <span className="block font-semibold">{a.nombre}</span>
              <span className="block text-sm">{money(a.precio)}</span>
              <span className="block text-xs">quedan {a.disponible}</span>
            </button>
          ))}
        </div>

        {sel && (
          <div className="space-y-3 rounded-2xl border bg-white p-4">
            <div className="flex flex-wrap gap-3">
              <label className="text-sm">Cantidad
                <input type="number" min="1" max={sel.disponible} value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  className="ml-2 w-20 rounded-lg border px-2 py-1" />
              </label>
              <label className="text-sm flex-1">Quién retira
                <input value={quienRetira} onChange={(e) => setQuienRetira(e.target.value)}
                  className="ml-2 w-full max-w-xs rounded-lg border px-2 py-1" placeholder="Nombre" />
              </label>
              <label className="text-sm flex-1">Garantía
                <input value={garantia} onChange={(e) => setGarantia(e.target.value)}
                  className="ml-2 w-full max-w-xs rounded-lg border px-2 py-1" placeholder="DNI, llaves…" />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['EFECTIVO', 'TRANSFERENCIA'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMedioPago(m)}
                  className={`rounded-xl px-4 py-2 font-semibold ${medioPago === m ? 'bg-neutral-900 text-white' : 'border'}`}>
                  {m === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}
                </button>
              ))}
              {medioPago === 'EFECTIVO' && (
                <input type="number" value={montoPagado} onChange={(e) => setMontoPagado(e.target.value)}
                  placeholder="Con cuánto paga" className="w-40 rounded-lg border px-2 py-1" />
              )}
              <span className="ml-auto text-lg font-semibold tabular-nums">{money(total)}</span>
            </div>

            <button type="button" disabled={ocupado} onClick={() => void confirmar()}
              className="h-14 w-full rounded-2xl bg-emerald-600 text-xl font-semibold text-white active:scale-95">
              Entregar y cobrar
            </button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase text-neutral-500">Afuera ({afuera.length})</h2>
        {afuera.length === 0 ? (
          <p className="rounded-xl border bg-white p-4 text-sm text-neutral-600">No hay nada prestado.</p>
        ) : afuera.map((a) => (
          <article key={a.id} className="rounded-xl border bg-white p-3">
            <p className="font-medium">
              {a.articuloNombre} ×{a.cantidad} · {a.quienRetira}
              {a.garantia && <span className="ml-2 text-sm text-neutral-600">garantía: {a.garantia}</span>}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={ocupado} onClick={() => void cerrar(a, 'DEVUELTO')}
                className="rounded-lg bg-emerald-600 px-3 py-1 font-semibold text-white">Devuelto</button>
              <button type="button" disabled={ocupado} onClick={() => void cerrar(a, 'ROTO')}
                className="rounded-lg border border-amber-600 px-3 py-1 font-semibold text-amber-700">Roto</button>
              <button type="button" disabled={ocupado} onClick={() => void cerrar(a, 'PERDIDO')}
                className="rounded-lg border border-red-600 px-3 py-1 font-semibold text-red-700">Perdido</button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd frontend && npx vitest run src/components/mostrador/pantalla-alquileres.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 7: Escribir la página**

Crear `frontend/src/app/mostrador/alquileres/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { mostradorDeSesion, manejarBuffetNoAutorizado } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { Alquiler, ArticuloAlquiler } from '@/lib/types';
import { PantallaAlquileres } from '@/components/mostrador/pantalla-alquileres';

export default async function MostradorAlquileresPage() {
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');
  // El backend ya rechaza al secundario con 403; esto evita renderizarle una pantalla que solo
  // sabría mostrar el error.
  if (mostrador.tipo !== 'PRINCIPAL') redirect('/mostrador');

  let articulos: ArticuloAlquiler[]; let afuera: Alquiler[];
  try {
    [articulos, afuera] = await Promise.all([
      buffetFetch<ArticuloAlquiler[]>('/alquileres/botonera'),
      buffetFetch<Alquiler[]>('/alquileres/afuera'),
    ]);
  } catch (e) {
    await manejarBuffetNoAutorizado(e);
    throw e;
  }

  return <PantallaAlquileres articulos={articulos} afuera={afuera} />;
}
```

- [ ] **Step 8: Enlazar desde la pantalla de venta**

En `frontend/src/components/mostrador/pantalla-venta.tsx`, dentro del bloque `{mostrador.tipo === 'PRINCIPAL' && (`, después del link "Entregar al secundario":

```tsx
          <a href="/mostrador/alquileres" className="rounded-xl border border-sky-600 px-4 py-2 font-semibold text-sky-700">
            Alquileres
          </a>
```

- [ ] **Step 9: Mostrar el total de alquileres en la caja**

En el mismo archivo, justo debajo de la línea que muestra el desglose de la caja abierta
(`<p className="mt-1 text-sm text-emerald-700">Efectivo {money(caja.totalEfectivo)} · Transferencia {money(caja.totalTransferencia)}</p>`,
alrededor de la línea 207), agregar:

```tsx
        {caja.totalAlquileres > 0 && (
          <p className="mt-1 text-sm text-emerald-700">Incluye {money(caja.totalAlquileres)} de alquileres</p>
        )}
```

El helper `money` ya existe en ese archivo (línea 8), no hace falta declararlo.

- [ ] **Step 10: Verificar el build**

Run: `cd frontend && pnpm build && pnpm lint`
Expected: build y lint sin errores.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/lib/alquiler-actions.ts frontend/src/lib/types.ts frontend/src/components/mostrador/pantalla-alquileres.tsx frontend/src/components/mostrador/pantalla-alquileres.test.tsx frontend/src/app/mostrador/alquileres frontend/src/components/mostrador/pantalla-venta.tsx
git commit -m "feat(alquileres): pantalla de entrega y devolucion en el mostrador"
```

---

### Task 8: Panel de administración

**Files:**
- Create: `frontend/src/lib/alquiler-admin-actions.ts`
- Create: `frontend/src/components/alquileres/sub-nav.tsx`
- Create: `frontend/src/components/alquileres/articulos-table.tsx`
- Create: `frontend/src/components/alquileres/articulo-dialog.tsx`
- Create: `frontend/src/app/(panel)/alquileres/page.tsx`
- Create: `frontend/src/app/(panel)/alquileres/movimientos/page.tsx`
- Modify: `frontend/src/components/nav-items.ts`

**Interfaces:**
- Consumes: `GET /alquileres/articulos`, `POST /alquileres/articulos`, `PATCH /alquileres/articulos/:id`, `POST /alquileres/articulos/:id/reponer`, `GET /alquileres?desde&hasta&estado` (Task 5); los tipos `ArticuloAlquiler` y `Alquiler` (Task 7).
- Produces: las páginas `/alquileres` y `/alquileres/movimientos`, y las actions `crearArticulo`, `actualizarArticulo`, `ajustarStockArticulo`, todas devolviendo `{ ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Escribir las server actions**

Crear `frontend/src/lib/alquiler-admin-actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath('/alquileres');
    revalidatePath('/alquileres/movimientos');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
}

type ArticuloInput = { nombre: string; precio: number; stock?: number; orden?: number; activo?: boolean };

export async function crearArticulo(i: ArticuloInput): Promise<Result> {
  return run(() => apiFetch('/alquileres/articulos', { method: 'POST', body: JSON.stringify(i) }));
}

export async function actualizarArticulo(id: string, i: Partial<ArticuloInput>): Promise<Result> {
  return run(() => apiFetch(`/alquileres/articulos/${id}`, { method: 'PATCH', body: JSON.stringify(i) }));
}

/** `cantidad` puede ser negativa: sirve para dar de baja una unidad rota sin alquiler de por medio. */
export async function ajustarStockArticulo(id: string, cantidad: number): Promise<Result> {
  return run(() => apiFetch(`/alquileres/articulos/${id}/reponer`, { method: 'POST', body: JSON.stringify({ cantidad }) }));
}
```

- [ ] **Step 2: Escribir el sub-nav**

Crear `frontend/src/components/alquileres/sub-nav.tsx`:

```tsx
import Link from 'next/link';

const PAGINAS = [
  { clave: 'catalogo', href: '/alquileres', label: 'Artículos' },
  { clave: 'movimientos', href: '/alquileres/movimientos', label: 'Movimientos' },
] as const;

export type PaginaAlquileres = (typeof PAGINAS)[number]['clave'];

export function SubNavAlquileres({ activa }: { activa: PaginaAlquileres }) {
  return (
    <nav className="flex flex-wrap gap-2">
      {PAGINAS.map((p) => (
        <Link key={p.clave} href={p.href}
          className={`rounded-lg px-3 py-1 text-sm font-medium ${
            p.clave === activa ? 'bg-neutral-900 text-white' : 'border text-neutral-700'
          }`}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Escribir el diálogo de alta y edición**

Crear `frontend/src/components/alquileres/articulo-dialog.tsx`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ArticuloAlquiler } from '@/lib/types';
import { crearArticulo, actualizarArticulo } from '@/lib/alquiler-admin-actions';

export function ArticuloDialog({
  open, onOpenChange, articulo,
}: { open: boolean; onOpenChange: (o: boolean) => void; articulo: ArticuloAlquiler | null }) {
  const [nombre, setNombre] = useState(articulo?.nombre ?? '');
  const [precio, setPrecio] = useState(articulo ? String(Number(articulo.precio)) : '');
  const [stockInicial, setStockInicial] = useState('0');
  const [activo, setActivo] = useState(articulo?.activo ?? true);
  const [pending, start] = useTransition();
  const editando = !!articulo;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNombre(articulo?.nombre ?? '');
      setPrecio(articulo ? String(Number(articulo.precio)) : '');
      setStockInicial('0');
      setActivo(articulo?.activo ?? true);
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    if (!nombre.trim()) { toast.error('Ingresá el nombre'); return; }
    const precioNum = Number(precio);
    if (!precioNum || precioNum <= 0) { toast.error('El precio debe ser mayor a 0'); return; }
    // El stock solo se carga al crear: después se mueve por "Ajustar stock", que es el único
    // camino que respeta lo que está prestado.
    const input = { nombre: nombre.trim(), precio: precioNum, activo, ...(editando ? {} : { stock: Number(stockInicial) || 0 }) };
    start(async () => {
      const r = editando ? await actualizarArticulo(articulo!.id, input) : await crearArticulo(input);
      if (r.ok) { toast.success(editando ? 'Artículo actualizado' : 'Artículo creado'); onOpenChange(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editando ? 'Editar artículo' : 'Nuevo artículo'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="aa-nombre">Nombre</Label>
            <Input id="aa-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Raqueta de pádel" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aa-precio">Precio del alquiler</Label>
            <Input id="aa-precio" type="number" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </div>
          {!editando && (
            <div className="space-y-1">
              <Label htmlFor="aa-stock">Unidades que hay</Label>
              <Input id="aa-stock" type="number" min="0" value={stockInicial} onChange={(e) => setStockInicial(e.target.value)} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo (aparece en el mostrador)
          </label>
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={submit}>{editando ? 'Guardar' : 'Crear'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Escribir la tabla del catálogo**

Crear `frontend/src/components/alquileres/articulos-table.tsx`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ArticuloAlquiler } from '@/lib/types';
import { ArticuloDialog } from './articulo-dialog';
import { ajustarStockArticulo } from '@/lib/alquiler-admin-actions';

const money = (n: number | string) => '$' + Number(n || 0).toLocaleString('es-AR');

export function ArticulosTable({ articulos }: { articulos: ArticuloAlquiler[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<ArticuloAlquiler | null>(null);
  const [seleccion, setSeleccion] = useState<ArticuloAlquiler | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [pending, start] = useTransition();

  function ajustar() {
    if (!seleccion) return;
    const n = Number(cantidad);
    if (!n) { toast.error('Ingresá una cantidad distinta de 0'); return; }
    start(async () => {
      const r = await ajustarStockArticulo(seleccion.id, n);
      if (r.ok) { toast.success('Stock ajustado'); setSeleccion(null); }
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-end">
        <Button onClick={() => { setEditando(null); setDialogOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Nuevo artículo
        </Button>
      </div>

      {articulos.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay artículos todavía.</p>
      ) : (
        <>
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead><TableHead>Precio</TableHead>
                  <TableHead>Disponible</TableHead><TableHead>Afuera</TableHead><TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articulos.map((a) => (
                  <TableRow key={a.id} onClick={() => { setCantidad(''); setSeleccion(a); }}
                    className={`cursor-pointer hover:bg-neutral-50 ${a.activo ? '' : 'opacity-60'}`}>
                    <TableCell className="font-medium">{a.nombre}</TableCell>
                    <TableCell>{money(a.precio)}</TableCell>
                    <TableCell className={a.disponible === 0 ? 'font-medium text-red-600' : ''}>{a.disponible}</TableCell>
                    <TableCell className="text-neutral-600">{a.prestado}</TableCell>
                    <TableCell className="text-neutral-600">{a.stock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {articulos.map((a) => (
              <button key={a.id} type="button" onClick={() => { setCantidad(''); setSeleccion(a); }}
                className={`block w-full rounded-lg border bg-white p-3 text-left${a.activo ? '' : ' opacity-60'}`}>
                <span className="block text-sm font-medium">{a.nombre}</span>
                <span className="mt-1 block text-sm text-neutral-600">
                  {money(a.precio)} · {a.disponible} disponibles · {a.prestado} afuera
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <Sheet open={seleccion !== null} onOpenChange={(o) => { if (!o) setSeleccion(null); }}>
        {seleccion && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{seleccion.nombre}</SheetTitle>
              <p className="text-sm text-neutral-600">
                {money(seleccion.precio)} · {seleccion.disponible} disponibles · {seleccion.prestado} afuera
              </p>
            </SheetHeader>
            <div className="flex flex-col gap-3">
              <Button className="h-11 w-full" disabled={pending}
                onClick={() => { setSeleccion(null); setEditando(seleccion); setDialogOpen(true); }}>
                Editar
              </Button>
              <div className="space-y-1">
                <Label htmlFor="aa-ajuste">Ajustar stock (negativo para dar de baja)</Label>
                <div className="flex gap-2">
                  <Input id="aa-ajuste" type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="+3 / -1" />
                  <Button variant="outline" disabled={pending} onClick={ajustar}>Ajustar</Button>
                </div>
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>

      <ArticuloDialog key={editando?.id ?? 'new'} open={dialogOpen} onOpenChange={setDialogOpen} articulo={editando} />
    </>
  );
}
```

- [ ] **Step 5: Escribir la página del catálogo**

Crear `frontend/src/app/(panel)/alquileres/page.tsx`:

```tsx
import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { ArticuloAlquiler } from '@/lib/types';
import { ArticulosTable } from '@/components/alquileres/articulos-table';
import { SubNavAlquileres } from '@/components/alquileres/sub-nav';

export default async function AlquileresPage() {
  await requireAdmin();
  const articulos = await apiFetch<ArticuloAlquiler[]>('/alquileres/articulos');
  const sinStock = articulos.filter((a) => a.activo && a.disponible === 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Alquileres</h1>
        <p className="text-sm text-neutral-600">Artículos e inventario</p>
      </header>
      <SubNavAlquileres activa="catalogo" />

      {sinStock.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="font-medium text-amber-900">Sin disponibilidad ({sinStock.length})</p>
          <p className="mt-1 text-sm text-amber-800">{sinStock.map((a) => a.nombre).join(' · ')}</p>
        </div>
      )}

      <ArticulosTable articulos={articulos} />
    </div>
  );
}
```

- [ ] **Step 6: Escribir la página de movimientos**

Crear `frontend/src/app/(panel)/alquileres/movimientos/page.tsx`:

```tsx
import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Alquiler, EstadoAlquiler } from '@/lib/types';
import { SubNavAlquileres } from '@/components/alquileres/sub-nav';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

const FILTROS: { clave: '' | EstadoAlquiler; label: string }[] = [
  { clave: '', label: 'Todos' },
  { clave: 'ENTREGADO', label: 'Afuera' },
  { clave: 'DEVUELTO', label: 'Devueltos' },
  { clave: 'PERDIDO', label: 'Perdidos' },
  { clave: 'ROTO', label: 'Rotos' },
];

export default async function MovimientosAlquileresPage({
  searchParams,
}: { searchParams: Promise<{ desde?: string; hasta?: string; estado?: EstadoAlquiler }> }) {
  await requireAdmin();
  const { desde, hasta, estado } = await searchParams;
  const qs = new URLSearchParams();
  if (desde) qs.set('desde', desde);
  if (hasta) qs.set('hasta', hasta);
  if (estado) qs.set('estado', estado);
  const movimientos = await apiFetch<Alquiler[]>(`/alquileres${qs.size ? `?${qs}` : ''}`);

  const afuera = movimientos.filter((m) => m.estado === 'ENTREGADO');
  const perdidos = movimientos.filter((m) => m.estado === 'PERDIDO' || m.estado === 'ROTO');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Movimientos de alquileres</h1>
      </header>
      <SubNavAlquileres activa="movimientos" />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-neutral-600">Afuera ahora</p>
          <p className="text-2xl font-semibold tabular-nums">{afuera.length}</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-neutral-600">Perdidos o rotos</p>
          <p className="text-2xl font-semibold tabular-nums">{perdidos.length}</p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
        <label className="text-sm">Desde
          <input type="date" name="desde" defaultValue={desde} className="ml-2 rounded-lg border px-2 py-1" />
        </label>
        <label className="text-sm">Hasta
          <input type="date" name="hasta" defaultValue={hasta} className="ml-2 rounded-lg border px-2 py-1" />
        </label>
        <select name="estado" defaultValue={estado ?? ''} className="rounded-lg border px-2 py-1 text-sm">
          {FILTROS.map((f) => <option key={f.clave} value={f.clave}>{f.label}</option>)}
        </select>
        <button type="submit" className="rounded-lg bg-neutral-900 px-3 py-1 text-sm font-medium text-white">Filtrar</button>
      </form>

      {movimientos.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay movimientos para ese filtro.</p>
      ) : (
        <div className="space-y-2">
          {movimientos.map((m) => (
            <article key={m.id} className="rounded-xl border bg-white p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{m.articuloNombre} ×{m.cantidad}</span>
                <span className="tabular-nums">{money(m.total)}</span>
              </div>
              <p className="text-sm text-neutral-600">
                {m.quienRetira} · {fmt(m.entregadoEn)} · {m.estado.toLowerCase()}
                {m.garantia && ` · garantía: ${m.garantia}`}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Agregar la entrada al menú**

En `frontend/src/components/nav-items.ts`, agregar `Handshake` a los iconos importados de `lucide-react` y esta línea al array `nav`, justo después de la de Buffet:

```ts
  { href: '/alquileres', label: 'Alquileres', icon: Handshake, roles: SOLO_ADMIN, grupo: 'Operación' },
```

- [ ] **Step 8: Verificar el build y el lint**

Run: `cd frontend && pnpm build && pnpm lint && pnpm test`
Expected: todo verde.

- [ ] **Step 9: Correr la suite completa del backend**

Run: `cd backend && npm test`
Expected: todo verde, incluidos los tests de buffet que existían antes.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/alquiler-admin-actions.ts frontend/src/components/alquileres "frontend/src/app/(panel)/alquileres" frontend/src/components/nav-items.ts
git commit -m "feat(alquileres): panel de articulos y de movimientos"
```

---

## Notas de verificación final

Antes de dar el módulo por terminado, confirmar con la salida a la vista:

1. `cd backend && npm test` — verde, sin tests de buffet rotos.
2. `cd backend && npm run typecheck` — sin errores.
3. `cd frontend && pnpm build && pnpm lint && pnpm test` — verde.
4. Un cierre de caja del principal con alquileres: el total del cierre incluye la plata del alquiler y la conciliación del secundario sigue dando lo mismo que antes del módulo.

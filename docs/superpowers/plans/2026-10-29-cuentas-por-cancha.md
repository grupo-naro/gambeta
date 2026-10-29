# Cuentas por cancha en el buffet — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el mostrador del buffet pueda abrir una cuenta por cancha, sumar consumos durante el turno (descontando stock en el momento) y rendirla al final con un único cobro.

**Architecture:** Dos modelos nuevos (`CuentaBuffet`, `CuentaBuffetLinea`) y un servicio `buffetCuenta.service.ts` que reutiliza la lógica de stock y de pago de `buffetCaja.service.ts` (extraída a helpers compartidos). Al rendir se crea un `TicketBuffet` normal en la caja abierta, así que caja, cierre y totales no cambian. Frontend: dos pantallas nuevas bajo `/mostrador/cuentas` y una lista de solo lectura para el admin en `/buffet/cuentas`.

**Tech Stack:** Express 5 + Prisma 7 + zod + vitest (backend, npm); Next.js 16 App Router + Tailwind v4 (frontend, pnpm).

**Spec:** `docs/superpowers/specs/2026-10-29-cuentas-por-cancha-design.md`

## Global Constraints

- Código, comentarios y vocabulario en español: `cuenta`, `cancha`, `consumo`, `rendir`, `impaga`, `mostrador`.
- Capas del backend: `routes/ → services/ → repositories/ → db/prisma.ts`. Errores solo con las fábricas de `src/utils/errors.ts` (`BadRequest`, `NotFound`, `Conflict`, `BusinessRule`, `Forbidden`).
- Prisma 7: importar tipos desde `src/db/client.ts`, el cliente desde `src/db/prisma.ts`; correr `npx prisma generate` tras editar el schema; la config vive en `prisma.config.ts`.
- La migración es **aditiva**: no toca tablas existentes. Nombre: `20261029120000_cuentas_buffet`.
- Un mostrador solo ve y modifica las cuentas que abrió. El admin las ve todas en **solo lectura** (JWT, rol ADMIN). Rutas de mostrador con `authMostrador`; la de admin con `authJwt` + `requireRole('ADMIN')`.
- El stock se **descuenta al sumar** el consumo y **se devuelve al quitarlo**; **rendir no vuelve a descontar**. El principal descuenta de `ProductoBuffet.stock`; el secundario de `StockMostrador` (con el CHECK `StockMostrador_cantidad_no_negativa` ya existente).
- Un mostrador no puede cerrar su caja con cuentas `ABIERTA`.
- Los `'use server'` del frontend solo exportan funciones `async`.
- Tests de integración (Testcontainers) requieren Docker; los unitarios se corren con `npx vitest run -c vitest.unit.config.ts`. Los archivos del repo son CRLF.

## Review Focus

1. Doble toque en **Rendir** (o reintento de red): un solo ticket, un solo cobro, mismo resultado en la segunda llamada.
2. Rendir con la **caja cerrada**: 409, la cuenta sigue `ABIERTA` y el stock no cambia.
3. El **secundario** suma más de lo que tiene asignado: error de negocio y la cuenta queda igual (ni línea ni stock tocados).
4. Un mostrador intenta ver o modificar la cuenta de **otro mostrador**: `NotFound`, sin filtrar su existencia.
5. Rendir una cuenta **vacía**: error; hay que cancelarla.
6. Un producto se **desactiva** o cambia de precio con la cuenta abierta: rendir usa el `precioUnit` guardado en la línea y no falla.
7. Cantidad **negativa, no entera o enorme** al fijar un consumo: rechazada por el validador.

---

### Task 1: Modelos, migración y limpieza de tests

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20261029120000_cuentas_buffet/migration.sql`
- Modify: `backend/tests/helpers/db.ts` (`resetTables`)

**Interfaces:**
- Produces: modelos Prisma `CuentaBuffet` y `CuentaBuffetLinea`, enum `EstadoCuentaBuffet` (`ABIERTA | RENDIDA | CANCELADA | IMPAGA`).

- [ ] **Step 1:** En `schema.prisma` agregar el enum y los modelos. `CuentaBuffet`: `id`, `mostradorId`→`Mostrador`, `canchaId`→`Cancha`, `reservaId String?`→`Reserva`, `estado` (default `ABIERTA`), `abiertaEn` (default now), `cerradaEn DateTime?`, `cajaId String?`→`CajaBuffet` (caja en la que se resolvió), `ticketId String? @unique`→`TicketBuffet`, `total Decimal? @db.Decimal(10,2)`, `lineas`; índices `[mostradorId, estado]` y `[canchaId]`. `CuentaBuffetLinea`: `id`, `cuentaId`→`CuentaBuffet` (`onDelete: Cascade`), `productoId`→`ProductoBuffet`, `precioUnit Decimal @db.Decimal(10,2)`, `cantidad Int`, `@@unique([cuentaId, productoId])`. Agregar los campos inversos en `Mostrador`, `Cancha`, `Reserva`, `CajaBuffet`, `TicketBuffet` y `ProductoBuffet`.
- [ ] **Step 2:** Generar la migración con `npx prisma migrate dev --create-only --name cuentas_buffet` (o escribir el SQL a mano si no hay base) y editar `migration.sql` para agregar: `CHECK ("cantidad" > 0)` en `CuentaBuffetLinea`, y el índice único parcial `CREATE UNIQUE INDEX "CuentaBuffet_canchaId_abierta_key" ON "CuentaBuffet"("canchaId") WHERE "estado" = 'ABIERTA';` (una cancha, una cuenta abierta).
- [ ] **Step 3:** En `resetTables()` borrar `cuentaBuffetLinea` y `cuentaBuffet` **antes** de `ticketBuffet`, `cajaBuffet` y las canchas/reservas, respetando el orden de FKs ya existente.
- [ ] **Step 4:** Run: `cd backend && npx prisma generate && npm run typecheck`. Expected: sin errores.
- [ ] **Step 5: Commit** — `feat(buffet): modelos de cuentas por cancha`.

---

### Task 2: Helpers compartidos de stock y de pago

**Files:**
- Create: `backend/src/services/buffetStock.ts`
- Modify: `backend/src/services/buffetCaja.service.ts` (`cobrar` usa los helpers)
- Test: `backend/tests/unit/buffetPago.test.ts`

**Interfaces:**
- Produces:
  - `calcularPago(medioPago: 'EFECTIVO' | 'TRANSFERENCIA', montoPagado: number, total: number): { montoPagado: number; vuelto: number }` — efectivo con `montoPagado < total` lanza `BusinessRule('El monto pagado es menor al total')`; transferencia devuelve `{ montoPagado: total, vuelto: 0 }`.
  - `descontarStock(tx: Prisma.TransactionClient, mostrador: { id: string; tipo: 'PRINCIPAL' | 'SECUNDARIO' }, producto: { id: string; nombre: string }, cantidad: number): Promise<void>` — principal decrementa `ProductoBuffet.stock`; secundario decrementa `StockMostrador` y, si no alcanza, lanza el mismo `BusinessRule('No tenés stock asignado de <nombre>. Pedile al mostrador principal que te entregue.')`.
  - `devolverStock(tx, mostrador, productoId: string, cantidad: number): Promise<void>` — suma a donde `descontarStock` restó.
  - `esViolacionStockAsignadoNegativo(e: unknown): boolean` (movida desde `buffetCaja.service.ts`, exportada).

- [ ] **Step 1: Write the failing test** `buffetPago.test.ts`: efectivo con `calcularPago('EFECTIVO', 5000, 3000)` → `{ montoPagado: 5000, vuelto: 2000 }`; `calcularPago('EFECTIVO', 2000, 3000)` lanza `BusinessRule` con el mensaje exacto; `calcularPago('TRANSFERENCIA', 0, 3000)` → `{ montoPagado: 3000, vuelto: 0 }`.
- [ ] **Step 2:** Run `npx vitest run -c vitest.unit.config.ts tests/unit/buffetPago.test.ts`. Expected: FAIL (no existe).
- [ ] **Step 3:** Crear `buffetStock.ts` con las cuatro funciones; mover ahí la lógica de stock y de pago hoy inline en `cobrar` (mismos mensajes y mismo manejo del CHECK). Refactorizar `cobrar` para usarlas **sin cambiar su comportamiento**.
- [ ] **Step 4:** Run el test unitario (PASS), `npm run typecheck`, y `npx vitest run tests/integration/buffet-cobro.test.ts tests/integration/buffet-venta-secundario.test.ts` en una máquina con Docker. Expected: todo en verde, sin cambios de comportamiento.
- [ ] **Step 5: Commit** — `refactor(buffet): extraer helpers de stock y de pago del cobro`.

---

### Task 3: Servicio de cuentas — abrir, consumos, cancelar, impaga

**Files:**
- Create: `backend/src/services/buffetCuenta.service.ts`
- Test: `backend/tests/integration/buffet-cuenta.test.ts`

**Interfaces:**
- Consumes (Task 2): `descontarStock`, `devolverStock`, `esViolacionStockAsignadoNegativo`; `cajaAbierta(mostradorId)` ya exportada de `buffetCaja.service.ts`.
- Produces:
  - `interface CuentaLineaDTO { productoId: string; nombre: string; cantidad: number; precioUnit: number; subtotal: number }`
  - `interface CuentaDTO { id: string; canchaId: string; canchaNombre: string; estado: 'ABIERTA'|'RENDIDA'|'CANCELADA'|'IMPAGA'; abiertaEn: string; cerradaEn: string | null; reserva: { clienteNombre: string; horaInicio: string; horaFin: string } | null; total: number; lineas: CuentaLineaDTO[] }`
  - `buffetCuentaService.abrir(mostradorId: string, canchaId: string): Promise<CuentaDTO>` — `NotFound` si la cancha no existe o está inactiva; `Conflict` si ya hay una `ABIERTA` en esa cancha (también por la carrera del índice único parcial); enlaza la reserva de esa cancha en curso (`CONFIRMADA`/`ESPERANDO_SENA`/`COMPLETADA` con `fechaInicio <= ahora < fechaFin`), si hay.
  - `listarAbiertas(mostradorId): Promise<CuentaDTO[]>`; `detalle(mostradorId, cuentaId): Promise<CuentaDTO>` (`NotFound` si es de otro mostrador).
  - `fijarCantidad(mostradorId, cuentaId, productoId: string, cantidad: number): Promise<CuentaDTO>` — fija la cantidad **absoluta** (0 quita la línea; así reintentar es idempotente). Solo cuenta `ABIERTA` (`Conflict` si no). Descuenta o devuelve la **diferencia** de stock en la misma transacción. Al crear la línea guarda el `precioUnit` actual del producto; producto inexistente/inactivo → `NotFound`/`BusinessRule` solo al **agregar** o subir cantidad.
  - `cancelar(mostradorId, cuentaId): Promise<CuentaDTO>` — `ABIERTA` → `CANCELADA`, devuelve todo el stock; llamarla sobre una ya `CANCELADA` devuelve la cuenta sin error.
  - `darPorImpaga(mostradorId, cuentaId): Promise<CuentaDTO>` — `ABIERTA` → `IMPAGA`: guarda `total`, `cerradaEn` y `cajaId` (la caja abierta del mostrador, `Conflict` si no hay), el stock queda descontado; idempotente sobre una ya `IMPAGA`.

- [ ] **Step 1: Write the failing tests** (`buffet-cuenta.test.ts`, mismo armado que `buffet-cobro.test.ts` con `sembrar()` y token de mostrador): abre una cuenta; segunda apertura en la misma cancha → 409; `fijarCantidad` 3 de un producto con stock 10 deja stock 7 y total correcto; bajar a 1 devuelve stock a 9; fijar 0 quita la línea y devuelve todo; `cancelar` devuelve el stock restante y no crea ticket; `darPorImpaga` deja el stock descontado, guarda `total` y `cajaId`, sin ticket; Review Focus 3 (secundario sin asignado: error y `lineas` vacías, stock intacto), 4 (otro mostrador → `NotFound`) y 6 (el `precioUnit` de la línea no cambia si el producto sube de precio).
- [ ] **Step 2:** Run `npx vitest run tests/integration/buffet-cuenta.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar el servicio con una transacción por operación. Para `fijarCantidad`, tomar la fila de la cuenta y verificar `estado = ABIERTA` dentro de la transacción antes de tocar stock.
- [ ] **Step 4:** Run el test (PASS) y `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(buffet): abrir cuentas por cancha, sumar y quitar consumos`.

---

### Task 4: Rendir la cuenta, cierre de caja y conciliación

**Files:**
- Modify: `backend/src/services/buffetCuenta.service.ts`, `backend/src/services/buffetCaja.service.ts` (`cerrar`), `backend/src/services/buffetConciliacion.service.ts` (`calcularResumen`)
- Test: `backend/tests/integration/buffet-cuenta-rendir.test.ts`

**Interfaces:**
- Consumes: `calcularPago` (Task 2); `CuentaDTO` y `cajaAbierta` (Task 3).
- Produces: `buffetCuentaService.rendir(input: { mostradorId: string; cuentaId: string; medioPago: 'EFECTIVO'|'TRANSFERENCIA'; montoPagado: number }): Promise<{ cuenta: CuentaDTO; ticketId: string; total: number; vuelto: number }>`.

- [ ] **Step 1: Write the failing tests:** rendir en efectivo con vuelto crea un `TicketBuffet` con `uid` `cuenta-<id>` y sus `VentaBuffet` con los `precioUnit` de las líneas, **sin tocar el stock**, y la caja suma ese monto; rendir dos veces devuelve el mismo `ticketId` y deja un solo ticket (Review Focus 1); rendir con la caja cerrada → 409 y la cuenta sigue `ABIERTA` (2); rendir vacía → `BusinessRule` (5); efectivo con monto menor al total → `BusinessRule` y la cuenta sigue `ABIERTA`; `cerrar` caja con una cuenta `ABIERTA` → `Conflict` que dice cuántas hay y no cierra; después de rendirla, cerrar funciona; en un cierre del secundario con una cuenta `IMPAGA` de la caja, la conciliación cuenta esas unidades como `vendido`.
- [ ] **Step 2:** Run los tests. Expected: FAIL.
- [ ] **Step 3:** Implementar `rendir`: en una transacción, pasar la cuenta `ABIERTA`→`RENDIDA` con `updateMany` condicionado al estado (si el conteo es 0, releer y devolver el resultado ya rendido), crear ticket + ventas con los datos de las líneas guardadas, y llenar `ticketId`, `cajaId`, `total`, `cerradaEn`. En `cerrar`, antes de cerrar, contar cuentas `ABIERTA` del mostrador y lanzar `Conflict`. En `calcularResumen`, sumar a `vendido` las líneas de cuentas `IMPAGA` con `cajaId = caja.id`.
- [ ] **Step 4:** Run los tests nuevos y `buffet-cierre.test.ts` + `buffet-conciliacion.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(buffet): rendir cuentas, cierre de caja y conciliación`.

---

### Task 5: Rutas y validadores

**Files:**
- Modify: `backend/src/validators/buffet.schema.ts`, `backend/src/routes/buffet.routes.ts`
- Test: `backend/tests/integration/buffet-cuenta-rutas.test.ts`

**Interfaces:**
- Consumes: `buffetCuentaService` (Tasks 3-4), `auditService` si el patrón de las rutas de buffet lo usa.
- Produces (todas con `authMostrador`, salvo la última): `GET /buffet/canchas` → `{ id, nombre }[]` de canchas activas; `GET /buffet/cuentas` → `CuentaDTO[]` abiertas del mostrador; `POST /buffet/cuentas` body `{ canchaId }` → 201 `CuentaDTO`; `GET /buffet/cuentas/:id`; `PUT /buffet/cuentas/:id/lineas/:productoId` body `{ cantidad }` (entero `0..999`); `POST /buffet/cuentas/:id/rendir` body `{ medioPago, montoPagado }`; `POST /buffet/cuentas/:id/cancelar`; `POST /buffet/cuentas/:id/impaga`; y `GET /buffet/admin/cuentas?estado=` con `authJwt` + `requireRole('ADMIN')` → `CuentaDTO[]` de todos los mostradores.

- [ ] **Step 1: Write the failing tests:** cada ruta responde con el código y la forma esperados; `PUT` con cantidad `-1`, `1.5` o `100000` → 400 (Review Focus 7); sin `x-mostrador` → 401; la ruta de admin rechaza el token de mostrador y acepta el JWT de admin.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Agregar los schemas zod (`abrirCuentaSchema`, `fijarCantidadSchema`, `rendirCuentaSchema`, `cuentaIdSchema`, `listarCuentasAdminSchema`) y las rutas finas que llaman al servicio y responden. La ruta `/buffet/admin/cuentas` va declarada en la parte "Admin (JWT)" del archivo.
- [ ] **Step 4:** Run los tests de rutas y `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(buffet): rutas de cuentas por cancha`.

---

### Task 6: Tipos y acciones del frontend

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/buffet-actions.ts`, `frontend/src/lib/buffet-admin-actions.ts`
- Test: `frontend/src/lib/buffet-api.test.ts` (si el patrón existente lo permite) o un test nuevo de las funciones puras de la Task 7

**Interfaces:**
- Produces: tipos `CuentaBuffet`, `CuentaLinea`, `CanchaMostrador = { id: string; nombre: string }`; acciones (`'use server'`, `conSesion`, devuelven `Resultado<T>`): `getCanchasMostrador()`, `getCuentasAbiertas()`, `abrirCuenta(canchaId)`, `getCuenta(id)`, `fijarConsumo(cuentaId, productoId, cantidad)`, `rendirCuenta(cuentaId, medioPago, montoPagado)`, `cancelarCuenta(cuentaId)`, `cuentaImpaga(cuentaId)`; y para el admin en `buffet-admin-actions.ts`, `getCuentasAdmin(estado?)` con `apiFetch`.

- [ ] **Step 1:** Agregar los tipos espejo de `CuentaDTO`/`CuentaLineaDTO`.
- [ ] **Step 2:** Implementar las acciones copiando el patrón de `cobrar` (`conSesion` + `buffetFetch`); cada mutación que cambie la cuenta usa `revalidatePath('/mostrador/cuentas')`.
- [ ] **Step 3:** Run `pnpm exec tsc --noEmit`. Expected: sin errores.
- [ ] **Step 4: Commit** — `feat(mostrador): acciones y tipos de cuentas por cancha`.

---

### Task 7: Pantallas del mostrador

**Files:**
- Create: `frontend/src/app/mostrador/cuentas/page.tsx`, `frontend/src/app/mostrador/cuentas/[id]/page.tsx`, `frontend/src/components/mostrador/pantalla-cuentas.tsx`, `frontend/src/components/mostrador/pantalla-cuenta.tsx`
- Modify: `frontend/src/components/mostrador/pantalla-venta.tsx` (enlace "Cuentas por cancha")
- Test: `frontend/src/components/mostrador/pantalla-cuenta.test.tsx`

**Interfaces:**
- Consumes (Task 6): las acciones `getCanchasMostrador`, `getCuentasAbiertas`, `abrirCuenta`, `getCuenta`, `fijarConsumo`, `rendirCuenta`, `cancelarCuenta`, `cuentaImpaga`; `filtrarProductos` y `calcularVuelto` ya exportadas de `pantalla-venta.tsx`.
- Produces: `PantallaCuentas({ canchas, abiertas })` — lista de cuentas abiertas (cancha, cliente/horario si hay, total) y selector para abrir una cuenta en una cancha sin cuenta abierta; `PantallaCuenta({ cuenta, productos, mostrador })` — botonera y buscador para sumar, líneas con `+`/`−`, total, y botones **Rendir** (diálogo con medio de pago, monto y vuelto), **Impaga** y **Cancelar** (ambos con confirmación).

- [ ] **Step 1: Write the failing test** `pantalla-cuenta.test.tsx`: renderiza las líneas y el total; tocar `+` llama `fijarConsumo` con `cantidad + 1`; tocar `−` en cantidad 1 llama con `0`; **Rendir** abre el diálogo y en efectivo muestra el vuelto con `calcularVuelto`; los botones se deshabilitan mientras hay una llamada en curso (evita el doble toque, Review Focus 1).
- [ ] **Step 2:** Run `pnpm vitest run src/components/mostrador/pantalla-cuenta.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implementar las dos pantallas siguiendo el estilo táctil de `pantalla-venta.tsx`; las páginas son server components que cargan datos con `buffetFetch` y mandan al PIN con `manejarBuffetNoAutorizado` ante un 401, igual que `app/mostrador/page.tsx`. Tras rendir, cancelar o marcar impaga, volver a `/mostrador/cuentas`.
- [ ] **Step 4:** Run el test, `pnpm exec tsc --noEmit`, `pnpm lint` en los archivos tocados. Expected: PASS y sin errores nuevos.
- [ ] **Step 5: Commit** — `feat(mostrador): pantallas de cuentas por cancha`.

---

### Task 8: Lista de solo lectura para el admin

**Files:**
- Create: `frontend/src/app/(panel)/buffet/cuentas/page.tsx`, `frontend/src/components/buffet/cuentas-admin.tsx`
- Modify: `frontend/src/app/(panel)/buffet/page.tsx` (enlace a la lista)

**Interfaces:**
- Consumes (Task 6): `getCuentasAdmin(estado?)`.
- Produces: `CuentasAdmin({ cuentas })` — tabla con cancha, estado (badge), apertura, cierre, total y detalle de líneas; filtro por estado por query string; las `IMPAGA` resaltadas.

- [ ] **Step 1:** Implementar la página con `requireAdmin()` y la tabla (sin acciones de edición).
- [ ] **Step 2:** Run `pnpm exec tsc --noEmit`, `pnpm lint` sobre los archivos tocados y `pnpm build`. Expected: sin errores nuevos; la ruta aparece en la salida del build.
- [ ] **Step 3: Commit** — `feat(buffet): lista de cuentas para el admin`.

---

### Cierre

- [ ] Correr `cd backend && npm test` en una máquina con Docker (los tests de integración de este plan nunca se corrieron si se implementó sin Docker) y `npx vitest run -c vitest.unit.config.ts`.
- [ ] Antes del push: la migración `20261029120000_cuentas_buffet` corre sola al arrancar el backend; verificar en GitHub Actions que el deploy quede en verde.

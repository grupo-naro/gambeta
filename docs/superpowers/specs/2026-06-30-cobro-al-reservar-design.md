# Cobro al reservar desde el panel (seña / total / nada) — Design

**Fecha:** 2026-06-30
**Estado:** Aprobado
**Componentes:** backend (crear reserva + cobro) + frontend (diálogo Nueva reserva).

## Problema

Desde el cambio `0dddbea`, una reserva creada en el panel nace **CONFIRMADA sin cobro** → el chip muestra **"Debe $total"** (rojo), aunque en el mostrador el cliente casi siempre paga la seña (o el total). Se quiere poder **registrar ese cobro al momento de reservar**, eligiendo: **Nada / Seña / Total**.

## Comportamiento

En **Nueva reserva** (panel), un selector **"Cobro"**: `Nada` · `Seña` · `Total`. Si es Seña o Total, se muestra el **medio**: `Efectivo` / `Transferencia`. **Default: Seña + Efectivo.**

Resultado en el chip de pago:
- **Nada** → "Debe $total" (rojo).
- **Seña** → se registra un cobro por el monto de la seña → "Debe $resto" (ámbar).
- **Total** → se registra un cobro por el precio completo → "Pagado" (verde).

Aplica **solo a reservas creadas desde el panel** (staff/JWT). El bot (x-api-key) no usa esto; su flujo de seña queda igual.

## Backend

- **`createReservaSchema`** (`src/validators/reserva.schema.ts`): agregar al body
  - `cobroInicial: z.enum(['ninguno', 'sena', 'total']).default('ninguno')`
  - `medioCobro: z.enum(['EFECTIVO', 'TRANSFERENCIA']).default('EFECTIVO')`
- **Ruta `POST /reservas`** (`src/routes/reserva.routes.ts`): después de `const r = await reservaService.crear(body, { porStaff })` (donde `porStaff = req.principal?.kind === 'admin'`), si `porStaff && body.cobroInicial !== 'ninguno'`:
  - `const precio = Number(r.monto);`
  - `const monto = body.cobroInicial === 'total' ? precio : await senaService.montoParaPrecio(precio);`
  - `if (monto > 0) await cobroService.crear(r.id, { monto, medio: body.medioCobro }, req.principal.kind === 'admin' ? req.principal.adminId : null);`
  - (Reusa `cobroService.crear`, que ya registra el cobro, recalcula saldo y marca la hoja sucia. Verifica el admin FK.)
- Imports a agregar en la ruta: `senaService` (`../services/sena.service.js`) y `cobroService` (`../services/cobro.service.js`).
- La respuesta 201 sigue devolviendo la reserva creada; el panel re-fetchea (revalidatePath) y el chip se actualiza. No hace falta cambiar el shape de la respuesta.

### Testing (integración, Testcontainers)
En `tests/integration/reserva.routes.test.ts` (o uno nuevo), con token admin (`signAdminToken`):
- `cobroInicial: 'total'` → la reserva queda con `saldo` 0 / `pagado` = precio (verificar vía `GET /reservas` o los cobros); estado CONFIRMADA.
- `cobroInicial: 'sena'` → `pagado` = seña (según `senaService`), `saldo` = precio − seña > 0.
- `cobroInicial: 'ninguno'` (o sin el campo) → sin cobros, `saldo` = precio.
- Con `x-api-key` (bot) + `cobroInicial: 'total'` → **NO** registra cobro (solo aplica a staff/JWT) y sigue el flujo de seña del bot.

## Frontend

- **`src/components/reservas/nueva-reserva-dialog.tsx`**: agregar
  - estado `cobro: 'ninguno' | 'sena' | 'total'` (default `'sena'`) con un `<select>` "Cobro".
  - estado `medioCobro: 'EFECTIVO' | 'TRANSFERENCIA'` (default `'EFECTIVO'`) con un `<select>` "Medio", visible solo cuando `cobro !== 'ninguno'`.
  - pasar `cobroInicial: cobro` y `medioCobro` a `crearReserva(...)`.
- **`src/lib/reservas-actions.ts`** (`crearReserva`): sumar los parámetros `cobroInicial` y `medioCobro` al input y al body del `POST /reservas`.

## Fuera de alcance
- Reservas del bot (sin cambios).
- Cobros parciales de monto arbitrario al reservar (solo seña/total; montos custom siguen por el flujo de cobro existente en la hoja de acción).
- Reprogramar/otras acciones.

## Integración
Backend → `main` + push → deploy (VM; ojo IPv6/runner — puede requerir deploy manual). Frontend → `master` + push → Vercel. Ambas partes deben estar deployadas para que el selector funcione punta a punta.

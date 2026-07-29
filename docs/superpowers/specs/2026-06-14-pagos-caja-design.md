# Pagos y caja — Design

**Fecha:** 2026-06-14
**Estado:** Aprobado

## Objetivo

Registrar cada cobro de una reserva con su medio (efectivo / transferencia), llevar el saldo
(precio total vs. pagado) y una caja con totales por día, cancha y medio. La recepcionista cobra
en la cancha y cuadra la caja del día; el admin ve la caja completa.

## Decisiones (confirmadas)
- Medios: **EFECTIVO** y **TRANSFERENCIA** (solo esos).
- Seña aprobada (bot o admin) = **cobro automático** de transferencia por el monto de la seña.
- **Saldo calculado** (`monto − Σ cobros`); no se agrega estado nuevo a la reserva. Sobrepago permitido (saldo se muestra 0/"Pagado").
- Registrar/anular cobro y ver caja del día → ambos roles; caja con rango y por cancha → admin (controles solo para admin; endpoint para logueados).
- Anular cobro: lo pueden hacer ambos roles y queda en Actividad.

## Modelo
```prisma
enum MedioPago { EFECTIVO TRANSFERENCIA }

model Cobro {
  id              String     @id @default(cuid())
  reservaId       String
  reserva         Reserva    @relation(fields: [reservaId], references: [id], onDelete: Cascade)
  monto           Decimal    @db.Decimal(10, 2)
  medio           MedioPago
  origen          String     @default("MANUAL") // MANUAL | SENA
  registradoPorId String?
  registradoPor   AdminUser? @relation(fields: [registradoPorId], references: [id])
  creadoEn        DateTime   @default(now())
  @@index([creadoEn])
  @@index([reservaId])
}
```
- Relación inversa en `Reserva` (`cobros Cobro[]`) y `AdminUser` (`cobros Cobro[]`).
- El modelo `Pago` (seña: comprobante/verificación) **no cambia**.
- **Saldo** de una reserva: `Number(reserva.monto) − Σ Number(cobro.monto)`. "Pagada" = saldo ≤ 0.

## Backend

### Seña → cobro automático
En `reserva.service.aprobarSena` (que ya marca `Pago` APROBADO + reserva CONFIRMADA + audit APROBAR_SENA): además crear un `Cobro { reservaId, monto: montoSena, medio: 'TRANSFERENCIA', origen: 'SENA', registradoPorId: by.adminId ?? null }` dentro de la misma transacción. (Si la seña se aprobó por el bot, `registradoPorId` null → "Sistema".) No se duplica el log (basta el de APROBAR_SENA).

### Endpoints
- `POST /reservas/:id/cobros` (`authJwt`, ambos roles): body `{ monto: number>0, medio: 'EFECTIVO'|'TRANSFERENCIA' }`. Verifica que la reserva exista. Crea `Cobro` `origen:'MANUAL'`, `registradoPorId` = `req.principal.adminId`. Devuelve `{ cobro, saldo }`. Audit: "Registró un cobro de $X (medio) — «cancha»".
- `GET /reservas/:id/cobros` (`authJwt`): `{ monto, pagado, saldo, cobros: [{ id, monto, medio, origen, registradoPor, creadoEn }] }`.
- `DELETE /cobros/:id` (`authJwt`, ambos roles): elimina el cobro. Audit: "Anuló un cobro de $X". (Se permite anular cualquier cobro, incluido `origen:'SENA'`.)
- `GET /caja?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (`authJwt`; default `desde=hasta=hoy` en TZ negocio): cobros con `creadoEn` en `[dayWindow(desde).start, dayWindow(hasta).end]`. Devuelve:
  ```
  { desde, hasta, total, porMedio: { EFECTIVO, TRANSFERENCIA },
    porCancha: [{ canchaId, nombre, total }],
    cobros: [{ id, creadoEn, monto, medio, cancha, cliente, registradoPor }] }
  ```
  Repo: query Cobro con `include reserva → cancha + cliente`, `registradoPor → nombre`; agregaciones en memoria (volumen bajo) o con groupBy.
- Validadores Zod (`cobro.schema.ts`, `caja.schema.ts`): monto positivo, medio enum; desde/hasta `YYYY-MM-DD` opcionales (`hhmm`-style regex de fecha) con `desde ≤ hasta`.
- Servicios: `cobro.service.ts` (crear/listar-por-reserva/eliminar + saldo) y `caja.service.ts` (reporte). Repo `cobro.repo.ts`. Montar rutas: `/cobros` (DELETE) o anidar en reservas; `/caja`.
- **Roles:** estos endpoints son `authJwt` (ambos). No llevan `requireRole`. El gating de "rango/por cancha" es del frontend.

### Tests (TDD)
- Crear cobro baja el saldo; saldo = monto − Σ cobros; `GET /reservas/:id/cobros` devuelve saldo correcto.
- Aprobar seña crea un Cobro TRANSFERENCIA `origen:'SENA'` por `montoSena` (y la caja lo cuenta).
- `DELETE /cobros/:id` lo elimina y sube el saldo.
- `GET /caja`: agrega por medio y por cancha, y por fecha del cobro (un cobro de hoy aparece en hoy; uno de otro día no).
- Validación: monto ≤ 0 → 400; medio inválido → 400.
- RECEPCIONISTA puede POST cobro y GET caja (no 403).

## Frontend
- `lib/types`: `MedioPago='EFECTIVO'|'TRANSFERENCIA'`; `Cobro { id, monto, medio, origen, registradoPor, creadoEn }`; `CobrosReserva { monto, pagado, saldo, cobros }`; `CajaReporte { desde, hasta, total, porMedio, porCancha:[{canchaId,nombre,total}], cobros:[...] }`.
- `lib/cobros-actions.ts` + `lib/caja` fetch (BFF, `async function`, `run()`+`revalidate`).
- **Reservas:** acción/diálogo **"Cobros"** por reserva (ambos roles): muestra total/pagado/saldo, lista de cobros con "Anular", y form **Registrar cobro** (monto + select medio). `revalidatePath('/reservas')` + `router.refresh()`.
- **Pantalla `/caja`** (nav "Caja", ambos roles): Server Component que con `getSession()` decide:
  - rol RECEPCIONISTA → caja de **hoy** (sin selector); muestra total + por medio + detalle del día.
  - rol ADMIN → selector de rango (desde/hasta, default hoy) + por cancha + total + detalle.
  - Componente de reporte responsive (tabla `hidden md:block` + cards `md:hidden`); montos en `$ es-AR`; fecha/hora en TZ Argentina.
- `validators`: `cobroSchema` (monto coerce>0, medio enum).

## Bot
Sin cambios: el bot aprueba la seña vía `PATCH /reservas/:id/aprobar-sena`, y el backend ya crea el cobro automático.

## Migración / compat
- Migración crea `MedioPago` + tabla `Cobro`. Sin backfill (las reservas/seña viejas no generan cobros retroactivos; la caja arranca desde que se registran cobros / se aprueban señas con el sistema nuevo).

## Fuera de alcance
- Mercado Pago u otros medios.
- Export a Excel (feature siguiente; la caja deja los datos listos).
- Cierre/arqueo de caja por turno o por usuario, egresos/gastos.
- Cambiar el flujo de seña del bot.

## Testing (resumen)
- Backend: tests arriba; suite completa verde.
- Frontend: unit de `cobroSchema`; tsc/lint/`pnpm build`. Manual: registrar un cobro efectivo en una reserva (baja el saldo), ver la caja del día como recepcionista, y como admin con rango/por cancha; aprobar una seña y ver que aparece en la caja como transferencia.

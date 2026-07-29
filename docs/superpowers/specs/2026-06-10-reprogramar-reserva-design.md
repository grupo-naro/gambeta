# Spec — Reprogramación de reservas (backend)

- **Fecha:** 2026-06-10
- **Componente:** backend `canchitas-backend` (Node/Express/TS/Prisma 7/Zod 4). Bot (n8n) en plan aparte.
- **Estado:** Aprobado.

## Objetivo
Permitir **mover** una reserva a otro horario conservando su estado y la seña ya pagada (no re-cobrar),
para soportar "no puedo a las 21, ¿tenés a las 20?".

## Decisiones
- Reprogramar **mantiene** estado (`CONFIRMADA` sigue CONFIRMADA), `esContacto`, `montoSena` y el Pago.
- **Ventana:** igual que cancelar (`CANCELACION_ANTICIPACION_HORAS`, default 12h) sobre el turno ACTUAL;
  el admin (JWT) puede forzar; el principal de servicio (bot/API key) la respeta.

## Endpoint: `PATCH /reservas/:id/reprogramar`
- Auth: `authAny` (bot via API key o admin via JWT).
- Body: `{ fecha: "YYYY-MM-DD", horaInicio: "HH:MM" }`.
- Lógica:
  1. Cargar reserva (404 si no existe).
  2. Estado debe ser `CONFIRMADA` o `ESPERANDO_SENA` (si no → **409** "no se puede reprogramar").
  3. Ventana: si `!adminId` y `Date.now() > fechaInicio_actual - 12h` → **422**.
  4. Calcular nuevo `fechaInicio` (TZ Argentina) y `fechaFin = +60min`. Si `<= now` → **422** (pasado).
  5. Update de `fechaInicio/fechaFin` (sin tocar estado/pago). El exclusion constraint previene overlap →
     si el nuevo slot está ocupado → **409**.
  6. Audita `REPROGRAMAR_RESERVA`.
  7. Devuelve la reserva actualizada.

## Archivos
- `src/repositories/reserva.repo.ts`: agregar `reprogramar(id, fechaInicio, fechaFin, tx?)` que hace
  `update` y mapea la violación de exclusión (SQLSTATE 23P01) a `Conflict` (igual que `create`).
- `src/services/reserva.service.ts`: agregar `reprogramar(id, by, { fecha, horaInicio })` (carga, valida
  estado/ventana/pasado, update, audita).
- `src/validators/reserva.schema.ts`: `reprogramarSchema` (body fecha+horaInicio, params id).
- `src/routes/reserva.routes.ts`: `PATCH /:id/reprogramar` con `validate` + `authAny`.

## Testing (TDD, Vitest + Supertest + Testcontainers)
- Mueve una CONFIRMADA a un slot libre → 200, estado sigue CONFIRMADA, `fechaInicio` nueva, slot viejo
  queda libre y el nuevo ocupado.
- Nuevo slot ocupado → **409**.
- Dentro de la ventana (principal servicio) → **422**; con `Authorization` admin → **200** (override).
- Reprogramar una `CANCELADA` → **409**.
- Fecha/hora en el pasado → **422**.

## Despliegue
Backward-compatible. Merge a main → auto-deploy por el self-hosted runner.

## Fuera de alcance
La intención `reprogramar` en el bot (n8n) — plan/implementación aparte después del backend.

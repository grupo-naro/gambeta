# Cancelación hasta 10 minutos antes del turno — Design

**Fecha:** 2026-07-06
**Estado:** Aprobado
**Componente:** backend `canchitas-backend` (env + `reserva.service.cancelar` + tests + config de deploy). Sin bot/frontend/DB.

## Problema

Hoy un cliente solo puede cancelar hasta **12 horas antes** del turno (`CANCELACION_ANTICIPACION_HORAS=12`). En un caso real, un cliente a 34 min del turno quiso cancelar y el bot respondió "muy cerca del horario, escribí a un encargado", dejándolo sin salida. Se quiere que el cliente pueda cancelar **hasta 10 minutos antes** del turno.

## Alcance

- **Solo cancelar.** Reprogramar queda como está (`REPROGRAMACION_ANTICIPACION_HORAS=2`).
- El admin/panel cancela con `adminId`, que **bypassa** la regla (`if (!by.adminId ...)`), y no cambia.
- El bot solo relaya el 422; su mensaje actual sigue sirviendo para el caso <10 min.

## Diseño

### 1. Env: de horas a minutos
En `src/config/env.ts`, reemplazar:
```ts
CANCELACION_ANTICIPACION_HORAS: z.coerce.number().int().nonnegative().default(12),
```
por:
```ts
CANCELACION_ANTICIPACION_MINUTOS: z.coerce.number().int().nonnegative().default(10),
```

### 2. `reserva.service.cancelar()` (líneas ~214-217)
De:
```ts
const horas = getEnv().CANCELACION_ANTICIPACION_HORAS;
const limite = new Date(r.fechaInicio.getTime() - horas * 3600000);
if (!by.adminId && Date.now() > limite.getTime()) {
  throw BusinessRule(`Solo se puede cancelar hasta ${horas}h antes del turno`);
}
```
a:
```ts
const minutos = getEnv().CANCELACION_ANTICIPACION_MINUTOS;
const limite = new Date(r.fechaInicio.getTime() - minutos * 60000);
if (!by.adminId && Date.now() > limite.getTime()) {
  throw BusinessRule(`Solo se puede cancelar hasta ${minutos} minutos antes del turno`);
}
```

### 3. Config de deploy y ejemplo
- `docker-compose.vm.yml`: `CANCELACION_ANTICIPACION_HORAS: "12"` → `CANCELACION_ANTICIPACION_MINUTOS: "10"`.
- `docker-compose.yml`: idem → `"10"`.
- `.env.example`: `CANCELACION_ANTICIPACION_HORAS=12` → `CANCELACION_ANTICIPACION_MINUTOS=10`.

### 4. Tests
- `tests/unit/env.test.ts`: `expect(env.CANCELACION_ANTICIPACION_MINUTOS).toBe(10)` (era HORAS=12).
- `tests/helpers/global-setup.ts`: `process.env['CANCELACION_ANTICIPACION_MINUTOS']='10'` (era HORAS='12').
- Integración (`reserva.service` o endpoint `PATCH /reservas/:id/cancelar`), TDD:
  - Turno con inicio a **>10 min** en el futuro, cancelación por servicio (sin adminId) → **OK** (queda CANCELADA).
  - Turno con inicio a **<10 min** (ej: dentro de 5 min), sin adminId → **422** con el mensaje de minutos.
  - Con `adminId` → cancela igual aunque falten <10 min (bypass).

## Comportamiento resultante
Cliente por WhatsApp cancela hasta 10 min antes; recién en los últimos 10 min recibe "muy cerca del horario, escribí a un encargado". Admin sin restricción.

## Riesgo
- **Env var renombrado:** si la VM tenía `CANCELACION_ANTICIPACION_HORAS=12` seteado fuera del compose, tras el rename queda ignorado → aplica el default 10 min (deseado). El compose de la VM se actualiza en este cambio.
- Bajo riesgo: cambio de constante + unidad; sin DB, sin migración.

## Testing
`npx vitest run` (necesita Docker para testcontainers). RED → GREEN del test de integración + suite sin regresiones nuevas (hay 4 fallos preexistentes conocidos: sena x3, disponibilidad-tamano x1).

## Fuera de alcance
- Reprogramar (queda en 2h), bot, frontend, DB.
- Auto-aviso al encargado en el caso <10 min (se descartó a favor de bajar el umbral).

## Integración / deploy
Backend → `main` local, **sin push** salvo indicación. El cambio aplica al recrear el contenedor con el nuevo env (auto-deploy en push a main; el compose de la VM ya trae el valor). Sin migración de DB.

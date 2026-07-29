# Mis Reservas (consulta de turnos por el cliente) — Design

**Fecha:** 2026-06-10
**Estado:** Aprobado

## Objetivo

Permitir que el bot de WhatsApp responda "¿qué turnos tengo?" listando las
reservas próximas del cliente, identificado por su número de WhatsApp.

## Problema

`GET /reservas` (listado admin) usa `authJwt` (solo admin con JWT). El bot de
n8n autentica con `x-api-key` (service principal), así que **no puede** usar ese
endpoint. Hace falta una vía scoped para que el bot consulte solo las reservas
del número que pregunta.

## Decisiones (aprobadas)

- **Qué mostrar:** solo turnos **futuros activos** — estado `CONFIRMADA` o
  `ESPERANDO_SENA` con `fechaInicio > ahora`, ordenados ascendente por fecha.
  No se incluyen pasadas, `CANCELADA` ni `COMPLETADA`.
- **Exposición:** endpoint **dedicado y scoped**, no abrir el listado admin.

## Backend

### Endpoint

`GET /reservas/mias?whatsapp=<numero>` — middleware `authAny` (acepta JWT admin o
`x-api-key` service).

- `whatsapp` es **obligatorio**. Si falta → 400 (validación Zod). Esto garantiza
  que el service principal nunca liste reservas de otro cliente: siempre filtra
  por un número concreto.
- Respuesta `200`: array (posiblemente vacío) de reservas, cada una con:
  `id`, `cancha` (`{ id, nombre }`), `fechaInicio`, `fechaFin`, `estado`,
  `monto`, `montoSena`. Ordenadas por `fechaInicio` ascendente.

### Componentes

- **`src/services/reserva.service.ts`** — nuevo método `misReservas(whatsapp: string)`:
  llama a `reservaRepo.list(where)` con `where = { cliente: { whatsapp },
  estado: { in: ['CONFIRMADA','ESPERANDO_SENA'] }, fechaInicio: { gt: new Date() } }`.
- **`src/repositories/reserva.repo.ts`** — **sin cambios**: `list(where)` ya
  incluye la relación `cancha` y ordena por `fechaInicio` ascendente.
- **`src/validators/reserva.schema.ts`** — `misReservasSchema`: `query` con
  `whatsapp: z.string().min(5)`, `body` y `params` vacíos.
- **`src/routes/reserva.routes.ts`** — `reservaRoutes.get('/mias', authAny,
  validate(misReservasSchema), ...)`, registrado **antes** de `/:id` (como
  `/vencidas-sena`) para que no lo sombree la ruta paramétrica.

### Manejo de errores

- Falta `whatsapp` → 400 (Zod).
- Cliente sin turnos próximos → `200` con `[]` (no es error).

## Bot (n8n — cambio aparte, igual que `reprogramar`)

- **Intent nuevo `mis_reservas`** en el nodo Prompt (enum + descripción de
  Gemini): "qué turnos tengo / mis reservas / qué reservé / cuándo juego".
- **Rama en Cerebro:** `GET /reservas/mias?whatsapp=<number>` (header
  `x-api-key`). Si el array tiene elementos: listarlos
  ("Tenés: Cancha 1 el 2026-06-11 a las 17:00 (CONFIRMADA), ..."), indicando
  estado; para `ESPERANDO_SENA` aclarar que falta la seña. Si está vacío:
  "No tenés turnos próximos. ¿Querés reservar uno?". El `try/catch` existente del
  Cerebro cubre backend caído con el mensaje genérico de demora.
- Guardado de contexto Redis: mantener el contexto previo (`keepCtx`) — esta
  consulta no cambia el estado conversacional.

## Testing (integración, Vitest + Supertest + Testcontainers)

- Devuelve los turnos futuros activos de un cliente, ordenados por fecha.
- No incluye reservas `CANCELADA`/`COMPLETADA` ni turnos pasados.
- No incluye reservas de **otro** cliente (aislamiento por whatsapp).
- `400` si falta `whatsapp`.
- `200` con `[]` cuando el cliente no tiene turnos próximos.
- Acepta tanto `x-api-key` (service) como JWT admin (`authAny`).

## Fuera de alcance (YAGNI)

- Paginación (un cliente tiene pocos turnos próximos).
- Historial / turnos pasados.
- Panel admin (ya tiene `GET /reservas`).

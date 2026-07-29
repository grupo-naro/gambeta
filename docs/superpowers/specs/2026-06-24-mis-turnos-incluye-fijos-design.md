# "Mis turnos" del bot incluye los turnos fijos — Design

**Fecha:** 2026-06-24
**Estado:** Aprobado
**Componentes:** backend (Express/Prisma) + bot (n8n workflow `I8yiX4g1rGh5Hb2U`).

## Problema

Cuando un cliente le pregunta al bot "¿tengo algún turno?", el bot responde solo sus **reservas sueltas** (`GET /reservas/mias`). No menciona sus **turnos fijos**, aunque el fijo tenga el WhatsApp del cliente vinculado (los fijos se cargan presencialmente desde el panel, con el número, justamente para que el bot los reconozca). Resultado: el cliente cree que solo tiene la reserva suelta y no ve su turno recurrente.

## Objetivo

Que la consulta de turnos del bot combine **reservas sueltas + turnos fijos** del cliente (match por WhatsApp). Mensajes esperados:

- Ambos: "Tenés una reserva el [fecha] a las [hora] en [cancha], y además un turno fijo todos los [día] a las [hora]."
- Solo fijo: "Tenés un turno fijo todos los [día] a las [hora]."
- Solo reserva suelta: como hoy.
- Nada: como hoy.

El fijo se reporta como **recurrente** ("todos los [día]"), no como una fecha puntual. Es **solo informativo**: no se puede cancelar/reprogramar el fijo desde el bot (eso sigue presencial; "liberar una fecha" del fijo ya existe y queda igual).

## Pieza 1 — Backend: endpoint `GET /turnos-fijos/mios`

- Ruta: `GET /turnos-fijos/mios?whatsapp=<num>` con middleware `authAny` (el bot autentica con `x-api-key`; igual que `/reservas/mias` y `/turnos-fijos/liberar`).
- Validator (Zod): query schema con `whatsapp: z.string().min(1)` (reusar el patrón de `misReservasSchema`).
- Service `turnoFijoService.misFijos(whatsapp)`:
  - `const target = local10(whatsapp)` (mismo helper que `liberarPorWhatsapp`). Si `!target` → devolver `[]`.
  - `prisma.turnoFijo.findMany({ where: { activo: true }, include: { cancha: true } })`.
  - Filtrar `local10(f.whatsapp) === target`.
  - Ordenar por `diaSemana` asc, luego `horaInicio` asc.
  - Mapear a shape chico y estable: `{ id, diaSemana, horaInicio, horaFin, canchaNombre, precio }` donde `canchaNombre = f.cancha.nombre` y `precio = f.precio == null ? null : Number(f.precio)`.
- No filtra por fecha ni por excepciones: el fijo es recurrente; reportamos el día/hora del fijo. (Las excepciones liberan fechas puntuales pero el fijo sigue vigente.)

### Testing (Vitest + Testcontainers, hand-written SQL migrations; requiere Docker)
- Seed: una cancha; un fijo `activo` con `whatsapp` `+5491136620274`, `diaSemana`, `horaInicio/Fin`, `precio`; otro fijo `activo` de otro número; un fijo `activo:false` del primer número.
- `GET /turnos-fijos/mios?whatsapp=5491136620274` (sin `+`, formato canónico del bot) → devuelve solo el fijo activo del primer número (match por últimos 10), con `canchaNombre` y `precio` numérico; NO incluye el inactivo ni el de otro número.
- `GET /turnos-fijos/mios?whatsapp=1136620274` (10 dígitos locales) → mismo resultado (valida el match por últimos 10).
- `GET /turnos-fijos/mios?whatsapp=99999999999` → `[]`.
- `GET /turnos-fijos/mios` sin `whatsapp` → 400 (validación).

## Pieza 2 — Bot (n8n, cambio directo vía n8n MCP)

En el nodo **Cerebro**, en la rama que responde la consulta de turnos del cliente (la que hoy llama `GET /reservas/mias`):

1. Hacer también `GET /turnos-fijos/mios?whatsapp=<wa>` (backend interno `http://backend:3000`, header `x-api-key` SVC).
2. Combinar la respuesta:
   - Listar reservas sueltas como hoy.
   - Agregar los fijos como recurrentes: "y además un turno fijo todos los [día] a las [hora]" (un renglón por fijo si hay varios; incluir cancha si aporta claridad).
   - Si solo hay fijos (sin reservas): "Tenés un turno fijo todos los [día] a las [hora]."
   - Si no hay nada: mantener el mensaje actual.
3. Mapear `diaSemana` → nombre de día con base **0=domingo, 1=lunes … 6=sábado** (consistente con `dayOfWeekInTz` del backend).
4. Verificar el snippet con `node --check` (función envuelta en `async function(){...}`) antes de aplicar el patch.

El fijo no se agrega a `resolverTurno()` (selección para cancelar/reprogramar): esto es solo la respuesta informativa.

## Orden de implementación

1. Backend primero (endpoint + tests), merge a `main` + push; el deploy a la VM (.36) lo corre el usuario.
2. Una vez deployado y con el endpoint vivo, el cambio del bot (directo en n8n).

## Fuera de alcance

- Acciones sobre el fijo desde el bot (cancelar/reprogramar el fijo completo).
- Migración de la agenda del Excel (tema separado, pausado).

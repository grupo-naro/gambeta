# Bot — Cambiar un turno fijo por una cancha más chica (mismo día/hora) — Design

**Fecha:** 2026-07-08
**Estado:** Aprobado
**Componente:** workflow n8n `I8yiX4g1rGh5Hb2U`, nodo **Cerebro**. Sin backend/frontend (usa endpoints existentes).

## Problema

Un cliente con turno **fijo** (ej. cancha de 9, hoy 21:00) avisa que hoy no van todos y quiere una **cancha más chica** (de 5) en su lugar. Hoy el bot no lo maneja: reservaría la de 5 aparte (con seña) y dejaría el fijo de 9 ocupado.

## Objetivo

Cuando un cliente con fijo reserva una cancha en **el mismo día y hora** de su fijo, el bot lo trata como **reemplazo**: reserva la cancha nueva **sin seña** (es cliente fijo) y **libera el fijo** de ese día. Guiado en 2 pasos: el cliente confirma la reserva y el bot hace ambas cosas en orden seguro.

## Diseño (rama `confirmar` del Cerebro)

### Detección del swap
Al confirmar una reserva normal (ya hay `ctx.canchaId/fecha/hora`), el bot consulta `GET /turnos-fijos/mios?whatsapp=`. Si el cliente tiene un fijo cuyo `diaSemana` = día de `ctx.fecha` **y** `horaInicio` = `ctx.hora`, es un swap (`_swapFijo=true`).
- Día de la semana de `ctx.fecha`: `new Date(Date.UTC(y,m-1,d)).getUTCDay()` (0=domingo), TZ-safe.

### Acción al confirmar (orden seguro)
1. **Crea la reserva** (POST `/reservas`) con `esContacto: _swapFijo || esContacto`. Con `esContacto:true` el backend la deja **CONFIRMADA sin seña** (`confianza = esContacto || …` → estado CONFIRMADA).
2. Si `r.estado==='CONFIRMADA'` **y** `_swapFijo`: **libera el fijo** (POST `/turnos-fijos/liberar` `{whatsapp, fecha: ctx.fecha}`). Si `liberado`, se agrega al mensaje.
3. Respuesta: *"Listo &lt;nombre&gt;! Te reserve la cancha 3 el hoy a las 21:00 **y te libere tu turno fijo de hoy**. Te esperamos!"* (el texto de liberación solo si de verdad se liberó).

**Orden:** reserva primero, liberación después. Si la reserva falla (409/422), **no libera** el fijo (manejo de error actual). Así el cliente nunca pierde el fijo sin tener el reemplazo.

## Alcance / límites
- El swap se dispara solo cuando la reserva es en el **mismo día + hora** del fijo (caso "reemplazo mi fijo"). Otra hora = turno **adicional** normal (con seña), el fijo queda intacto.
- Si la cancha nueva fuera una **subdivisión de la misma cancha del fijo** (ej. Cancha 4 divisible), la disponibilidad la muestra ocupada por el propio fijo → no se ofrece a esa hora → el swap no se dispara. En ese caso el cliente libera el fijo por separado y luego reserva. (Aceptado.)
- Sin cambios en backend/frontend: se usan `/turnos-fijos/mios`, `/reservas` (con `esContacto:true`) y `/turnos-fijos/liberar`, todos existentes.
- Costo: una llamada extra `GET /turnos-fijos/mios` por cada confirmación de reserva. Aceptable.

## Riesgo
- **Adicional vs reemplazo:** si un cliente con fijo reserva a su mismo día+hora queriendo *dos* turnos (fijo de 9 + de 5), el bot liberaría el fijo. Es muy poco probable (mismo horario) y el mensaje lo informa; aceptado.
- Se apoya en que el backend crea CONFIRMADA sin seña con `esContacto:true` (verificado en `reserva.service.crear`).

## Testing
- Sintaxis del Cerebro vía AsyncFunction.
- Smoke test (con Evolution): cliente con fijo (ej. de 9, martes 21) dice "hoy quiero una de 5 a las 21" → el bot reserva la de 5 sin seña y libera el fijo, y lo dice. Cliente sin fijo a esa hora → reserva normal (con seña), sin liberar nada.

## Despliegue
En vivo vía patchNodeField (backup por version history de n8n).

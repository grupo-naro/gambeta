# Bot — Mover el turno fijo a otra hora el mismo día (guiado) — Design

**Fecha:** 2026-07-08
**Estado:** Aprobado
**Componente:** workflow n8n `I8yiX4g1rGh5Hb2U`, nodo **Cerebro** (rama `confirmar` + un ruteo de contexto). Sin backend/frontend.

## Problema

Un cliente con fijo (ej. de 9 hoy 21:00) dice "hoy a las 21 no vamos, jugamos a las 18". Quiere **mover** su turno fijo a otra hora **el mismo día**. Hoy el bot solo maneja el swap cuando la reserva es a la **misma hora** del fijo (cambio de tamaño). A otra hora lo toma como turno **adicional** (con seña) y deja el fijo intacto.

## Objetivo

Cuando un cliente con fijo confirma una reserva **el mismo día pero a otra hora**, el bot **pregunta** si es en lugar de su fijo. Si confirma, crea la reserva **sin seña** y **libera el fijo** de ese día. Si dice que es aparte, reserva normal (con seña) y deja el fijo.

## Diseño (Cerebro)

### Ruteo de contexto (arriba, junto a `esperaReprog`)
Si `ctx.esperaSwap` está seteado y el mensaje es una respuesta (si/dale/listo/ok/en lugar/aparte/no/extra) y no es cancelar/humano/reprogramar → `intent='confirmar'` (para procesar la respuesta). Si no parece una respuesta → se descarta `ctx.esperaSwap` y sigue normal.

### Rama `confirmar`
1. Si `ctx.esperaSwap`, restaura los datos de la reserva pendiente (`canchaId/cancha/fecha/hora/jugadores`) desde ahí.
2. **Detección del fijo** (`GET /turnos-fijos/mios`, día de `ctx.fecha`):
   - `_swapFijo` = tiene fijo ese día **a la misma hora** (`ctx.hora`).
   - `_fijoOtra` = tiene fijo ese día **a otra hora** (si no hay same-hour).
3. **Decisión:**
   - `_preguntar = !ctx.esperaSwap && !_swapFijo && !!_fijoOtra` → **preguntar y no crear**: *"Veo que tenés tu turno fijo de las 21 hoy. ¿Esta reserva de las 18 es en lugar de ese? Respondé SÍ y te lo libero (sin seña), o 'aparte' si es un turno extra."* Guarda `ctx.esperaSwap` con los datos de la reserva.
   - Si no `_preguntar` → **crear**:
     - `_libFijo` = `ctx.esperaSwap ? (la respuesta NO fue negativa) : _swapFijo`.
       - `_swapNo` = el mensaje contiene "no/aparte/extra/adicional/los dos/ambas/también".
     - POST `/reservas` con `esContacto: _libFijo || esContacto` (con `_libFijo` → CONFIRMADA sin seña).
     - Si `CONFIRMADA` y `_libFijo` → POST `/turnos-fijos/liberar` `{whatsapp, fecha}`; si liberado, se agrega al mensaje.
     - Si no `_libFijo` → flujo normal (con seña, ESPERANDO_SENA).

### Comportamiento combinado
- **Misma hora, otro tamaño** → swap automático (ya implementado). Sin cambios.
- **Otra hora, mismo día** → pregunta; SÍ = mueve el fijo (sin seña + libera), "aparte" = reserva normal con seña, fijo intacto.
- **Otro día / sin fijo** → reserva normal como siempre.

## Riesgos / límites
- La reserva debe estar **disponible** para poder crearla (el flujo de reserva solo ofrece horarios libres). Orden seguro: crear primero, liberar después; si la creación falla, no libera.
- La distinción "en lugar / aparte" se apoya en palabras clave del mensaje; si es ambiguo, por defecto (habiendo preguntado) asume que es reemplazo, salvo negación explícita. Aceptado (es guiado).
- Costo: `GET /turnos-fijos/mios` por cada confirmación (aceptado).
- Sin backend/frontend (usa `/turnos-fijos/mios`, `/reservas` con `esContacto:true`, `/turnos-fijos/liberar`).

## Implementación
Por el tamaño e importancia (toca la rama de confirmación de reservas), se reemplaza **toda la rama `confirmar`** por la versión nueva en un solo patch (find/replace verbatim), más un patch chico para el ruteo `esperaSwap`.

## Testing
- Sintaxis del Cerebro vía AsyncFunction.
- Smoke test (con Evolution): cliente con fijo (de 9, hoy 21) reserva a las 18 → el bot pregunta → "sí" → reserva sin seña + libera el fijo; "aparte" → reserva con seña + fijo intacto. Misma hora → swap automático (sin preguntar). Sin fijo → normal.

## Despliegue
En vivo vía patchNodeField (backup por version history de n8n).

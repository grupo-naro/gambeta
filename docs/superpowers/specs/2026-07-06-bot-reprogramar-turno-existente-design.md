# Bot WhatsApp — Reconocer "cambiar mi turno" (reprogramar) — Design

**Fecha:** 2026-07-06
**Estado:** Aprobado
**Componente:** workflow n8n "Canchitas — Bot v2" (`I8yiX4g1rGh5Hb2U`), nodo **Prompt**. Sin Cerebro/backend/frontend.

## Problema

Un cliente con un turno confirmado que pide moverlo ("tenés otro horario para cambiarme para más tarde") es clasificado como consulta de disponibilidad nueva en vez de **reprogramar**. Caso real (Nico): tenía turno 18hs confirmado, pidió cambiarlo a más tarde y el bot respondió con slots libres nuevos, nunca ofreció mover su turno.

### Causa

Tras confirmar una reserva, el contexto queda `{lastResId, lastResLabel, lastResFecha, lastResHora, postReserva}`. En el **Prompt**, `ctxLine` solo detecta reserva **en progreso** (`ctx.jugadores || ctx.canchaId || 'cancha' in ctx || ctx.fecha || ctx.hora`) — **no mira `ctx.lastResId`**. Entonces Gemini no sabe que el cliente ya tiene un turno y no puede clasificar "cambiarme" como reprogramar. La lógica del Cerebro para `reprogramar` ya funciona (resuelve por `lastResId` y pide nuevo día/hora); el problema es solo de clasificación.

## Diseño (2 ajustes en el Prompt)

### 1. Surfacear el turno ya reservado en `ctxLine`
Hoy:
```js
const enReserva=!!(ctx&&(ctx.jugadores||ctx.canchaId||('cancha' in ctx)||ctx.fecha||ctx.hora));
const ctxLine=enReserva?('El cliente esta reservando un turno. Datos hasta ahora: ...'):'Sin reserva en progreso.';
```
Nuevo: agregar un caso intermedio cuando hay `ctx.lastResId` (turno ya reservado) y NO hay reserva en progreso:
```js
const tieneTurno=!!(ctx&&ctx.lastResId);
const ctxLine = enReserva
  ? ('El cliente esta reservando un turno. Datos hasta ahora: ...')   // igual que hoy
  : (tieneTurno
      ? ('El cliente YA tiene un turno reservado: '+(ctx.lastResLabel||'un turno')+'. Si pide cambiarlo, moverlo, otro horario, mas tarde o mas temprano, la intencion es reprogramar; si pide cancelarlo, cancelar; si no, interpretalo normal.')
      : 'Sin reserva en progreso.');
```
- Prioridad: si hay reserva **en progreso** se mantiene el texto actual (no se toca ese flujo). Solo cuando NO hay reserva en progreso pero sí un turno confirmado, se usa el texto nuevo.

### 2. Ampliar ejemplos de la intención `reprogramar`
En la enumeración de intenciones, la definición actual:
> `reprogramar (cambiar/mover un turno ya reservado a otro dia u hora)`

pasa a incluir ejemplos:
> `reprogramar (cambiar/mover un turno ya reservado a otro dia u hora, ej: cambiame para mas tarde, tenes otro horario, lo quiero mas temprano, movelo a las 20, cambialo para mañana)`

## Comportamiento resultante
Nico (con turno 18hs) dice "cambiame para más tarde" → intención `reprogramar` → Cerebro resuelve el turno por `lastResId` y responde "¿A qué día y hora querés cambiar tu turno?" (setea `esperaReprog`); al responder el horario, reprograma manteniendo la seña. (Sin cambios en Cerebro.)

## Riesgo y mitigación
- **Sobre-clasificación:** el hint podría empujar a `reprogramar`/`cancelar` mensajes ambiguos. Mitigación: el hint es condicional (solo cuando hay turno) y explícito ("si no, interpretalo normal"). Se observa en el smoke test.
- No cambia el flujo de reserva en progreso (rama `enReserva` intacta).

## Testing
Sin tests automáticos en n8n. Validación:
1. Sintaxis del Prompt vía AsyncFunction sobre el workflow guardado.
2. Smoke test (con Evolution), partiendo de un turno confirmado:
   - "cambiame para más tarde" → el bot pregunta a qué día/hora y luego reprograma (no ofrece reservar uno nuevo).
   - "tenés otro horario?" → reprogramar.
   - "cancelalo" → cancelar (sigue funcionando).
   - Un cliente **sin** turno que dice "querés reservar?" → no cae en reprogramar.

## Fuera de alcance
- Bug #4 (cancelar/reprogramar muy cerca del horario deja colgado al cliente).
- Backend/frontend, Cerebro.

## Despliegue
En vivo sobre `I8yiX4g1rGh5Hb2U` vía patchNodeField, backup por version history de n8n. Ver [[bot-debounce-mensajes]].

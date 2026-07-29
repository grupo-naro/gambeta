# Bot WhatsApp — Respuestas concisas y menos vueltas — Design

**Fecha:** 2026-07-06
**Estado:** Aprobado
**Componente:** workflow n8n "Canchitas — Bot v2" (`I8yiX4g1rGh5Hb2U`), nodo **Cerebro**. Sin backend/frontend.

## Problema

El cliente (dueño del complejo) reporta que el bot "da muchas vueltas", repite preguntas y es poco conciso. Quiere que reservar / modificar / cancelar sea directo: pedir lo necesario de una y responder corto.

## Objetivo

- **Tono seco y directo** en todas las respuestas (máximo 1-2 frases, sin relleno).
- **Reservar en menos turnos:** pedir día + hora + tamaño/cancha juntos cuando falten, en vez de uno por vez.
- Mantener el **upsell** de cancha destacada, pero en una sola línea.

## Diseño (ediciones al nodo Cerebro)

### 1. Humanizer más seco (`hBody` systemInstruction)
El humanizer reescribe TODAS las respuestas (salvo comprobante/opciones/`alreadyNatural`). Cambiar:
- *"Tono cordial, relajado, cercano y breve, como una persona real (no un robot)."* → *"Tono directo, claro y conciso, como una persona real pero sin vueltas ni relleno."*
- *"1 a 3 frases"* → *"maximo 1 o 2 frases cortas"*.

Se mantienen intactas las reglas duras: no inventar; mantener EXACTOS horas, montos, alias, CBU, nombres de cancha y listas de turnos; respetar expresiones de fecha; no saludar salvo que el cliente salude en ese mensaje; sin emojis o como mucho uno.

### 2. Reservar — pedir todo junto cuando falta el tamaño (rama `!jugadores`)
Hoy: `reply='Dale! Tenemos canchas de <tamaños>. Cual queres?'` (pide solo tamaño → luego día → luego hora = 3 vueltas).
Nuevo: un solo pedido con lo que falte. Arma una lista de faltantes (`que dia` si no hay fecha, `a que hora` si no hay hora, y siempre `de cuantos jugadores (o que cancha)`), y responde:
> *"Dale. Decime `<faltantes unidos por coma>` y te la reservo. Tenemos de `<tamaños>`."*

Preserva `fecha`/`hora` ya provistas en el `store` (como hoy).

### 3. Reservar — si faltan día y hora, pedir ambos (rama `!fecha`)
Hoy: `reply='Para que dia queres la cancha de <jugadores>? (ej: hoy, manana, el viernes)'` y `store={jugadores}` (pierde `hora`).
Nuevo:
- Si además falta hora: *"Decime qué día y a qué hora querés la de `<jugadores>`."*
- Si ya hay hora: *"¿Para qué día querés la de `<jugadores>` a las `<hora>`?"*
- `store` preserva `jugadores` y `hora` (no perder la hora ya dada).

### 4. Lista de horarios (rama con tamaño+fecha, sin hora)
Se mantiene el listado de turnos libres (es informativo, un solo turno). Solo se acorta la frase:
> *"En canchas de `<jugadores>` el `<fecha>` tengo: `<horas>`. ¿A qué hora?"*

### 5. Upsell corto (estándar + destacada libres)
Se mantiene el ofrecimiento, en una línea:
> *"A las `<hora>` te queda la `<estándar>`, o la `<destacada>` (`<precio>`). ¿Cuál?"*
(Reemplaza el texto largo actual "…tenés una cancha de N, y también la X (… la hora). Cuál preferís: la de N o la X?".)

**Nota:** las ramas de upsell y opciones setean `skipHuman` (no pasan por el humanizer), por eso su wording debe quedar ya conciso en el template.

## Alcance / no-cambios
- **Modificar/cancelar:** la lógica no cambia (reprogramar ya pide "¿a qué día y hora?" en una sola). El humanizer más seco las acorta igual.
- **Confirmar nombre:** se mantiene ("¿A nombre de quién?") — es un dato necesario.
- Sin cambios en intención/clasificación (Prompt), backend, frontend ni DB.

## Riesgo
- **Demasiado seco:** el humanizer podría sonar cortante. Mitigación: se pide "directo, claro y conciso, como una persona real" (no robótico) y se conservan las reglas de exactitud. Se ajusta el wording tras el smoke test si suena frío.
- **Pérdida de datos en el store:** los cambios en las ramas `!jugadores`/`!fecha` deben preservar `fecha`/`hora`/`jugadores` ya provistos (explícito en el diseño).

## Testing
Sin tests automáticos en n8n. Validación:
1. Sintaxis del Cerebro vía AsyncFunction sobre el workflow guardado.
2. Smoke test (con Evolution): "quiero reservar" → un solo pedido combinado; "mañana 20 de 5" → ofrece cancha/upsell y confirma en 1-2 turnos; respuestas visiblemente más cortas; modificar/cancelar cortos.

## Despliegue
En vivo sobre `I8yiX4g1rGh5Hb2U` vía patchNodeField, backup por version history de n8n. Ver [[bot-debounce-mensajes]].

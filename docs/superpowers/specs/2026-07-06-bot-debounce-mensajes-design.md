# Bot WhatsApp — Debounce de mensajes (buffer 30s) — Design

**Fecha:** 2026-07-06
**Estado:** Aprobado
**Componente:** workflow n8n "Canchitas — Bot v2" (id `I8yiX4g1rGh5Hb2U`). Solo bot; sin backend ni frontend.

## Problema

El webhook dispara una ejecución por cada mensaje entrante. Cuando un cliente escribe en ráfaga (ej: "no puedo ir hoy" e inmediatamente "porque se me complicó a las 18"), el bot procesa cada mensaje por separado y malinterpreta: toma el "18" del segundo mensaje como intención de reservar a las 18:00. Hay que **agrupar** los mensajes seguidos de un mismo cliente y procesarlos juntos como un solo input.

## Solución (debounce con ventana deslizante de 30s)

Bufferear los mensajes de texto en Redis; cada mensaje nuevo reinicia la ventana. Solo la ejecución del **último** mensaje (tras 30s sin nada nuevo) procesa el texto combinado; las anteriores abortan sin responder.

- **Ventana:** 30 segundos desde el último mensaje.
- **Multimedia:** imagen/PDF (comprobante) y audios cuya transcripción falló **bypassean** el buffer y se procesan al instante. El audio transcripto OK entra al buffer como texto (la transcripción ya ocurre en `Extraer`).

## Topología del workflow

Actual: `Webhook → Extraer → Leer contexto → Prompt → Cerebro → Guardar contexto → Enviar Evolution`.

Nueva:
```
Webhook → Extraer → IF ¿multimedia inmediata?
   ├─ TRUE (esImagen || esPdf || audioFallo) ───────────────→ Mensaje ─┐
   └─ FALSE (texto o audio transcripto)                                 │
        → Redis Push (buf) → Redis Incr (seq) → Wait 30s                │
        → Redis Get (seq) → IF ¿soy el último? (myseq == curseq)        │
             ├─ FALSE → (rama termina, sin salida → no responde)        │
             └─ TRUE → Redis Get (buf, list) → Redis Del (buf+seq)      │
                       → Combinar (Code) ─────────────────────→ Mensaje ┘
   Mensaje → Leer contexto → Prompt → Cerebro → Guardar contexto → Enviar Evolution
```

### Nodos nuevos
1. **IF ¿multimedia inmediata?** — condición `{{ $json.esImagen || $json.esPdf || $json.audioFallo }}`. TRUE → `Mensaje`. FALSE → `Redis Push`.
2. **Redis Push** — operación `push` (RPUSH) a `buf:{{ $json.number }}` (list) con el valor `{{ $json.text }}`; `expire` ttl 120s. Debe preservar los campos del ítem entrante.
3. **Redis Incr** — operación `incr` sobre `seq:{{ $json.number }}`, resultado en propiedad `myseq`; `expire` ttl 120s.
4. **Wait** — 30 segundos.
5. **Redis Get seq** — operación `get`, keyType `string`, key `seq:{{ $json.number }}`, propiedad `curseq`.
6. **IF ¿soy el último?** — condición numérica `{{ Number($json.myseq) }}` **igual a** `{{ Number($json.curseq) }}`. FALSE → sin conexión de salida (la ejecución termina, no responde). TRUE → `Redis Get buffer`.
7. **Redis Get buffer** — operación `get`, keyType `list`, key `buf:{{ $json.number }}`, propiedad `bufItems` (array en orden cronológico).
8. **Redis Del** — operación `delete` de `buf:{{ $json.number }}` y `seq:{{ $json.number }}` (dos claves; si el nodo Redis borra una sola, encadenar dos nodos delete o usar el que soporte varias).
9. **Combinar** (Code) — une `bufItems` en un solo texto y emite el ítem canónico (ver contrato abajo).
10. **Mensaje** — nodo de convergencia de ambas ramas; su salida es el ítem canónico. Puede ser un Code node passthrough (`return $input.all();`) o NoOp. Es el nodo que Prompt/Cerebro referencian como fuente del mensaje.

### Contrato del ítem canónico (salida de `Mensaje`)
Mismos campos que hoy emite `Extraer`:
`number, text, esImagen, esPdf, esAudio, audioFallo, base64, mime, msgId, pushName, hoy, diaSemana`.
- Rama multimedia: es el ítem de `Extraer` sin cambios.
- Rama buffer (nodo `Combinar`): `text` = `bufItems.join('. ')` (o `'\n'`); `esImagen=false`, `esPdf=false`, `audioFallo=false`; el resto (`number, msgId, pushName, hoy, diaSemana, esAudio, base64, mime`) tomado del último mensaje vía `$('Extraer').first().json`.

## Ediciones a nodos existentes
- **Prompt** — `const e=$('Extraer').first().json;` → `$('Mensaje')`. (1 referencia.) Así `e.text` y el `geminiBody` usan el texto combinado.
- **Cerebro** — reemplazar todas las referencias `$('Extraer')` por `$('Mensaje')` (~4: `number`, dentro de `fechaLinda` el `hoy`, `const E=`, `const E2=`). El texto combinado alimenta la extracción de intención, el resolver `mencionaComun`, el mute post-reserva y el resto de la lógica.
- La dedup por `msgId` (`seen`) y el mute `postReserva` siguen funcionando: cada mensaje sigue teniendo su ejecución, pero solo la del último llega a Cerebro; el `msgId` del último es el que se registra.

## Precondiciones a verificar ANTES de construir
1. **El nodo Wait reanuda** correctamente en este n8n (histórico de queue mode que colgaba ejecuciones). Prueba mínima: un workflow o rama de test con Wait 30s que confirme que reanuda. Si no reanuda, ajustar config de n8n (worker / `WEBHOOK_URL`) antes de seguir.
2. **El Webhook responde "inmediatamente"** (no "al finalizar el workflow"). Si respondiera al final, el Wait retrasaría 30s el 200 a Evolution y podría gatillar reintentos → mensajes duplicados. Confirmar/ajustar el modo de respuesta del webhook.

## Casos borde
- **Texto buffereado + comprobante:** el comprobante se procesa al instante (rama inmediata); el texto pendiente sigue su timer y responde por separado. Aceptado.
- **Mensaje justo después del cierre:** inicia su propia ventana de 30s → respuesta separada. Correcto.
- **Ejecución abortada (no última):** no borra el buffer; la ganadora lo borra. TTL de 120s limpia buffers huérfanos si la ganadora fallara.
- **Race entre lectura de buffer y mensaje nuevo:** si llega un mensaje después de que la ganadora leyó y borró el buffer, ese mensaje arranca ventana nueva con su propio texto. Aceptado.

## Testing
Sin tests automáticos en n8n. Validación:
1. Prueba de reanudación del Wait (precondición 1).
2. Sintaxis de los Code nodes (`Combinar`, `Prompt`, `Cerebro`) vía AsyncFunction sobre el workflow ya guardado: `new (Object.getPrototypeOf(async function(){}).constructor)(jsCode)`.
3. Smoke test manual una vez vinculado Evolution: mandar 2-3 mensajes seguidos y verificar una sola respuesta que considera todos; mandar un solo mensaje y verificar respuesta a los ~30s; mandar comprobante y verificar respuesta inmediata.

## Fuera de alcance
- Backend / frontend / panel.
- Cambiar la duración por cliente o hacerla configurable (fija en 30s).
- Indicador de "escribiendo…" durante la espera.

## Despliegue
Cambios aplicados en vivo sobre el workflow n8n con backup previo (`n8n_get_workflow` full guardado antes de tocar). Todo dentro del workflow `I8yiX4g1rGh5Hb2U`.

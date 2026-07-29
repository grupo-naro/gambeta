# Panel de dev — Visor de conversaciones del bot (local) — Design

**Fecha:** 2026-07-07
**Estado:** Aprobado
**Componente:** herramienta local nueva `dev-panel/` (Node/Express + una página HTML). No se deploya. No toca el bot, backend ni frontend.

## Problema

Para dar contexto y depurar el bot, el dueño necesita ver las **conversaciones completas** cliente↔bot. Evolution Manager solo muestra los mensajes **salientes** del bot, no los **entrantes** de los clientes. Hace falta una vista local que muestre las dos puntas: qué escribe la gente, cómo, y qué contesta el bot.

## Fuente de datos

**Historial de ejecuciones de n8n** (workflow `I8yiX4g1rGh5Hb2U`), vía REST API sobre Tailscale (`GET {N8N_URL}/api/v1/executions?workflowId=...&includeData=true`). Cada ejecución guarda el output de los nodos (el workflow tiene `saveDataSuccessExecution: 'all'`):
- Nodo **`Extraer`** → mensaje **entrante** del cliente: `number`, `text` (para audio, la transcripción), `esImagen`/`esAudio`/`esPdf`, `msgId`, `hoy`. (Esto es lo que Evolution Manager esconde.)
- Nodo **`Cerebro`** → respuesta **saliente**: `replyText`, y `redisValue` (el estado que el bot guarda en Redis: última reserva, esperaNombre, seen, etc.).

No se conecta a Evolution ni a Redis directamente: el estado de Redis ya viene en el output del Cerebro. Funciona con la data histórica ya guardada y en vivo cuando se revincule Evolution.

## Arquitectura

Servidor local Node/Express (`dev-panel/server.js`), bindeado a `127.0.0.1`:
- **`GET /api/conversaciones`** — trae las últimas N ejecuciones de n8n (API key en header, desde `.env`), parsea el `runData` y arma una lista de turnos: `{ number, ts, dir: 'in'|'out', texto, media?, estado? }`. Agrupa por `number`, ordena por `ts`. Devuelve JSON. La API key **nunca** se expone al navegador.
- **`GET /`** — sirve una página HTML estática (single file, JS inline) que:
  - Muestra a la izquierda la lista de clientes (números) con el último mensaje.
  - A la derecha, la conversación del cliente elegido: burbujas **cliente a la izquierda** / **bot a la derecha**, con hora. Los mensajes de audio/imagen se marcan (`[audio: …]`, `[imagen]`, `[pdf]`).
  - Un desplegable por turno del bot con el **estado** guardado (`redisValue`), para ver qué "recuerda".
  - **Auto-refresh** cada ~12s (re-fetch a `/api/conversaciones`).

### Parseo del `runData`
Por ejecución: `execution.data.resultData.runData['Extraer'][0].data.main[0][0].json` (entrante) y `...runData['Cerebro'][0].data.main[0][0].json` (saliente). Ejecuciones sin `Cerebro` (mensajes de ráfaga que abortaron por el debounce, o filtrados) aportan solo el mensaje entrante — se muestran igual (así se ve cada mensaje de ráfaga). Ejecuciones sin `Extraer` con output (grupos/fromMe) se ignoran.
**Nota:** la forma exacta del `data` de la ejecución varía según versión de n8n; el parser se valida contra una ejecución real durante la implementación y se adapta (defensivo: si falta un nodo, se saltea sin romper).

## Configuración
`dev-panel/.env` (gitignored): `N8N_URL=http://100.77.36.68:5678`, `N8N_API_KEY=<key>`, `WORKFLOW_ID=I8yiX4g1rGh5Hb2U`, `PORT=4545`, `LIMIT=200`. Un `.env.example` sin secretos.

## Alcance / no-alcance
- Solo lectura, solo local, sin auth (bindeado a localhost).
- No muestra la *intención* que detectó Gemini (es interna al Cerebro, no está en el output). Muestra mensaje + respuesta + estado. Se puede agregar después guardando la intención en `redisValue`.
- Solo conversaciones 1‑a‑1 que le llegan al bot (no grupos, no mensajes que el bot manda por fuera del workflow).
- No toca repos que se deployan; es una carpeta aparte.

## Errores / resiliencia
- Si n8n no responde (Tailscale caído), la página muestra "sin conexión con n8n" y reintenta en el próximo refresh (no rompe).
- Parser defensivo ante ejecuciones con forma inesperada (saltea, no crashea).

## Testing
- Unit del parser: dado un objeto de ejecución de ejemplo (fixture real capturado), extrae los turnos esperados (in/out, número, texto, estado).
- Manual: `node dev-panel/server.js` → abrir `localhost:4545` → se ven conversaciones históricas agrupadas por cliente.

## Stack
Node + Express (o `http` nativo para cero deps), `dotenv`, `fetch` nativo (Node 18+). Página HTML/JS sin framework. Mínimas dependencias.

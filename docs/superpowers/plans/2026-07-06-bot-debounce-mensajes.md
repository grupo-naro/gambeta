# Bot WhatsApp — Debounce de mensajes (buffer 30s) — Implementation Plan

> **Ejecución:** trabajo directo sobre n8n vía MCP (no subagentes). Cada tarea termina en un estado verificable. Checkboxes `- [ ]` para tracking.

**Goal:** Que el bot agrupe los mensajes de texto/audio que un cliente manda en ráfaga dentro de una ventana de 30s y los procese como un solo input, en vez de responder a cada uno por separado.

**Architecture:** Debounce con ventana deslizante en el workflow `I8yiX4g1rGh5Hb2U`. Los mensajes de texto se apilan en una lista Redis `buf:<numero>` (cada entrada lleva un token único). Tras un nodo Wait de 30s, sólo la ejecución cuyo token es el último elemento de la lista procesa el texto combinado; las demás abortan. Imagen/PDF y audios fallidos bypassean el buffer.

**Tech Stack:** n8n (nodos Code v2, Redis v1, IF v2, Wait v1.1). Redis credential id `6UaPDSqMMaYTJN1g` ("Redis Canchitas"). Gemini para intención/visión (sin cambios).

## Global Constraints
- Todo dentro del workflow `I8yiX4g1rGh5Hb2U` ("Canchitas — Bot v2"). Sin cambios en backend/frontend.
- Ventana fija de **30 segundos**.
- Multimedia inmediata (bypass buffer): `esImagen || esPdf || audioFallo`. Audio transcripto OK va al buffer como texto.
- Backup del workflow ANTES de tocar nada.
- Evolution está **apagado** (post-lanzamiento con errores): no hay tráfico real; el smoke test queda diferido a cuando se revincule.
- Los nodos Redis preservan el ítem entrante (get agrega su `propertyName`; set/delete pasan el ítem). Verificado contra el workflow actual (Guardar contexto → Enviar usa `$json`).
- Referenciar `number`/`myToken` en expresiones vía `$('Marcar').item.json.…` (no `$json`) después del push, para no depender del passthrough del push.

---

### Task 1: Backup + verificar precondiciones (Wait reanuda, Webhook responde inmediato)

**Objetivo:** No construir nada hasta confirmar que el Wait reanuda en este n8n y que el webhook no bloquea la respuesta a Evolution.

- [ ] **Step 1: Backup del workflow completo**

`n8n_get_workflow` mode `full` id `I8yiX4g1rGh5Hb2U` → guardar el JSON en `scratchpad/bot-backup-<fecha>.json`. Este es el punto de restauración.

- [ ] **Step 2: Verificar modo de respuesta del Webhook**

`n8n_get_workflow` mode `filtered` nodeNames `["Webhook WhatsApp"]`. Mirar `parameters.responseMode`:
- Si es `onReceived` (responde al recibir) → OK, no tocar.
- Si es `lastNode` o `responseNode` → cambiar a `onReceived` con `n8n_update_partial_workflow` (updateNode), porque con el Wait la respuesta a Evolution se demoraría 30s y podría gatillar reintentos → mensajes duplicados.
Registrar el valor encontrado.

- [ ] **Step 3: Prueba de reanudación del Wait (workflow de test aparte)**

Crear un workflow temporal con `n8n_create_workflow`: Manual Trigger → Wait (timeInterval, 20s) → Set/NoOp. Ejecutarlo con `n8n_test_workflow` (o disparo manual) y confirmar vía `n8n_executions` que la ejecución pasa a `waiting` y luego **finaliza `success`** tras ~20s.
- Si finaliza OK → Wait reanuda; continuar. Borrar el workflow de test (`n8n_delete_workflow`).
- Si queda colgado en `waiting` para siempre → **DETENER el plan** y avisar al usuario: hay que arreglar la config de n8n (worker de queue mode / `WEBHOOK_URL`) antes de seguir. No construir el debounce sobre un Wait roto.

---

### Task 2: Agregar los nodos nuevos

**Objetivo:** Crear los 6 nodos del pipeline de buffer + el nodo de convergencia, sin conectarlos todavía (o conectándolos en Task 3). Usar `n8n_update_partial_workflow` con operaciones `addNode`.

Posiciones sugeridas (para que quede prolijo): Extraer está en [220,0]; poner IF en [360,0], y la rama buffer descendiendo en y.

- [ ] **Step 1: IF "¿Multimedia?"** (`n8n-nodes-base.if`, typeVersion 2, pos [380,-40])

```json
{
  "parameters": {
    "conditions": {
      "options": { "caseSensitive": true, "typeValidation": "loose", "version": 2 },
      "combinator": "and",
      "conditions": [
        { "leftValue": "={{ $json.esImagen || $json.esPdf || $json.audioFallo }}",
          "rightValue": "", "operator": { "type": "boolean", "operation": "true", "singleValue": true } }
      ]
    },
    "options": {}
  }
}
```
Salida 0 (true) = multimedia inmediata → irá a Mensaje. Salida 1 (false) = texto/audio → irá a Marcar.

- [ ] **Step 2: Code "Marcar"** (`n8n-nodes-base.code`, typeVersion 2, pos [560,120])

```javascript
const E = $('Extraer').first().json;
const myToken = Date.now() + '-' + Math.random().toString(36).slice(2);
return [{ json: Object.assign({}, E, { myToken, entry: JSON.stringify({ t: myToken, x: E.text || '' }) }) }];
```

- [ ] **Step 3: Redis "Bufferear"** (`n8n-nodes-base.redis`, typeVersion 1, pos [740,120])

```json
{
  "parameters": { "operation": "push", "list": "=buf:{{ $json.number }}", "messageData": "={{ $json.entry }}", "tail": true },
  "credentials": { "redis": { "id": "6UaPDSqMMaYTJN1g", "name": "Redis Canchitas" } }
}
```
(push = RPUSH con tail:true; sin TTL — el ganador borra la lista. Ver nota de orphans al final.)

- [ ] **Step 4: Wait "Esperar 30s"** (`n8n-nodes-base.wait`, typeVersion 1.1, pos [920,120])

```json
{ "parameters": { "resume": "timeInterval", "amount": 30, "unit": "seconds" } }
```

- [ ] **Step 5: Redis "Leer buffer"** (`n8n-nodes-base.redis`, typeVersion 1, pos [1100,120])

```json
{
  "parameters": { "operation": "get", "key": "=buf:{{ $('Marcar').item.json.number }}", "keyType": "list", "propertyName": "bufItems", "options": {} },
  "credentials": { "redis": { "id": "6UaPDSqMMaYTJN1g", "name": "Redis Canchitas" } }
}
```

- [ ] **Step 6: Code "¿Último?"** (`n8n-nodes-base.code`, typeVersion 2, pos [1280,120])

```javascript
const E = $('Extraer').first().json;
const myToken = $('Marcar').first().json.myToken;
let items = $json.bufItems;
if (!Array.isArray(items)) items = items ? [items] : [];
const parsed = items.map((s) => { try { return JSON.parse(s); } catch (e) { return { t: '', x: String(s || '') }; } });
const last = parsed[parsed.length - 1] || {};
if (last.t !== myToken) { return []; } // no soy el último → abortar sin responder
const combined = parsed.map((p) => (p.x || '').trim()).filter(Boolean).join('. ');
return [{ json: Object.assign({}, E, { text: combined, esImagen: false, esPdf: false, audioFallo: false }) }];
```

- [ ] **Step 7: Redis "Limpiar buffer"** (`n8n-nodes-base.redis`, typeVersion 1, pos [1460,120])

```json
{
  "parameters": { "operation": "delete", "key": "=buf:{{ $('Marcar').item.json.number }}" },
  "credentials": { "redis": { "id": "6UaPDSqMMaYTJN1g", "name": "Redis Canchitas" } },
  "onError": "continueRegularOutput"
}
```
(Sólo corre para el ganador — el que abortó no emite ítem. Deja la lista lista para el próximo turno.)

- [ ] **Step 8: Code "Mensaje"** (`n8n-nodes-base.code`, typeVersion 2, pos [640,0])

```javascript
return $input.all();
```
Nodo de convergencia. Su salida es el ítem canónico (campos de Extraer, con `text` combinado en la rama buffer). Recibe de dos ramas; sólo una entrega por ejecución.

- [ ] **Step 9: Validar los nodos**

`n8n_validate_workflow` (o `validate_node` sobre cada nodo nuevo). Corregir cualquier error de parámetros (nombres/typeVersion) antes de seguir. Esperado: sin errores de configuración (habrá warnings de conexiones hasta la Task 3).

---

### Task 3: Reconectar el flujo

**Objetivo:** Insertar el pipeline entre Extraer y Leer contexto. Usar `n8n_update_partial_workflow` con `removeConnection` / `addConnection`.

- [ ] **Step 1: Quitar la conexión vieja**

removeConnection: `Extraer` → `Leer contexto`.

- [ ] **Step 2: Agregar las conexiones nuevas**

addConnection (todas `main`):
- `Extraer` → `¿Multimedia?`
- `¿Multimedia?` salida 0 (true) → `Mensaje`
- `¿Multimedia?` salida 1 (false) → `Marcar`
- `Marcar` → `Bufferear`
- `Bufferear` → `Esperar 30s`
- `Esperar 30s` → `Leer buffer`
- `Leer buffer` → `¿Último?`
- `¿Último?` → `Limpiar buffer`
- `Limpiar buffer` → `Mensaje`
- `Mensaje` → `Leer contexto`

- [ ] **Step 3: Verificar topología**

`n8n_get_workflow` mode `structure`. Confirmar que el grafo coincide con el diagrama del spec y que `Leer contexto → Prompt → Cerebro → Guardar contexto → Enviar Evolution` sigue intacto.

---

### Task 4: Apuntar Prompt y Cerebro al texto combinado

**Objetivo:** Que Prompt y Cerebro lean el mensaje desde `Mensaje` (texto combinado) en vez de `Extraer` (mensaje suelto). Usar `n8n_update_partial_workflow` con `patchNodeField` (find/replace estricto).

- [ ] **Step 1: Patch Prompt**

En `parameters.jsCode`, reemplazar:
- find: `const e=$('Extraer').first().json;`
- replace: `const e=$('Mensaje').first().json;`

- [ ] **Step 2: Patch Cerebro (4 referencias)**

En `parameters.jsCode`, reemplazar una por una (cada find es único en su contexto):
- `const number=($('Extraer').first().json.number)||P.number;` → `const number=($('Mensaje').first().json.number)||P.number;`
- `const hh=(($('Extraer').first().json.hoy)||'').split('-').map(Number);` → `const hh=(($('Mensaje').first().json.hoy)||'').split('-').map(Number);`
- `const E=$('Extraer').first().json;` → `const E=$('Mensaje').first().json;`
- `const E2=$('Extraer').first().json;` → `const E2=$('Mensaje').first().json;`

Si algún `patchNodeField` reporta match múltiple o cero, inspeccionar el jsCode actual (`n8n_get_workflow` filtered) y ajustar el `find` para que sea único.

- [ ] **Step 3: Verificar que no quedan referencias colgadas**

`n8n_get_workflow` filtered `["Prompt","Cerebro"]` y confirmar que **no** aparece `$('Extraer')` en ninguno de los dos (todas migradas a `$('Mensaje')`).

---

### Task 5: Validación final (sintaxis + workflow)

- [ ] **Step 1: Validar el workflow completo**

`n8n_validate_workflow` id `I8yiX4g1rGh5Hb2U`. Esperado: sin errores (warnings aceptables si son de expresiones dinámicas conocidas).

- [ ] **Step 2: Chequeo de sintaxis de los Code nodes**

Traer el workflow (`n8n_get_workflow` filtered `["Marcar","¿Último?","Mensaje","Prompt","Cerebro"]`) y para cada `jsCode` correr `new (Object.getPrototypeOf(async function(){}).constructor)(jsCode)` para confirmar que parsea (sin ejecutar). Esperado: sin excepción.

- [ ] **Step 3: Confirmar workflow activo**

`n8n_get_workflow` mode `minimal` → `active: true`. Si el update lo desactivó, reactivarlo.

---

### Task 6 (DIFERIDA hasta revincular Evolution): Smoke test

No ejecutable ahora (Evolution apagado). Cuando se revincule:
- [ ] Mandar 2-3 mensajes de texto seguidos (ráfaga) → esperar **una sola** respuesta que considere todos.
- [ ] Mandar un único mensaje → respuesta a los ~30s.
- [ ] Mandar un comprobante (imagen) → respuesta **inmediata** (sin esperar 30s).
- [ ] Revisar `n8n_executions` para confirmar que las ejecuciones "no ganadoras" terminan sin enviar mensaje.

---

## Self-Review
- **Cobertura del spec:** topología (Task 3), nodos buffer + Mensaje (Task 2), edición Prompt/Cerebro (Task 4), precondiciones Wait+webhook (Task 1), validación (Task 5), smoke test diferido (Task 6). Cubierto.
- **Modelo Redis:** el spec decía RPUSH a lista; confirmado que el nodo soporta `push`/`get(list)`/`delete`. El "último" se decide por token en la entrada (más robusto que el `incr` del spec original — mejora aplicada en el plan).
- **Consistencia de nombres:** `buf:<number>` en Bufferear/Leer buffer/Limpiar; `myToken`/`entry` producidos por Marcar y consumidos por ¿Último?; `bufItems` de Leer buffer consumido por ¿Último?; `$('Mensaje')` en Prompt y Cerebro.
- **Orphans:** `push` no tiene TTL; una lista queda huérfana sólo si la ejecución ganadora nunca reanuda el Wait (= falla de precondición 1). Aceptado; si pasara, se limpia borrando `buf:*` a mano. YAGNI un cleanup automático.

## Riesgos abiertos
- Precondición 1 (Wait) es bloqueante: si falla, no se construye (Task 1 Step 3 detiene el plan).
- El passthrough exacto de cada nodo Redis se asume por analogía con el workflow actual; la validación (Task 5) y, más adelante, el smoke test (Task 6) lo confirman.

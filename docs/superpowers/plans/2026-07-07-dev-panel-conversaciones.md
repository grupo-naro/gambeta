# Panel de dev — Visor de conversaciones (local) — Implementation Plan

> Herramienta local standalone. El workspace raíz no es repo git → sin commits; el entregable es la carpeta `dev-panel/` funcionando.

**Goal:** Página web local que muestra las conversaciones cliente↔bot (ambas puntas) leyendo el historial de ejecuciones de n8n.

**Architecture:** Servidor Node zero-dep (`http` + `fetch` nativo, Node 18+) en `dev-panel/`, bindeado a `127.0.0.1`. Un parser convierte ejecuciones de n8n en turnos; un endpoint JSON los sirve; una página HTML los renderiza con auto-refresh.

**Stack:** Node ≥18 (fetch nativo), sin dependencias npm. HTML/JS sin framework.

## Global Constraints
- Solo local, solo lectura, bind a `127.0.0.1`. La API key vive en `dev-panel/.env`, nunca se manda al navegador.
- No tocar backend/frontend/bot.
- Fuente: `GET {N8N_URL}/api/v1/executions?workflowId=&includeData=true&limit=`. Nodos `Extraer` (entrante) y `Cerebro` (saliente: `replyText`, `redisValue`).

---

### Task 1: Scaffold + capturar la forma real de una ejecución

**Files:** `dev-panel/.env`, `dev-panel/.env.example`, `dev-panel/fixture-execution.json`

- [ ] **Step 1: Crear `dev-panel/.env`**
```
N8N_URL=http://100.77.36.68:5678
N8N_API_KEY=<pegar la key de ~/.claude.json (X-N8N-API-KEY del MCP n8n)>
WORKFLOW_ID=I8yiX4g1rGh5Hb2U
PORT=4545
LIMIT=200
```
Y un `dev-panel/.env.example` igual pero con `N8N_API_KEY=` vacío.

- [ ] **Step 2: Traer 1 ejecución real con data y guardarla como fixture** (para ver la forma exacta de `runData`)
```bash
cd dev-panel
set -a; . ./.env; set +a
# id de una ejecución reciente:
ID=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_URL/api/v1/executions?workflowId=$WORKFLOW_ID&limit=1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log((j.data&&j.data[0]&&j.data[0].id)||'')})")
curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_URL/api/v1/executions/$ID?includeData=true" -o fixture-execution.json
node -e "const e=require('./fixture-execution.json'); const rd=e.data&&e.data.resultData&&e.data.resultData.runData; console.log('nodos:', rd?Object.keys(rd):'(data no es objeto — inspeccionar)'); if(rd&&rd.Extraer)console.log('Extraer json:', JSON.stringify(rd.Extraer[0].data.main[0][0].json)); if(rd&&rd.Cerebro)console.log('Cerebro json:', JSON.stringify(rd.Cerebro[0].data.main[0][0].json));"
```
Expected: imprime los nodos y el `json` de `Extraer`/`Cerebro`. **Confirmar la ruta real** `data.resultData.runData[nodo][0].data.main[0][0].json`. Si `e.data` viene como string (algunas versiones), ajustar: `JSON.parse(e.data)`. Anotar la forma confirmada para el parser.

---

### Task 2: Parser + test

**Files:** `dev-panel/parser.js`, `dev-panel/parser.test.js`

**Interfaces:**
- `parseEjecucion(exec)` → `{ number, ts, dir, texto, media, estado } | null` por ejecución.
- `agruparConversaciones(execs)` → `[{ number, turnos: [{ ts, dir, texto, media, estado }] }]` ordenado.

- [ ] **Step 1: Escribir `parser.js`**
```javascript
// Extrae el json de un nodo de una ejecución de n8n (defensivo).
function nodoJson(exec, nombre) {
  try {
    let data = exec.data;
    if (typeof data === 'string') data = JSON.parse(data);
    const rd = data && data.resultData && data.resultData.runData;
    const run = rd && rd[nombre];
    return run && run[0] && run[0].data && run[0].data.main && run[0].data.main[0] && run[0].data.main[0][0]
      ? run[0].data.main[0][0].json : null;
  } catch { return null; }
}

// Una ejecución → hasta 2 turnos (entrante del cliente y, si hay, respuesta del bot).
function turnosDeEjecucion(exec) {
  const ts = exec.startedAt || exec.stoppedAt || null;
  const ex = nodoJson(exec, 'Extraer');
  const ce = nodoJson(exec, 'Cerebro');
  const number = (ex && ex.number) || (ce && ce.number) || null;
  if (!number) return [];
  const out = [];
  if (ex) {
    let media = null;
    if (ex.esImagen) media = 'imagen'; else if (ex.esPdf) media = 'pdf'; else if (ex.esAudio) media = 'audio';
    out.push({ number, ts, dir: 'in', texto: ex.text || '', media });
  }
  if (ce && ce.replyText) {
    out.push({ number, ts, dir: 'out', texto: ce.replyText, estado: ce.redisValue || null });
  }
  return out;
}

function agrupar(execs) {
  const porNum = new Map();
  for (const e of execs) for (const t of turnosDeEjecucion(e)) {
    if (!porNum.has(t.number)) porNum.set(t.number, []);
    porNum.get(t.number).push(t);
  }
  const conv = [];
  for (const [number, turnos] of porNum) {
    turnos.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    conv.push({ number, turnos, ultimo: turnos[turnos.length - 1] });
  }
  conv.sort((a, b) => new Date(b.ultimo.ts) - new Date(a.ultimo.ts));
  return conv;
}

module.exports = { turnosDeEjecucion, agrupar };
```
(Ajustar `nodoJson` a la forma confirmada en Task 1 si difiere.)

- [ ] **Step 2: Test `parser.test.js`** (usa la fixture real + un caso armado; corre con `node --test`)
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { turnosDeEjecucion, agrupar } = require('./parser.js');

test('extrae entrante y saliente de una ejecución', () => {
  const exec = { startedAt: '2026-07-06T21:00:00.000Z', data: { resultData: { runData: {
    Extraer: [{ data: { main: [[{ json: { number: '549111', text: 'hola quiero cancha', esImagen: false, esAudio: false, esPdf: false } }]] } }],
    Cerebro: [{ data: { main: [[{ json: { number: '549111', replyText: 'Dale, decime dia y hora', redisValue: '{"jugadores":5}' } }]] } }],
  } } } };
  const t = turnosDeEjecucion(exec);
  assert.equal(t.length, 2);
  assert.equal(t[0].dir, 'in'); assert.equal(t[0].texto, 'hola quiero cancha');
  assert.equal(t[1].dir, 'out'); assert.equal(t[1].estado, '{"jugadores":5}');
});

test('ejecución solo con Extraer (ráfaga abortada) da 1 turno entrante', () => {
  const exec = { startedAt: '2026-07-06T21:00:05.000Z', data: { resultData: { runData: {
    Extraer: [{ data: { main: [[{ json: { number: '549111', text: 'para las 20' } }]] } }],
  } } } };
  const t = turnosDeEjecucion(exec);
  assert.equal(t.length, 1); assert.equal(t[0].dir, 'in');
});

test('agrupa por número y ordena', () => {
  const conv = agrupar([
    { startedAt: '2026-07-06T21:00:00Z', data: { resultData: { runData: { Extraer: [{ data: { main: [[{ json: { number: 'A', text: '1' } }]] } }] } } } },
    { startedAt: '2026-07-06T21:05:00Z', data: { resultData: { runData: { Extraer: [{ data: { main: [[{ json: { number: 'A', text: '2' } }]] } }] } } } },
  ]);
  assert.equal(conv.length, 1); assert.equal(conv[0].turnos.length, 2);
  assert.equal(conv[0].turnos[0].texto, '1');
});
```
Run: `node --test dev-panel/` → 3/3 pass. Además: correr el parser contra la fixture real (`node -e "const{agrupar}=require('./parser.js');console.log(JSON.stringify(agrupar([require('./fixture-execution.json')]),null,2))"`) y confirmar que extrae número/texto reales.

---

### Task 3: Servidor + página + verificación

**Files:** `dev-panel/server.js`, `dev-panel/public.html` (inline en server.js)

- [ ] **Step 1: `server.js`** (Node `http`, lee `.env` a mano, `fetch` nativo)
- Parseo simple de `.env` (líneas `K=V`).
- `GET /api/conversaciones`: `fetch(N8N_URL + '/api/v1/executions?workflowId='+WF+'&includeData=true&limit='+LIMIT, { headers: { 'X-N8N-API-KEY': KEY } })`; `agrupar(json.data)`; responde JSON. Try/catch → 502 `{error:'sin conexion con n8n'}`.
- `GET /`: sirve el HTML.
- `server.listen(PORT, '127.0.0.1')`.

- [ ] **Step 2: Página HTML** (inline): dos columnas — lista de clientes (número + último texto, orden por reciente) y panel de conversación (burbujas `dir==='in'` a la izquierda, `out` a la derecha, hora local; media marcada `[audio]`/`[imagen]`/`[pdf]`; `estado` en un `<details>`). `fetch('/api/conversaciones')` al cargar y cada 12s; si `error`, banner "sin conexión con n8n". CSS mínimo inline.

- [ ] **Step 3: Verificación (end-to-end)**
```bash
node dev-panel/server.js   # (en background o en otra terminal)
curl -s localhost:4545/api/conversaciones | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('conversaciones:', Array.isArray(j)?j.length:j)})"
```
Expected: imprime la cantidad de conversaciones (>0 si hay data histórica). Abrir `localhost:4545` en el navegador y confirmar que se ven las conversaciones con ambas puntas. Frenar el server tras verificar (o dejarlo corriendo para el usuario).

---

## Self-Review
- **Cobertura del spec:** fuente n8n executions (T1/T3), parser ambas puntas + estado (T2), server local + página auto-refresh (T3), resiliencia a n8n caído (T3 try/catch). Cubierto.
- **Placeholders:** ninguno (código completo; la key la pega el usuario en `.env`).
- **Riesgo:** la forma de `data.resultData.runData` varía por versión de n8n → Task 1 la confirma contra una ejecución real y el parser se ajusta; `nodoJson` es defensivo.
- **Seguridad:** bind a 127.0.0.1, key solo server-side en `.env`.

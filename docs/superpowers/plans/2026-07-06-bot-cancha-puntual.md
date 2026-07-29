# Bot — Reconocer cancha puntual por nombre — Implementation Plan

> **Ejecución:** trabajo directo sobre n8n vía MCP (no subagentes). Una sola tarea (4 patches + validación).

**Goal:** Que el bot resuelva por la cancha nombrada por el cliente ("la cancha 1 a las 21") sin volver a preguntar el tamaño, aunque falte el día/hora en ese mensaje.

**Architecture:** 3 patches al Code node `Cerebro` (rama `reservar/consultar_disponibilidad`) + 1 patch al `Prompt`, todo vía `patchNodeField` sobre `I8yiX4g1rGh5Hb2U`.

## Global Constraints
- Workflow `I8yiX4g1rGh5Hb2U`. Solo `Cerebro` y `Prompt`. Sin backend/frontend.
- `patchNodeField` es estricto: cada `find` debe existir y ser único. Si falla, releer el jsCode actual y ajustar el `find`.
- Backup = version history de n8n (ya está la versión previa; este cambio genera una nueva versión).

---

### Task 1: Cancha puntual (3 patches Cerebro + 1 Prompt)

**Files:** workflow `I8yiX4g1rGh5Hb2U`, nodos `Cerebro` y `Prompt`.

- [ ] **Step 1: Aplicar los 4 patches en un solo `n8n_update_partial_workflow`**

**Patch A — Cerebro: `cPick` mira el contexto**
- find: `const cPick=matchC(gem.cancha, opciones.length?opciones:canchas);`
- replace: `const cPick=matchC(gem.cancha||ctx.cancha, opciones.length?opciones:canchas);`

**Patch B — Cerebro: `matchC` con fallback por número**
- find: `const matchC=(n,pool)=>{ if(!n) return null; const s=String(n).toLowerCase(); return pool.find(c=>c.nombre.toLowerCase()===s)||pool.find(c=>c.nombre.toLowerCase().includes(s)||s.includes(c.nombre.toLowerCase()))||null; };`
- replace: `const matchC=(n,pool)=>{ if(!n) return null; const s=String(n).toLowerCase().trim(); let c=pool.find(x=>x.nombre.toLowerCase()===s)||pool.find(x=>x.nombre.toLowerCase().includes(s)||s.includes(x.nombre.toLowerCase())); if(c) return c; const num=(s.match(/\d+/)||[])[0]; if(num){ c=pool.find(x=>((x.nombre.match(/\d+/)||[])[0])===num); if(c) return c; } return null; };`

**Patch C — Cerebro: nueva rama "cancha nombrada, falta día/hora"**
- find: `else if(!jugadores){ reply='Dale! Tenemos canchas de '`
- replace: `else if(cPick){ const falta=(!fecha&&!hora)?'para que dia y a que hora te la reservo?':(!fecha?'para que dia?':'a que hora?'); reply='Dale, la '+nomb(cPick.nombre)+'. '+falta; store=Object.assign({},ctx,{cancha:cPick.nombre,jugadores:cPick.jugadores||ctx.jugadores||null,fecha:fecha||ctx.fecha||null,hora:hora||ctx.hora||null}); }\n    else if(!jugadores){ reply='Dale! Tenemos canchas de '`

**Patch D — Prompt: hint de normalización de cancha**
- find: `usa el campo cancha solo si el cliente nombra una cancha puntual de esa lista o para consultar precio.`
- replace: `usa el campo cancha solo si el cliente nombra una cancha puntual de esa lista o para consultar precio. Si el cliente nombra una cancha puntual (por ejemplo la cancha 1, la numero 2 o la techada), poné en cancha el nombre EXACTO de esa cancha de la lista.`

Estructura del `n8n_update_partial_workflow`: dos operaciones `patchNodeField` — una para `Cerebro` con los patches A, B y C; otra para `Prompt` con el patch D.

- [ ] **Step 2: Validar el workflow**

`n8n_validate_workflow` id `I8yiX4g1rGh5Hb2U`. Esperado: `valid: true`, sin errores.

- [ ] **Step 3: Chequeo de sintaxis del Cerebro**

`n8n_get_workflow` filtered `["Cerebro","Prompt"]`; para cada `jsCode` correr `new (Object.getPrototypeOf(async function(){}).constructor)(jsCode)`. Esperado: sin excepción. Confirmar además que quedó la rama `else if(cPick){` entre `if(cPick&&fecha&&hora)` y `else if(!jugadores)`.

- [ ] **Step 4: Confirmar activo**

`n8n_get_workflow` mode `minimal` → `active: true`.

---

### Task 2 (DIFERIDA — con Evolution): smoke test
- [ ] "la cancha 1 a las 21" + "hoy" → pregunta solo el día y luego confirma/ofrece la cancha 1, **sin** preguntar tamaño.
- [ ] "la cancha número 2 mañana a las 20" → resuelve Cancha 2.
- [ ] "una de 5 hoy" → sigue funcionando el flujo por tamaño (no rompe la lógica existente).

## Self-Review
- **Cobertura:** patch A (ctx), B (matchC número), C (rama nueva), D (Prompt) = los 3 ajustes del spec. Cubierto.
- **Placeholders:** ninguno; código completo.
- **Consistencia:** `cPick` (recomputado con ctx) alimenta la rama nueva y la de `cPick&&fecha&&hora`; `store` guarda `cancha`+`jugadores`+fecha/hora conocidas; el follow-up cae en `cPick&&fecha&&hora`.
- **Riesgo:** sobre-match por número solo si Gemini setea `cancha` para un tamaño; el Prompt lo separa. Se observa en smoke test.

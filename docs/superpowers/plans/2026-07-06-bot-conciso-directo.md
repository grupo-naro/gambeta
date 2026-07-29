# Bot — Respuestas concisas y menos vueltas — Implementation Plan

> **Ejecución:** trabajo directo sobre n8n vía MCP (no subagentes). Una tarea (patches al Cerebro + validación).

**Goal:** Bot más seco y directo, y reservar en menos turnos (pedir día+hora+tamaño juntos), manteniendo el upsell corto.

**Architecture:** Patches al Code node `Cerebro` vía `patchNodeField` sobre `I8yiX4g1rGh5Hb2U`. Sin backend/frontend.

## Global Constraints
- Workflow `I8yiX4g1rGh5Hb2U`, solo `Cerebro`. Sin backend/frontend/DB.
- `patchNodeField` estricto: cada `find` debe existir y ser único. Si falla, releer el jsCode y ajustar.
- **No romper el resolver de opciones:** el upsell debe seguir ofreciendo "la de `<jugadores>`" (que matchea `'de '+jugadores`) y el nombre de la destacada, porque así los detecta la rama `ctx.opciones` del Cerebro.
- Backup = version history de n8n.

## Decisión de implementación vs spec
- **Edit 4 del spec (acortar la lista de horarios)** se logra vía el **humanizer seco** (esa rama sí pasa por el humanizer), sin patch de template — evita fragilidad con los `\n` embebidos. Las ramas que **no** pasan por el humanizer (upsell/opciones, comprobante, `alreadyNatural`) sí requieren wording conciso en el template: por eso el upsell (Edit 5) se patchea a mano.

---

### Task 1: Bot conciso (5 patches al Cerebro)

**Files:** workflow `I8yiX4g1rGh5Hb2U`, nodo `Cerebro`.

- [ ] **Step 1: Aplicar los 5 patches en un solo `n8n_update_partial_workflow`** (una operación `patchNodeField` sobre `Cerebro`, `fieldPath: parameters.jsCode`)

**Patch A — Humanizer: tono directo**
- find: `Tono cordial, relajado, cercano y breve, como una persona real (no un robot).`
- replace: `Tono directo, claro y conciso, como una persona real pero sin vueltas ni relleno.`

**Patch B — Humanizer: 1-2 frases**
- find: `no menciones precios si no aparecen en los datos; 1 a 3 frases; sin emojis o como mucho uno.`
- replace: `no menciones precios si no aparecen en los datos; maximo 1 o 2 frases cortas, sin vueltas ni relleno; sin emojis o como mucho uno.`

**Patch C — Reservar: pedir todo junto (rama `!jugadores`)**
- find: `else if(!jugadores){ reply='Dale! Tenemos canchas de '+(tamanos.length?tamanos.join(', '):'5, 6, 9')+'. Cual queres?'; store=Object.assign({},ctx,{fecha:fecha||ctx.fecha||null,hora:hora||ctx.hora||null}); }`
- replace: `else if(!jugadores){ const faltan=[]; if(!fecha) faltan.push('que dia'); if(!hora) faltan.push('a que hora'); faltan.push('de cuantos jugadores (o que cancha)'); reply='Dale. Decime '+faltan.join(', ')+' y te la reservo. Tenemos de '+(tamanos.length?tamanos.join(', '):'5, 6, 9')+'.'; store=Object.assign({},ctx,{fecha:fecha||ctx.fecha||null,hora:hora||ctx.hora||null}); }`

**Patch D — Reservar: pedir día y hora juntos (rama `!fecha`)**
- find: `else if(!fecha){ reply='Para que dia queres la cancha de '+jugadores+'? (ej: hoy, manana, el viernes)'; store={jugadores:Number(jugadores)}; }`
- replace: `else if(!fecha){ reply=(!hora)?('Decime que dia y a que hora queres la de '+jugadores+'.'):('Para que dia queres la de '+jugadores+' a las '+hora+'?'); store={jugadores:Number(jugadores),hora:hora||ctx.hora||null}; }`

**Patch E — Upsell corto (rama `comun&&dest`, no pasa por humanizer)**
- find: `reply='Para el '+fechaLinda(fecha)+' a las '+hora+' tenes una cancha de '+jugadores+', y tambien la '+dest.nombre+' ('+destPrecio+' la hora). Cual preferis: la de '+jugadores+' o la '+dest.nombre+'?';`
- replace: `reply='A las '+hora+' tenes la de '+jugadores+' o la '+dest.nombre+' ('+destPrecio+'). Cual preferis?';`

(Mantiene "la de `<jugadores>`" + nombre de la destacada → el resolver de opciones los sigue detectando.)

- [ ] **Step 2: Validar el workflow**

`n8n_validate_workflow` id `I8yiX4g1rGh5Hb2U`. Esperado: `valid: true`, sin errores.

- [ ] **Step 3: Chequeo de sintaxis del Cerebro**

`n8n_get_workflow` filtered `["Cerebro"]`; correr `new (Object.getPrototypeOf(async function(){}).constructor)(jsCode)`. Esperado: sin excepción. Confirmar que aparecen: "Tono directo, claro y conciso", "maximo 1 o 2 frases cortas", la rama `const faltan=[]`, y el upsell "tenes la de '+jugadores+' o la ".

- [ ] **Step 4: Confirmar activo**

`n8n_get_workflow` mode `minimal` → `active: true`.

---

### Task 2 (DIFERIDA — con Evolution): smoke test
- [ ] "quiero reservar" → un solo pedido combinado (día+hora+tamaño), no de a uno.
- [ ] "mañana 20 de 5" → ofrece cancha/upsell y confirma en 1-2 turnos; upsell en una línea; "la de 5" o el nombre de la techada se detectan bien.
- [ ] Respuestas visiblemente más cortas en reservar/modificar/cancelar.

## Self-Review
- **Cobertura del spec:** Edit 1 (humanizer) = patches A+B; Edit 2 (`!jugadores`) = C; Edit 3 (`!fecha`) = D; Edit 5 (upsell) = E. Edit 4 (lista horarios) cubierto por el humanizer seco (documentado arriba). Cubierto.
- **Placeholders:** ninguno.
- **Consistencia/resolver:** el upsell conserva "la de `<jugadores>`" + nombre destacada → compatible con la rama `ctx.opciones`. Patches C/D preservan `fecha`/`hora`/`jugadores` en el `store`.
- **Riesgo:** wording demasiado seco; se ajusta tras smoke test.

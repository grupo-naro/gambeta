# Bot — Mover fijo a otra hora (guiado) — Implementation Plan

> Bot-only. Aplicado directo por el controlador vía n8n MCP (patchNodeField sobre `Cerebro`).

**Goal:** Que un cliente con fijo que reserva a OTRA hora el mismo día sea preguntado ("¿en lugar de tu fijo?") y, si confirma, se le reserve sin seña y se libere el fijo.

**Architecture:** 5 patches quirúrgicos a la rama `confirmar` + ruteo `esperaSwap` del Code node `Cerebro`. Se evita tocar el bloque de la seña (con `\n`/comillas) para no arriesgar el escape.

## Global Constraints
- Solo `Cerebro`. Sin backend/frontend. Backup por version history de n8n.
- El contexto guardado ya conserva `ctx.canchaId/fecha/hora` al preguntar (se guarda `esperaSwap:true`), así que no hace falta restaurar datos.

---

### Task 1: Mover fijo a otra hora (guiado) — 5 patches

- [ ] **Step 1: Aplicar los 5 patches en un `n8n_update_partial_workflow`** (una operación `patchNodeField` sobre `Cerebro`, en este orden)

**Patch A — detección extendida + flags** (reemplaza la línea de detección actual)
- find: `let _swapFijo=false; try{ const _mf=await H.httpRequest({method:'GET',url:BACKEND+'/turnos-fijos/mios?whatsapp='+encodeURIComponent(number),headers:{'x-api-key':SVC},json:true}); const _pf=String(ctx.fecha).split('-').map(Number); const _dow=(_pf.length===3)?new Date(Date.UTC(_pf[0],_pf[1]-1,_pf[2])).getUTCDay():-1; _swapFijo=Array.isArray(_mf)&&_mf.some(f=>f.diaSemana===_dow&&f.horaInicio===ctx.hora); }catch(e){}`
- replace: `let _swapFijo=false; let _fijoOtra=null; try{ const _mf=await H.httpRequest({method:'GET',url:BACKEND+'/turnos-fijos/mios?whatsapp='+encodeURIComponent(number),headers:{'x-api-key':SVC},json:true}); const _pf=String(ctx.fecha).split('-').map(Number); const _dow=(_pf.length===3)?new Date(Date.UTC(_pf[0],_pf[1]-1,_pf[2])).getUTCDay():-1; if(Array.isArray(_mf)){ _swapFijo=_mf.some(f=>f.diaSemana===_dow&&f.horaInicio===ctx.hora); if(!_swapFijo) _fijoOtra=_mf.find(f=>f.diaSemana===_dow)||null; } }catch(e){} const _swapNo=/\bno\b|aparte|extra|adicional|los dos/.test(String(P.text||'').toLowerCase()); const _preguntar=!ctx.esperaSwap&&!_swapFijo&&!!_fijoOtra; const _libFijo=ctx.esperaSwap?!_swapNo:_swapFijo;`

**Patch B — rama "preguntar" antes del chequeo de nombre**
- find: `if(!nombreReserva){ reply='Dale! A nombre de quien registro la reserva?'; store=Object.assign({},ctx,{esperaNombre:true}); }`
- replace: `if(_preguntar){ reply='Veo que tenes tu turno fijo de las '+(_fijoOtra&&_fijoOtra.horaInicio)+' hoy. Esta reserva de las '+ctx.hora+' es en lugar de ese? Responde SI y te lo libero (sin sena), o "aparte" si es un turno extra.'; store=Object.assign({},ctx,{esperaSwap:true}); } else if(!nombreReserva){ reply='Dale! A nombre de quien registro la reserva?'; store=Object.assign({},ctx,{esperaNombre:true}); }`

**Patch C — `esContacto` usa `_libFijo`**
- find: `esContacto:_swapFijo||esContacto,`
- replace: `esContacto:_libFijo||esContacto,`

**Patch D — liberar usa `_libFijo`**
- find: `let _libTxt=''; if(_swapFijo){ try{`
- replace: `let _libTxt=''; if(_libFijo){ try{`

**Patch E — ruteo `esperaSwap`** (tras el bloque de `esperaReprog`/`buscarNombre`)
- find: `if(ctx.buscarNombre && gem.fecha && intent!=='confirmar'){ intent='cancelar'; }`
- replace: `if(ctx.buscarNombre && gem.fecha && intent!=='confirmar'){ intent='cancelar'; } if(ctx.esperaSwap){ const _ts=String(P.text||'').toLowerCase(); if(/\bsi\b|dale|listo|\bok\b|confirm|en lugar|aparte|\bno\b|extra|adicional|los dos/.test(_ts) && intent!=='cancelar' && intent!=='humano' && intent!=='reprogramar' && intent!=='liberar_fijo'){ intent='confirmar'; } else { delete ctx.esperaSwap; } }`

- [ ] **Step 2: Validar** — `n8n_validate_workflow` → `valid:true`.

- [ ] **Step 3: Syntax-check** — traer Cerebro por API y AsyncFunction-check (sin excepción); confirmar `_fijoOtra`, `_preguntar`, `_libFijo`, `esperaSwap`, y la pregunta "es en lugar de ese".

- [ ] **Step 4: Confirmar `active:true`**.

---

### Task 2 (DIFERIDA — con Evolution): smoke test
- [ ] Cliente con fijo (de 9, hoy 21) reserva a las 18 → el bot pregunta "¿en lugar de tu fijo de las 21?" → "sí" → reserva sin seña + libera el fijo; "aparte" → reserva con seña, fijo intacto.
- [ ] Misma hora (otro tamaño) → swap automático, sin preguntar.
- [ ] Sin fijo ese día → reserva normal con seña.

## Self-Review
- **Cobertura del spec:** detección `_fijoOtra` + flags (A), pregunta guiada (B), seña por `_libFijo` (C), liberación por `_libFijo` (D), ruteo de la respuesta (E). Cubierto.
- **Placeholders:** ninguno.
- **Consistencia:** `_preguntar` corta la creación insertándose en la cadena `if(_preguntar){}else if(!nombreReserva){}else try{}`. `_libFijo` unifica seña + liberación. `esperaSwap` se guarda al preguntar y se limpia al crear (los stores de éxito/seña no lo incluyen) o si el mensaje no es una respuesta (Patch E `delete`).
- **Escape:** se evita el bloque de la seña (con `\n`/comillas); los `find`/`replace` no lo tocan.
- **Riesgo:** una llamada `/turnos-fijos/mios` por confirmación (aceptado). Ambigüedad en lugar/aparte resuelta por palabra clave con default a reemplazo (guiado).

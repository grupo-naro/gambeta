# Bot — Cambiar fijo por cancha más chica — Implementation Plan

> Bot-only. Aplicado directo por el controlador vía n8n MCP (patchNodeField sobre `Cerebro`).

**Goal:** Que al confirmar una reserva en el mismo día+hora del fijo del cliente, el bot la cree sin seña y libere el fijo de ese día.

**Architecture:** 3 patches a la rama `confirmar` del Code node `Cerebro` (`I8yiX4g1rGh5Hb2U`).

## Global Constraints
- Solo `Cerebro`. Sin backend/frontend (usa `/turnos-fijos/mios`, `/reservas` con `esContacto:true`, `/turnos-fijos/liberar`).
- Orden seguro: crear reserva primero, liberar fijo después (solo si CONFIRMADA).
- Backup por version history de n8n.

---

### Task 1: Swap fijo→cancha chica en `confirmar` (3 patches)

- [ ] **Step 1: Aplicar los 3 patches en un `n8n_update_partial_workflow`** (una operación `patchNodeField` sobre `Cerebro`)

**Patch A — detección del swap** (tras `let esContacto=false;`)
- find: `let esContacto=false;`
- replace: `let esContacto=false;\n      let _swapFijo=false; try{ const _mf=await H.httpRequest({method:'GET',url:BACKEND+'/turnos-fijos/mios?whatsapp='+encodeURIComponent(number),headers:{'x-api-key':SVC},json:true}); const _pf=String(ctx.fecha).split('-').map(Number); const _dow=(_pf.length===3)?new Date(Date.UTC(_pf[0],_pf[1]-1,_pf[2])).getUTCDay():-1; _swapFijo=Array.isArray(_mf)&&_mf.some(f=>f.diaSemana===_dow&&f.horaInicio===ctx.hora); }catch(e){}`

**Patch B — `esContacto` en el POST /reservas**
- find: `body:{canchaId:ctx.canchaId,whatsapp:number,nombreCliente:nombreReserva,esContacto,fecha:ctx.fecha,horaInicio:ctx.hora,nombreConfirmado:true}`
- replace: `body:{canchaId:ctx.canchaId,whatsapp:number,nombreCliente:nombreReserva,esContacto:_swapFijo||esContacto,fecha:ctx.fecha,horaInicio:ctx.hora,nombreConfirmado:true}`

**Patch C — al confirmar: liberar fijo + mensaje**
- find: `if(r.estado==='CONFIRMADA'){ reply='Listo '+nombreReserva+'! Te reserve '+label+'. Te esperamos!'; store={ lastResId:r.id, lastResLabel:label, lastResFecha:ctx.fecha, lastResHora:ctx.hora, postReserva:Date.now() }; }`
- replace: `if(r.estado==='CONFIRMADA'){ let _libTxt=''; if(_swapFijo){ try{ const _lr=await H.httpRequest({method:'POST',url:BACKEND+'/turnos-fijos/liberar',headers:{'x-api-key':SVC,'Content-Type':'application/json'},body:{whatsapp:number,fecha:ctx.fecha},json:true}); if(_lr&&_lr.liberado) _libTxt=' y te libere tu turno fijo de '+fechaLinda(ctx.fecha); }catch(e){} } reply='Listo '+nombreReserva+'! Te reserve '+label+_libTxt+'. Te esperamos!'; store={ lastResId:r.id, lastResLabel:label, lastResFecha:ctx.fecha, lastResHora:ctx.hora, postReserva:Date.now() }; }`

- [ ] **Step 2: Validar** — `n8n_validate_workflow` → `valid:true`.

- [ ] **Step 3: Syntax-check** — traer Cerebro por API y AsyncFunction-check (sin excepción); confirmar que aparece `_swapFijo`, la lectura de `/turnos-fijos/mios` y el `_libTxt`.

- [ ] **Step 4: Confirmar `active:true`**.

---

### Task 2 (DIFERIDA — con Evolution): smoke test
- [ ] Cliente con fijo (ej. de 9 a las 21 hoy) dice "hoy quiero una de 5 a las 21" → confirma → reserva de 5 **sin seña** + libera el fijo, y el mensaje lo dice.
- [ ] Cliente sin fijo a esa hora → reserva normal con seña, sin liberar nada.
- [ ] Cliente con fijo a OTRA hora → turno adicional normal (con seña), fijo intacto.

## Self-Review
- **Cobertura del spec:** detección (A), sin seña vía esContacto (B), liberar + mensaje (C). Cubierto.
- **Placeholders:** ninguno.
- **Consistencia/orden:** `_swapFijo` se calcula antes del POST; la liberación va dentro del `if(CONFIRMADA)` (reserva primero). Si falla la reserva, no libera.
- **Riesgo:** `GET /turnos-fijos/mios` extra por confirmación (aceptado); adicional-vs-reemplazo mismo horario (aceptado, informado en el mensaje).

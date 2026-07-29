# Bot — Reconocer "cambiar mi turno" (reprogramar) — Implementation Plan

> **Ejecución:** trabajo directo sobre n8n vía MCP (no subagentes). Una sola tarea (2 patches al Prompt + validación).

**Goal:** Que un cliente con turno confirmado que pide moverlo ("cambiame para más tarde") sea clasificado como `reprogramar` y no como consulta nueva.

**Architecture:** 2 patches al Code node `Prompt` vía `patchNodeField` sobre `I8yiX4g1rGh5Hb2U`. Sin Cerebro (su lógica de reprogramar ya funciona con la intención correcta).

## Global Constraints
- Workflow `I8yiX4g1rGh5Hb2U`, solo nodo `Prompt`. Sin backend/frontend.
- `patchNodeField` estricto: cada `find` debe existir y ser único. Si falla, releer el jsCode y ajustar.
- Backup = version history de n8n.

---

### Task 1: Reprogramar turno existente (2 patches Prompt)

**Files:** workflow `I8yiX4g1rGh5Hb2U`, nodo `Prompt`.

- [ ] **Step 1: Aplicar los 2 patches en un solo `n8n_update_partial_workflow`**

**Patch A — surfacear el turno reservado en `ctxLine`**
- find: `:'Sin reserva en progreso.';`
- replace: `:((ctx&&ctx.lastResId)?('El cliente YA tiene un turno reservado: '+(ctx.lastResLabel||'un turno')+'. Si pide cambiarlo, moverlo, otro horario, mas tarde o mas temprano, la intencion es reprogramar; si pide cancelarlo, cancelar; si no, interpretalo normal.'):'Sin reserva en progreso.');`

(Deja el ternario anidado: `enReserva ? (…texto en progreso…) : (ctx.lastResId ? (…turno reservado…) : 'Sin reserva en progreso.')`.)

**Patch B — ampliar ejemplos de `reprogramar`**
- find: `reprogramar (cambiar/mover un turno ya reservado a otro dia u hora)`
- replace: `reprogramar (cambiar/mover un turno ya reservado a otro dia u hora, ej: cambiame para mas tarde, tenes otro horario, lo quiero mas temprano, movelo a las 20, cambialo para mañana)`

Estructura: una operación `patchNodeField` sobre `Prompt` con los dos patches.

- [ ] **Step 2: Validar el workflow**

`n8n_validate_workflow` id `I8yiX4g1rGh5Hb2U`. Esperado: `valid: true`, sin errores.

- [ ] **Step 3: Chequeo de sintaxis del Prompt**

`n8n_get_workflow` filtered `["Prompt"]`; correr `new (Object.getPrototypeOf(async function(){}).constructor)(jsCode)` sobre el `jsCode`. Esperado: sin excepción. Confirmar que el ternario anidado quedó bien cerrado y que aparece el texto "YA tiene un turno reservado".

- [ ] **Step 4: Confirmar activo**

`n8n_get_workflow` mode `minimal` → `active: true`.

---

### Task 2 (DIFERIDA — con Evolution): smoke test
Partiendo de un turno confirmado:
- [ ] "cambiame para más tarde" → pregunta a qué día/hora y reprograma (no ofrece reservar uno nuevo).
- [ ] "tenés otro horario?" → reprogramar.
- [ ] "cancelalo" → cancelar (sigue OK).
- [ ] Cliente **sin** turno → no cae en reprogramar.

## Self-Review
- **Cobertura:** patch A (ctxLine surfacea turno) + patch B (ejemplos reprogramar) = los 2 ajustes del spec. Cubierto.
- **Placeholders:** ninguno.
- **Consistencia:** el ternario anidado preserva el caso `enReserva` (intacto) y agrega el caso `ctx.lastResId`. Cerebro sin cambios (reprogramar ya resuelve por `lastResId`).
- **Riesgo:** sobre-clasificación; mitigado por hint condicional + "si no, interpretalo normal"; se observa en smoke test.

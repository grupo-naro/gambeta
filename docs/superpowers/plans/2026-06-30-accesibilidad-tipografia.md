# Accesibilidad: texto más grande + más contraste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agrandar el texto de todo el panel ~+12% y mejorar el contraste del texto secundario, para que gente grande lo lea cómodo.

**Architecture:** Cambio de presentación puro. El grueso es una línea en `globals.css` (root `font-size: 112.5%`) que escala toda la app rem-based. Después, ajustes mecánicos: subir los pocos textos en px fijo y oscurecer un escalón los grises de texto. Sin tocar lógica ni componentes de negocio.

**Tech Stack:** Next 16, Tailwind v4 (config en CSS), pnpm. Repo: `frontend`, rama git `master` (crear rama `feat/accesibilidad-tipografia`).

## Global Constraints

- Tailwind v4: clases estáticas (nada generado dinámicamente); el theme vive en `src/app/globals.css`.
- Solo presentación: NO tocar lógica, datos ni componentes de negocio.
- `text-neutral-400`/`text-neutral-500` se usan SOLO como color de texto (no hay `border-`/`bg-` de esos tonos) → el reemplazo global es seguro.
- Verificación de cada tarea: `pnpm lint` + `pnpm build` sin errores.
- Cierre: merge a `master` local + **push a GitHub → Vercel deploya** (el panel vive en `admin.canchitaortigoza.com.ar`; esto NO depende de la VM/IPv6).

---

## File Structure

- `frontend/src/app/globals.css` (Modify): root `font-size` + foco visible.
- `frontend/src/components/app-shell.tsx`, `mobile-nav.tsx`, `calendario/calendario-semana.tsx`, `dashboard/ocupacion-heatmap.tsx` (Modify): textos en px fijo.
- Reemplazo global de grises de texto en `frontend/src/**` (~40 archivos, mecánico).

---

### Task 1: Tamaño base + textos en px fijo + foco

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/components/app-shell.tsx`, `frontend/src/components/mobile-nav.tsx`, `frontend/src/components/calendario/calendario-semana.tsx`, `frontend/src/components/dashboard/ocupacion-heatmap.tsx`

- [ ] **Step 1: Subir el tamaño base del root**

En `frontend/src/app/globals.css`, en `@layer base`, la regla `html` hoy es:
```css
  html {
    @apply font-sans;
  }
```
Reemplazarla por:
```css
  html {
    @apply font-sans;
    font-size: 112.5%; /* 16px -> 18px: escala todo lo rem-based (texto + spacing) */
  }
```

- [ ] **Step 2: Reforzar el foco visible**

En el mismo `@layer base`, la regla del `*` hoy es:
```css
  * {
    @apply border-border outline-ring/50;
  }
```
Reemplazarla por:
```css
  * {
    @apply border-border outline-ring/70;
  }
  :focus-visible {
    outline-offset: 2px;
  }
```

- [ ] **Step 3: Subir los textos en px fijo (orden importa para no encadenar)**

Correr, desde `frontend/`, EN ESTE ORDEN (así un `9` no termina en `12`):
```bash
grep -rl 'text-\[11px\]' src | xargs sed -i 's/text-\[11px\]/text-[12px]/g'
grep -rl 'text-\[9px\]'  src | xargs sed -i 's/text-\[9px\]/text-[11px]/g'
grep -rl 'text-\[10px\]' src | xargs sed -i 's/text-\[10px\]/text-[12px]/g'
grep -rl 'text-\[15px\]' src | xargs sed -i 's/text-\[15px\]/text-[16px]/g'
```
Verificar que ya no quedan los viejos:
```bash
grep -rn 'text-\[\(9\|10\|11\|15\)px\]' src || echo "OK: sin px viejos"
```
Expected: `OK: sin px viejos` (los únicos px de texto ahora son 12 y 16).

- [ ] **Step 4: Verificar build + lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/app/globals.css src/components/
git commit -m "feat(a11y): texto base mas grande (18px) + px fijos + foco visible"
```

---

### Task 2: Contraste del texto secundario

**Files:**
- Modify (global, ~40 archivos): `frontend/src/**` — literales `text-neutral-400` / `text-neutral-500`.

**Interfaces:**
- Consumes: nada de Task 1 (independiente).
- Produces: nada (solo clases de color de texto).

- [ ] **Step 1: Oscurecer un escalón los grises de TEXTO (orden importa)**

Desde `frontend/`, correr PRIMERO el 500→600 y DESPUÉS el 400→500 (así los 400 originales terminan en 500, no en 600):
```bash
grep -rl 'text-neutral-500' src | xargs sed -i 's/text-neutral-500/text-neutral-600/g'
grep -rl 'text-neutral-400' src | xargs sed -i 's/text-neutral-400/text-neutral-500/g'
```
(Esto también cubre variantes con opacidad como `text-neutral-400/70` → `text-neutral-500/70`, correcto.)

- [ ] **Step 2: Confirmar el reemplazo**

```bash
grep -rn 'text-neutral-400' src || echo "OK: no quedan neutral-400 de texto"
```
Expected: `OK: no quedan neutral-400 de texto` (todos subieron un escalón). `text-neutral-500` que aparezcan ahora son ex-400.

- [ ] **Step 3: Verificar build + lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 4: Commit**

```bash
cd frontend && git add src/
git commit -m "feat(a11y): mas contraste en texto secundario (grises un escalon mas oscuros)"
```

---

## Self-review (hecho)

- **Cobertura del spec:** root font-size 112.5% (T1 step 1) ✓; px fijos (T1 step 3) ✓; contraste neutral 400/500 (T2) ✓; foco visible (T1 step 2) ✓; verificación build/lint (ambas tareas) ✓.
- **Sin placeholders.** Comandos y edits completos.
- **Orden de los sed:** documentado para evitar encadenar reemplazos (px: 11→12 antes que 9→11; grises: 500→600 antes que 400→500).

## Cierre

Tras las 2 tareas: **superpowers:finishing-a-development-branch** — `pnpm lint` + `pnpm build`, **revisión visual** (login, Vista Hoy, Reservas, Calendario, Configuración; ojo desborde en mobile), merge de `feat/accesibilidad-tipografia` a `master` + **push** (Vercel deploya). Verificar en `admin.canchitaortigoza.com.ar` (Ctrl+Shift+R por caché).

> Nota: al ser un cambio 100% visual, la **revisión visual** es la verificación principal — no hay tests de estilo. Conviene que el usuario mire el resultado en Vercel (o `pnpm dev`) y confirme tamaño/contraste antes de dar por cerrado.

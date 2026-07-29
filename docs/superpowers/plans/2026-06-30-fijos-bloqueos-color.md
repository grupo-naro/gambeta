# Diferenciar fijos (lima) y bloqueos (naranja) por color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los turnos fijos (lima) y los bloqueos (naranja) resalten en el panel (Vista Hoy + Calendario), con barra de color + fondo tenido, dejando las reservas como están.

**Architecture:** Un objeto `ESTILO_TIPO` con clases Tailwind literales en `lib/calendario.ts`, reutilizado por las cards de Hoy (`FijoCard`, `BloqueoCard`) y por el bloque del Calendario (`EventoBtn`). Solo presentación; reservas sin cambios.

**Tech Stack:** Next 16, Tailwind v4 (clases estáticas literales), pnpm. Repo: `frontend`, rama git `master` (crear `feat/fijos-bloqueos-color`).

## Global Constraints

- Tailwind v4: las clases deben ser **literales estáticas** (para que el JIT las incluya). `ESTILO_TIPO` contiene strings literales.
- Solo presentación: NO tocar lógica, datos ni reservas (`turno-card.tsx`).
- Colores: fijo = **lima** (`border-lime-500` / `bg-lime-50` / `bg-lime-200 text-lime-900` / `text-lime-600`); bloqueo = **naranja** (`border-orange-500` / `bg-orange-50` / `text-orange-700` / `text-orange-800`).
- Verificación: `pnpm lint` + `pnpm build`; la real es **visual**.
- Cierre: merge a `master` + push → Vercel.

---

## File Structure

- `frontend/src/lib/calendario.ts` (Modify): agregar `ESTILO_TIPO`.
- `frontend/src/components/hoy/fijo-card.tsx` (Modify): tarjeta lima.
- `frontend/src/components/hoy/bloqueo-card.tsx` (Modify): tarjeta naranja.
- `frontend/src/components/calendario/calendario-semana.tsx` (Modify): `EventoBtn` usa color por tipo para fijo/bloqueo.

---

### Task 1: Estilos por tipo (lima/naranja) en Hoy + Calendario

**Files:**
- Modify: `frontend/src/lib/calendario.ts`
- Modify: `frontend/src/components/hoy/fijo-card.tsx`
- Modify: `frontend/src/components/hoy/bloqueo-card.tsx`
- Modify: `frontend/src/components/calendario/calendario-semana.tsx`

**Interfaces:**
- Produces: `ESTILO_TIPO` en `@/lib/calendario` con forma:
  - `ESTILO_TIPO.fijo` → `{ card: string; icono: string; badge: string; cal: string }`
  - `ESTILO_TIPO.bloqueo` → `{ card: string; icono: string; texto: string; cal: string }`

- [ ] **Step 1: Agregar `ESTILO_TIPO` en `lib/calendario.ts`**

Agregar al final de `frontend/src/lib/calendario.ts`:

```ts
// Estilos por TIPO de evento (fijo/bloqueo) para que resalten en Hoy y Calendario.
// Clases Tailwind LITERALES (el JIT las purga si no aparecen como string).
export const ESTILO_TIPO = {
  fijo: {
    card: 'border-l-4 border-lime-500 bg-lime-50',
    icono: 'text-lime-600',
    badge: 'bg-lime-200 text-lime-900',
    cal: 'bg-lime-100 text-lime-900 border-lime-400',
  },
  bloqueo: {
    card: 'border-l-4 border-orange-500 bg-orange-50',
    icono: 'text-orange-700',
    texto: 'text-orange-800',
    cal: 'bg-orange-100 text-orange-900 border-orange-400',
  },
} as const;
```

- [ ] **Step 2: `FijoCard` en lima**

En `frontend/src/components/hoy/fijo-card.tsx`:

1. Cambiar el import de calendario para incluir `ESTILO_TIPO`:
```tsx
import { colorDeCancha, nombreCancha, ESTILO_TIPO } from '@/lib/calendario';
```
2. Reemplazar el `<button ...>` de apertura:
```tsx
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left transition hover:bg-neutral-50">
```
por:
```tsx
    <button onClick={onClick} className={cn('flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:brightness-95', ESTILO_TIPO.fijo.card)}>
```
3. Reemplazar el ícono:
```tsx
      <CalendarClock className="h-5 w-5 flex-none text-sky-500" />
```
por:
```tsx
      <CalendarClock className={cn('h-5 w-5 flex-none', ESTILO_TIPO.fijo.icono)} />
```
4. Reemplazar el badge (última `<span>`):
```tsx
      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Fijo · {money(fijo.precio)}</span>
```
por:
```tsx
      <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', ESTILO_TIPO.fijo.badge)}>Fijo · {money(fijo.precio)}</span>
```

- [ ] **Step 3: `BloqueoCard` en naranja**

En `frontend/src/components/hoy/bloqueo-card.tsx`:

1. Cambiar el import de calendario para incluir `ESTILO_TIPO`:
```tsx
import { etiquetaMotivo, colorDeCancha, nombreCancha, ESTILO_TIPO } from '@/lib/calendario';
```
2. Reemplazar el `<div ...>` de apertura:
```tsx
    <div className="flex items-center gap-3 rounded-xl border border-dashed bg-neutral-50 px-4 py-3">
```
por:
```tsx
    <div className={cn('flex items-center gap-3 rounded-xl px-4 py-3', ESTILO_TIPO.bloqueo.card)}>
```
3. Reemplazar el ícono:
```tsx
      <Ban className="h-5 w-5 flex-none text-neutral-500" />
```
por:
```tsx
      <Ban className={cn('h-5 w-5 flex-none', ESTILO_TIPO.bloqueo.icono)} />
```
4. Reemplazar el `<p>` del motivo:
```tsx
        <p className="truncate text-xs text-neutral-600">
          {etiquetaMotivo(bloqueo.motivo)}{bloqueo.nota ? ` · ${bloqueo.nota}` : ''}
        </p>
```
por:
```tsx
        <p className={cn('truncate text-xs font-medium', ESTILO_TIPO.bloqueo.texto)}>
          {etiquetaMotivo(bloqueo.motivo)}{bloqueo.nota ? ` · ${bloqueo.nota}` : ''}
        </p>
```

- [ ] **Step 4: `EventoBtn` del Calendario (fijo lima / bloqueo naranja)**

En `frontend/src/components/calendario/calendario-semana.tsx`:

1. Agregar `ESTILO_TIPO` al import de calendario (que hoy es `import { colorDeCancha, ubicarEnTz, horasDelDia, materializar, etiquetaMotivo, type EventoCal } from '@/lib/calendario';`):
```tsx
import { colorDeCancha, ubicarEnTz, horasDelDia, materializar, etiquetaMotivo, ESTILO_TIPO, type EventoCal } from '@/lib/calendario';
```
2. En `EventoBtn`, después de `const col = colorDeCancha(ev.canchaId, canchas);`, agregar la elección de color por tipo:
```tsx
  const clasesColor =
    ev.tipo === 'fijo' ? ESTILO_TIPO.fijo.cal
    : ev.tipo === 'bloqueo' ? ESTILO_TIPO.bloqueo.cal
    : `${col.bg} ${col.text} ${col.border}`;
```
3. En el `className` del `<button>`, reemplazar `${col.bg} ${col.text} ${col.border}` por `${clasesColor}`. Queda:
```tsx
      className={`flex-1 truncate rounded border px-1.5 py-1 text-left text-[12px] leading-tight ${clasesColor} ${esReserva ? '' : 'border-dashed'} ${esperando ? 'opacity-60' : ''}`}
```

- [ ] **Step 5: Verificar build + lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/lib/calendario.ts src/components/hoy/fijo-card.tsx src/components/hoy/bloqueo-card.tsx src/components/calendario/calendario-semana.tsx
git commit -m "feat(ui): fijos en lima y bloqueos en naranja (Hoy + Calendario) para diferenciarlos"
```

---

## Self-review (hecho)

- **Cobertura del spec:** `ESTILO_TIPO` (step 1) ✓; FijoCard lima (step 2) ✓; BloqueoCard naranja (step 3) ✓; EventoBtn por tipo, reservas con color de cancha (step 4) ✓; reservas/turno-card sin tocar ✓.
- **Sin placeholders.** Edits before/after completos.
- **Consistencia:** `ESTILO_TIPO.fijo.{card,icono,badge,cal}` y `.bloqueo.{card,icono,texto,cal}` usados igual en los 4 archivos. `cn` ya está importado en las dos cards.

## Cierre

Tras la tarea: **superpowers:finishing-a-development-branch** — `pnpm lint` + `pnpm build`, **revisión visual** (Vista Hoy con fijo lima / bloqueo naranja / reserva blanca; Calendario con bloques lima/naranja; texto legible), merge de `feat/fijos-bloqueos-color` a `master` + push (Vercel). Ver en `admin.canchitaortigoza.com.ar` (Ctrl+Shift+R).

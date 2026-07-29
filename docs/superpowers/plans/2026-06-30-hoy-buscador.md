# Buscador por nombre en Vista Hoy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un buscador por nombre del cliente en la Vista Hoy, que filtra reservas y fijos en vivo (client-side), combinado con el filtro de cancha existente.

**Architecture:** Todo dentro de `agenda-hoy.tsx`: un estado `q`, un helper de normalización (sin acentos/mayúsculas), extender los filtros actuales y agregar el input de búsqueda arriba de los chips de cancha. Sin backend ni datos nuevos.

**Tech Stack:** Next 16, Tailwind v4, lucide-react, pnpm. Repo: `frontend`, rama git `master` (crear `feat/hoy-buscador`).

## Global Constraints

- Solo presentación / filtro client-side sobre `agenda` ya cargada. NO tocar backend ni tipos.
- Búsqueda sin acentos ni mayúsculas, por substring, solo sobre **nombre del cliente** (reservas + fijos).
- Combinar con el filtro de cancha (`coincide`) ya existente.
- Bloqueos: **ocultos cuando hay texto** en el buscador.
- Clases Tailwind estáticas. Imports SIN `.js`.
- Verificación: `pnpm lint` + `pnpm build`; la real es visual.

---

## File Structure

- `frontend/src/components/hoy/agenda-hoy.tsx` (Modify): estado `q`, helper `norm`, filtros extendidos, input de búsqueda, empty state.

---

### Task 1: Buscador en `agenda-hoy.tsx`

**Files:**
- Modify: `frontend/src/components/hoy/agenda-hoy.tsx`

- [ ] **Step 1: Importar el ícono `Search`**

En la línea de import de `lucide-react` (hoy `import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';`), agregar `Search`:
```tsx
import { ChevronLeft, ChevronRight, CalendarDays, Search } from 'lucide-react';
```

- [ ] **Step 2: Estado + helper de normalización + filtros**

Reemplazar este bloque:
```tsx
  const [canchaFiltro, setCanchaFiltro] = useState<string | null>(null);

  const coincide = (canchaId: string) => !canchaFiltro || canchaId === canchaFiltro;
  const reservas = agenda.reservas.filter((r) => r.estado !== 'CANCELADA' && coincide(r.canchaId));
  const fijos = agenda.fijos.filter((f) => coincide(f.canchaId));
  const bloqueos = agenda.bloqueos.filter((b) => coincide(b.canchaId));
```
por:
```tsx
  const [canchaFiltro, setCanchaFiltro] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const norm = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const buscando = q.trim() !== '';
  const matchNombre = (nombre?: string | null) => !buscando || norm(nombre ?? '').includes(norm(q));

  const coincide = (canchaId: string) => !canchaFiltro || canchaId === canchaFiltro;
  const reservas = agenda.reservas.filter((r) => r.estado !== 'CANCELADA' && coincide(r.canchaId) && matchNombre(r.cliente?.nombre));
  const fijos = agenda.fijos.filter((f) => coincide(f.canchaId) && matchNombre(f.clienteNombre));
  const bloqueos = agenda.bloqueos.filter((b) => coincide(b.canchaId) && !buscando);
```

- [ ] **Step 3: Input de búsqueda (arriba de los chips)**

Insertar este bloque **justo antes** del `div` de los chips de cancha (la línea `<div className="flex gap-2 overflow-x-auto pb-1">`):
```tsx
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre…"
          className="w-full rounded-lg border bg-white py-2 pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        {buscando && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
          >
            ×
          </button>
        )}
      </div>

```

- [ ] **Step 4: Empty state con búsqueda**

Reemplazar el párrafo del estado vacío:
```tsx
          <p className="text-sm text-neutral-600">{canchaFiltro ? 'No hay turnos en esa cancha para este día.' : 'No hay turnos para este día.'}</p>
```
por:
```tsx
          <p className="text-sm text-neutral-600">{buscando ? `No se encontró ninguna reserva para «${q}».` : canchaFiltro ? 'No hay turnos en esa cancha para este día.' : 'No hay turnos para este día.'}</p>
```

- [ ] **Step 5: Verificar build + lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/components/hoy/agenda-hoy.tsx
git commit -m "feat(hoy): buscador por nombre del cliente (filtra reservas y fijos en vivo)"
```

---

## Self-review (hecho)

- **Cobertura del spec:** estado `q` + `norm` sin acentos (step 2) ✓; match nombre en reservas+fijos (step 2) ✓; combinado con `coincide` (step 2) ✓; bloqueos ocultos al buscar (`&& !buscando`, step 2) ✓; input lupa + limpiar arriba de los chips (step 3) ✓; empty state con búsqueda (step 4) ✓.
- **Sin placeholders.** Edits before/after completos.
- **Consistencia:** `q`, `buscando`, `matchNombre`, `norm` definidos en step 2 y usados en steps 3-4; `Search` importado en step 1. Regex de acentos con rango unicode `̀-ͯ` (no chars combinantes literales).

## Cierre

Tras la tarea: **superpowers:finishing-a-development-branch** — `pnpm lint` + `pnpm build`, **revisión visual** (tipear un nombre filtra reservas/fijos y oculta bloqueos; "×" limpia; combinar con chip de cancha; búsqueda sin resultados muestra el mensaje), merge de `feat/hoy-buscador` a `master` + push (Vercel). Ver en `admin.canchitaortigoza.com.ar`.

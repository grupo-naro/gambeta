# Menú agrupado (sidebar + drawer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar las 12 secciones del menú en grupos con subtítulo (Operación / Programación / Administración), en el sidebar de desktop y en el drawer mobile, sin perder ninguna sección.

**Architecture:** Se agrega un campo `grupo` a cada `NavItem` y un helper puro `navAgrupado(rol)` que devuelve los grupos (en orden canónico `GRUPOS`) con sus ítems filtrados por rol, omitiendo grupos vacíos. El sidebar (`app-shell.tsx`) y el drawer (`mobile-nav.tsx`) iteran ese helper y renderizan un encabezado por grupo. `NavLink` no cambia.

**Tech Stack:** Next 16 + React 19 + TypeScript, Tailwind 4 (clases estáticas), Base UI (Dialog en el drawer), Vitest (unit, sin Docker), pnpm. Repo: `frontend` (rama git `master`, local — NO se pushea).

## Global Constraints

- Frontend custom Next 16: imports SIN extensión `.js`; clases Tailwind estáticas (nada generado dinámicamente).
- Verificación de cierre: `pnpm build` y `pnpm lint` sin errores.
- Trabajar en una rama feature; al terminar, merge a `master` local con `--no-ff`. NO se pushea el frontend.
- Roles: `AMBOS = ['ADMIN','RECEPCIONISTA']`, `SOLO_ADMIN = ['ADMIN']` (ya existen en `nav-items.ts`).
- Encabezado de grupo, clases exactas: `text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400`.

---

## File Structure

- `frontend/src/components/nav-items.ts` (Modify): agrega `Grupo`, campo `grupo` en `NavItem`, `GRUPOS`, `GrupoNav`, `navAgrupado`. Reordena el array `nav` para que quede agrupado/legible.
- `frontend/src/components/nav-items.test.ts` (Create): unit de `navAgrupado` y `GRUPOS`.
- `frontend/src/components/app-shell.tsx` (Modify): el `<nav>` del `<aside>` renderiza por grupo.
- `frontend/src/components/mobile-nav.tsx` (Modify): el `<nav>` del drawer renderiza por grupo.

---

### Task 1: `nav-items.ts` — campo `grupo`, `GRUPOS` y helper `navAgrupado` (TDD)

**Files:**
- Modify: `frontend/src/components/nav-items.ts`
- Test: `frontend/src/components/nav-items.test.ts`

**Interfaces:**
- Consumes: nada (tipo `Rol` de `@/lib/types`, ya importado en el archivo).
- Produces (lo usan Task 2 y Task 3):
  - `type Grupo = 'Operación' | 'Programación' | 'Administración'`
  - `interface NavItem { href: string; label: string; icon: LucideIcon; roles: Rol[]; grupo: Grupo }`
  - `const GRUPOS: Grupo[]`
  - `interface GrupoNav { grupo: Grupo; items: NavItem[] }`
  - `function navAgrupado(rol: Rol): GrupoNav[]` — grupos en orden de `GRUPOS`, ítems filtrados por `roles.includes(rol)`, grupos vacíos omitidos.

- [ ] **Step 1: Write the failing test**

Crear `frontend/src/components/nav-items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { navAgrupado, GRUPOS } from './nav-items';

describe('GRUPOS', () => {
  it('define el orden canonico de los grupos', () => {
    expect(GRUPOS).toEqual(['Operación', 'Programación', 'Administración']);
  });
});

describe('navAgrupado', () => {
  it('ADMIN ve los 3 grupos, en orden y con las cantidades correctas', () => {
    const r = navAgrupado('ADMIN');
    expect(r.map((g) => g.grupo)).toEqual(['Operación', 'Programación', 'Administración']);
    expect(r.map((g) => g.items.length)).toEqual([5, 3, 4]);
  });

  it('RECEPCIONISTA ve solo Operación y Programación (sin Administración)', () => {
    const r = navAgrupado('RECEPCIONISTA');
    expect(r.map((g) => g.grupo)).toEqual(['Operación', 'Programación']);
    expect(r.map((g) => g.items.length)).toEqual([5, 1]);
    expect(r[1].items[0].href).toBe('/turnos-fijos'); // único de Programación visible para recepción
  });

  it('nunca devuelve un item fuera del alcance del rol', () => {
    for (const rol of ['ADMIN', 'RECEPCIONISTA'] as const) {
      for (const g of navAgrupado(rol)) {
        for (const item of g.items) expect(item.roles).toContain(rol);
      }
    }
  });

  it('nunca devuelve un grupo vacio', () => {
    for (const rol of ['ADMIN', 'RECEPCIONISTA'] as const) {
      for (const g of navAgrupado(rol)) expect(g.items.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm vitest run src/components/nav-items.test.ts`
Expected: FAIL — `navAgrupado` / `GRUPOS` no existen (import error).

- [ ] **Step 3: Reemplazar el contenido de `nav-items.ts`**

Reemplazar TODO el archivo `frontend/src/components/nav-items.ts` por:

```ts
import { Sun, LayoutDashboard, CalendarDays, CalendarRange, LandPlot, CalendarClock, Ban, Settings, Users, Activity, Wallet, Contact, type LucideIcon } from 'lucide-react';
import type { Rol } from '@/lib/types';

export type Grupo = 'Operación' | 'Programación' | 'Administración';

export interface NavItem { href: string; label: string; icon: LucideIcon; roles: Rol[]; grupo: Grupo }

const AMBOS: Rol[] = ['ADMIN', 'RECEPCIONISTA'];
const SOLO_ADMIN: Rol[] = ['ADMIN'];

/** Orden canónico en que se muestran los grupos del menú. */
export const GRUPOS: Grupo[] = ['Operación', 'Programación', 'Administración'];

export const nav: NavItem[] = [
  // Operación — el día a día
  { href: '/hoy', label: 'Hoy', icon: Sun, roles: AMBOS, grupo: 'Operación' },
  { href: '/reservas', label: 'Reservas', icon: CalendarDays, roles: AMBOS, grupo: 'Operación' },
  { href: '/calendario', label: 'Calendario', icon: CalendarRange, roles: AMBOS, grupo: 'Operación' },
  { href: '/caja', label: 'Caja', icon: Wallet, roles: AMBOS, grupo: 'Operación' },
  { href: '/clientes', label: 'Clientes', icon: Contact, roles: AMBOS, grupo: 'Operación' },
  // Programación — la grilla / recursos
  { href: '/canchas', label: 'Canchas', icon: LandPlot, roles: SOLO_ADMIN, grupo: 'Programación' },
  { href: '/turnos-fijos', label: 'Turnos fijos', icon: CalendarClock, roles: AMBOS, grupo: 'Programación' },
  { href: '/bloqueos', label: 'Bloqueos', icon: Ban, roles: SOLO_ADMIN, grupo: 'Programación' },
  // Administración — gestión / sistema
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: SOLO_ADMIN, grupo: 'Administración' },
  { href: '/configuracion', label: 'Configuración', icon: Settings, roles: SOLO_ADMIN, grupo: 'Administración' },
  { href: '/usuarios', label: 'Usuarios', icon: Users, roles: SOLO_ADMIN, grupo: 'Administración' },
  { href: '/actividad', label: 'Actividad', icon: Activity, roles: SOLO_ADMIN, grupo: 'Administración' },
];

export interface GrupoNav { grupo: Grupo; items: NavItem[] }

/** Grupos (en orden de GRUPOS) con sus ítems visibles para el rol; omite grupos vacíos. */
export function navAgrupado(rol: Rol): GrupoNav[] {
  return GRUPOS
    .map((grupo) => ({ grupo, items: nav.filter((n) => n.grupo === grupo && n.roles.includes(rol)) }))
    .filter((g) => g.items.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && pnpm vitest run src/components/nav-items.test.ts`
Expected: PASS (4 tests / 5 `it` ok).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/components/nav-items.ts src/components/nav-items.test.ts
git commit -m "feat(nav): grupo en NavItem + helper navAgrupado con tests"
```

---

### Task 2: Sidebar (desktop) renderiza por grupo

**Files:**
- Modify: `frontend/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `navAgrupado` de `@/components/nav-items` (Task 1).
- Produces: nada (componente de UI).

- [ ] **Step 1: Cambiar el import**

En `frontend/src/components/app-shell.tsx`, reemplazar:

```tsx
import { nav } from '@/components/nav-items';
```

por:

```tsx
import { navAgrupado } from '@/components/nav-items';
```

- [ ] **Step 2: Renderizar el `<nav>` por grupo**

En el mismo archivo, reemplazar el bloque:

```tsx
        <nav className="flex-1 space-y-1 px-3 pt-2">
          {nav.filter((n) => n.roles.includes(rol)).map((n) => (
            <NavLink key={n.href} href={n.href} label={n.label} Icon={n.icon} />
          ))}
        </nav>
```

por:

```tsx
        <nav className="flex-1 space-y-4 px-3 pt-2">
          {navAgrupado(rol).map((g) => (
            <div key={g.grupo} className="space-y-1">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">{g.grupo}</div>
              {g.items.map((n) => (
                <NavLink key={n.href} href={n.href} label={n.label} Icon={n.icon} />
              ))}
            </div>
          ))}
        </nav>
```

- [ ] **Step 3: Verificar build y lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 4: Commit**

```bash
cd frontend && git add src/components/app-shell.tsx
git commit -m "feat(nav): sidebar agrupado por seccion"
```

---

### Task 3: Drawer (mobile) renderiza por grupo

**Files:**
- Modify: `frontend/src/components/mobile-nav.tsx`

**Interfaces:**
- Consumes: `navAgrupado` de `@/components/nav-items` (Task 1).
- Produces: nada (componente de UI).

- [ ] **Step 1: Cambiar el import**

En `frontend/src/components/mobile-nav.tsx`, reemplazar:

```tsx
import { nav } from '@/components/nav-items';
```

por:

```tsx
import { navAgrupado } from '@/components/nav-items';
```

- [ ] **Step 2: Renderizar el `<nav>` por grupo (manteniendo el onClick que cierra el drawer)**

En el mismo archivo, reemplazar el bloque:

```tsx
          {/* onClick en el contenedor: cualquier NavLink tocado cierra el drawer (burbujea) */}
          <nav className="flex-1 space-y-1" onClick={() => setOpen(false)}>
            {nav.filter((n) => n.roles.includes(rol)).map((n) => <NavLink key={n.href} href={n.href} label={n.label} Icon={n.icon} />)}
          </nav>
```

por:

```tsx
          {/* onClick en el contenedor: cualquier NavLink tocado cierra el drawer (burbujea) */}
          <nav className="flex-1 space-y-4" onClick={() => setOpen(false)}>
            {navAgrupado(rol).map((g) => (
              <div key={g.grupo} className="space-y-1">
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">{g.grupo}</div>
                {g.items.map((n) => <NavLink key={n.href} href={n.href} label={n.label} Icon={n.icon} />)}
              </div>
            ))}
          </nav>
```

- [ ] **Step 3: Verificar build y lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 4: Commit**

```bash
cd frontend && git add src/components/mobile-nav.tsx
git commit -m "feat(nav): drawer mobile agrupado por seccion"
```

---

## Cierre

Tras las 3 tareas: usar **superpowers:finishing-a-development-branch** — correr `pnpm vitest run` (unit) + `pnpm lint` + `pnpm build`, revisión whole-branch, y merge de la rama feature a `master` local con `git merge --no-ff`. NO pushear el frontend.

Verificación visual sugerida (`pnpm dev`): el sidebar y el menú hamburguesa muestran los subtítulos OPERACIÓN / PROGRAMACIÓN / ADMINISTRACIÓN; con un usuario RECEPCIONISTA aparecen solo OPERACIÓN (5 ítems) y PROGRAMACIÓN (Turnos fijos).

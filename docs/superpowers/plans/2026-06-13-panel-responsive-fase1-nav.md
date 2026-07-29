# Panel responsive — Fase 1: Navegación mobile (drawer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En mobile (`<md`) habilitar la navegación con un drawer (hamburguesa) que reusa los items del nav, ya que hoy el sidebar es `hidden md:flex` y no hay forma de cambiar de página.

**Architecture:** Se extrae el array `nav` a un módulo compartido. `AppShell` agrega en el header mobile un botón ☰ que abre un `MobileNav` (drawer construido sobre el primitivo `@base-ui/react/dialog`, deslizando desde la izquierda) con los mismos `NavLink` + Salir.

**Tech Stack:** Next 16 + React 19 + Tailwind 4 + Base UI + pnpm.

**Rama:** `feat/mobile-nav` (`c:/Users/Lautaro/Desktop/ortigoza/frontend`). Es la Fase 1 del spec `docs/superpowers/specs/2026-06-13-panel-responsive-design.md` (las fases 2–4 se planifican aparte).

---

### Task T0: Crear la rama

- [ ] **Step 1**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/frontend`):
```bash
git checkout master && git checkout -b feat/mobile-nav
```

---

### Task T1: Extraer el array `nav` a un módulo compartido

**Files:**
- Create: `frontend/src/components/nav-items.ts`
- Modify: `frontend/src/components/app-shell.tsx` (usar el import; sin cambio de comportamiento)

- [ ] **Step 1: Crear `nav-items.ts`**

Crear `frontend/src/components/nav-items.ts`:

```ts
import { LayoutDashboard, CalendarDays, CalendarRange, LandPlot, CalendarClock, Ban, Settings, type LucideIcon } from 'lucide-react';

export interface NavItem { href: string; label: string; icon: LucideIcon }

export const nav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/reservas', label: 'Reservas', icon: CalendarDays },
  { href: '/calendario', label: 'Calendario', icon: CalendarRange },
  { href: '/canchas', label: 'Canchas', icon: LandPlot },
  { href: '/turnos-fijos', label: 'Turnos fijos', icon: CalendarClock },
  { href: '/bloqueos', label: 'Bloqueos', icon: Ban },
  { href: '/configuracion', label: 'Configuración', icon: Settings },
];
```

- [ ] **Step 2: Usar el import en `app-shell.tsx`**

En `frontend/src/components/app-shell.tsx`:
- En el import de `lucide-react` (línea 2), quitar los íconos que ahora viven en `nav-items.ts` y dejar SÓLO los que `app-shell` sigue usando (`LogOut`). Queda:
```ts
import { LogOut } from 'lucide-react';
```
- Agregar el import del nav:
```ts
import { nav } from '@/components/nav-items';
```
- Borrar el bloque `const nav = [ ... ];` inline (líneas 7-14). El resto (el `.map` que renderiza `NavLink`) queda igual y ahora usa el `nav` importado.

- [ ] **Step 3: Verificar build (sin cambio visual)**

Run:
```bash
pnpm exec tsc --noEmit && pnpm build
```
Expected: build OK; el sidebar desktop se ve igual que antes.

- [ ] **Step 4: Commit**

```bash
git add src/components/nav-items.ts src/components/app-shell.tsx
git commit -m "refactor(nav): extract nav items to shared module"
```

---

### Task T2: `MobileNav` (drawer) + hamburguesa en el header

**Files:**
- Create: `frontend/src/components/mobile-nav.tsx`
- Modify: `frontend/src/components/app-shell.tsx` (header)

- [ ] **Step 1: Crear `mobile-nav.tsx`**

Crear `frontend/src/components/mobile-nav.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Menu, LogOut } from 'lucide-react';
import { logout } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { NavLink } from '@/components/nav-link';
import { nav } from '@/components/nav-items';

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button variant="ghost" size="icon" aria-label="Abrir menú" />}>
        <Menu className="h-5 w-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar p-3 shadow-xl outline-none transition-transform duration-200 data-closed:-translate-x-full data-open:translate-x-0">
          <Dialog.Title className="px-2 py-3 text-[15px] font-semibold tracking-tight text-neutral-900">
            Canchitas <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Ortigoza</span>
          </Dialog.Title>
          {/* onClick en el contenedor: cualquier NavLink tocado cierra el drawer (burbujea) */}
          <nav className="flex-1 space-y-1" onClick={() => setOpen(false)}>
            {nav.map((n) => <NavLink key={n.href} href={n.href} label={n.label} Icon={n.icon} />)}
          </nav>
          <form action={logout} className="border-t border-neutral-200/80 pt-2">
            <Button variant="ghost" size="sm" type="submit" className="w-full justify-start text-neutral-600">
              <LogOut className="mr-1.5 h-4 w-4" /> Salir
            </Button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

NOTA: el primitivo `@base-ui/react/dialog` cierra solo con click en el backdrop y con Escape. `Dialog.Trigger` con `render={<Button/>}` es el patrón Base UI usado en el repo (ver `dropdown-menu`/`dialog`). `Button` soporta `size="icon"` (se usa en las tablas) y `variant="ghost"`.

- [ ] **Step 2: Insertar la hamburguesa en el header de `app-shell.tsx`**

En `frontend/src/components/app-shell.tsx`:
- Importar el componente:
```ts
import { MobileNav } from '@/components/mobile-nav';
```
- En el `<header>`, ANTES del `<span ... md:hidden>` del logo, agregar el botón (solo mobile):
```tsx
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-neutral-200/80 bg-white/75 px-6 backdrop-blur-md">
          <div className="md:hidden"><MobileNav /></div>
          <span className="flex items-center gap-2 font-semibold tracking-tight md:hidden">
            <Logo className="h-5 w-5 text-primary" /> Canchitas
          </span>
          <div className="ml-auto flex items-center gap-3">
            ...
          </div>
        </header>
```
(El `<div className="md:hidden">` envuelve el trigger para que el botón solo aparezca en mobile; en desktop el header queda igual que ahora.)

- [ ] **Step 3: Verificar build**

Run:
```bash
pnpm exec tsc --noEmit && pnpm build
```
Expected: build OK, `✓ Compiled successfully`. Si Base UI tipa distinto `Dialog.Trigger`/`render`, ajustar al patrón exacto de `components/ui/dialog.tsx` (que usa `DialogPrimitive.Close render={<Button .../>}`).

- [ ] **Step 4: Commit**

```bash
git add src/components/mobile-nav.tsx src/components/app-shell.tsx
git commit -m "feat(nav): mobile drawer navigation (hamburger)"
```

---

### Task T3: Verificación

- [ ] **Step 1: lint + tsc + build**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm build
```
Expected: todo verde.

- [ ] **Step 2: Verificación manual (anotar para el usuario)**

En viewport ≈375px (devtools responsive): aparece el ☰ en el header; al tocarlo se abre el drawer desde la izquierda con los 7 items + Salir; tocar un item navega y cierra el drawer; el backdrop y Escape cierran; en desktop (`md+`) NO aparece el ☰ y el sidebar se ve igual.

---

### Task C1: Finalizar la rama

- [ ] **Step 1: finishing-a-development-branch**

Anunciar "I'm using the finishing-a-development-branch skill to complete this work." → build verde → merge a `master` (el repo no tiene remote → queda local).

---

## Self-Review

**Spec coverage (Fase 1):**
- Extraer `nav` a módulo compartido → T1 ✓
- Sidebar desktop intacto (`hidden md:flex`) → no se toca ✓
- Header mobile suma ☰ que abre el drawer → T2 ✓
- `MobileNav` drawer sobre `@base-ui/react/dialog`, slide desde la izquierda, items con `NavLink` + Salir, cierra al navegar/backdrop/Escape → T2 ✓
- `NavLink` reusado (marca activo con `usePathname`) → T2 ✓
- Sólo responsive, clases Tailwind estáticas → T2 (clases de animación estáticas) ✓

**Placeholder scan:** Sin TBD/TODO. La nota de "ajustar si Base UI tipa distinto" remite al patrón real del repo, no es un placeholder.

**Type consistency:** `nav: NavItem[]` con `{href,label,icon}` usado igual en `app-shell` (sidebar) y `mobile-nav` (drawer). `NavLink` recibe `{href,label,Icon}` (Icon = `n.icon`), idéntico al uso actual en `app-shell`. `MobileNav` sin props. Imports de lucide repartidos: íconos del nav en `nav-items.ts`, `LogOut` queda en `app-shell` y `mobile-nav` importa `Menu, LogOut`.

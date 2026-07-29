# Panel responsive (mobile) — Design

**Fecha:** 2026-06-13
**Estado:** Aprobado

## Objetivo

Adaptar todo el panel admin a mobile. Hoy en pantalla chica **no hay navegación** (el sidebar es
`hidden md:flex` y el header sólo muestra el logo), las tablas se cortan, el calendario obliga a
scroll horizontal y algunos forms/grids no apilan. Objetivo: que el panel sea usable en celular.

## Decisiones (confirmadas)
- Navegación mobile: **drawer con hamburguesa** (reusa los items del nav).
- Tablas en mobile: **cards apiladas** (tabla en desktop, cards en `<md`).
- Calendario en mobile: **vista de día** con selector (semana en desktop).
- Sólo responsive (sin rediseño visual, sin PWA, sin gestos).

## Breakpoint
`md` (768px). "Mobile" = `<md`; "desktop" = `md+`. Consistente con el `hidden md:flex` actual.

## Áreas (4 fases, un solo spec/plan)

### Fase 1 — Navegación (drawer)
- Extraer el array `nav` (hoy inline en `app-shell.tsx`) a `src/components/nav-items.ts` (export `nav`) para una sola fuente de verdad.
- `app-shell.tsx`: sidebar desktop sigue `hidden md:flex`. El header (visible en mobile) suma a la izquierda un botón **☰** (`md:hidden`) que abre el drawer. Estado `open` en `AppShell` (ya es `'use client'`).
- Nuevo `src/components/mobile-nav.tsx` (client): drawer construido sobre el primitivo `@base-ui/react/dialog` (mismo que usa `components/ui/dialog.tsx`), posicionado a la izquierda con animación de slide-in (clases Tailwind estáticas). Contiene: logo, los `nav` items (con `NavLink`), y el form de **Salir** (`logout`). Se cierra al tocar un item (onClick → setOpen(false)) y con backdrop/Escape (lo da Base UI).
- `NavLink` se reusa tal cual (su `usePathname` marca el activo). 

### Fase 2 — Tablas → cards en mobile
Para `reservas-table`, `canchas-table`, `turnos-fijos` table, `bloqueos` table:
- Envolver la `<Table>` actual en un contenedor `hidden md:block`.
- Agregar, con `md:hidden`, una lista de **cards** (`<div>` por fila) que muestran los campos clave en vertical + las mismas acciones (el mismo `DropdownMenu`/botones y handlers ya existentes). Se reusan los datos y callbacks; sólo cambia el markup de presentación.
- Cada card: título (nombre/cliente/cancha según la tabla), líneas de datos (fecha/hora/estado/precio/etc.) y las acciones abajo. Badges de estado igual que en la tabla.

### Fase 3 — Calendario vista de día (mobile)
En `calendario-semana.tsx` (client, ya tiene `reservas/fijos/bloqueos`, `dias`, `horas`, `porCelda`, `colorDeCancha`, dialogs):
- `md+`: la grilla semanal de 7 columnas (sin cambios).
- `<md` (`md:hidden`): vista de **un día**:
  - Estado `diaSel` (string YYYY-MM-DD), default = `hoy` si `dias.includes(hoy)`, si no `dias[0]`.
  - Selector: fila de 7 chips (lun–dom + número), el activo resaltado; tocar uno setea `diaSel`. (Chips, no flechas.)
  - Debajo: las `horas` en filas; cada fila = etiqueta de hora + los `EventoCal` de `(diaSel, hora)` (reusando el render de bloque y el `onEvento` que ya abre los dialogs).
- La grilla semanal va envuelta en `hidden md:block`; la vista día en `md:hidden`. Comparten todo el estado/handlers del componente (dialogs de reserva y de fijo/bloqueo intactos).

### Fase 4 — Polish forms / dialogs / dashboard
- **Dialogs** (`components/ui/dialog.tsx` DialogContent): garantizar ancho seguro en mobile — `w-[calc(100%-2rem)]` + `max-w-*` + `max-h`/scroll si hace falta, centrado con margen. Verificar que ningún dialog se desborde (cancha, reprogramar, nueva reserva, turno fijo, bloqueo, detalle calendario).
- **Configuración** (`config-form.tsx`): los `grid-cols-2` (horas, franjas pico) → `grid-cols-1 sm:grid-cols-2`.
- **Dashboard** (`/dashboard`): grids de cards → `grid-cols-1` en mobile escalando a `md:grid-cols-…`; el gráfico de recharts dentro de `ResponsiveContainer` (o contenedor con ancho 100% y alto fijo) para no desbordar.
- **Reservas:** la barra de filtros ya usa `flex-wrap`; repaso de que los inputs ocupen bien el ancho en mobile.

## Componentes nuevos / tocados
- Nuevo: `src/components/nav-items.ts`, `src/components/mobile-nav.tsx`.
- Modificados: `app-shell.tsx`, `reservas-table.tsx`, `canchas-table.tsx`, `turnos-fijos` table, `bloqueos` table, `calendario-semana.tsx`, `config-form.tsx`, dashboard page/components, `components/ui/dialog.tsx`.

## Testing
- Unit: si se extrae lógica pura (ej. el cálculo del `diaSel` default) se testea; el resto es presentacional → **tsc/lint/`pnpm build`** (obligatorio por boundary RSC) + revisión visual.
- Manual: abrir cada pantalla en viewport angosto (≈375px): navegar con el drawer, ver tablas como cards, calendario en vista día (cambiar de día, abrir un evento), forms/dialogs sin desborde.
- No romper desktop: las vistas desktop quedan iguales (los cambios mobile van bajo `md:hidden`/`<md`).

## Gotchas
- `'use server'` no se toca (sólo UI).
- Clases Tailwind **estáticas** (incl. las de animación del drawer) para que el JIT no las purgue.
- `pnpm build` antes de mergear (los componentes nuevos son client; cuidar boundaries).
- El drawer sobre Base UI Dialog: usar el primitivo `@base-ui/react/dialog` (Popup posicionado a la izquierda), NO el `DialogContent` centrado por defecto.

## Fuera de alcance
- Rediseño visual (colores/tipografía/espaciados generales).
- PWA / instalable / offline.
- Gestos (swipe entre días).
- Vista mensual del calendario.

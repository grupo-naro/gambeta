# Menú agrupado (sidebar + drawer) — Design

**Fecha:** 2026-06-22
**Estado:** Aprobado
**Repo:** frontend (Next 16). Solo frontend; sin backend.

## Problema

El menú tiene 12 secciones en una **lista plana** (igual en el sidebar de desktop y en el drawer mobile). Para el admin (ve las 12) es difícil de escanear y "confunde". Las secciones ya tienen una agrupación lógica pensada (hoy solo en comentarios de `nav-items.ts`), pero no se renderiza.

## Objetivo (sub-proyecto B, enfoque A: agrupar con títulos)

Mostrar las secciones en **grupos con subtítulo**, manteniendo TODAS (sin fusionar ni esconder). Aplica igual al sidebar (desktop) y al drawer (mobile). Los títulos de grupo aparecen solo si el grupo tiene al menos un ítem visible para el rol.

## Agrupación (aprobada)

Orden y contenido de los grupos:

1. **Operación** — `/hoy`, `/reservas`, `/calendario`, `/caja`, `/clientes`
2. **Programación** — `/canchas`, `/turnos-fijos`, `/bloqueos`
3. **Administración** — `/dashboard`, `/configuracion`, `/usuarios`, `/actividad`

Roles (sin cambios; ya están en `nav-items.ts`): Operación → Hoy/Reservas/Calendario/Caja/Clientes son AMBOS; Programación → Canchas/Bloqueos SOLO_ADMIN, Turnos fijos AMBOS; Administración → todos SOLO_ADMIN.

Resultado por rol:
- **RECEPCIONISTA:** "Operación" (Hoy, Reservas, Calendario, Caja, Clientes) + "Programación" (Turnos fijos). El grupo "Administración" no aparece (sin ítems para el rol).
- **ADMIN:** los 3 grupos completos.

## Diseño técnico

### `nav-items.ts`
- Agregar campo `grupo: Grupo` a cada `NavItem`, donde `type Grupo = 'Operación' | 'Programación' | 'Administración'`.
- Exportar el orden de grupos: `export const GRUPOS: Grupo[] = ['Operación', 'Programación', 'Administración'];`
- Asignar a cada ítem su grupo según la agrupación de arriba. (Reordenar el array para que quede agrupado/legible, aunque el render usa `grupo` no el orden del array.)
- Helper nuevo: `export function navAgrupado(rol: Rol): { grupo: Grupo; items: NavItem[] }[]` → para cada `Grupo` en `GRUPOS`, los items con ese grupo y `roles.includes(rol)`; **omite los grupos sin items**. Mantiene el orden de `GRUPOS` y, dentro, el orden del array `nav`.

### Render (sidebar `app-shell.tsx` y drawer `mobile-nav.tsx`)
- Reemplazar el `nav.filter(...).map(NavLink)` por iterar `navAgrupado(rol)`: por cada grupo, un encabezado + los `NavLink` del grupo.
- Encabezado de grupo: texto chico en mayúsculas, estilo consistente con el del branding ("Ortigoza"): `text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400`, con padding (ej. `px-3 pt-4 pb-1`; el primer grupo con menos `pt`).
- En el drawer (mobile) el contenedor mantiene el `onClick={() => setOpen(false)}` que cierra al tocar un link (sigue funcionando porque burbujea).
- `NavLink` no cambia (mismo componente).

### Estructura de archivos
- Modify: `frontend/src/components/nav-items.ts` (campo `grupo`, `GRUPOS`, `navAgrupado`).
- Modify: `frontend/src/components/app-shell.tsx` (render agrupado en el `<aside>`).
- Modify: `frontend/src/components/mobile-nav.tsx` (render agrupado en el drawer).
- (Opcional) Test: `frontend/src/components/nav-items.test.ts` (unit de `navAgrupado`).

## Errores / bordes

- Grupo sin items para el rol → no se renderiza su encabezado (lo garantiza `navAgrupado`).
- Un ítem sin grupo asignado → al asignar `grupo` a TODOS en `nav`, no debería ocurrir; el tipo `Grupo` (no opcional) lo fuerza en compilación.
- El ítem activo (ruta actual) sigue resaltado por `NavLink` (sin cambios).

## Testing

- Unit (Vitest, sin Docker) de `navAgrupado`:
  - `navAgrupado('RECEPCIONISTA')` → 2 grupos: "Operación" (5 items) y "Programación" (1 item, Turnos fijos); NO incluye "Administración".
  - `navAgrupado('ADMIN')` → 3 grupos con la cantidad correcta (5 / 3 / 4) y en el orden de `GRUPOS`.
  - Cada item devuelto tiene `roles.includes(rol)`.
- Verificación: `pnpm build` + `pnpm lint` sin errores. Revisión visual: sidebar y drawer muestran los grupos con subtítulos; recepción ve solo 2 grupos.

## Integración

- Frontend: rama feature → merge a `master` local (no se pushea). Sin deploy de backend.

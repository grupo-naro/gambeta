# Hoja de acción en tablas de admin — Design

**Fecha:** 2026-06-16
**Estado:** Aprobado
**Programa:** Refactor de interacción (reuso del bottom sheet). **Pieza 2** (Pieza 1 = Reservas + Calendario ✅). Ver [[programa-ux-panel]].

## Objetivo

Reemplazar el menú de 3 puntos de las tablas de admin (Canchas, Usuarios, Bloqueos, Turnos fijos) por el patrón "tocar la fila → hoja inferior (bottom sheet) con los datos clave + botones de acción grandes abajo", consistente con la hoja de reservas. Mobile-first (recepción en celular/tablet).

## Contexto (estado actual)

Cada tabla tiene tabla (desktop) + tarjetas (mobile) y un `DropdownMenu`/3 puntos con sus acciones. `act(fn, okMsg)` helper en cada una. Diálogos de crear/editar y `useConfirm` ya existentes.

- **Canchas** (`canchas-table.tsx`): dropdown con **Editar** (`CanchaDialog`), **Activar/Desactivar** (`setActivaCancha`), **Eliminar** (`eliminarCancha`, con aviso `useConfirm` especial si `c.grupoId`: borra el grupo entero). Estado `dialogOpen`/`editing` para `CanchaDialog`. Botón "Nueva cancha".
- **Usuarios** (`usuarios-table.tsx`): dropdown solo si `!u.esDefault && u.email !== currentEmail`, con **cambiar rol** (`cambiarRolUsuario`) y **Eliminar** (`eliminarUsuario`). Botón "Nuevo usuario" (`UsuarioDialog`, solo crear).
- **Bloqueos** (`bloqueos-table.tsx`): dropdown con **Eliminar** (`eliminarBloqueo`). Botón "Nuevo bloqueo" (`BloqueoDialog`, solo crear).
- **Turnos fijos** (`turnos-fijos-table.tsx`): dropdown con **Liberar fecha** (`ExcepcionDialog`) y **Eliminar** (`eliminarTurnoFijo`). Botón "Nuevo turno fijo".
- `components/ui/sheet.tsx`: `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`. `useConfirm` ya cablea las acciones destructivas (B1).

## Decisiones (confirmadas)

- Patrón **"info + botones"** (no form dentro de la hoja): la hoja muestra datos clave + botones; "Editar" (solo Canchas) abre el `CanchaDialog` actual.
- Las **4 entidades** en este spec/plan.
- La hoja se arma **inline** en cada tabla con los primitivos de `ui/sheet` (sin componente nuevo), igual que la de reservas vive como su propio bloque.
- No se agrega edición a entidades que hoy no la tienen.

## Alcance (común a las 4 tablas)

- Quitar el `DropdownMenu`/3 puntos (y la columna de acciones del header en desktop; en mobile, el botón de 3 puntos de la tarjeta).
- Hacer **tocable** la fila desktop (`TableRow onClick` + `cursor-pointer hover:bg-neutral-50`) y la tarjeta mobile (envolver en `<button>` con hijos `<span className="block">` — Base UI `<button>` no admite `<div>`/`<p>`).
- Estado nuevo por tabla: `const [seleccion, setSeleccion] = useState<T | null>(null)`; la hoja abre con `open={seleccion !== null}`, cierra con `onOpenChange={(o) => { if (!o) setSeleccion(null); }}`.
- Markup de la hoja (consistente):
  - `SheetHeader` → `SheetTitle` con el identificador principal; subtítulo opcional.
  - Bloque de info: lista `label/value` (mismos datos que ya muestran las tarjetas mobile).
  - Botones apilados, ancho completo, alto cómodo (`h-11 w-full`): primarios arriba, **Eliminar** abajo en rojo (`variant="ghost" className="text-red-600"` o `variant="destructive"`).
- Acciones: reutilizar las server actions y `act(...)` existentes; las destructivas pasan por `useConfirm` (mismos textos que B1). Tras una acción, `act` ya hace toast (las tablas se revalidan vía `revalidatePath` de las actions); cerrar la hoja al ejecutar una acción que saca la fila (eliminar) — la acción destructiva cierra la hoja (`setSeleccion(null)`) en su callback de éxito.

## Detalle por entidad

### Canchas (`canchas-table.tsx`)
- Hoja: título = `c.nombre` (+ badges Divisible/Destacada si aplica). Info: Tipo, Tamaño (`Fútbol {c.jugadores}`), Precio/hora (`money(c.precioHora)`), Estado (Activa/Inactiva).
- Botones: **Editar** → `setEditing(c); setDialogOpen(true); setSeleccion(null)` (abre `CanchaDialog`). **Activar/Desactivar** → `act(() => setActivaCancha(c.id, !c.activa), ...)`. **Eliminar** → `useConfirm` (descripción especial si `c.grupoId`) → `act(() => eliminarCancha(c.id), 'Cancha eliminada')` + cerrar hoja.
- Mantener `CanchaDialog` montado (con su `key={editing?.id ?? 'new'}`) y el botón "Nueva cancha".

### Usuarios (`usuarios-table.tsx`)
- Hoja: título = `u.email` (+ badge "default" si aplica). Info: Nombre, Rol (Admin/Recepcionista).
- Si `!u.esDefault && u.email !== currentEmail`: botones **Hacer admin/recepcionista** (`cambiarRolUsuario`) y **Eliminar** (`useConfirm` → `eliminarUsuario` + cerrar). Si es default o el usuario actual: la hoja muestra solo la info (sin botones).
- Todas las filas son tocables (abren la hoja informativa). Mantener "Nuevo usuario".

### Bloqueos (`bloqueos-table.tsx`)
- Hoja: título = `b.cancha?.nombre ?? '—'`. Info: Motivo (`MOTIVO_LABEL`), Programa (`programaLabel(b)`), Horario (`b.horaInicio–b.horaFin`).
- Botón: **Eliminar** (`useConfirm` → `eliminarBloqueo` + cerrar). Mantener "Nuevo bloqueo".

### Turnos fijos (`turnos-fijos-table.tsx`)
- Hoja: título = `t.clienteNombre`. Info: Cancha, Día (`DIAS[t.diaSemana]`), Horario, Precio (`money(t.precio)`).
- Botones: **Liberar fecha** → `abrirExcepcion(t); setSeleccion(null)` (abre `ExcepcionDialog`). **Eliminar** (`useConfirm` → `eliminarTurnoFijo` + cerrar). Mantener "Nuevo turno fijo" y el `ExcepcionDialog` montado (con su `key`).

## Componentes y responsabilidades

- Cada tabla: lista + abre su hoja inline + monta sus diálogos existentes. La hoja no duplica lógica de acciones (reusa las server actions ya cableadas).
- `ui/sheet` y `useConfirm`: sin cambios.

## Manejo de errores / bordes

- Acción que saca la fila (eliminar): el callback de éxito cierra la hoja (`setSeleccion(null)`); la lista se revalida por la action.
- Usuario default / uno mismo: hoja informativa sin botones (no se permite cambiar rol ni borrar, igual que hoy).
- "Editar"/"Liberar fecha": cierran la hoja y abren el diálogo correspondiente (un nivel a la vez).
- Cancha divisible: el texto de confirmación de borrado avisa que borra el grupo entero (igual que B1).

## Pruebas

- Solo frontend → **`pnpm lint` y `pnpm build` obligatorios**; `pnpm test` (los existentes pasan). Sin lógica pura nueva.
- QA manual (mobile): en cada tabla, tocar fila/tarjeta abre la hoja; los botones hacen lo mismo que antes hacía el dropdown; eliminar pide confirmación y cierra la hoja; en Usuarios, el default/uno mismo no muestra botones; Editar (Canchas) y Liberar fecha (Turnos fijos) abren su diálogo.

## Despliegue / compat

- Solo frontend. Rama `feat/sheet-admin-tables` → merge a `master` local (sin push salvo indicación). Sin backend ni tipos nuevos.

## Fuera de alcance (YAGNI)

- Agregar form de editar a usuarios/bloqueos/turnos fijos.
- Un componente de hoja genérico unificado (cada hoja se arma inline con `ui/sheet`).
- Cambios de backend; Pieza C (visual) y B3/B4.

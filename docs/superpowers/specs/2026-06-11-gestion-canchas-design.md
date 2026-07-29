# Gestión de Canchas (panel admin) — Design

**Fecha:** 2026-06-11
**Estado:** Aprobado

## Objetivo

Permitir desde el panel admin: listar canchas, crear, editar, activar/desactivar
y eliminar. "Eliminar" borra de verdad solo si la cancha no tiene reservas; si
tiene historial, se desactiva (preserva las reservas).

## Backend

### Modelo (existente)
`Cancha { id, nombre, tipo (string), precioHora (Decimal), activa (bool), reservas[], horarios[] }`.
`HorarioDisponible.cancha` tiene `onDelete: Cascade`; `Reserva.cancha` NO tiene
cascade (Restrict por defecto) → borrar una cancha con reservas falla en la DB.

### Endpoints existentes (sin cambios)
- `GET /canchas?activa=` (authAny), `POST /canchas` (authJwt, `{nombre,tipo,precioHora}`),
  `PATCH /canchas/:id` (authJwt, parciales), `PATCH /canchas/:id/activa` (authJwt, `{activa}`).

### Nuevo: `DELETE /canchas/:id` (authJwt)
- Service `eliminar(id)`:
  1. `canchaService.get(id)` (404 si no existe).
  2. Contar reservas de la cancha (`reservaRepo`/prisma count `where: { canchaId: id }`).
  3. Si `count > 0` → `Conflict('La cancha tiene reservas; desactivala en vez de eliminarla')` (409).
  4. Si `count === 0` → `canchaRepo.delete(id)` (los `horarios` se borran en cascada). Responde 200 con `{ ok: true }`.
- Repo: agregar `delete(id)` (`prisma.cancha.delete({ where: { id } })`).
- Validación de params: reusar `idParamSchema` (o un `eliminarCanchaSchema` equivalente con `params.id`).
- Ruta: `canchaRoutes.delete('/:id', authJwt, validate(idParamSchema), ...)`.

### Tests (integración, Vitest)
- Borra una cancha sin reservas → 200, y deja de existir (`GET` ya no la trae).
- 409 al borrar una cancha con una reserva asociada.
- 404 si el id no existe.
- 401 sin auth (es authJwt).

## Frontend (Next 16, BFF — mismo patrón que Reservas)

### Navegación
- Agregar ítem **"Canchas"** al sidebar (`app-shell.tsx`, ícono lucide, ej. `Volleyball`/`Goal`/`LandPlot`).

### Página `/canchas` (Server Component, dentro de `(panel)`)
- `apiFetch<Cancha[]>('/canchas')` → tabla con columnas: **Nombre**, **Tipo**, **Precio/hora**, **Estado** (badge Activa/Inactiva).
- Las inactivas se muestran atenuadas (texto/markers en gris).
- Header con título + botón **"Nueva cancha"**.
- Loading skeleton (`loading.tsx`) y estado vacío.

### Tipos
- `Cancha` ya existe en `src/lib/types.ts` (`{id,nombre,tipo,precioHora,activa}`).
- `tipo`: en el form es un **select** con opciones F5 / F7 / F11 / Otro (con valores
  string `'futbol5'|'futbol7'|'futbol11'|'otro'` o etiquetas legibles; el backend acepta
  cualquier string). Al editar, si el `tipo` actual no está en la lista, se muestra como "Otro".

### Acciones (Server Actions en `src/lib/canchas-actions.ts`, reusando el helper `run()`)
- `crearCancha({nombre,tipo,precioHora})` → `POST /canchas`.
- `editarCancha(id, {nombre,tipo,precioHora})` → `PATCH /canchas/:id`.
- `setActivaCancha(id, activa)` → `PATCH /canchas/:id/activa`.
- `eliminarCancha(id)` → `DELETE /canchas/:id` (maneja 409 mostrando el mensaje del backend).
- Todas hacen `revalidatePath('/canchas')`.

### Componentes
- `components/canchas/canchas-table.tsx` (client): tabla + dropdown de acciones por fila:
  **Editar**, **Activar/Desactivar** (según estado), **Eliminar** (con confirmación; si 409 → toast sugiriendo desactivar).
- `components/canchas/cancha-dialog.tsx` (client): dialog reutilizable para crear/editar
  (campos nombre, tipo select, precioHora). Validación con Zod antes de enviar.
- `components/cancha-estado-badge.tsx` (o inline): badge Activa (verde) / Inactiva (gris).

### Validación (Zod, `src/lib/validators.ts`)
- `canchaSchema`: `nombre` min 1, `tipo` min 1, `precioHora` number > 0 (coerción desde el input).

### Errores / UX
- Toasts éxito/error; `pending` por acción; confirmación antes de eliminar.
- 401 → el patrón existente (apiFetch lanza ApiAuthError) redirige a login.

## Testing
- **Backend**: integración del nuevo `DELETE` (4 casos arriba).
- **Frontend**: unit (Vitest) de `canchaSchema`. El resto se valida con `tsc`/`lint`/`build`
  (igual que el MVP); sin E2E.

## Fuera de alcance
- Clientes y Config de seña (resto de Fase 2).
- Gestión de horarios por cancha (sigue el horario global 16–23).
- Hard delete de canchas con reservas (intencionalmente bloqueado con 409).

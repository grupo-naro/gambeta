# Registro de actividad (auditoría) — Design

**Fecha:** 2026-06-14
**Estado:** Aprobado

## Objetivo

Registrar quién hizo qué cambio y cuándo, en texto legible (ej. "Nahuel Guerra — Cambió el alias — hoy 07:50"),
y verlo en una pantalla del panel (solo-admin).

## Decisiones (confirmadas)
- Se loguean **mutaciones**: Configuración, Canchas (ABM), Usuarios (CRUD), Turnos fijos, Bloqueos, Reservas (crear + cancelar/reprogramar/aprobar-rechazar seña), e **inicios de sesión (login)**. No se loguean lecturas.
- Detalle: **field-level en Configuración** (qué campo cambió, por nombre — NO el valor), **nivel entidad** en el resto.
- Pantalla **solo-admin**. Sin purga automática (retención total por ahora).

## Modelo (extiende `AuditLog` existente)
`AuditLog` ya tiene: `adminId String?` (+ relación `admin` → nombre), `accion String`, `entidad String`, `entidadId String?`, `payload Json?`, `creadoEn DateTime @default(now())`, índices por `(entidad,entidadId)` y `creadoEn`.
- Suma **`descripcion String @default('')`** = el texto legible armado al escribir. Migración.
- Filas previas (señas) tienen `descripcion` vacía → al mostrar, fallback a una etiqueta derivada de `accion` (mapa `accion→label`).

## Registro (helper semántico)
- `auditService.log(req, { accion, entidad, entidadId?, descripcion, payload? })`: extrae el actor de `req.principal` (`adminId` si `kind==='admin'`; `null` si es servicio/bot → se muestra "Sistema") y escribe vía `auditLogRepo.record`. No falla la operación si el log falla (try/catch, best-effort).
- Se invoca en cada handler de mutación, con la `descripcion` armada ahí:
  - **Config (PATCH /config):** comparar el body validado contra lo guardado; `descripcion` lista los **nombres** de los campos que cambiaron ("Cambió el alias", "Cambió alias y horario de cierre"). **Nunca** incluir valores de `cbu`/`alias`/`password`.
  - **Canchas:** "Creó la cancha «X»" / "Editó la cancha «X»" / "Activó «X»" / "Desactivó «X»" / "Eliminó la cancha «X»" / "Creó cancha divisible «X»".
  - **Usuarios:** "Creó el usuario `email` (rol)" / "Cambió el rol de `email` a ROL" / "Eliminó el usuario `email`".
  - **Turnos fijos:** "Creó turno fijo de «cliente»" / "Eliminó turno fijo de «cliente»" / "Liberó la fecha YYYY-MM-DD" / "Reactivó la fecha YYYY-MM-DD".
  - **Bloqueos:** "Creó bloqueo (MOTIVO)" / "Eliminó bloqueo".
  - **Reservas:** "Creó una reserva" (crear) + las ya existentes (cancelar/reprogramar/aprobar-rechazar seña) — se les agrega `descripcion`.
  - **Login:** "Inició sesión".
- **Seguridad:** jamás loguear contraseñas ni valores de CBU/alias; para config solo el nombre del campo.

## Endpoint
`GET /auditoria` (`authJwt` + `requireRole('ADMIN')`):
- Devuelve los últimos N (default 200) `AuditLog` ordenados por `creadoEn` desc, con shape `{ id, creadoEn, usuario, accion, entidad, descripcion }` donde `usuario = admin?.nombre ?? 'Sistema'`.
- Filtro opcional `?entidad=Config|Cancha|Usuario|TurnoFijo|Bloqueo|Reserva|Auth`.
- Sin paginación compleja (MVP).
- Repo: `auditLogRepo.list({ entidad?, limit })` con `include: { admin: { select: { nombre: true } } }`.

## Frontend — pantalla `/actividad` (solo-admin)
- `lib/types`: `LogActividad { id, creadoEn, usuario, accion, entidad, descripcion }`.
- Nav item **"Actividad"** (roles `['ADMIN']`).
- Page Server Component con `await requireAdmin()` + `apiFetch('/auditoria')`.
- Componente cliente (filtro por entidad vía query param o select) responsive: tabla `hidden md:block` + cards `md:hidden`. Cada ítem: **fecha/hora en TZ Argentina** (`toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})`), **usuario**, **descripción** (fallback a etiqueta de `accion` si `descripcion` vacía), badge de entidad.

## Testing
- **Backend (TDD):** `auditService.log` escribe con actor del principal (admin) y null para servicio; una mutación clave (ej. `PATCH /config` cambiando alias) crea un AuditLog con `descripcion` que menciona "alias" y NO el valor; `GET /auditoria` requiere ADMIN (RECEPCIONISTA → 403), devuelve newest-first con `usuario`, y respeta `?entidad`. Suite completa verde.
- **Frontend:** unit del helper de etiqueta `accion→label` (fallback) si se extrae; tsc/lint/`pnpm build`. Manual: hacer un cambio (ej. alias) y verlo en /actividad como admin; recepcionista no ve el item ni la página.

## Fuera de alcance
- Diff field-level fuera de Config.
- Export CSV, búsqueda de texto, paginación infinita, revertir cambios.
- Purga/retención automática.
- Loguear lecturas.

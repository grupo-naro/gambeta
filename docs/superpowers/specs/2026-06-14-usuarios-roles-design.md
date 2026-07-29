# Usuarios y roles (ADMIN / RECEPCIONISTA) — Design

**Fecha:** 2026-06-14
**Estado:** Aprobado

## Objetivo

Sistema de usuarios con dos roles: **ADMIN** (dueño: configura todo, gestiona usuarios) y
**RECEPCIONISTA** (atiende en la cancha: da turnos presenciales, cobra/seña, ve el calendario).
El admin sembrado es el usuario por defecto (inmutable); un admin puede crear y eliminar usuarios.

## Decisiones (confirmadas)
- Roles: `ADMIN`, `RECEPCIONISTA`.
- Recepcionista accede a: **Reservas** (crear/cobrar/cancelar/reprogramar/aprobar-rechazar seña), **Disponibilidad** (incl. por-tamaño) y **Calendario** (lectura, incl. fijos/bloqueos). **No** ve Dashboard, ni Canchas ABM, ni Config, ni escritura de turnos-fijos/bloqueos, ni Usuarios.
- CRUD de usuarios (solo ADMIN): crear / listar / eliminar / cambiar rol. (Sin reset de contraseña — fuera de alcance.)
- Default admin (`admin@canchitas.com`): inmutable — no se elimina, no se le cambia el rol. Nadie puede auto-eliminarse. Por lo demás un admin elimina a cualquier usuario.

## Backend (Superpowers)

### Modelo
- `enum Rol { ADMIN, RECEPCIONISTA }`.
- `AdminUser` suma `rol Rol @default(RECEPCIONISTA)` y `esDefault Boolean @default(false)`.
- Migración. El seed marca al admin existente (`admin@canchitas.com`) con `rol=ADMIN, esDefault=true` (idempotente, vía upsert/update).

### Auth con rol
- `AdminClaims` suma `rol: Rol`. `signAdminToken` lo incluye; `verifyAdminToken` lo devuelve; `login` lo incluye en el token y en la respuesta `admin`.
- `req.principal` (kind 'admin') suma `rol`.

### Middleware `requireRole`
- Nuevo `src/middlewares/requireRole.ts`: `requireRole(...roles: Rol[])` → corre **después** de `authJwt`; si `req.principal?.kind !== 'admin'` o `!roles.includes(principal.rol)` → 403 (`Forbidden`). (Sólo se usa en rutas `authJwt`; las `authAny` del bot no se tocan.)
- Agregar helper de error `Forbidden` (403) en `utils/errors.ts` si no existe.

### Matriz de permisos (rutas)
**Cualquier logueado (authJwt, ambos roles) o authAny existente:**
- `GET /canchas`, `GET /canchas/:id`, `GET /config` (ya `authAny`).
- `GET /disponibilidad`, `GET /disponibilidad/por-tamano` (ya `authAny`).
- `/reservas`: list, `/:id`, `/mias`, POST crear, PATCH cancelar/reprogramar/aprobar-sena/rechazar-sena, `/vencidas-sena` (ya `authAny`).
- `GET /turnos-fijos`, `GET /bloqueos` → quedan accesibles a cualquier logueado (separar el GET de los writes; el GET es `authJwt` sin requireRole).

**Solo ADMIN (`authJwt` + `requireRole('ADMIN')`):**
- `POST/PATCH/DELETE /canchas`, `POST /canchas/divisible`, `PATCH /canchas/:id/activa`.
- `PATCH /config`.
- Escritura de `/turnos-fijos` (POST/PATCH/DELETE + `/excepciones`) y `/bloqueos` (POST/PATCH/DELETE).
- Endpoint(s) de analytics del dashboard (el que consume `/dashboard`).
- Todo `/usuarios`.

(Las rutas `authAny` que usa el bot con `x-api-key` NO llevan requireRole y siguen igual.)

### CRUD de usuarios — `/usuarios` (todo `authJwt + requireRole('ADMIN')`)
- `GET /usuarios` → lista `{ id, email, nombre, rol, esDefault }` (sin passwordHash).
- `POST /usuarios` → body `{ email, nombre, password (min 6), rol }`; hashea password (`utils/password`); email único → 409 si repetido; devuelve el usuario sin hash.
- `PATCH /usuarios/:id/rol` → body `{ rol }`; 403/409 si el target es `esDefault` (no se le cambia el rol).
- `DELETE /usuarios/:id` → 403 si `esDefault` o si `:id === principal.adminId` (no auto-eliminarse); si no, elimina.
- Servicio `usuario.service.ts` + repo (reusar/extender `adminUser.repo.ts`).

### Tests (TDD)
- `requireRole`: ADMIN pasa; RECEPCIONISTA → 403; sin principal → 403.
- `login` devuelve token con `rol` (decodificable) y `admin.rol`.
- Usuarios: crear (persiste rol, hash, sin devolver hash), email duplicado → 409, listar, cambiar rol, eliminar; **no** eliminar default (403), **no** auto-eliminarse (403), **no** cambiar rol del default (403).
- Gating: una ruta de escritura (ej. `PATCH /config` o `POST /canchas`) con token RECEPCIONISTA → 403; con ADMIN → ok. `GET /turnos-fijos` con RECEPCIONISTA → 200.

## Frontend

### Sesión con rol
- Helper `getSession()` (server-only): lee la cookie `token`, **decodifica el payload del JWT** (base64, sin verificar firma — sólo para UI; el backend es el guardia real) → `{ adminId, email, rol }`. Devuelve null si no hay/cookie inválida.
- El layout `(panel)` usa `getSession()` para pasar `email` y `rol` al `AppShell`. (Hoy el layout ya obtiene `email`; se amplía a `rol`.)
- `lib/types`: `Rol = 'ADMIN' | 'RECEPCIONISTA'`; `LoginResult.admin` suma `rol`.

### Nav y páginas gateadas por rol
- `nav-items.ts`: cada item suma `roles: Rol[]` (o flag `adminOnly`). Admin-only: Dashboard, Canchas, Turnos fijos, Bloqueos, Configuración, **Usuarios**. Ambos: Reservas, Calendario.
- `AppShell` y `MobileNav` filtran los items según el `rol` de la sesión.
- Helper `requireAdmin()` (server): en los Server Components admin-only (dashboard, canchas, configuracion, turnos-fijos, bloqueos, usuarios) → si `rol !== 'ADMIN'` → `redirect('/reservas')`. (Defensa server-side además de ocultar el nav.)

### Pantalla `/usuarios` (admin)
- Tabla de usuarios (email, nombre, rol, badge "default"), responsive (tabla `hidden md:block` + cards `md:hidden`, como las demás).
- **Crear usuario:** dialog (email, nombre, password, select rol) → `POST /usuarios`.
- **Cambiar rol:** acción que llama `PATCH /usuarios/:id/rol` (deshabilitada en el default).
- **Eliminar:** acción `DELETE /usuarios/:id` (oculta/deshabilitada en el default y en uno mismo).
- Server actions en `lib/usuarios-actions.ts` (patrón `run()` + `revalidatePath('/usuarios')`, exports `async function`).
- Validadores en `lib/validators.ts` (`usuarioSchema`: email, nombre, password min 6, rol enum).

### Login
- La respuesta ya devuelve `admin`; se le suma `rol` (informativo). Sin cambios de flujo.

## Migración / compat
- Migración agrega `rol` (default RECEPCIONISTA) y `esDefault` (default false). Seed marca el admin actual ADMIN+default. Usuarios nuevos por defecto se crean con el rol elegido en el form (no se usa el default del schema para creación vía API, que igual exige `rol`).
- Sin backfill de datos operativos (no afecta reservas/canchas).

## Fuera de alcance
- Reset / cambio de contraseña, recuperación por email, 2FA.
- Permisos más finos o roles adicionales.
- Auditoría por usuario más allá del `AuditLog` de señas ya existente.

## Testing (resumen)
- Backend: tests de `requireRole`, login-con-rol, CRUD de usuarios y reglas de protección, y gating de una ruta de escritura. Suite completa verde.
- Frontend: unit de `usuarioSchema` y del filtrado de nav por rol (helper puro si se extrae); tsc/lint/`pnpm build`. Manual: entrar como recepcionista (nav recortado, /configuracion redirige a /reservas) y como admin (ve Usuarios, crea/elimina).

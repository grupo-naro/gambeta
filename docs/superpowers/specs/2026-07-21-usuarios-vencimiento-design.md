# Usuarios con vencimiento (demo) — Diseño

**Fecha:** 2026-07-21
**Objetivo:** Permitir crear usuarios del panel con una **fecha de expiración** (presets de
duración: 1 / 2 / 7 / 30 días), pensados para dar accesos de prueba a potenciales clientes.
Al vencer, el usuario no puede entrar ni continuar una sesión abierta, y queda bloqueado pero
recuperable (se puede extender la fecha para reactivarlo).

## Decisiones tomadas

- **Cómo se elige:** presets de duración (`1 / 2 / 7 / 30 días` + "Sin vencimiento"). No hay
  date-picker de fecha exacta (YAGNI).
- **Enforcement:** enfoque A — el token JWT se emite con vencimiento igual a `expiraEn` del
  usuario. El login rechaza a los vencidos; el token expira solo al llegar la fecha, validado
  por `jwt.verify` en cada request. Sin consulta a la base por request.
  - Trade-off aceptado: si a un usuario ya logueado se le *acorta* la fecha, su sesión actual
    sigue válida hasta el vencimiento que llevaba el token; al re-loguear toma la fecha nueva.
    Para una demo es suficiente.
- **Al vencer:** el usuario queda bloqueado, NO se borra. Reversible vía "Extender".
- **Admin por defecto (`esDefault`) y usuarios sin vencimiento (`expiraEn = null`):** nunca
  se ven afectados.

## Cambios

### 1. Base de datos
Campo nuevo, opcional, en `AdminUser`:
```prisma
model AdminUser {
  // ...
  expiraEn DateTime?   // null = sin vencimiento
}
```
Migración que agrega la columna nullable. Los usuarios existentes quedan en `null` (sin
vencimiento), incluido el admin por defecto. No requiere backfill.

### 2. Backend

**Presets → fecha.** El endpoint de crear recibe un preset opcional de días y calcula la
fecha; nunca recibe una fecha cruda del cliente.

- `usuario.schema.ts` (`crearUsuarioSchema`): agregar `duracionDias` opcional, restringido a
  los presets: `z.union([z.literal(1), z.literal(2), z.literal(7), z.literal(30)]).optional()`.
- `usuario.service.crear`: `expiraEn = duracionDias ? new Date(Date.now() + duracionDias*86400000) : null`.
- `adminUser.repo`:
  - `create`: aceptar `expiraEn: Date | null` y devolver `expiraEn` en el `select`.
  - `list`: incluir `expiraEn` en el `select`.
  - agregar `updateExpiracion(id, expiraEn: Date | null)`.
- `auth.service.login`: tras validar la password, si `admin.expiraEn && admin.expiraEn <= new Date()`
  → `throw Unauthorized('Usuario vencido')`. Si no, firmar el token con vencimiento acotado a
  `expiraEn`.
- `auth.service.signAdminToken`: aceptar un override opcional de expiración
  (`expiresInSeconds?: number`). Si el usuario tiene `expiraEn`, el login pasa
  `Math.floor((expiraEn - now)/1000)`; si no, usa el default (`JWT_EXPIRES_IN`).
- `usuario.service.cambiarExpiracion(id, duracionDias | null, currentAdminId)`: setea
  `expiraEn = duracionDias ? ahora + días : null`. Rechaza si el usuario es `esDefault`
  (`Forbidden`). Devuelve el usuario actualizado.
- Ruta nueva: `PATCH /usuarios/:id/expiracion` (mismo guard de rol que el resto del CRUD de
  usuarios), body `{ duracionDias: 1|2|7|30|null }`.

### 3. Frontend

- **Form de crear usuario:** selector "Vencimiento" con opciones
  `Sin vencimiento (default) / 1 día / 2 días / 7 días / 30 días`. Envía `duracionDias`
  (omitido o `null` para "Sin vencimiento").
- **Lista de usuarios:** columna "Vencimiento":
  - `null` → "—".
  - futuro → "Vence el dd/mm/aaaa".
  - pasado → badge "Vencido".
  Acción por fila **"Extender"** (menú con los presets + "Quitar vencimiento") que llama al
  `PATCH .../expiracion`. No se muestra para el admin por defecto.
- **Login:** cuando el backend responde "Usuario vencido", mostrar ese mensaje (en vez del
  genérico de credenciales).

## Criterios de éxito

1. Crear un usuario con "2 días": entra hoy; pasada la fecha el login responde "Usuario
   vencido" y una sesión abierta se corta en el siguiente request.
2. La lista muestra el estado (—, "Vence el…", "Vencido").
3. "Extender" sobre un vencido lo reactiva (vuelve a poder entrar tras re-loguear).
4. El admin por defecto y los usuarios sin vencimiento no cambian su comportamiento.

## Fuera de alcance (YAGNI)

- Borrado automático de usuarios vencidos.
- Date-picker de fecha exacta.
- Avisos por email/WhatsApp de expiración.
- Chequeo de vencimiento contra la base en cada request (enfoque B).

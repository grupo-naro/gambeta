# Clientes: editar WhatsApp + eliminar — Design

**Fecha:** 2026-07-02
**Estado:** Aprobado
**Componentes:** backend (repo `canchitas-backend`) + frontend (repo `frontend`).

## Problema

En Clientes ya se puede editar **nombre** y **confianza** (hoja al tocar el cliente). Faltan:
1. **Editar el WhatsApp** (para corregir un número mal cargado).
2. **Eliminar** un cliente.

## Decisiones (con el usuario)
- Editar WhatsApp: sí, con control de duplicado.
- Eliminar: **bloqueado si el cliente tiene reservas** (no se pierde historial). Solo se borran clientes sin reservas.

## Backend

### Editar WhatsApp
- `editarClienteSchema` (`src/validators/cliente.schema.ts`): agregar al body `whatsapp: whatsappCanonico.optional()` (valida y normaliza cuando viene; permite omitirlo).
- `clienteService.editar` (`src/services/cliente.service.ts`): aceptar `whatsapp?` en `data`. Si `data.whatsapp` viene:
  - **control de duplicado:** `const otro = await clienteRepo.findByWhatsapp(data.whatsapp); if (otro && otro.id !== id) throw Conflict('Ya existe un cliente con ese WhatsApp');`
  - agregar `patch.whatsapp = data.whatsapp`.
- `clienteRepo.update` (`src/repositories/cliente.repo.ts`): sumar `whatsapp?: string` al tipo del `data` y pasarlo al `prisma.cliente.update`.

### Eliminar
- `clienteService.eliminar(id)`: `const c = await clienteRepo.findById(id)` (ya incluye `reservas`); si `!c` → `NotFound`; si `c.reservas.length > 0` → `Conflict('No se puede eliminar: el cliente tiene reservas')`; si no, `await clienteRepo.delete(id)` y devolver `{ ok: true }`.
- `clienteRepo.delete(id)`: `prisma.cliente.delete({ where: { id } })`.
- Ruta: `clienteRoutes.delete('/:id', authJwt, async (req, res, next) => { try { res.json(await clienteService.eliminar(String(req.params.id))); } catch (e) { next(e); } })`.

### Tests (integración, Testcontainers)
`tests/integration/cliente.routes.test.ts` (nuevo o extendido), con token admin:
- **Editar whatsapp OK:** crear cliente (POST /clientes), PATCH `{whatsapp: '<otro>'}` → 200; verificar el nuevo número.
- **WhatsApp duplicado:** crear cliente A y B; PATCH A con el whatsapp de B → **409**; A queda sin cambios.
- **Eliminar sin reservas:** crear cliente, DELETE → 200; ya no está.
- **Eliminar con reservas:** crear una reserva (POST /reservas, que hace upsert del cliente), DELETE ese cliente → **409** (bloqueado); el cliente sigue existiendo.

## Frontend

### Acciones (`src/lib/clientes-actions.ts`)
- `editarWhatsappCliente(id, whatsapp)`: `apiFetch('/clientes/'+id, { method:'PATCH', body: JSON.stringify({ whatsapp }) })` (vía `run`, revalida `/clientes`).
- `eliminarCliente(id)`: `apiFetch('/clientes/'+id, { method:'DELETE' })` (vía `run`).

### Hoja del cliente (`src/components/clientes/clientes-table.tsx`)
- Agregar estado `whatsapp` inicializado en `abrir(c)` con `c.whatsapp`.
- **Campo WhatsApp editable:** input + botón "Guardar" (igual patrón que Nombre), mostrando el preview del número canónico con `previewWhatsapp` (ya usado en otros diálogos) y deshabilitando Guardar si es inválido o igual al actual. Al guardar → `editarWhatsappCliente`. Si el backend devuelve 409 (duplicado), se muestra el mensaje (toast, ya lo maneja `act`).
- **Botón "Eliminar cliente"** (destructivo, al final de la hoja) con **confirmación** vía `useConfirm()` (`components/ui/confirm`, ya montado en AppShell). Al confirmar → `eliminarCliente(id)`; si OK, cerrar la hoja; si el backend bloquea (tiene reservas), mostrar el mensaje de error (toast).

## Fuera de alcance
- Editar nombre/confianza (ya existe, sin cambios).
- Borrado en cascada de reservas (se descartó; se bloquea).
- Merge/fusión de clientes duplicados.

## Integración
Backend → `main` + push → deploy VM (ahora con IPv4, el deploy vuelve a funcionar). Frontend → `master` + push → Vercel. Ambas partes deployadas para funcionar end-to-end (el eliminar necesita el DELETE del backend).

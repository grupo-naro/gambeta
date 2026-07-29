# Nombre real del cliente — Design

**Fecha:** 2026-06-16
**Estado:** Aprobado

## Objetivo

Que el sistema guarde el **nombre real** del cliente (no el del contacto de WhatsApp ni el pushName). Hoy el bot, para un contacto, usa el nombre del contacto — pero un contacto guardado como "Publicidad Naro" puede ser en realidad "Daniel". El bot debe **pedir el nombre real una vez** (a todos, contactos incluidos), guardarlo, y **reutilizarlo** en las próximas reservas sin volver a preguntar.

**Restricción:** esto **no cambia el sistema de seña por contacto** — la decisión de cobrar o no seña sigue basándose en si el número es contacto de WhatsApp (`esContacto` vía Evolution `findContacts`). La idea de decidir la seña desde la DB es a futuro, **fuera de alcance**.

## Contexto (estado actual)

- Modelo `Cliente` (`prisma/schema.prisma`): `id, nombre, whatsapp @unique, esContacto, primeraReserva, totalReservas, creadoEn, reservas[]`.
- `cliente.routes.ts`: `GET /clientes` (authJwt, lista), `GET /clientes/:id` (authJwt), `POST /clientes` (authAny, upsert). `clienteService.upsert(whatsapp, nombre, esContacto)` → `clienteRepo.upsert`.
- `reserva.service.ts` `crear()`: dentro de una transacción hace `tx.cliente.upsert({ where:{whatsapp}, create:{ whatsapp, nombre, esContacto, primeraReserva, totalReservas:1 }, update:{ nombre, esContacto, totalReservas:{increment:1} } })`. `CreateReservaInput` tiene `{ canchaId, whatsapp, nombreCliente, esContacto, fecha, horaInicio, montoSena?, notas? }`.
- Bot (n8n `I8yiX4g1rGh5Hb2U`, nodo `Cerebro`, rama `confirmar`): detecta `esContacto` con `findContacts`; si es contacto usa `nombreCtto||pushName` (no pregunta); si no, pregunta "¿a nombre de quién?" (`esperaNombre` en Redis → `nombreProvisto`). Luego `POST /reservas` con `esContacto` y `nombreCliente`.

## Decisiones (confirmadas)
- Pedir el nombre **una sola vez** (hasta tenerlo confirmado) y reutilizarlo.
- **Sin pantalla "Clientes"** en el panel por ahora (queda para más adelante).
- **Sin back-fill**: los clientes viejos quedan como están y se les pide el nombre real en su próxima reserva (migración natural).
- La seña **sigue por contacto** (sin cambios).

## Alcance

### Backend

**1. Migración — `Cliente.nombreConfirmado`**
- Agregar `nombreConfirmado Boolean @default(false)` al modelo `Cliente`. Migración Prisma (los existentes quedan en `false`).

**2. Endpoint de búsqueda por whatsapp (para el bot)**
- `GET /clientes/buscar?whatsapp=<num>` (`authAny`): devuelve `{ id, nombre, nombreConfirmado } | null` (200 con el objeto si existe, `null` si no). Valida `whatsapp` requerido (Zod) → 400 si falta. (Se registra **antes** de `GET /:id` para no ser opacado por la ruta param.)
- `clienteService.buscarPorWhatsapp(whatsapp)` + `clienteRepo.findByWhatsapp(whatsapp)`.

**3. `POST /reservas` respeta el nombre confirmado**
- `createReservaSchema.body` suma `nombreConfirmado: z.boolean().default(false)`.
- `CreateReservaInput` suma `nombreConfirmado?: boolean`.
- En `reserva.crear`, el upsert del cliente:
  - **create:** `nombreConfirmado: input.nombreConfirmado ?? false`.
  - **update:** **no pisar un nombre ya confirmado con uno sin confirmar.** Concretamente: leer el cliente existente (`tx.cliente.findUnique({where:{whatsapp}})`); si `existente?.nombreConfirmado && !input.nombreConfirmado` → mantener `existente.nombre` (no actualizar el nombre); en cualquier otro caso actualizar `nombre = input.nombreCliente`. Setear `nombreConfirmado: input.nombreConfirmado ? true : undefined` (un `true` lo confirma; un `false` no lo degrada). `esContacto` y `totalReservas:{increment:1}` como hoy.
- El panel (NuevaReservaDialog) crea reservas con un nombre tipeado por la recepción → debe enviar `nombreConfirmado: true` (es un nombre real). (Ver Frontend.)

### Frontend (cambio mínimo)
- `lib/reservas-actions.ts` `crearReserva(...)`: el `POST /reservas` que arma incluye `nombreConfirmado: true` (la recepción tipeó el nombre). No hay pantalla nueva.

### Bot (n8n, fuera de Superpowers — se hace con n8n MCP tras el deploy del backend)
- Rama `confirmar` del `Cerebro`:
  - Mantener `findContacts` **solo para `esContacto`** (seña).
  - Para el nombre: `GET /clientes/buscar?whatsapp=<number>`.
    - Si `nombreConfirmado === true` → `nombreReserva = clienteDb.nombre` (reusar, no preguntar).
    - Si no → si hay `nombreProvisto` (acaba de responder la pregunta) → usarlo; si no → preguntar *"Dale! ¿A nombre de quién registro la reserva?"* y guardar `esperaNombre` (como hoy) y cortar.
  - `POST /reservas` con `nombreCliente: nombreReserva`, `esContacto` (seña), `nombreConfirmado: true`.
  - El nombre del contacto/pushName **ya no** se usa como nombre de reserva.
- (Este cambio del bot se aplica con el MCP de n8n una vez deployado el backend; va documentado acá pero su ejecución no es parte del plan de código.)

## Datos / flujo
1. Cliente escribe, el bot llega a `confirmar`.
2. `findContacts` → `esContacto` (define seña, igual que hoy).
3. `GET /clientes/buscar?whatsapp` → ¿nombre confirmado?
   - sí → reusa.
   - no → pide el nombre (una vez) → al responder, `POST /reservas` con `nombreConfirmado:true`.
4. `reserva.crear` upsert: guarda/confirma el nombre real sin pisar uno ya confirmado; incrementa `totalReservas`; la seña depende de `esContacto` (sin cambios).

## Manejo de errores / bordes
- `/clientes/buscar` sin `whatsapp` → 400. Cliente inexistente → `null` (no 404), para que el bot sepa "preguntar".
- Reserva de un cliente nuevo (no existe) → create con `nombreConfirmado` según input.
- Si el bot no logra consultar `/clientes/buscar` (error de red) → trata como "no confirmado" y pregunta (degradación segura; nunca reserva con un nombre equivocado).
- `POST /clientes` (upsert) existente: opcionalmente aceptar `nombreConfirmado` también, pero no es necesario para este flujo (YAGNI salvo que se quiera).

## Pruebas (backend, TDD)
- `GET /clientes/buscar?whatsapp=` → devuelve `{id,nombre,nombreConfirmado}` de un cliente existente; `null` si no existe; 400 sin whatsapp.
- `POST /reservas` con `nombreConfirmado:true` para un cliente nuevo → crea el cliente con `nombreConfirmado=true` y ese nombre.
- `POST /reservas` con `nombreConfirmado:false` (o ausente) sobre un cliente que ya tiene `nombreConfirmado=true` → **NO** cambia el nombre confirmado (se mantiene "Daniel").
- `POST /reservas` con `nombreConfirmado:true` sobre un cliente no confirmado → actualiza el nombre y lo marca confirmado.
- (Vitest + Supertest + Testcontainers; necesita Docker.)

## Despliegue / compat
- Backend: rama `feat/nombre-real-cliente` → merge a `main` + **deploy VM** (`migrate deploy` aplica la columna). Frontend: rama aparte (cambio mínimo en `crearReserva`) → master local.
- Aditivo: `nombreConfirmado` default false; el flujo viejo sigue funcionando si el bot todavía no se actualizó (el bot se actualiza después del deploy).

## Fuera de alcance (YAGNI)
- Pantalla "Clientes" en el panel (ver/editar lista) — más adelante.
- Decidir la seña desde la DB (sigue por contacto de WhatsApp).
- Back-fill de nombres viejos.
- Editar/normalizar nombres existentes.

# Autocompletar cliente por WhatsApp (reserva + fijo) — Design

**Fecha:** 2026-07-02
**Estado:** Aprobado
**Componentes:** frontend (Nueva reserva + Nuevo turno fijo) + backend (turno fijo registra cliente).

## Problema

Al crear una reserva o un turno fijo, recepción tipea WhatsApp + nombre a mano cada vez, aunque el cliente ya exista. Se quiere: **poner el WhatsApp primero y, si el número ya está en Clientes, autocompletar el nombre**. Si no existe, se tipea el nombre y, al generar, el cliente queda registrado en Clientes (la reserva ya lo hace; el fijo hoy no).

## Autocompletar por WhatsApp (frontend — ambos diálogos)

- **Reordenar:** el campo **WhatsApp va primero**, luego **Nombre** (que se autocompleta), en `nueva-reserva-dialog.tsx` y `turno-fijo-dialog.tsx`.
- **Acción de búsqueda** (`src/lib/clientes-actions.ts`):
  ```ts
  export async function buscarClientePorWhatsapp(whatsapp: string): Promise<{ nombre: string } | null> {
    const canon = aCanonico(whatsapp);
    if (!canon) return null;
    try {
      const c = await apiFetch<{ nombre: string } | null>(`/clientes/buscar?whatsapp=${encodeURIComponent(canon)}`);
      return c ? { nombre: c.nombre } : null;
    } catch { return null; }
  }
  ```
  (Usa `aCanonico` de `@/lib/whatsapp` para canonicalizar; `/clientes/buscar` ya existe y matchea el whatsapp canónico guardado. Es acción de lectura → devuelve dato o `null`, resiliente.)
- **En cada diálogo:** al cambiar el WhatsApp, con **debounce ~400ms** y un **guard anti-carrera** (patrón `requestIdRef` como el que ya usan los slots de nueva-reserva), si `aCanonico(whatsapp)` es válido se llama `buscarClientePorWhatsapp`. Si devuelve un cliente → `setNombre(cliente.nombre)` y se muestra un cartelito "Cliente existente". Si `null` → no toca el nombre (se tipea a mano). El nombre queda **editable** igual.
- **Reset:** al cerrar/limpiar el diálogo, se resetea también el flag de "cliente existente".

## Registrar cliente al crear (backend — turno fijo)

- `turnoFijo.service.crear` (`backend/src/services/turnoFijo.service.ts`): tras crear el fijo, si `input.whatsapp` está presente, hacer upsert del cliente:
  ```ts
  await prisma.cliente.upsert({
    where: { whatsapp: input.whatsapp },
    create: { whatsapp: input.whatsapp, nombre: input.clienteNombre, nombreConfirmado: true },
    update: {},
  });
  ```
  (`input.whatsapp` ya viene canónico por `whatsappCanonico` del schema. `update: {}` no pisa un cliente existente.)
- La **reserva** ya hace upsert del cliente en `reservaService.crear` → sin cambios.

### Testing (integración, Testcontainers)
- Crear un turno fijo con un WhatsApp **nuevo** → aparece un `Cliente` con ese whatsapp y ese nombre.
- Crear un fijo con un WhatsApp **ya existente** (crear cliente antes) → NO duplica (sigue habiendo 1 cliente con ese whatsapp; su nombre no se pisa).

## Comportamiento del autocompletado (detalle)
- Si recepción ya tipeó un nombre y luego el WhatsApp resuelve a un cliente existente, el nombre se **reemplaza** por el de la base (fuente de verdad); puede re-editarlo a mano.
- No bloquea el submit ni valida contra la base: es solo una ayuda de tipeo.

## Fuera de alcance
- Autocompletar en el bot (el bot ya maneja su propio flujo).
- Buscar por nombre (solo por WhatsApp).
- Un selector/typeahead de clientes (es autocompletar por número, no un dropdown).

## Integración
Backend → `main` + push → deploy VM. Frontend → `master` + push → Vercel. El autocompletar (frontend) funciona con el `/clientes/buscar` que ya está deployado; el "fijo registra cliente" necesita el backend nuevo en la VM. Dos repos.

# Reservas web — vista mobile (lista de horarios) — Diseño

**Fecha:** 2026-07-27
**Objetivo:** Optimizar la web de reservas (`reservas/`) en **mobile**. El desktop queda igual (la
grilla horas×canchas). En mobile se reemplaza por una **lista vertical** de horarios (hora +
"DISPONIBLE" + precio) con selector de mes/día arriba, inspirada en la referencia del cliente.

## Decisiones tomadas

- **Solo mobile cambia** (`< md`); **desktop intacto** (la grilla actual).
- **Lista por hora:** una fila por horario. "DISPONIBLE" si **alguna** cancha del deporte está libre
  a esa hora; si no, "Ocupado". **Auto-asignación:** entre las canchas libres se toma la **más
  barata** (ese es el precio mostrado y la cancha que se reserva).
- **Precio visible** por fila → el backend agrega `precioHora` por cancha a la grilla.
- **Selector de fecha mobile:** pills de mes (**mes actual + siguiente**) + fila horizontal de días
  scrolleable. Reemplaza el calendario solo en mobile.
- Los horarios pasados ya no figuran (comportamiento actual de la grilla).
- Sin migraciones.

## Backend

- `GET /disponibilidad/grilla`: agregar `precioHora` a cada cancha de la respuesta:
  `canchas: [{ id, nombre, precioHora }]` (hoy es `{ id, nombre }`). Se toma de
  `cancha.precioHora` (Decimal → number). No cambia `horas`/`libres` ni el desktop.
- Implementación: en `disponibilidadService.grilla`, incluir `precioHora: Number(c.precioHora)` al
  mapear las canchas.

## Frontend (`reservas/`, responsive; desktop sin cambios)

- **Tipo `Grilla`:** `canchas: { id: string; nombre: string; precioHora: number }[]`.
- **`PantallaReserva`** pasa a renderizar, con el mismo estado (deporte/fecha/grilla):
  - **Desktop** (`hidden md:block`): la grilla actual (agregar `precioHora` al tipo no la rompe; se
    ignora ahí).
  - **Mobile** (`md:hidden`):
    - Botones de deporte (compartidos con desktop o duplicados por breakpoint).
    - **`SelectorFechaMobile`** (componente nuevo): pills de mes (actual + siguiente) + fila
      horizontal de días. Al elegir un día, setea `fecha` (mismo estado que el calendario del
      desktop). Días pasados no seleccionables; para el mes actual arranca en hoy.
    - **Lista de horarios:** por cada `hora` de la grilla, una fila con: la hora, un botón
      **"DISPONIBLE"** (verde) o "Ocupado" (gris), y el **precio** de la cancha libre más barata a
      esa hora. Tap en "DISPONIBLE" → abre el modal de reserva con esa cancha elegida.
  - El **modal** de nombre/teléfono/confirmación se reusa igual (ya existe).
- **Helper de selección (mobile):** para una `hora`, `elegidaMobile(grilla, hora)` devuelve la
  cancha libre de menor `precioHora` (o `null` si ninguna libre). Función pura, fácil de testear.
- El calendario del desktop (`Calendario`) se mantiene, oculto en mobile (`hidden md:block`); el
  `SelectorFechaMobile` es `md:hidden`.

## Manejo de errores

- Igual que hoy: si la grilla falla, mensaje en el área de la lista/grilla; si crear falla, mensaje
  en el modal y se recarga la grilla.
- Hora sin ninguna cancha libre → fila "Ocupado" no tocable.

## Testing

- **Backend (integración):** `GET /disponibilidad/grilla` incluye `precioHora` numérico por cancha.
- **Frontend:** la app `reservas/` no tiene runner de tests (se verifica por `pnpm build`). La
  función pura `elegidaMobile` (cancha libre más barata) se mantiene simple/determinista; si se
  quisiera testear, se puede extraer, pero no se agrega runner en este alcance.

## Criterios de éxito

1. En mobile, la reserva se ve como una lista vertical (hora + DISPONIBLE/Ocupado + precio) con
   selector de mes/día; el desktop no cambia.
2. Tocar una hora disponible reserva la cancha libre más barata de esa hora (modal → confirmar).
3. El precio mostrado es el de la cancha que se reservaría.
4. Cambiar deporte o día actualiza la lista; horarios pasados no figuran.

## Fuera de alcance (YAGNI)

- Elegir cancha puntual en mobile (se auto-asigna la más barata).
- Cambiar el desktop.
- Fotos/venue/logos de patrocinadores de la referencia (es solo ejemplo de estilo).
- Mercado Pago (sub-proyecto B).

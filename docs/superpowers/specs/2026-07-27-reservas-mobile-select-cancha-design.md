# Reservas mobile — select de cancha + precio hora pico — Diseño

**Fecha:** 2026-07-27
**Objetivo:** En la vista mobile de reservas, permitir **elegir la cancha** con un `select` antes de
ver los horarios (en vez de auto-asignar la más barata), y mostrar el **precio efectivo** por hora
(base o **hora pico**) de esa cancha. Desktop queda igual.

## Decisiones tomadas

- Mobile: un **`select` de cancha** (las canchas del deporte elegido, por nombre); por defecto la
  primera. Al cambiar de deporte, se resetea a la primera de ese deporte.
- La **lista de horarios** es de la cancha elegida: fila por hora → **DISPONIBLE** (libre) /
  **Ocupado** (gris) + el **precio efectivo** de esa hora.
- **Precio efectivo:** base o pico, según `precioEfectivo(cancha, fecha, hora, config)`. La hora
  pico se configura en la config del negocio (`picoDesde/picoHasta` y las de finde) y el
  `precioHoraPico` por cancha en el panel; la web solo lo **muestra**.
- Se **quita la auto-asignación** ("la más barata"). Las horas ocupadas de la cancha elegida se ven
  "Ocupado" (ya no desaparecen, porque es una cancha puntual).
- Desktop (grilla) **sin cambios**.

## Backend

- `GET /disponibilidad/grilla` agrega **`precios`**: precio efectivo por cancha y por hora →
  `precios: Record<string /*canchaId*/, Record<string /*hora*/, number>>`, calculado con
  `precioEfectivo(cancha, fecha, hora, cfg)` (cfg = `configService.get()`). No cambia
  `canchas`/`horas`/`libres` ni el desktop.
- Implementación en `disponibilidadService.grilla`: obtener `cfg = await configService.get()`;
  guardar `precioHora`/`precioHoraPico` por cancha; tras armar `horas`, construir
  `precios[canchaId][hora] = precioEfectivo({ precioHora, precioHoraPico }, fecha, hora, cfg)`.
- `precioEfectivo` se importa de `./precio.service.js`. `canchaRepo.list(true)` ya trae
  `precioHora` y `precioHoraPico`.

## Frontend (`reservas/`, solo mobile; desktop igual)

- **Tipo `Grilla`:** agregar `precios: Record<string, Record<string, number>>`.
- **`PantallaReserva` (bloque mobile):**
  - Botones de deporte (igual).
  - **`<select>` de cancha:** opciones = `grilla.canchas` (por `nombre`). Estado `canchaSelId`; el
    valor efectivo se deriva `canchaSel = grilla.canchas.find(c => c.id === canchaSelId) ?? grilla.canchas[0]`
    (así, al cambiar de deporte y no existir la cancha anterior, cae a la primera). `onChange` setea `canchaSelId`.
  - `SelectorFechaMobile` (igual).
  - **Lista:** por cada `hora` de `grilla.horas` → `libre = grilla.libres[canchaSel.id]?.[hora]`;
    `precio = grilla.precios[canchaSel.id]?.[hora]`. Botón **DISPONIBLE** (tap → `abrirForm(canchaSel.id, canchaSel.nombre, hora)`) si libre; si no, span **Ocupado** gris; a la derecha, `money(precio)`.
  - Se elimina el helper de auto-asignación `elegidaMobile`.
- El modal de reserva se reusa igual. Desktop no cambia.

## Manejo de errores

- Igual que hoy: grilla falla → mensaje; crear falla → mensaje en el modal + recarga.
- Si el deporte no tiene canchas → la lista/select quedan vacíos y se muestra "No hay
  disponibilidad".

## Testing

- **Backend (integración):** `GET /disponibilidad/grilla` incluye `precios[canchaId][hora]` con el
  precio efectivo; con `precioHoraPico > 0` y una ventana de pico configurada, una hora dentro del
  pico devuelve el precio pico y una fuera devuelve el base.
- **Frontend:** `reservas/` sin runner; verificación por `pnpm build`.

## Criterios de éxito

1. En mobile aparece un `select` de cancha; al elegir una, la lista muestra sus horarios y precios.
2. El precio por hora es el efectivo (pico cuando corresponde).
3. Las horas ocupadas de la cancha elegida se ven "Ocupado"; las pasadas no figuran.
4. Sin auto-asignación; el desktop no cambia.

## Fuera de alcance (YAGNI)

- Mostrar los dos precios (base y pico) a la vez: se muestra el efectivo de cada hora.
- Cambiar el desktop.
- Configurar la hora pico desde la web (se configura en el panel/config).
- Mercado Pago (sub-proyecto B).

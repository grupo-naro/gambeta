# Hoja de acción en Reservas y Calendario — Design

**Fecha:** 2026-06-15
**Estado:** Aprobado
**Programa:** Mejora UX del panel. Refactor de interacción: reusar la hoja de acción (bottom sheet) de Hoy en el resto del panel. **Pieza 1** (Reservas + Calendario). Pieza 2 (tablas de admin: canchas/usuarios/bloqueos/turnos fijos) = spec aparte. Ver [[programa-ux-panel]].

## Objetivo

Unificar la interacción con una reserva detrás de **una sola hoja inferior** (la de Hoy): en vez del menú de 3 puntos, **tocar el bloque** de la reserva abre la hoja con cobros + estado y, abajo, Reprogramar/Cancelar (y aprobar/rechazar seña si corresponde). Aplica a **Reservas** y **Calendario**, reusando el componente ya construido para Hoy.

## Contexto (estado actual)

- `components/hoy/accion-turno-sheet.tsx` (`AccionTurnoSheet`): hoja inferior que carga `getCobros`, muestra Total/Pagado/Saldo, cobro express (botones Efectivo/Transferencia + monto + "Cobrar $X"), primaria Aprobar/Rechazar seña si `ESPERANDO_SENA`, secundarias Reprogramar/Cancelar, y lista de cobros con Anular. Props `{ reserva: Reserva|null; open; onOpenChange; onReprogramar }`. Usada hoy solo por `agenda-hoy.tsx`.
- `components/reservas/reservas-table.tsx`: tabla (desktop) + tarjetas (mobile) con un **dropdown de 3 puntos** por reserva (Aprobar/Rechazar seña, Cobros→`CobrosDialog`, Reprogramar→`ReprogramarDialog`, Cancelar). Solo aparece para `CONFIRMADA`/`ESPERANDO_SENA`.
- `components/calendario/calendario-semana.tsx`: al tocar un evento de reserva abre un `Dialog` propio con datos + Aprobar/Rechazar seña, Reprogramar, Cancelar. Excluye `CANCELADA` de los eventos. `selReserva` es una `Reserva` completa tomada de `reservasById` (la lista viene de `/reservas`, que ahora trae `pagado`/`saldo`).
- La lista `/reservas` ya incluye `pagado`/`saldo` por reserva (backend mergeado a main; deploy VM pendiente — misma dependencia que Hoy).

## Decisiones (confirmadas)

- Reusar `AccionTurnoSheet` en Reservas y Calendario.
- **Mover** `components/hoy/accion-turno-sheet.tsx` → `components/reservas/accion-reserva-sheet.tsx`, renombrando el export a `AccionReservaSheet` (ahora es de "reserva", no de Hoy). Actualizar el import en `agenda-hoy.tsx`.
- Agregar **gating por estado** a la hoja:
  - Secundarias **Reprogramar/Cancelar**: solo si `estado === 'CONFIRMADA' || estado === 'ESPERANDO_SENA'`.
  - **Cobro express**: solo si `estado !== 'CANCELADA'`.
- Reservas: la fila (desktop) y la tarjeta (mobile) se vuelven tocables; se elimina el dropdown y el `CobrosDialog`.
- Calendario: se reemplaza el `Dialog` de reserva por la hoja; el `Dialog` de info de fijo/bloqueo queda igual.

## Alcance

### `components/reservas/accion-reserva-sheet.tsx` (movido + ampliado)

- Mover el archivo desde `components/hoy/accion-turno-sheet.tsx`; renombrar `export function AccionTurnoSheet` → `AccionReservaSheet`. Mantener props y toda la lógica existente.
- Gating (la `reserva` ya está disponible en el cuerpo del componente, después del `if (!reserva) return null`):
  - Calcular `const editable = reserva.estado === 'CONFIRMADA' || reserva.estado === 'ESPERANDO_SENA';`
  - El bloque de **cobro express** (rama `data.saldo > 0`) se muestra solo si `reserva.estado !== 'CANCELADA'`. Si está cancelada, no se ofrece cobrar (se puede seguir viendo la lista de cobros).
  - El bloque de **secundarias** (Reprogramar/Cancelar) se renderiza solo si `editable`.
  - La rama `ESPERANDO_SENA` (Aprobar/Rechazar) ya está condicionada por estado; queda igual.
- Actualizar `components/hoy/agenda-hoy.tsx`: importar `AccionReservaSheet` desde la nueva ruta y usar ese nombre.

### `components/reservas/reservas-table.tsx`

- Quitar el `DropdownMenu`/3 puntos y sus items (desktop y mobile) y la columna de acciones del header de la tabla.
- Hacer **tocable** toda la fila (desktop) y toda la tarjeta (mobile): `onClick` → `abrir(r)` que setea la reserva seleccionada y abre la hoja. Cursor pointer + hover sutil. (En desktop, `onClick` en `TableRow` con `className` de hover; en mobile, envolver la tarjeta en un elemento con `onClick`.)
- Estado: `const [seleccion, setSeleccion] = useState<Reserva|null>(null)`, `const [sheetOpen, setSheetOpen] = useState(false)`, `const [reprogramarId, setReprogramarId] = useState<string|null>(null)`.
- Montar `<AccionReservaSheet reserva={seleccion} open={sheetOpen} onOpenChange={...} onReprogramar={(id)=>setReprogramarId(id)} />` + `<ReprogramarDialog id={reprogramarId} open={reprogramarId!==null} onOpenChange={...} />` (con `router.refresh()` al cerrar reprogramar, como en `agenda-hoy`). **Eliminar** import y uso de `CobrosDialog`.
- Las filas de cualquier estado abren la hoja (la hoja gatea qué acciones ofrecer). Quitar `cobrosId`/`reschedulingId` viejos y el helper `act` si queda sin uso (la hoja maneja sus propias acciones); conservar lo que siga usándose.

### `components/calendario/calendario-semana.tsx`

- Reemplazar el `Dialog` de reserva (el que usa `selReserva` con botones Aprobar/Rechazar seña, Reprogramar, Cancelar) por `<AccionReservaSheet reserva={selReserva} open={selReserva!==null} onOpenChange={(o)=>{ if(!o) setSelReserva(null); }} onReprogramar={(id)=>setReprogId(id)} />`.
- El `Dialog` de info de fijo/bloqueo (`selInfo`) **no se toca**.
- Quitar los imports/handlers que queden sin uso por sacar ese Dialog (p. ej. `aprobarSena`/`rechazarSena`/`cancelarReserva`/`useConfirm`/`act` si ya no se usan en el archivo). Mantener lo que siga en uso (router, ReprogramarDialog, etc.).
- `ReprogramarDialog` ya está montado en calendario con `reprogId`; mantenerlo (con su `router.refresh()` al cerrar).

## Componentes y responsabilidades

- `accion-reserva-sheet.tsx` — única hoja de acción de una reserva (cobros + seña + reprogramar/cancelar), reusada por Hoy, Reservas y Calendario. Gatea acciones por estado.
- `reservas-table.tsx` / `calendario-semana.tsx` / `agenda-hoy.tsx` — solo abren la hoja con la reserva seleccionada; no duplican lógica de cobros/acciones.

## Manejo de errores / bordes

- Reserva `CANCELADA`/`COMPLETADA` (visibles en Reservas por filtro): la hoja se abre en modo lectura útil — muestra Total/Pagado/Saldo y la lista de cobros; oculta cobro express (si CANCELADA) y Reprogramar/Cancelar (si no es CONFIRMADA/ESPERANDO_SENA). Para COMPLETADA con saldo>0 igual permite cobrar (estado !== CANCELADA).
- Toda mutación dentro de la hoja sigue con su toast + `router.refresh()` (sin cambios).
- Depende del backend con `pagado`/`saldo` desplegado (igual que Hoy); con el deploy pendiente, mostraría montos en 0/NaN — se asume desplegado.

## Pruebas

- Solo frontend → **`pnpm lint` y `pnpm build` obligatorios**. Tests unitarios existentes deben seguir verdes (`pnpm test`). No hay lógica pura nueva que testear (el gating es condicional de render).
- QA manual (mobile): en Reservas, tocar una fila/tarjeta abre la hoja; cobrar baja el saldo; Reprogramar/Cancelar funcionan; una reserva CANCELADA abre la hoja sin botones de cobro/cancelar. En Calendario, tocar una reserva abre la misma hoja; un fijo/bloqueo sigue abriendo el diálogo de info.

## Despliegue / compat

- Solo frontend. Rama `feat/sheet-reservas-calendario` → merge a `master` local (sin push salvo indicación).
- Sin cambios de backend ni de tipos.

## Fuera de alcance (YAGNI)

- Pieza 2: tablas de admin (canchas/usuarios/bloqueos/turnos fijos) con hoja editar+acciones — spec aparte.
- Cambiar el cobro express, los textos de confirmación (ya vienen de B1) o la lógica de seña.
- Rediseño visual de la tabla más allá de hacerla tocable y sacar la columna de acciones.

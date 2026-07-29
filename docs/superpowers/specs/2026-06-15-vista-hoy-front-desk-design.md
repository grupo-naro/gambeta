# Vista "Hoy" — Front desk (mobile-first, cobro express) — Design

**Fecha:** 2026-06-15
**Estado:** Aprobado
**Programa:** Mejora integral de UX del panel. Sub-proyecto **A** (de A/B/C). B = claridad y feedback; C = identidad visual. Este spec cubre solo A.

## Objetivo

Una pantalla **"Hoy"** que sea el **home operativo de la recepción**, pensada **mobile-first** (celular/tablet de mostrador), donde la tarea más repetida —**cobrar**— se resuelve en pocos toques sin saltar entre pantallas. De un vistazo se ve la agenda del día y **quién debe**; tocando un turno se cobra al instante.

## Contexto (estado actual)

- El trabajo está repartido: dar turno (Reservas + diálogo), cobrar (diálogo de Cobros vía dropdown), ver el día (Calendario). La recepción salta entre 3 lugares por una sola interacción.
- La recepcionista no tiene "su" pantalla: el Dashboard es solo-admin; al entrar cae en `/reservas` (tabla con filtros, densa, pensada para mouse).
- **`Reserva` no trae el estado de pago**: `pagado`/`saldo` se piden aparte por reserva (`getCobros`) al abrir el diálogo. Para una vista centrada en cobrar, ver el saldo al vistazo es lo más valioso.

## Decisiones (confirmadas)

- **Usuario y dispositivo:** recepción, en **celular/tablet**. Diseño mobile-first, toques grandes (≥56px).
- **Tarea estrella:** **cobrar / registrar pago**.
- **Enfoque:** vista nueva `/hoy` + **toque mínimo de backend** (la lista de reservas devuelve `pagado`/`saldo`). Reusa todo lo demás.
- **Agenda:** muestra CONFIRMADA, ESPERANDO_SENA y COMPLETADA del día; **oculta CANCELADA**. Pasados atenuados.
- **Stepper de días** ◀ Hoy ▶ (ayer/hoy/mañana y más), default hoy.
- **Landing post-login** y **primer ítem de menú** = `/hoy` para **ambos roles**. `/reservas` queda intacta para búsquedas (admin).

## Alcance

### Backend (toque mínimo, sin migración)

`GET /reservas` (lista) incluye, por reserva, dos campos nuevos:
- `pagado: number` — suma de los `monto` de los `Cobro` de esa reserva.
- `saldo: number` — `monto - pagado` (nunca negativo: `max(0, monto - pagado)`).

Implementación: tras traer las reservas del filtro, agregar Σ cobros por `reservaId` (un `groupBy`/aggregate sobre `Cobro`, mismo patrón que `sheetsData.semana()` ya usa) y adjuntar `pagado`/`saldo` a cada reserva serializada. Sin cambios de DB, sin endpoint nuevo.

"Cobrado hoy" no requiere backend nuevo: se reusa `GET /caja?desde=<hoy>&hasta=<hoy>` (ya devuelve `total`).

### Frontend

**Ruta:** `app/(panel)/hoy/page.tsx` (Server Component).
- Lee la cookie `token` vía `apiFetch` (patrón BFF existente).
- Fetch `GET /reservas?fecha=<fechaParam>` (ahora con `pagado`/`saldo`).
- Fetch `GET /caja?desde=<fechaParam>&hasta=<fechaParam>` para el total cobrado del día.
- `searchParams` es `Promise` (Next 16); `fecha` default = hoy en TZ negocio.
- Pasa datos al cliente `AgendaHoy`.

**Layout (mobile-first):**
1. **Header pegajoso (`sticky top-0`)**: título "Hoy", fecha larga (`martes 15 de junio`), pill **"Cobrado hoy: $X"**, y stepper **◀ Hoy ▶**. El stepper cambia el searchParam `?fecha=YYYY-MM-DD` (navegación server). Cuando `fecha ≠ hoy`, el botón central dice la fecha y permite volver a "Hoy".
2. **Botón "Nuevo turno"** ancho completo en mobile → abre el `NuevaReservaDialog` existente (recibe `canchas`).
3. **Agenda del día**: turnos ordenados por hora ascendente. Cada turno = **tarjeta tocable** (`TurnoCard`): hora grande a la izquierda (HH:MM), cliente + cancha al centro, **chip de pago** (`PagoChip`) a la derecha. Turnos cuya hora ya pasó: atenuados (`opacity-60`). Oculta CANCELADA.
4. **Estado vacío**: ícono + "No hay turnos para hoy" + botón Nuevo turno.
5. **Carga**: `loading.tsx` con skeleton de tarjetas.

**Hoja de acción (`AccionTurnoSheet`)** — al tocar una tarjeta:
- Variante **bottom sheet** mobile-friendly del `Dialog` (nuevo componente `ui/sheet.tsx` o variante `side="bottom"` del Dialog de Base UI). En desktop puede caer como diálogo centrado.
- Carga `getCobros(reservaId)` (Total / Pagado / Saldo).
- **Acción primaria según estado:**
  - `ESPERANDO_SENA` → **"Aprobar seña"** (primaria) + "Rechazar seña" (secundaria). Reusa `aprobarSena`/`rechazarSena`.
  - saldo > 0 (CONFIRMADA/COMPLETADA con deuda) → **"Cobrar $[saldo]"**: dos botones grandes **Efectivo / Transferencia** (Efectivo por defecto), monto pre-cargado al saldo y editable (cobro parcial). Un toque registra el cobro (`registrarCobro` con `cobroSchema`).
  - saldo == 0 → muestra 🟢 **"Pagado"**, sin acción de cobro.
- **Secundarias** (siempre, discretas): **Reprogramar** (abre `ReprogramarDialog` existente), **Cancelar** (destructiva, con confirmación). Lista de cobros previos con **"Anular"** (`anularCobro`), colapsada/secundaria.
- Tras cualquier mutación: toast + `router.refresh()` y recarga de `getCobros`.

**Roles / navegación:**
- `nav-items.ts`: agregar `{ href: '/hoy', label: 'Hoy', icon: <Sun/CalendarCheck>, roles: AMBOS }` como **primer** ítem.
- **Landing post-login**: redirigir a `/hoy` para ambos roles (hoy cae en `/reservas` o `/dashboard`). Ajustar el redirect del login / índice de `(panel)`. El admin sigue teniendo `/dashboard` en el menú.

## Componentes (frontend) y responsabilidades

- `app/(panel)/hoy/page.tsx` — Server Component: fetch reservas+caja, arma props, render `AgendaHoy`.
- `app/(panel)/hoy/loading.tsx` — skeleton de tarjetas.
- `components/hoy/agenda-hoy.tsx` (client) — lista de tarjetas, stepper de días, estado del turno seleccionado, monta `NuevaReservaDialog`, `AccionTurnoSheet`, `ReprogramarDialog`.
- `components/hoy/turno-card.tsx` — presentacional: hora, cliente, cancha, `PagoChip`, atenuado si pasó.
- `components/hoy/pago-chip.tsx` — **pura**: `estadoPago(reserva) → { label, tono }` (verde/amarillo/rojo/espera). Unit-testeable.
- `components/hoy/accion-turno-sheet.tsx` (client) — hoja de acción: cobro express + acciones secundarias + lista de cobros.
- `components/ui/sheet.tsx` — bottom sheet (variante del Dialog de Base UI). Si resulta más simple, extender `ui/dialog.tsx` con `side="bottom"` en vez de un componente nuevo.
- **Reusa:** `NuevaReservaDialog`, `ReprogramarDialog`, `lib/cobros-actions` (`getCobros`/`registrarCobro`/`anularCobro`), `lib/reservas-actions` (`cancelarReserva`/`aprobarSena`/`rechazarSena`), `cobroSchema`, `EstadoBadge`, helpers `lib/fecha`.

## Tipos

`lib/types.ts`: agregar a `Reserva` → `pagado: number; saldo: number;`.

## Lógica del chip de pago (pura, con tests)

`estadoPago({ estado, monto, pagado, saldo })`:
- `estado === 'ESPERANDO_SENA'` → `{ label: 'Espera seña', tono: 'espera' }` (⏳, gris/azul).
- `estado === 'CANCELADA'` → no se renderiza (la agenda la oculta).
- `saldo === 0` (y monto > 0) → `{ label: 'Pagado', tono: 'pagado' }` (🟢 verde).
- `0 < pagado < monto` → `{ label: 'Debe $' + saldo, tono: 'debe' }` con matiz de "seña/parcial" (🟡 amarillo) cuando `pagado > 0`.
- `pagado === 0` → `{ label: 'Debe $' + saldo, tono: 'debe' }` (🔴 rojo).

(Colores Tailwind **estáticos**, sin clases dinámicas: mapear `tono → clase` con un objeto literal.)

## Flujo de datos

1. `/hoy?fecha=YYYY-MM-DD` (Server) → `apiFetch('/reservas?fecha=...')` + `apiFetch('/caja?desde=...&hasta=...')`.
2. Render `AgendaHoy` con `reservas`, `totalCobradoHoy`, `canchas` (para Nuevo turno), `fecha`.
3. Tocar tarjeta → `AccionTurnoSheet` abre y `getCobros(reservaId)`.
4. Cobrar/cancelar/aprobar → server action → toast → `router.refresh()` (re-fetch del Server Component) + recarga `getCobros`.
5. Stepper → `router.push('/hoy?fecha=...')`.

## Manejo de errores / bordes

- Fetch de reservas/caja falla → la página muestra error amable (no pantalla en blanco); el sheet usa toast (patrón actual de `cobros-dialog`).
- Sin turnos → estado vacío.
- `monto === 0` → chip "Pagado" (no hay deuda); sin acción de cobro.
- Cobro parcial: monto editable; validación con `cobroSchema` (mensaje de error por toast).
- Concurrencia: tras mutar, `router.refresh()` trae el estado fresco.
- TZ: la fecha de "hoy" y el agrupado por hora respetan TZ negocio (mismos helpers que el resto del panel).

## Pruebas

**Backend (TDD):**
- `GET /reservas` devuelve `pagado`/`saldo` correctos: reserva sin cobros → `pagado 0`, `saldo = monto`; con cobros parciales → `pagado` = Σ, `saldo` = `monto − pagado`; pagada → `saldo 0`. `saldo` nunca negativo.

**Frontend:**
- Unit de `estadoPago` (pura): los 4 casos (pagado / debe rojo / parcial amarillo / espera seña).
- `pnpm build` **obligatorio** antes de merge (atrapa errores de límite RSC y server-actions arrow).

## Despliegue / compat

- **Backend**: rama `feat/vista-hoy-backend`, merge a main + deploy VM (`git fetch && reset --hard && up -d --build && migrate deploy && seed`). Sin migración de DB (solo agregado de campos en la respuesta). Re-login no requerido (no toca auth).
- **Frontend**: rama `feat/vista-hoy-panel`, merge a master local. `pnpm build` verde.
- Pantallas existentes (Reservas, Calendario, Cobros) siguen funcionando; los campos nuevos `pagado/saldo` son aditivos.

## Fuera de alcance (YAGNI)

- Sub-proyecto **B** (estados de carga/vacío/error consistentes en todo el panel, microcopy, onboarding) y **C** (identidad visual, dark mode): specs aparte.
- Búsqueda/filtrado dentro de "Hoy" (lo cubre `/reservas`).
- Arrastrar-y-soltar en calendario, notificaciones push, agenda multi-día.
- Torneos.
- Sincronización de pago hacia el bot / Sheets más allá de los triggers ya existentes.

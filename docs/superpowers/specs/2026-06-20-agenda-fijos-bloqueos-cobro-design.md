# Agenda con fijos y bloqueos + cobro de fijos — Design

**Fecha:** 2026-06-20
**Estado:** Aprobado

## Problema

`/hoy` y `/reservas` consultan solo `/reservas?fecha=...` (reservas reales). Los **turnos fijos** (`TurnoFijo`, plantillas recurrentes) y los **bloqueos/torneos** (`Bloqueo`) solo se ven en el Calendario. Resultado: si hoy hay un fijo y mañana un torneo, no aparecen en la agenda operativa ni en reservas, y un fijo —que en la práctica es una reserva que paga— no se puede cobrar.

## Objetivo y alcance

1. **Visibilidad:** `/hoy` y `/reservas` muestran, para la fecha, las reservas reales **+ los fijos del día** (virtuales) **+ los bloqueos del día**.
2. **Cobro de fijos:** cada ocurrencia de un fijo se cobra **por turno, como una reserva normal**. Al cobrarla se materializa una reserva real y entra a caja/saldo con el mecanismo existente.
3. **Bloqueos/torneos:** se muestran como filas de **solo lectura** (ocupan el horario, no se cobran).

Fuera de alcance: cobro mensual/por período; editar fijos (no existe endpoint de update; se crean/eliminan).

## Decisión de arquitectura (elegida: A)

La caja se construye 100% sobre `Cobro`, y cada `Cobro` cuelga de una `Reserva` (`cobro → reserva → cancha/cliente`). Para que un turno de fijo entre a caja/saldo **debe existir una reserva**. Por eso: al cobrar un fijo se **materializa** una `Reserva` real vinculada al fijo, y de ahí en más es una reserva común. No se crea un camino de cobro paralelo.

## Precio del fijo

El fijo **no tiene precio propio**. Al crear un fijo ya **no se pide precio**. El monto al materializar/cobrar se calcula **igual que una reserva normal**: `precioEfectivo(cancha, fecha, horaInicio, cfg)` (precio de la cancha en vivo, con la lógica de pico que ya exista). Donde se muestre el precio de un fijo (agenda, tabla de fijos), se deriva de la cancha, no de un valor guardado.

## Modelo de datos

- **`Reserva.turnoFijoId String?`** (nuevo) + relación a `TurnoFijo` + **`@@unique([turnoFijoId, fechaInicio])`** → materializar es idempotente (no duplica un fijo ya materializado en esa fecha). Índice incluido por el unique.
- **`TurnoFijo.precio`** pasa a **nullable** (`Decimal?`) y deja de poblarse al crear (el precio sale de la cancha). Migración hecha a mano (`prisma/migrations/<ts>_agenda_fijos/migration.sql`) + `prisma generate`.
- **`TurnoFijo.whatsapp`**: se mantiene en el schema Prisma como `String?`, pero el **validador de creación lo exige** (ver abajo). Necesario porque el cliente de la reserva materializada se identifica por WhatsApp (`Cliente.whatsapp` es único y requerido).

## Backend

### Crear fijo (cambios)
- `crearTurnoFijoSchema`: **quitar `precio`**; **`whatsapp` pasa a requerido** y normalizado (reusar `whatsappCanonico` del feature de normalización).
- `turnoFijoService.crear`: ya no recibe/persiste `precio` (queda null).

### Materializar
- `turnoFijoService.materializar(fijoId, fecha)`:
  1. Cargar el fijo; si `!activo` o hay excepción en `fecha` → `BusinessRule`.
  2. Si ya existe reserva con `turnoFijoId = fijoId` y `fechaInicio` = ese día → **devolverla** (idempotente).
  3. Upsert de `Cliente` por `normalizarWhatsapp(fijo.whatsapp)` con `nombre = fijo.clienteNombre`.
  4. Crear `Reserva`: `canchaId = fijo.canchaId`, `fechaInicio/fechaFin` desde `fijo.horaInicio/horaFin` en `fecha` (TZ negocio, `combineDateTimeUtc`), `estado = 'CONFIRMADA'`, `monto = precioEfectivo(cancha, fecha, fijo.horaInicio, cfg)`, `montoSena = null`, `turnoFijoId = fijoId`. **No** pasa por el chequeo de conflicto de reserva (saltea el conflicto del propio fijo); igual valida que no haya otra reserva real pisando ese slot.
  5. Devolver la reserva (con `pagado`/`saldo` como las demás).
- Ruta: **`POST /turnos-fijos/:id/materializar`** (authAny; body `{ fecha: YYYY-MM-DD }`, validado). Devuelve la reserva.
- El **cobro** reusa el endpoint de cobro existente sobre la reserva devuelta (no se duplica lógica de cobro).

### Agenda
- **`GET /agenda?fecha=YYYY-MM-DD`** (authJwt) → `{ reservas, fijos, bloqueos }` para ese día:
  - `reservas`: las reservas reales del día (incluye las materializadas).
  - `fijos`: ocurrencias **virtuales** de los `TurnoFijo` activos cuyo `diaSemana` coincide, **descontando**: excepciones en esa fecha, y fijos **ya materializados** (existe reserva con ese `turnoFijoId` en esa fecha). Cada item incluye `turnoFijoId, canchaId, cancha.nombre, clienteNombre, whatsapp, horaInicio, horaFin, precio` (precio = `precioEfectivo` de la cancha).
  - `bloqueos`: los bloqueos que aplican ese día (puntual por fecha o recurrente por `diaSemana`), solo lectura.
  - Reusa la lógica de ocupación/fijos existente (`ocupacionService`/repos) — sin duplicar reglas de recurrencia/excepción.

## Frontend

- **`/hoy` (AgendaHoy)** y **`/reservas`** pasan a consumir `GET /agenda?fecha`.
- Render por slot/fila:
  - **Reserva real** → como hoy (con su cobro/estado/saldo).
  - **Fijo virtual** → fila tipo "Fijo" con cancha, cliente, hora y precio (de la cancha). Acción **Cobrar**: llama a `POST /turnos-fijos/:id/materializar {fecha}` y luego al cobro existente sobre la reserva resultante. Tras cobrar, esa fila pasa a ser la reserva real (revalida).
  - **Bloqueo/torneo** → fila de **solo lectura** (motivo + nota), marcada como ocupada; sin acciones de cobro.
- En `/reservas`, los fijos y bloqueos del día se muestran como filas adicionales distinguidas; el filtro de **estado** no les aplica (no tienen estado), el de **cancha** sí.
- Quitar el input **precio** del diálogo de nuevo turno fijo; **WhatsApp pasa a requerido** con el preview/validación ya existentes (reusa `aCanonico`/`previewWhatsapp`).
- Donde la tabla de turnos fijos muestre el precio, mostrar el de la cancha (o quitarlo).

## Errores

- Materializar un fijo inexistente/ inactivo / con excepción en la fecha → 422 `BusinessRule` con mensaje claro.
- Fijo sin WhatsApp (datos viejos): no se puede cobrar; el frontend muestra "este fijo no tiene WhatsApp, recargalo con el número para poder cobrarlo".
- Slot pisado por una reserva real distinta del fijo → `Conflict` (no debería pasar si la disponibilidad ya bloquea el fijo, pero se contempla).

## Datos existentes

Fijos viejos con `precio` cargado y/o sin WhatsApp quedan como están; el `precio` se ignora para cobrar (se usa el de la cancha) y sin WhatsApp no se pueden cobrar hasta recargarlos. Sin backfill.

## Testing

- **Backend (integración, Docker):**
  - `materializar` crea la reserva correcta (cancha/hora/monto = `precioEfectivo`, estado CONFIRMADA, `turnoFijoId` seteado) y es **idempotente** (segunda llamada devuelve la misma, no duplica).
  - materializar respeta excepción (rechaza) y fijo inactivo (rechaza).
  - `GET /agenda?fecha` devuelve reservas + fijos virtuales (excluye materializados y excepciones) + bloqueos.
  - cobrar la reserva materializada la refleja en caja/saldo.
  - crear fijo sin `precio` ok; sin `whatsapp` → 400.
- **Frontend (unit):** el merge/orden de la agenda (reserva vs fijo virtual vs bloqueo) y el dedupe de fijos ya materializados.

## Integración

- Backend: rama feature → merge a `main` + push. Migración corre en el deploy (`prisma migrate deploy`).
- Frontend: rama feature → merge a `master` local.

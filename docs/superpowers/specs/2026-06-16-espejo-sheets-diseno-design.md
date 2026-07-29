# Espejo Google Sheets — Estilo de la planilla del dueño — Design

**Fecha:** 2026-06-16
**Estado:** Aprobado

## Objetivo

Hacer que las 7 pestañas de días (LUNES…DOMINGO) que genera el **espejo de Google Sheets** (backend) tengan **el mismo estilo visual** que la planilla que el dueño maneja a mano: columnas de cancha en **celeste**, columnas "$$" en **amarillo**, fila de **TOTAL en verde** con total por cancha + total general, encabezados `CANCHA n / $$ … / DIA`, horas en la columna A.

**Se copia el ESTILO, no las anotaciones manuales.** El contenido/datos que el espejo ya vuelca (cliente + monto de cada reserva, con estado de pago) **se mantiene como está hoy**; solo se le aplica el diseño. Las anotaciones humanas de la planilla manual (TOR, Entrenamiento, "g", "10000$ mp", y los colores de texto arbitrarios) **quedan fuera de alcance** (el sistema no tiene esos datos).

## Contexto (estado actual del espejo)

- `src/services/sheets/grilla.ts` → `construirGrillaDia(horas, canchas, reservas)` arma: `header = ['Hora', ...canchas.flatMap(c=>[c.nombre,'$$'])]`; `filas` por hora con celdas `{ texto, color }` donde `color` (fondo) sale del estado de pago de la reserva (verde/amarillo/rojo) y es `null` (blanco) si no hay reserva; `filaTotal = ['TOTAL $', ...blancos, money(totalGeneral)]`. `COLORES` define PAGADO/PARCIAL/SIN_PAGAR. `ReservaCelda = { canchaId, fecha?, hora, cliente, monto, pagado }`.
- `src/services/sheets/sheetsClient.ts` → `escribirDia(dia, fecha, g)` crea la pestaña si falta y escribe: fila de encabezado `[...g.header, '', 'DIA '+fecha]`, filas de horas (hora + celdas), fila total; con `updateCells` aplicando `userEnteredValue` + `userEnteredFormat.backgroundColor` por celda (fondo blanco si no hay color).
- `sheetsData` calcula `pagado` por reserva (Σ cobros). Las horas vienen de `config.horaApertura`/`horaCierre`.

## Decisiones (confirmadas)

- **Estado de pago → color del TEXTO** del nombre del cliente (no fondo): 🟢 verde = pagado (`pagado ≥ monto`), 🟠 naranja = seña/parcial (`0 < pagado < monto`), 🔴 rojo = debe (`pagado = 0`), negro = default. Las columnas quedan con el rayado plano celeste/amarillo.
- **Horas:** de `config` (`horaApertura`–`horaCierre`), como hoy.
- **Totales por cancha** en la fila verde (nuevo) + total general.
- Las columnas salen de las **canchas activas reales** (orden por nombre); si la cancha divisible tiene partes "Cancha 4-1/4-2/4-3", aparecen como columnas con ese nombre.

## Diseño visual (objetivo)

Por pestaña de día:

| | A | B | C | D | E | … | (última) |
|---|---|---|---|---|---|---|---|
| Fila 1 (encabezado) | *(vacío)* | CANCHA 1 | $$ | CANCHA 2 | $$ | … | DIA |
| Fila 2..N (horas) | 09:00 … | cliente | monto | … | … | … | *(fecha en fila 2)* |
| Fila TOTAL | TOTAL | *(vacío)* | $cancha1 | *(vacío)* | $cancha2 | … | $general |

- **Encabezado (fila 1):** fondo blanco, **negrita**, texto negro.
- **Filas de horas:** columna A (hora) fondo blanco; cada columna de **nombre de cancha → fondo celeste**; cada columna **"$$" → fondo amarillo**; columna DIA → blanco.
- **Fila TOTAL:** fondo **verde** en todo el ancho; "TOTAL" en la columna A; el total de cada cancha en su columna "$$"; el total general en la columna DIA.
- **Celda de cancha con reserva:** texto = `cliente.nombre`, color de texto según estado de pago. **Celda "$$":** texto = `money(monto)` (negro). Sin reserva → ambas vacías (con su fondo celeste/amarillo).
- **DIA:** encabezado "DIA"; la fecha real (formato dd/MM/yyyy) en la fila 2 de esa columna.

### Colores (RGB 0–1 para la API de Sheets)
- Celeste/cyan: `{ red: 0, green: 1, blue: 1 }`
- Amarillo: `{ red: 1, green: 1, blue: 0 }`
- Verde (fila total): `{ red: 0, green: 1, blue: 0 }`
- Texto pagado (verde): `{ red: 0.13, green: 0.55, blue: 0.13 }`
- Texto seña/parcial (naranja): `{ red: 0.9, green: 0.45, blue: 0 }`
- Texto debe (rojo): `{ red: 0.8, green: 0, blue: 0 }`
- Texto default: negro `{ red: 0, green: 0, blue: 0 }`

## Cambios de implementación (backend)

### `src/services/sheets/grilla.ts`
- Reemplazar el modelo de celda `{ texto, color(fondo) }` por **`{ texto, colorTexto: ColorRGB | null }`** (el fondo ya no depende de la reserva; lo define la columna en el writer).
- `construirGrillaDia` devuelve un `GrillaDia` con:
  - `header: string[]` (sin "Hora"; A vacío → la primera celda del header es `''`, luego pares nombre/`$$`).
  - `filas`: por hora, `{ hora, celdas: { texto, colorTexto }[] }` (dos celdas por cancha: nombre con `colorTexto` según pago, monto con texto negro).
  - **`totalesPorCancha: number[]`** (un total por cancha, en el orden de las columnas) y `totalGeneral: number`.
  - Metadatos de columnas para el writer: cuáles son de nombre (celeste) y cuáles "$$" (amarillo). (Se puede derivar del índice: A=hora; luego, por cancha, col par = nombre, col impar = $$.)
- `colorTextoDe(monto, pagado)`: pagado→verde, parcial→naranja, debe→rojo (pura, testeable).

### `src/services/sheets/sheetsClient.ts`
- `escribirDia` aplica, vía `updateCells`/`repeatCell`:
  - Fila 1: `textFormat.bold = true`, fondo blanco; última columna header = "DIA".
  - Filas de horas: fondo **celeste** en columnas de nombre, **amarillo** en columnas "$$", blanco en A y DIA; en las celdas con reserva, `textFormat.foregroundColor` = `colorTexto`.
  - Fila TOTAL: fondo **verde** en todo el ancho; "TOTAL" en A; totales por cancha en cada "$$"; total general en DIA.
  - Fecha (dd/MM/yyyy) en la fila 2 de la columna DIA.
- Mantener: crear la pestaña si falta, y el aislamiento detrás de `estaConfigurado()` (no-op sin envs).

## Pruebas (TDD)
- `construirGrillaDia`: 
  - una reserva pagada → su celda de nombre con `colorTexto` verde y monto en la columna $$ correcta; reserva parcial → naranja; sin pagar → rojo.
  - `totalesPorCancha` suma por cancha correctamente y `totalGeneral` = suma de todos.
  - reserva ubicada en la (cancha, hora) correcta; sin reserva → celdas vacías.
- Los tests existentes de `grilla` se adaptan al nuevo modelo de celda (`colorTexto` en vez de `color` de fondo).
- El writer real (`sheetsClient`) no se testea contra la API (se aísla detrás de `estaConfigurado()`), igual que hoy.

## Despliegue / compat
- Solo backend. Rama `feat/espejo-sheets-diseno` → merge a `main` + **re-deploy a la VM** (necesario para que el espejo cambie). Sin migración de DB.
- Sin envs nuevas. Sigue siendo no-op si Google Sheets no está configurado.
- El próximo `POST /sheets/sync` (o cualquier cambio que dispare `marcarSucio`) reescribe las pestañas con el nuevo estilo.

## Fuera de alcance (YAGNI)
- Anotaciones manuales (TOR, Entrenamiento, "g", "mp") y los colores de texto arbitrarios de la planilla manual.
- Las pestañas que el dueño maneja a mano (LIBRE, MAS 25, TORNEO, MAS 35/40, INSCRIPCION, etc.) — el espejo solo toca LUNES…DOMINGO.
- Merges de celdas, bordes, anchos de columna milimétricos u otros detalles finos más allá de fondos/negrita/colores de texto descritos.

# Espejo en Google Sheets — Design

**Fecha:** 2026-06-15
**Estado:** Aprobado

## Objetivo

Un Google Sheet que replica el diseño del Excel actual (grilla por día: horas en filas, canchas en
columnas de pares cliente|$$, colores por estado de pago, total) y se mantiene **actualizado solo**
con las reservas/cobros del sistema. Es un **espejo de solo lectura** (la fuente es el sistema).

## Decisiones (confirmadas)
- Corre en el **backend** (googleapis + service account), disparado por **push con debounce** en cada cambio.
- **7 pestañas** = días de la **semana actual** (LUNES…DOMINGO), se sobrescriben (no histórico).
- Colores por estado de pago: **verde** = pagado (saldo 0), **amarillo** = seña/parcial, **rojo** = sin pagar.
- Sin credenciales configuradas → **no-op** (no rompe nada).
- Torneos y edición Sheet→sistema: fuera de alcance.

## Auth / configuración
- **Service account** de Google (la crea el dueño en Google Cloud, comparte el Sheet con su email como editor).
- Env del backend: `GOOGLE_SERVICE_ACCOUNT` (JSON de la cuenta de servicio, **base64**) y `SHEETS_SPREADSHEET_ID`. (Declararlas también en el bloque `environment:` de `docker-compose.vm.yml` — regla conocida: lo del `.env` no se auto-inyecta.)
- Si falta alguna env → el servicio es **no-op** (loguea "Sheets sync no configurado" y retorna).

## Modelo de datos a volcar (por día de la semana actual)
- Días: lunes→domingo de la semana de hoy (TZ Argentina). Cada pestaña se llama por el día (LUNES…DOMINGO); la **fecha** real va en el encabezado (celda O1/"DIA").
- **Filas:** una por hora, de `config.horaApertura` a `config.horaCierre` (col A, formato HH:MM).
- **Columnas:** A = hora; luego por cada **cancha activa** (orden por nombre) **dos columnas**: `<nombre>` (cliente) y `$$` (monto). Última fila **TOTAL $** = suma de `monto` de las reservas del día.
- **Celda** (cancha, hora): si hay una reserva no cancelada que empieza a esa hora ese día → col cliente = `cliente.nombre`; col $$ = `monto` (formateado). **Color de fondo** del par según el saldo de esa reserva: pagado (`Σcobros ≥ monto`) → verde; parcial (`0 < Σcobros < monto`) → amarillo; sin pagar (`Σcobros = 0`) → rojo. Sin reserva → celda vacía.

## Backend

### Dependencia
Agregar `googleapis` a `package.json`. (El Docker reconstruye e incluye la dep.)

### Builder puro (testeable) — `src/services/sheets/grilla.ts`
`construirGrillaSemana(input)` donde input = `{ dias: {dia, fecha}[], horas: string[], canchas: {id,nombre}[], reservas: {canchaId, fecha, hora, cliente, monto, pagado}[] }`. Devuelve, por día, una matriz de filas/celdas con `{ texto, color }` y la fila de total. **Pura**, sin googleapis ni red → unit-testeable (colores por saldo, total, ubicación de la reserva en la celda correcta).

### Datos
`sheetsData.semana()`: arma la lista de reservas de la semana actual con su `pagado` (Σ cobros por reserva). Reusa `reservaRepo`/`cobroRepo` (un query de reservas de la semana + cobros agregados por reserva). Horas de `configService`, canchas activas de `canchaRepo`.

### Writer — `src/services/sheets/sheetsClient.ts`
- Auth: `google.auth.JWT` con las credenciales del service account (parseadas de `GOOGLE_SERVICE_ACCOUNT` base64). Scope `https://www.googleapis.com/auth/spreadsheets`.
- `estaConfigurado(): boolean` (env presentes).
- `escribirDia(dia, fecha, grillaDelDia)`: asegura que la pestaña exista (la crea si falta, vía `batchUpdate addSheet`), limpia el rango, escribe valores (`values.update`) y aplica **colores de fondo** por celda (`batchUpdate` con `repeatCell`/`updateCells`).
- `escribirSemana(...)`: las 7 pestañas.

### Servicio + trigger — `src/services/sheets/sheetsSync.service.ts`
- `sincronizarTodo()`: arma la semana y escribe las 7 pestañas (usado por el endpoint on-demand).
- `marcarSucio(fecha)`: **best-effort, no bloqueante** (try/catch, nunca rompe la operación). Debounce **por fecha** (Map<fecha, timer> en proceso, ~2.5 s): al disparar, reconstruye **solo la pestaña de ese día**. Si `!estaConfigurado()` → no-op.
- Llamado desde: `reserva.crear`, `reserva.cancelar`, `reserva.reprogramar`, `cobro.crear`, `cobro.eliminar`, `reserva.aprobarSena` — con la fecha (TZ negocio) de la reserva afectada. (Reprogramar marca el día viejo y el nuevo.)

### Endpoints
- `POST /sheets/sync` (`authJwt` + `requireRole('ADMIN')`): `sincronizarTodo()` on-demand → `{ ok }` (o 503 si no configurado).
- `GET /sheets/info` (`authJwt` + `requireRole('ADMIN')`): `{ configurado: boolean, url: string | null }` (url = `https://docs.google.com/spreadsheets/d/<id>` si configurado).

### Tests (TDD)
- `construirGrillaSemana`: una reserva pagada → celda con cliente/monto y color verde; parcial → amarillo; sin pagar → rojo; cancelada → no aparece; total = suma de montos del día; reserva ubicada en la (cancha,hora) correcta.
- `sheetsSync.marcarSucio` y `sincronizarTodo` con env ausente → no-op (no lanza, no llama red). (El writer real no se testea contra la API; se aísla detrás de `estaConfigurado()`.)
- `POST /sheets/sync` sin config → 503; con RECEPCIONISTA → 403.

## Frontend (mínimo, admin)
- En `/configuracion`, sección **"Planilla de Google"**: muestra el estado (`GET /sheets/info`): si configurado, **link al Sheet** + botón **"Sincronizar ahora"** (server action → `POST /sheets/sync`, toast); si no, un texto de cómo activarlo (crear service account, compartir el Sheet, setear envs).
- `lib/types`: `SheetsInfo { configurado: boolean; url: string | null }`. Action `sincronizarSheets()`.

## Setup que hace el dueño
1. Crear un proyecto/Service Account en Google Cloud, habilitar la **Google Sheets API**, descargar el JSON.
2. Crear (o usar) un Google Sheet y **compartirlo con el email de la service account** (editor).
3. Poner en el `.env` de la VM `GOOGLE_SERVICE_ACCOUNT` (el JSON en base64) y `SHEETS_SPREADSHEET_ID`, y declararlas en `docker-compose.vm.yml`.

## Fuera de alcance
- Pestañas de torneos/ligas.
- Histórico (solo semana actual, sobrescrita).
- Sincronización inversa (editar en el Sheet no afecta al sistema).
- Formato avanzado más allá de la grilla + colores de fondo (sin merges/íconos del Excel original).

## Compat / despliegue
- Sin cambios de DB (no hay migración). Solo nueva dependencia + envs.
- Mientras no se configuren las envs, todo sigue igual (no-op). Una vez configurado, se puebla solo y con el botón "Sincronizar ahora".

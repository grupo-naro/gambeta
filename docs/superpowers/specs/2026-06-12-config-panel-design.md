# Configuración editable (panel admin) — Design

**Fecha:** 2026-06-12
**Estado:** Aprobado

## Objetivo

Que el dueño edite desde el panel, sin redeploy: **horarios del complejo**,
**teléfono del administrador** (escalado del bot) y **datos de seña/pago**
(modo, %/monto, alias, CBU, titular). Hoy esos valores viven en `.env` (seña) y
hardcodeados en el bot (teléfono). Pasan a la base de datos como fuente de verdad.

## Decisiones (aprobadas)
- **Horarios: único global** (`horaApertura`–`horaCierre`) para todo el complejo,
  todos los días. La disponibilidad pasa a usar este rango y **deja de depender del
  horario por-cancha** (`HorarioDisponible` queda en el esquema, sin uso; futuro override).
- **Teléfono admin:** es el número de escalado del bot (comprobantes a revisar).
- El form de seña incluye **modo + porcentaje/monto fijo + alias + CBU + titular**.

## Backend

### Modelo: `Configuracion` (singleton, una sola fila)
```
model Configuracion {
  id             String   @id @default("default")   // fila única
  horaApertura   String   // "HH:MM"
  horaCierre     String   // "HH:MM"
  adminWhatsapp  String
  senaModo       SenaModo @default(PORCENTAJE)       // enum PORCENTAJE | FIJO
  senaPorcentaje Int      @default(50)
  senaMontoFijo  Decimal  @db.Decimal(10,2) @default(5000)
  cbu            String   @default("")
  alias          String   @default("")
  titular        String   @default("")
  actualizadoEn  DateTime @updatedAt
}
enum SenaModo { PORCENTAJE FIJO }
```

### Migración + seed
- Migración crea la tabla.
- Un **`ensureConfig()`** (en seed y/o al primer acceso) hace `upsert` de la fila
  `id="default"` con los **valores actuales del `.env`** (`SENA_*`, horario 16:00–23:00,
  `adminWhatsapp` = el número que hoy usa el bot `5491159582039`). Así el comportamiento
  no cambia al desplegar.
- Tras la migración, los `SENA_*` del `.env` dejan de usarse (la DB manda). Se pueden
  dejar en `.env` sin efecto.

### Servicios
- **`configService`**: `get()` (devuelve la fila, la crea desde defaults si falta),
  `update(patch)` (valida y actualiza, audita `ACTUALIZAR_CONFIG`).
- **`senaService`** pasa a **async** y lee de `configService.get()`:
  `montoParaPrecio(precioHora)` y `datosPago()`. Ripple: `reserva.service.crear`
  (que ya es async) debe `await` esas llamadas; `config.routes` GET /config/sena también.
- **`disponibilidad.service`**: el rango de slots se arma con `horaApertura`–`horaCierre`
  de la config (en vez de iterar `HorarioDisponible`). Sigue restando reservas existentes.

### Endpoints
- **`GET /config`** (`authAny`): devuelve la config completa (la usa el panel y el bot).
  No expone secretos (CBU/alias se muestran a clientes; adminWhatsapp es interno no sensible).
- **`PATCH /config`** (`authJwt`): actualiza campos (parcial). Validación Zod: `horaApertura`/
  `horaCierre` `HH:MM` y apertura < cierre; `senaModo` enum; `senaPorcentaje` 0–100;
  `senaMontoFijo` ≥ 0; `adminWhatsapp` ≥ 8 dígitos; alias/cbu/titular strings.
- `GET /config/sena` se mantiene (ahora derivado de la DB) por compatibilidad.

## Bot (n8n, cambios chicos)
- **Teléfono admin:** el Cerebro hoy tiene `ADMIN='...'` fijo. En la rama de escalado de
  comprobante, pasa a leer `adminWhatsapp` de `GET /config` (fallback al valor actual si falla).
- **Horario en el prompt:** el nodo Prompt inyecta `horaApertura`–`horaCierre` desde
  `GET /config` (igual patrón que la lista dinámica de canchas), para que Gemini ofrezca el horario real.
- **Seña:** sin cambios (el bot ya recibe `datosPago`/`montoSena` en la respuesta de `POST /reservas`).

## Frontend (Next 16, BFF — patrón Reservas/Canchas)
- Nuevo ítem **"Configuración"** en el sidebar (`app-shell.tsx`, ícono `Settings`).
- Página **`/configuracion`** (Server Component): carga `GET /config`.
- Form (client) en tres secciones, con guardar por sección o uno general:
  - **Horarios:** apertura, cierre.
  - **Contacto:** WhatsApp del administrador.
  - **Pagos / Seña:** modo (porcentaje | fijo); si porcentaje → `senaPorcentaje`,
    si fijo → `senaMontoFijo`; alias, CBU, titular.
- Server Action `guardarConfig(patch)` → `PATCH /config` → `revalidatePath('/configuracion')`, toast.
- Validación Zod (espeja el backend): `configSchema` en `src/lib/validators.ts` + unit test.

### Errores / UX
- Toasts éxito/error; `pending` al guardar; validación previa (HH:MM, apertura<cierre, % 0–100).
- 401 → patrón existente (redirect a login).

## Testing
- **Backend (Vitest integración):** `GET /config` devuelve la fila (creándola si falta);
  `PATCH /config` actualiza y valida (rechaza HH:MM inválido, % fuera de rango, apertura≥cierre);
  `senaService` calcula desde la config de DB; `disponibilidad` usa el horario global.
- **Frontend:** unit de `configSchema`; resto con tsc/lint/build.

## Fuera de alcance
- `SENA_TIMEOUT_MINUTOS` y `CANCELACION_ANTICIPACION_HORAS` (siguen en `.env`).
- Horario por día de la semana o por cancha (futuro; `HorarioDisponible` queda para eso).
- Multi-sede / multi-config.

## Nota
El fix pendiente "cancha nueva genera HorarioDisponible" queda **redundante** una vez que
la disponibilidad use el horario global; es inofensivo dejarlo, pero ya no es necesario.

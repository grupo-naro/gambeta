# Precio por hora pico — Design

**Fecha:** 2026-06-13
**Estado:** Aprobado

## Objetivo

Que el precio de una reserva varíe según el horario: **precio pico** si la hora de inicio cae en
la franja pico del tipo de día (semana o fin de semana), y **precio normal** si no. El admin
configura las franjas (global) y el precio pico de cada cancha.

## Decisiones (confirmadas)
- Franja pico **global** (en Configuracion) + **precio pico por cancha**.
- **Distinguir fin de semana:** franja pico de semana y franja pico de finde, distintas. El precio pico es el mismo número (no hay precio finde aparte). Sáb/Dom = finde.
- Compat: `precioHora` actual pasa a ser el **precio normal/base**; sin pico configurado → comportamiento idéntico al actual.

## Modelo de datos

### Cancha
- Suma `precioHoraPico Decimal @default(0) @db.Decimal(10,2)`. `precioHora` = precio normal/base.
- Semántica: `precioHoraPico <= 0` → **sin recargo** (se cobra `precioHora` siempre).

### Configuracion (singleton global)
Suma 4 campos String (HH:MM, default `""`):
- `picoDesde`, `picoHasta` — franja pico de **lunes a viernes**.
- `picoFindeDesde`, `picoFindeHasta` — franja pico de **sábado y domingo**.
- Franja vacía (`""`) o `desde === hasta` → **sin franja pico** ese tipo de día.

## Cálculo (backend)

### Helper puro `precioEfectivo`
Nuevo módulo `src/services/precio.service.ts` (o función exportada), testeable:
```
precioEfectivo(
  cancha: { precioHora: number|Decimal; precioHoraPico: number|Decimal },
  fecha: string,        // YYYY-MM-DD
  horaInicio: string,   // HH:MM
  cfg: { picoDesde; picoHasta; picoFindeDesde; picoFindeHasta },
): number
```
Lógica:
1. `base = Number(cancha.precioHora)`, `pico = Number(cancha.precioHoraPico)`.
2. Si `pico <= 0` → devolver `base`.
3. Determinar tipo de día: `wd = dayOfWeekInTz(fecha, TZ_NEGOCIO)` (0=domingo..6=sábado); `esFinde = wd === 0 || wd === 6`.
4. Elegir franja: finde → `picoFindeDesde/Hasta`; semana → `picoDesde/Hasta`.
5. Si la franja es válida (`desde` y `hasta` no vacíos y `desde < hasta`) y `desde <= horaInicio < hasta` (comparación lexicográfica de HH:MM, que ordena bien) → devolver `pico`. Si no → `base`.

(Comparar HH:MM como string funciona porque están zero-padded y mismo formato.)

### Aplicación en `reserva.crear`
- Hoy: `monto = Number(cancha.precioHora)` y `montoSena = senaService.montoParaPrecio(Number(cancha.precioHora))`.
- Pasa a: `const precio = precioEfectivo(cancha, fecha, horaInicio, cfg)` (cfg de `configService.get()`); `monto = precio`; `montoSena = senaService.montoParaPrecio(precio)`.
- `senaService` no cambia (recibe un número).

### `reprogramar`
No recalcula el monto: mantiene el `monto`/seña originales (fuera de alcance reconciliar seña). Documentado.

## Frontend (panel)

### Canchas
- `Cancha` (tipo) suma `precioHoraPico: number`.
- `canchaSchema` suma `precioHoraPico` (coerce number, `>= 0`, default 0).
- Dialog (form **simple**): campo "Precio hora pico" (number, opcional; 0/ vacío = sin pico). Al editar pre-carga el valor.
- `canchas-actions` `CanchaInput` suma `precioHoraPico: number`.
- La divisible se crea con `precioHoraPico = 0` en sus unidades (no se duplica el form divisible); el admin ajusta el pico de cada unidad editándola luego. (Backend `crearDivisible` NO toma pico.)
- La tabla puede mostrar el pico junto al precio (ej. "$X · pico $Y") — opcional, menor.

### Configuración
- `Config` (tipo) suma `picoDesde/picoHasta/picoFindeDesde/picoFindeHasta`.
- `configSchema` suma los 4 campos (regex HH:MM **o** vacío; si ambos de una franja están seteados, `desde < hasta`).
- Pantalla `/configuracion`: sección "Hora pico" con franja de semana (desde/hasta) y franja de finde (desde/hasta), con ayuda ("vacío = sin hora pico").

## Bot (n8n directo, después del deploy)
- `consultar_precio`: con `/canchas` (ya devuelve `precioHoraPico`) y `/config` (franjas), responder normal + pico cuando hay pico (ej. "Cancha 1: $X, y $Y en hora pico de 19 a 23"). Si la cancha no tiene pico, solo el normal.
- Reserva: el monto/seña al confirmar ya los devuelve el backend (`POST /reservas` con precio efectivo) → el flujo no cambia. (Opcional: mencionar "(hora pico)" si el monto es el pico.)

## Backend — validación
- `createCanchaSchema`/`updateCanchaSchema`: `precioHoraPico` (number, opcional, `>= 0`, default 0 en create).
- `configSchema` (backend, PATCH /config): los 4 campos opcionales, cada uno HH:MM estricto **o** string vacío; validar `desde < hasta` por franja cuando ambos están presentes y no vacíos. Mantener la validación existente de horaApertura/Cierre/seña.

## Testing
- **Backend (TDD):**
  - `precioEfectivo`: sin pico (`precioHoraPico=0`) → base; hora dentro de franja semana → pico; fuera → base; finde usa franja finde; franja vacía → base; borde (`horaInicio === desde` incluido, `=== hasta` excluido).
  - `POST /reservas` en hora pico → `monto` = pico y `montoSena` proporcional; fuera de pico → base. (Integración con Configuracion seteada.)
  - Validación: `precioHoraPico` negativo → 400; franja con `desde >= hasta` → 400.
- **Frontend:** unit de `canchaSchema` (precioHoraPico) y `configSchema` (franjas válidas/ inválidas/ vacías); tsc/lint/`pnpm build`.
- **Bot:** probar `consultar_precio` por WhatsApp tras el deploy.

## Compat / migración
- Migración: `Cancha.precioHoraPico` default 0; `Configuracion` 4 campos default `""`. Sin backfill: nada cambia hasta que el admin configure pico y precios.

## Fuera de alcance
- Recalcular precio al reprogramar.
- Mostrar precio en calendario/disponibilidad.
- Más de una franja pico por tipo de día; pricing por día puntual o feriados.
- Precio pico distinto entre semana y finde (el número de pico es único por cancha).

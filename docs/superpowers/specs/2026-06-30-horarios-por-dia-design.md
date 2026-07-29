# Horarios de apertura/cierre por día de la semana — Design

**Fecha:** 2026-06-30
**Estado:** Aprobado (diseño). **Implementación diferida a post-instalación** (antes del corte del bot).
**Componentes:** backend (config + disponibilidad + sheets), frontend (Configuración + calendario), bot (texto de horario).

## Problema

Hoy el complejo tiene **un único horario global** de apertura/cierre (`Configuracion.horaApertura` / `horaCierre`, default 16:00–23:00), usado por la disponibilidad, la hoja espejo, el calendario y el bot. Pero **los horarios varían por día** (ej. el finde no es igual que la semana, y puede variar día a día). Se necesita un horario de apertura/cierre **por cada día de la semana** (global, igual para todas las canchas).

Decisión de granularidad (con el usuario): **por día de la semana** (7 horarios), NO por cancha. El modelo existente `HorarioDisponible` (por-cancha-por-día) queda **sin tocar** (está sin usar y es más granular de lo necesario).

## Enfoque elegido (A): tabla `HorarioComplejoDia`

Tabla nueva con exactamente **7 filas** (una por `diaSemana` 0-6, donde 0=domingo … 6=sábado, consistente con `dayOfWeekInTz`):

```prisma
model HorarioComplejoDia {
  diaSemana    Int    @id            // 0=domingo .. 6=sábado
  horaApertura String                // "HH:MM"
  horaCierre   String                // "HH:MM"
}
```

- **Migración + seed:** crear la tabla y **sembrar las 7 filas con el valor global actual** (`Configuracion.horaApertura/horaCierre`). Así el comportamiento **no cambia** hasta que el admin edite algún día.
- **Fuente de verdad:** estas 7 filas pasan a ser autoritativas para la disponibilidad. Los campos `Configuracion.horaApertura/horaCierre` se conservan como **default/seed y fallback** (si por algún motivo faltara una fila), y como dato genérico para el bot. No se borran (evita romper consumidores y migraciones).

### Helper central
`horarioDe(fecha: string): { horaApertura: string; horaCierre: string }`
- `dow = dayOfWeekInTz(fecha, TZ)`; devuelve la fila de ese `diaSemana`; si no existe, cae al global de `Configuracion`.
- Un `horario.service` con `todos()` (las 7) y `porDia(dow)`.

## Cambios por superficie

### Backend
- **Schema + migración** (tabla + seed 7 filas desde el global).
- **`horario.service` / repo:** `todos()`, `porDia(dow)`, `actualizarDia(dow, {apertura, cierre})` (o `actualizarTodos`).
- **`disponibilidad.service`** ([línea ~32](../../backend/src/services/disponibilidad.service.ts)): el loop de slots usa `horarioDe(fecha)` en vez de `cfg.horaApertura/horaCierre`.
- **Config endpoint:** `GET /config` (o un `GET /config/horarios`) devuelve las 7 filas; un endpoint para actualizarlas (`PUT /config/horarios`), con validador Zod (`HH:MM`, `apertura < cierre`).
- **Validación:** cada día `horaApertura < horaCierre`; formato `HH:MM`. (Fuera de alcance: horarios que cruzan medianoche.)

### Hoja espejo (Google Sheets)
- `sheetsData`/`sheetsSync` arman cada **pestaña-día por separado** → cada día usa **su propio** `horasDeConfig(horarioDe(fecha))` para las filas. (Mejora: cada día muestra sus horas reales en vez de un rango único.)

### Frontend (panel)
- **Configuración:** reemplazar los 2 inputs de horario por una **tabla de 7 filas** (Lunes…Domingo → apertura/cierre), con su server-action de guardado. Validación de `apertura < cierre`.
- **Calendario** (`horasDelDia`): la grilla semanal usa el **rango unión** (mínima apertura, máxima cierre de los 7 días) para que ningún turno quede fuera de la grilla; o por-día si el diseño lo permite. (Decidir en el plan; unión es lo más simple.)

### Bot (n8n, directo)
- El Prompt hoy pasa `P.horaAp`/`P.horaCi` (global) para la respuesta de FAQ "horario". Opción simple: que el FAQ liste el horario **por día** (o diga "el horario varía por día, te muestro disponibilidad"). La **disponibilidad** que ofrece el bot ya saldría correcta porque viene del endpoint del backend (que usa `horarioDe`). Cambio menor y posterior al backend.

## Testing
- **Unit** de `horarioDe`/`horario.service` (fila por día, fallback al global, finde = sáb/dom consistente con `dayOfWeekInTz`).
- **Integración** de `disponibilidad`: un día con horario reducido ofrece menos slots que otro día más amplio.
- **Unit** del validador (apertura<cierre, formato).
- Frontend: unit del schema de los 7 horarios; `pnpm build`/`lint`.

## Fuera de alcance
- Horarios **por cancha** (se mantiene `HorarioDisponible` sin usar).
- Horarios que **cruzan medianoche** (cierre < apertura) — se asume mismo día.
- Feriados / fechas puntuales con horario especial (futuro; hoy se cubre con un Bloqueo).

## Integración / timing
Backend (migración) → merge a `main` + push (deploy por la Action; correr `prisma migrate deploy` a mano si el workflow no lo hace). Frontend → master + push (Vercel). Bot → directo. **Implementar post-instalación y antes del corte del bot.** No bloqueante para el go-live (se arranca con el horario global único).

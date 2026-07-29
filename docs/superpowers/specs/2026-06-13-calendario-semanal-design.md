# Calendario semanal de reservas — Design

**Fecha:** 2026-06-13
**Estado:** Aprobado

## Objetivo

Una vista de calendario **semanal estilo Google Calendar** en el panel para ver las reservas,
con las **canchas diferenciadas por color**. Días en columnas, horas en filas, cada reserva
es un bloque coloreado según su cancha. Click en una reserva abre su detalle con las acciones
ya existentes (cancelar/reprogramar/aprobar/rechazar seña).

## Decisiones (confirmadas)
- Vista: **semana** (lun–dom), estilo Google Calendar. (Día/mes fuera de alcance.)
- Implementación: **grilla propia con Tailwind/CSS grid** (sin librería; evita riesgo de compat React 19/Next 16).
- Interacción: **ver + click en reserva → dialog con acciones existentes**. (Crear desde slot vacío y drag&drop fuera de alcance.)
- Color **por cancha**, paleta determinística + leyenda.
- Página nueva `/calendario` (no se toca `/reservas`).

## Backend (cambio chico → workflow Superpowers)

### Filtro por rango en GET /reservas
- `listReservaSchema.query` suma `desde` y `hasta` (ambos `YYYY-MM-DD`, opcionales, mismo regex que `fecha`).
- `reservaService.list` construye el `where` con `fechaInicio` en el rango `[inicio de 'desde' en TZ negocio, fin de 'hasta' en TZ negocio]` reusando los utils de tz (`dayWindowUtc`). Si vienen `desde`+`hasta`, se usa el rango; si viene `fecha` (comportamiento actual), se mantiene; `canchaId`/`estado`/`whatsapp` siguen igual y se combinan.
- Implementación del rango: `fechaInicio >= dayWindowUtc(desde).start` AND `fechaInicio < dayWindowUtc(hasta).end` (end = inicio del día siguiente a `hasta`).
- **Tests TDD:** reservas dentro del rango se devuelven; fuera del rango se excluyen; combinación con `estado` funciona; `desde` sin `hasta` (o viceversa) — definir: si falta uno, se ignora el rango y cae al comportamiento por `fecha`/sin filtro (documentado en el test).

### Sin otros cambios
El endpoint sigue `authJwt`. No cambia el shape de la reserva devuelta (ya trae `cancha{id,nombre}`, `cliente`, `fechaInicio`, `fechaFin`, `estado`, `monto`, `montoSena`).

## Frontend — página `/calendario`

### Server Component (BFF)
- Lee `searchParams.semana` (`YYYY-MM-DD`, ancla; default = hoy). Calcula el lunes de esa semana y el domingo (en TZ Argentina).
- Fetch en paralelo vía `apiFetch`: `GET /reservas?desde=<lunes>&hasta=<domingo>` (+ `estado` si se filtra), `GET /canchas`, `GET /config`.
- Pasa a la grilla: las reservas, el mapa cancha→color, y el rango horario (`horaApertura`/`horaCierre` de config).
- **Navegación:** "‹ semana anterior", "Hoy", "semana siguiente ›" como `<Link>` que cambian `?semana=` (server-driven, sin estado cliente). Encabezado con el rango de fechas mostrado.

### Grilla (Tailwind CSS grid)
- Columnas: 7 días (lun–dom) con encabezado (día + fecha; resaltar "hoy").
- Filas: una por hora, de `horaApertura` a `horaCierre` (ej. 16:00–23:00).
- Cada reserva → bloque de 1 hora en su día/hora. Posición: día calculado en TZ Argentina (`toLocaleString`/`Intl` con `timeZone: 'America/Argentina/Buenos_Aires'`), hora = `getHours` en esa TZ.
- **Solapamientos:** varias reservas en la misma celda (día+hora) → bloques lado a lado (flex dentro de la celda).
- **Estados:** se muestran CONFIRMADA, COMPLETADA y ESPERANDO_SENA; las ESPERANDO_SENA con opacidad reducida + etiqueta "(seña)". **CANCELADA no se muestra.** (El backend puede recibir `estado` o el front filtra las canceladas en memoria; se filtra en memoria para no perder las otras.)
- Color = cancha; estado = marca secundaria (opacidad).

### Color por cancha
- Paleta fija de ~10 colores Tailwind (clases estáticas, no generadas dinámicamente, para que Tailwind no las purgue).
- Asignación determinística: canchas ordenadas por `id` (estable) → índice `i` → `paleta[i % paleta.length]`. Mismo color siempre para la misma cancha.
- **Leyenda** arriba de la grilla: cuadradito de color + nombre de cancha, por cada cancha activa.
- Helper puro `colorDeCancha(canchaId, canchasOrdenadas)` → clases de color, testeable por unidad.

### Interacción — detalle de reserva
- Los bloques son client components (`'use client'`) que renderizan el bloque coloreado y manejan un dialog de detalle al clickear.
- El dialog muestra: cancha, cliente (nombre + whatsapp), fecha/hora, estado, monto/seña, y las **acciones existentes** importadas de `reservas-actions` (cancelar, reprogramar, aprobar/rechazar seña) con el mismo patrón `run()` + toasts. Reusar la lógica/markup de acciones que ya tiene `/reservas` (extraer a un componente compartido si hace falta para no duplicar).

### Navegación del panel
- `app-shell` suma el item **"Calendario"** (ruta `/calendario`).

## Testing
- **Backend:** test de integración del filtro por rango (`desde`/`hasta`) — dentro/fuera del rango, combinación con estado, y el caso de un solo extremo.
- **Frontend:** unit del helper `colorDeCancha` (determinismo + módulo de la paleta) y del cálculo de la semana (lunes/domingo desde un ancla). tsc/lint/`pnpm build` (obligatorio: el boundary RSC no lo atrapan tsc/lint/vitest).
- **Manual:** abrir `/calendario`, ver la semana, navegar prev/next/hoy, ver colores+leyenda, clickear una reserva y ejecutar una acción.

## Fuera de alcance
- Crear reserva desde slot vacío.
- Drag & drop para reprogramar.
- Vistas día y mes.
- Reservas de más de 1 hora (hoy los turnos son de 1 hora; si en el futuro hay multi-hora, el bloque abarcaría varias filas — no se contempla ahora).

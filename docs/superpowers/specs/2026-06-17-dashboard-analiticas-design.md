# Analíticas del Dashboard — Design

**Fecha:** 2026-06-17
**Estado:** Aprobado

## Objetivo

Sumar al Dashboard tres analíticas con un **selector de período** (Hoy / 7 días / 30 días) que afecta a todo: **ingresos por período** (total + tendencia diaria), **horarios más pedidos** (ya existe, ahora acotado al período) y **ocupación** (mapa de calor día×hora). Aprovecha la base de analítica que ya hay.

## Contexto (estado actual)

- `src/services/analytics.service.ts`: `ingresos(desde?, hasta?)` (suma `monto` de CONFIRMADA/COMPLETADA; ya soporta rango), `canchasTop()`, `horariosPico()` ($queryRaw, cuenta por hora), `ocupacion()` ($queryRaw, cuenta por (DOW, hora)). 
- `src/routes/analytics.routes.ts`: `authJwt + requireRole('ADMIN')`; `GET /analytics/ingresos|canchas-top|horarios-pico|ocupacion` — **ninguna lee query** (llaman sin args). Helper `serializeBigInt` para los $queryRaw.
- Frontend `app/(panel)/dashboard/page.tsx` (Server Component, `requireAdmin()`): 3 metric cards (Ingresos total, Reservas de hoy, Cancha más reservada) + `HorariosChart`. Usa `safe()` para tolerar fallos. `components/dashboard/metric-card.tsx` y `horarios-chart.tsx` (recharts). recharts disponible.
- Utils TZ: `dayWindowUtc(ymd, tz)` → `{ start, end }` (inicio del día y del día siguiente). `hoyAR()` en frontend.

## Decisiones (confirmadas)
- Período (Hoy / 7 días / 30 días) afecta **todas** las métricas.
- Ocupación = **mapa de calor día×hora** (sin % de ocupación).

## Alcance

### Backend

**1. `analytics.service` — todas reciben rango**
- `ingresos(desde, hasta)`: ya implementado (se mantiene).
- `canchasTop(desde, hasta)`: agregar `fechaInicio: { gte, lt }` al `where` del groupBy.
- `horariosPico(desde, hasta)`: agregar `AND "fechaInicio" >= $desde AND "fechaInicio" < $hasta` al $queryRaw (parámetros).
- `ocupacion(desde, hasta)`: ídem rango en el $queryRaw.
- **Nuevo `ingresosPorDia(desde, hasta)`**: total de `monto` por día (TZ Argentina) en el rango → `[{ fecha: 'YYYY-MM-DD', total: number }]`. Vía $queryRaw con `("fechaInicio" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date` agrupado, estado in (CONFIRMADA, COMPLETADA), ordenado por fecha. Devuelve solo los días con ingresos (el frontend completa los días faltantes en 0 si hace falta).

**2. Rutas — leer `?desde&hasta`**
- Helper para parsear `desde`/`hasta` (YYYY-MM-DD) a ventana UTC con `dayWindowUtc(desde).start` y `dayWindowUtc(hasta).end` (TZ negocio). Si faltan, usar un default (ej. últimos 30 días) — pero el frontend siempre los manda.
- Validación Zod: `analyticsRangeSchema` (query `{ desde?: YYYY-MM-DD, hasta?: YYYY-MM-DD }`).
- Todas las rutas `/analytics/*` pasan el rango parseado al service. Nueva `GET /analytics/ingresos-por-dia` → `serializeBigInt` no hace falta (devuelve number/string), pero mantener consistencia.

### Frontend — Dashboard

**Selector de período**
- Vía searchParam `?periodo=hoy|7|30` (default `30`). Componente cliente `PeriodoSelector` (3 botones / chips) que hace `router.push('/dashboard?periodo=...')`. La page es Server Component → recalcula y refetchea.
- La page calcula `desde/hasta`: hoy → `[hoyAR, hoyAR]`; 7 → `[hoyAR-6, hoyAR]`; 30 → `[hoyAR-29, hoyAR]`. Pasa `?desde=&hasta=` a cada fetch de analytics.

**Métricas (cards)**
- **Ingresos del período** (`/analytics/ingresos?desde&hasta` → `total`).
- **Reservas del período** (contar con `/reservas?desde&hasta` → length, o un conteo; reusar `/reservas` con rango ya soportado).
- **Cancha más reservada** (del período) (`/analytics/canchas-top?desde&hasta`).

**Gráficos**
- **Ingresos por día** (`components/dashboard/ingresos-chart.tsx`, recharts BarChart): datos de `/analytics/ingresos-por-dia`; el front arma el eje de días del período (rellena 0 los días sin ingreso) y formatea `$`.
- **Horarios más pedidos** (`HorariosChart` existente, ahora con datos de `/analytics/horarios-pico?desde&hasta`).
- **Ocupación — mapa de calor** (`components/dashboard/ocupacion-heatmap.tsx`): grilla **filas = horas** (de `config.horaApertura`–`horaCierre`) × **columnas = días (Lun…Dom)**; cada celda con intensidad de fondo según `reservas` (0 = claro, máximo = verde fuerte; `opacity`/escala relativa al máximo del set). Datos de `/analytics/ocupacion?desde&hasta` (`[{dia, hora, reservas}]`, `dia` = DOW 0=Domingo..6=Sábado de Postgres). Componente liviano (CSS grid, sin recharts). Leyenda mínima (menos → más). Las horas salen de `config` (fetch `/config`).

**Tipos / actions**
- `lib/types.ts`: tipos chicos para las respuestas (`IngresoDia { fecha:string; total:number }`, `OcupacionCelda { dia:number; hora:number; reservas:number }`, `HorarioPico { hora:number; reservas:number }`).
- Sin server actions (todo es lectura en el Server Component vía `apiFetch`). El `PeriodoSelector` solo navega.

## Datos / flujo
1. `/dashboard?periodo=30` → page calcula `desde/hasta` → `Promise.all` de los `apiFetch` con `?desde&hasta` (envueltos en `safe()`).
2. Render: selector + cards + gráfico ingresos/día + horarios + heatmap ocupación.
3. Cambiar período → `router.push` → re-render server con el nuevo rango.

## Manejo de errores / bordes
- Cada fetch envuelto en `safe(..., fallback)` (patrón actual) → si una métrica falla, el resto se ve igual.
- Período sin datos → cards en `$0`/`0`, gráficos vacíos, heatmap todo claro (sin error).
- Heatmap: si `reservas` máximo = 0, todas las celdas claras (evitar división por cero en la escala).
- `dia` de Postgres es 0=Domingo..6=Sábado; el heatmap ordena Lun→Dom (mapear índices).

## Pruebas
**Backend (TDD, Testcontainers):**
- `ingresos`/`canchasTop`/`horariosPico`/`ocupacion` respetan el rango (una reserva dentro y otra fuera → solo cuenta la de adentro).
- `ingresosPorDia` agrupa por día correctamente (2 reservas mismo día suman; días distintos separan) y respeta el rango.
- Rutas: `GET /analytics/ingresos?desde&hasta` y `/analytics/ingresos-por-dia?desde&hasta` responden 200 con el shape esperado; sin auth → 401; rol RECEPCIONISTA → 403 (ya lo cubre `requireRole('ADMIN')`).

**Frontend:** `pnpm lint` + `pnpm build` obligatorios; sin tests de componente (lógica de escala del heatmap es simple — si se extrae a una función pura, un unit chico opcional). QA manual: cambiar período y ver que cambian las 3 analíticas.

## Despliegue / compat
- Backend: rama `feat/dashboard-analytics` → main + deploy VM (sin migración de DB). Frontend: rama `feat/dashboard-analytics-panel` → master local.
- Aditivo: las rutas pasan a leer query opcional (compat: sin query → default últimos 30 días).

## Fuera de alcance (YAGNI)
- % de ocupación exacto (se usa el heatmap).
- Export a Excel/CSV de las métricas.
- Comparativas período vs período anterior.
- Analíticas para el rol recepcionista (sigue solo-admin).

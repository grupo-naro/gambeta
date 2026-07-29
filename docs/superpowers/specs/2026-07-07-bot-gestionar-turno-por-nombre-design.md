# Bot — Cancelar un turno por nombre (no solo el propio) — Design

**Fecha:** 2026-07-07
**Estado:** Aprobado
**Componentes:** backend `canchitas-backend` (endpoint de búsqueda) + bot n8n `I8yiX4g1rGh5Hb2U` (Prompt + Cerebro). Frontend sin cambios.

## Problema

Hoy el bot solo puede gestionar los turnos **del WhatsApp que escribe** (`/reservas/mias?whatsapp=`). No puede actuar sobre el turno de otra persona. Caso real: alguien escribe "mi cuñado reservó la cancha 2 para mañana a nombre de Julián, está internado, quiero cancelarla". El bot no encuentra el turno porque no está a nombre del que escribe.

## Objetivo y alcance

- **Cancelar** un turno identificándolo por **nombre del titular + día** (+ cancha y/o hora si las dan). "Número" = número de cancha (ya se extrae).
- **Fuera de alcance (para después):** reprogramar / cambiar de cancha el turno de otro por nombre — ahí el mensaje trae dos fechas (la del turno y la nueva) y necesita su propio diseño. Consultar turnos de otro por nombre tampoco entra (requeriría fecha y es marginal).

## Decisión de autorización (riesgo asumido)

El bot cancela cualquier turno que matchee **nombre + cancha + día**, sin verificar que quien escribe sea el titular. Esto permite, en teoría, que alguien cancele un turno ajeno con esos datos. El dueño lo aceptó por comodidad para un complejo de barrio. Queda documentado como riesgo conocido.

## Diseño

### 1. Backend — endpoint de búsqueda
`GET /reservas/buscar` con `authAny` (accesible por el bot vía `x-api-key`).
- Query (`buscarReservaSchema`): `nombre` (requerido, string), `fecha` (requerido, `YYYY-MM-DD`), `cancha` (opcional, string: nombre o número), `hora` (opcional, `HH:MM`).
- Servicio `reservaService.buscar({ nombre, fecha, cancha?, hora? })`:
  - Ventana del día en TZ negocio: `[combineDateTimeUtc(fecha,'00:00',tz), +86400000)`.
  - `prisma.reserva.findMany` where `fechaInicio` en la ventana, `estado in ['CONFIRMADA','ESPERANDO_SENA']`, `include: { cancha, cliente }`.
  - Filtro en JS: `cliente.nombre` normalizado (minúsculas, sin acentos) **incluye** `nombre` normalizado; si vino `cancha`, matchea por nombre/número; si vino `hora`, matchea la hora (derivada de `fechaInicio` en TZ).
  - Devuelve `[{ id, cancha: { nombre }, fecha (YYYY-MM-DD tz), horaInicio (HH:MM tz), estado, clienteNombre }]`.
- Validador nuevo + test de integración.

### 2. Bot — extraer el nombre del titular (Prompt)
- Agregar `nombre` (nullable string) al `responseSchema` de `geminiBody`.
- Instrucción: extraer `nombre` cuando el cliente nombra al titular de un turno ("a nombre de Julián", "la de mi cuñado Julián"). No confundir con el nombre para una reserva nueva.

### 3. Bot — cancelar por nombre (Cerebro, rama `cancelar`)
- Helper nuevo `buscarPorNombre(nombre, fecha, cancha, hora)` (al lado de `resolverTurno`): llama `GET /reservas/buscar` y devuelve la **misma forma** que `resolverTurno` (`{ id, label, fecha, hora, n, lista }`), con `label` incluyendo el nombre para desambiguar (ej: "la Cancha 2 el mañana a las 20:00 (Julián)"). Envuelto en try/catch → si el endpoint falla, devuelve null (no rompe).
- En la rama `cancelar`: `const nb = gem.nombre || ctx.buscarNombre;`
  - Si `nb && !fecha` → pedir el día: "¿Para qué día es el turno de `<nb>`?" y guardar `buscarNombre` en ctx (para resolver en el próximo mensaje).
  - Si `nb && fecha` → `t = await buscarPorNombre(nb, fecha, cancha, hora)`.
  - Si no hay `nb` → `t = await resolverTurno()` (comportamiento actual, por WhatsApp).
  - El resto de la rama no cambia: si `t.n>1` desambigua con el mecanismo existente (`pendiente:'cancelar'`, `turnos`); si uno solo, cancela por `t.id` vía `PATCH /reservas/:id/cancelar`.
- La cancelación sigue sujeta a la regla de anticipación (10 min) del backend.

## Dependencia de deploy
El bot llama al endpoint nuevo, que vive en el backend. Hasta que el backend se deploye (push + recrear), `buscar` responde 404 → `buscarPorNombre` (try/catch) devuelve null → el bot dice "no encuentro". Comportamiento degradado aceptable. Como Evolution está apagado, no hay tráfico real mientras tanto. Idealmente el bot y el backend salen juntos.

## Riesgo
- **Abuso** (cancelar turno ajeno): aceptado, documentado.
- **Falsos positivos de nombre:** "Julián" parcial podría matchear "Julián Pérez" y "Julián Gómez" el mismo día/cancha → se maneja con la desambiguación (`n>1`).

## Testing
- Backend: test de integración de `GET /reservas/buscar` (match por nombre+día; filtra canceladas; opcional cancha/hora; case/acento-insensible).
- Bot: sintaxis del Cerebro/Prompt vía AsyncFunction; smoke test (con Evolution) del caso "cancelá la de Julián, cancha 2, mañana".

## Integración / deploy
- Backend → rama `feat/cancelar-por-nombre` desde `main`, commit local (sin push salvo OK), + su test.
- Bot → aplicado en vivo vía patchNodeField (backup por version history).

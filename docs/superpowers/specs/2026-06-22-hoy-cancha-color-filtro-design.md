# Vista "Hoy": cancha con color + filtro por cancha — Design

**Fecha:** 2026-06-22
**Estado:** Aprobado
**Repo:** frontend (Next 16). Solo frontend; sin cambios de backend.

## Problema

La vista `/hoy` (pantalla principal del mostrador) muestra cada turno con hora, nombre del cliente y la cancha — pero la cancha aparece solo como su nombre crudo ("2"), en gris, poco distinguible. El recepcionista no diferencia rápido a qué cancha va cada turno, y no puede aislar los turnos de una cancha puntual.

## Objetivo (sub-proyecto A)

1. En la card de turno, mostrar **"Cancha 2"** (prefijo + nombre) con el **color de esa cancha** (el mismo sistema que ya usa el Calendario), para distinguir canchas de un vistazo.
2. Aplicar el mismo color de cancha a las filas de **fijo** y **bloqueo** (consistencia).
3. Mantener el **debe/estado de pago** que ya se muestra (chip "Pagado" / "Debe $X" / "Espera seña").
4. Agregar un **filtro por cancha** en la vista Hoy: una fila de chips (Todas + una por cancha) que filtra la lista del día a esa cancha.

Fuera de alcance: la reorganización del menú/secciones (sub-proyecto B, aparte).

## Contexto técnico existente (a reusar)

- `colorDeCancha(canchaId, canchas)` (en `src/lib/calendario.ts`) → `{ bg, text, border, dot }` (clases Tailwind de una PALETA de 10 colores, indexada por orden de `id`). Ya lo usa el Calendario.
- `AgendaHoy` (`src/components/hoy/agenda-hoy.tsx`) ya recibe `agenda` (`{reservas, fijos, bloqueos}`), `canchas: Cancha[]`, `fecha`, `totalCobrado`.
- Cards: `TurnoCard` (reserva), `FijoCard`, `BloqueoCard`. `TurnoCard` hoy muestra `reserva.cancha?.nombre` en gris; `PagoChip` ya muestra el debe/estado con color.

## Diseño

### Helper de etiqueta de cancha
Nuevo helper puro `nombreCancha(nombre: string): string` en `src/lib/calendario.ts` (o `src/lib/cancha.ts`):
- Si el nombre es numérico o tipo "4/1" → `"Cancha " + nombre` (ej. "Cancha 2", "Cancha 4/1").
- Si el nombre ya contiene letras de nombre propio (ej. "TECHADA") → devolverlo tal cual ("TECHADA").
- Regla concreta: si `/^[\d/]+$/.test(nombre.trim())` → `"Cancha " + nombre`; si no → `nombre` tal cual.

### Card de turno (TurnoCard)
- Recibe la lista `canchas` (o el color ya calculado) para poder llamar `colorDeCancha(reserva.canchaId, canchas)`.
- La línea de la cancha pasa de texto gris a un **chip con el color de la cancha**: `<span class="{col.bg} {col.text} ...rounded px-1.5 py-0.5 text-xs font-medium">{nombreCancha(reserva.cancha.nombre)}</span>`.
- Se mantiene la hora, el nombre del cliente y el `PagoChip` (debe) como están.

### Fijo y Bloqueo (FijoCard / BloqueoCard)
- Mismas: la cancha como chip con `colorDeCancha(canchaId, canchas)` + `nombreCancha(...)`. Reciben `canchas` para calcular el color.
- (Bloqueo sigue read-only; fijo sigue cobrable.)

### Filtro por cancha
- Nuevo componente cliente `FiltroCanchas` (o inline en `AgendaHoy`): fila scrollable de chips: **"Todas"** + una por cada cancha de `canchas` (cada chip con un punto `col.dot` y el `nombreCancha`).
- Estado local en `AgendaHoy`: `canchaFiltro: string | null` (null = todas). Al tocar un chip se setea; al tocar "Todas", null.
- La lista renderizada se filtra por `canchaFiltro`: reservas (`r.canchaId`), fijos (`f.canchaId`), bloqueos (`b.canchaId`). Es filtro **client-side** (la página ya trae todos los datos; no recarga).
- El chip activo se resalta (ej. `col.bg`/ring). Orden de los chips: por `id` (igual que la paleta) para que el color coincida con el del calendario.
- El estado vacío ("No hay turnos para este día") aplica también cuando el filtro deja la lista vacía → mensaje "No hay turnos en esa cancha para este día." cuando hay filtro activo.

## Estructura de archivos

- Modify: `src/lib/calendario.ts` — agregar `nombreCancha` (export). (Vive con `colorDeCancha`.)
- Modify: `src/components/hoy/turno-card.tsx` — chip de cancha con color; acepta `canchas`.
- Modify: `src/components/hoy/fijo-card.tsx` — ídem.
- Modify: `src/components/hoy/bloqueo-card.tsx` — ídem.
- Modify: `src/components/hoy/agenda-hoy.tsx` — estado `canchaFiltro`, fila de chips, filtrado de las 3 listas, pasar `canchas` a las cards.
- (La página `(panel)/hoy/page.tsx` ya pasa `canchas`; no cambia.)

## Errores / bordes

- Cancha sin color (canchaId no está en `canchas`): `colorDeCancha` ya cae en el índice 0 (color por defecto); no rompe.
- Reserva/fijo/bloqueo sin `cancha.nombre`: mostrar "Cancha" o "—" (mantener el fallback actual).
- Filtro activo + día sin turnos de esa cancha → estado vacío con mensaje contextual.

## Testing

- Unit (Vitest, sin Docker): `nombreCancha` ("2"→"Cancha 2", "4/1"→"Cancha 4/1", "TECHADA"→"TECHADA", ""→"—"/"Cancha"). Si existe test de `colorDeCancha`, no se toca.
- Verificación: `pnpm build` + `pnpm lint` sin errores. Revisión visual: card muestra "Cancha 2" con color; filtro aísla la cancha; estado vacío con filtro.
- Tailwind: las clases de la PALETA ya están "safelisted" (la PALETA es estática), así que el color por cancha no se purga.

## Integración

- Frontend: rama feature → merge a `master` local (no se pushea, flujo actual). No requiere deploy de backend.

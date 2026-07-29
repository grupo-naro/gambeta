# Calendario: turnos fijos y bloqueos/torneos — Design

**Fecha:** 2026-06-13
**Estado:** Aprobado

## Objetivo

Que el calendario semanal (`/calendario`) muestre, además de las reservas, los **turnos fijos**
y los **bloqueos** (torneos, mantenimiento, entrenamiento, otro), coloreados por **cancha** con la
misma paleta determinística. Las plantillas recurrentes se materializan sobre los días de la semana.

## Decisiones (confirmadas)
- Mostrar **todos los motivos** de bloqueo (TORNEO/ENTRENAMIENTO/MANTENIMIENTO/OTRO), cada uno con su etiqueta.
- Click en fijo/bloqueo → **detalle de solo lectura + link** a `/turnos-fijos` o `/bloqueos`. Las reservas mantienen sus acciones.
- Distinción visual: color = cancha; **fijo/bloqueo con borde punteado + etiqueta de tipo**; reserva con borde sólido.
- **Sin cambios de backend.** Materialización en el front (los endpoints `/turnos-fijos` y `/bloqueos` ya existen).

## Datos
- `GET /turnos-fijos` (authJwt) → `TurnoFijo[]`: `{ id, canchaId, clienteNombre, whatsapp, diaSemana (0-6, 0=domingo), horaInicio, horaFin, precio, activo, cancha?{nombre}, excepciones?[{ id, fecha }] }`.
- `GET /bloqueos` (authJwt) → `Bloqueo[]`: `{ id, canchaId, motivo (TORNEO|ENTRENAMIENTO|MANTENIMIENTO|OTRO), recurrente, diaSemana|null, fecha|null, horaInicio, horaFin, nota|null, cancha?{nombre} }`.
- La página `/calendario` agrega estos dos fetch al `Promise.all` existente (junto a `/reservas?desde&hasta`, `/canchas`, `/config`). Devuelven TODAS las plantillas (no filtradas por semana); el materializador filtra.

## Materialización (helper puro en `src/lib/calendario.ts`)

Convención de día: el weekday de un día `YYYY-MM-DD` se calcula con `new Date(dia+'T12:00:00Z').getUTCDay()` (0=domingo..6=sábado), que coincide con `diaSemana`.

Helper `materializar(dias: string[], fijos: TurnoFijo[], bloqueos: Bloqueo[]): EventoCal[]`:
- Para cada `dia` de `dias` (weekday = getUTCDay):
  - **Fijos:** incluir `f` si `f.activo` && `f.diaSemana === weekday` && **no** existe `f.excepciones?.some(e => e.fecha === dia)`.
  - **Bloqueos:** incluir `b` si (`b.recurrente` && `b.diaSemana === weekday`) **o** (`!b.recurrente` && `b.fecha === dia`).
  - Para cada item incluido, expandir a las horas cubiertas: `for (h = hInicio; h < hFin; h++)` donde `hInicio = Number(horaInicio.slice(0,2))`, `hFin = Number(horaFin.slice(0,2))` → un `EventoCal` por hora.

### Modelo `EventoCal`
```
interface EventoCal {
  key: string;            // único por celda+item (refId+'@'+fecha+'-'+hora)
  tipo: 'reserva' | 'fijo' | 'bloqueo';
  fecha: string;          // YYYY-MM-DD
  horaNum: number;
  canchaId: string;
  titulo: string;         // nombre cancha
  subtitulo: string;      // cliente (reserva/fijo) o motivo+nota (bloqueo)
  estado?: EstadoReserva; // solo reservas
  motivo?: MotivoBloqueo; // solo bloqueos
  refId: string;          // id de la reserva/fijo/bloqueo
}
```
Las **reservas** (ya filtradas CANCELADA) se convierten a `EventoCal` (tipo 'reserva', `horaNum` vía `ubicarEnTz`, 1 hora). Fijos/bloqueos vía el materializador. Todo se indexa por `(fecha, horaNum)` en un `Map`.

Etiqueta de motivo (corta): TORNEO→"Torneo", ENTRENAMIENTO→"Entren.", MANTENIMIENTO→"Mantenim.", OTRO→"Otro".

## Render (en `CalendarioSemana`)
- La celda `(dia, hora)` lista todos sus `EventoCal` lado a lado (como hoy).
- Color por cancha: `colorDeCancha(ev.canchaId, canchas)` (PALETA existente).
- **reserva:** borde sólido; ESPERANDO_SENA → opacidad + "(seña)".
- **fijo:** `border-dashed` + etiqueta chica "Fijo" arriba + cliente.
- **bloqueo:** `border-dashed` + etiqueta del motivo + (nota si hay).
- Leyenda existente (cancha→color) + una nota: "— borde punteado = fijo/torneo".

## Interacción
- Click en `EventoCal`:
  - `tipo==='reserva'` → dialog de detalle con acciones (cancelar/aprobar/rechazar/reprogramar), como hoy. (Se resuelve la reserva por `refId` desde la lista de reservas.)
  - `tipo==='fijo'` → dialog solo lectura: cancha, cliente, día/horario; link `Editar en Turnos fijos` → `/turnos-fijos`.
  - `tipo==='bloqueo'` → dialog solo lectura: cancha, motivo, día/horario, nota; link `Editar en Bloqueos` → `/bloqueos`.

## Testing
- **Unit del materializador** (`calendario.test.ts`): fijo aparece en su weekday y se expande a las horas cubiertas (ej. 18–20 → horas 18 y 19); una excepción en esa fecha lo excluye; fijo `activo:false` se excluye; bloqueo puntual aparece solo en su `fecha`; bloqueo recurrente aparece por `diaSemana`; cantidad de `EventoCal` por item = (hFin-hInicio).
- tsc/lint/`pnpm build` (obligatorio por boundary RSC).
- Manual: ver fijos y un torneo en el calendario, colores por cancha, borde punteado + etiqueta, click read-only con link.

## Fuera de alcance
- Editar fijos/bloqueos desde el calendario.
- Bloques que cruzan medianoche (los horarios del complejo no cruzan medianoche).
- Cambios de backend / endpoint de agenda materializada (se hace en el front).

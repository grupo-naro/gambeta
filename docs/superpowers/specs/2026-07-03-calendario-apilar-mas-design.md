# Calendario: apilar reservas por fila + "+N más" — Design

**Fecha:** 2026-07-03
**Estado:** Aprobado
**Alcance:** solo frontend (`calendario-semana.tsx` + `lib/calendario.ts`). Sin backend. Se deja commiteado SIN pushear (como el resto acumulado).

## Problema

En la grilla semanal de escritorio, cada celda (día × hora) renderiza las reservas en un `flex flex-wrap` con tarjetas `flex-1 truncate`. Cuando hay muchas canchas reservadas a la misma hora, las tarjetas se parten en columnas angostas y quedan ilegibles ("2 C", "1. j"…): no se distingue qué cancha ni qué cliente.

## Diseño

### Tarjeta de evento (`EventoBtn`) — una sola línea
Pasa de 2 líneas (cancha / cliente) a **una línea compacta** a lo ancho: `Cancha · Cliente` (con el tag "Fijo"/motivo de bloqueo como prefijo cuando corresponde), truncada, manteniendo:
- color de la cancha (`col.bg/text/border`) para reservas; estilos `ESTILO_TIPO.fijo.cal` (lima) / `ESTILO_TIPO.bloqueo.cal` (naranja) para fijos/bloqueos;
- borde punteado para no-reservas; `opacity-60` + " (seña)" si está en `ESPERANDO_SENA`;
- `title` con el texto completo (tooltip al pasar el mouse).

`className` cambia `flex-1` por `w-full` (ocupa la fila completa) y baja el padding vertical a `py-0.5`. Se usa igual en escritorio, mobile y en la hoja de "+N más".

```tsx
function EventoBtn({ ev, canchas, onEvento }: { ev: EventoCal; canchas: Cancha[]; onEvento: (ev: EventoCal) => void }) {
  const col = colorDeCancha(ev.canchaId, canchas);
  const esReserva = ev.tipo === 'reserva';
  const esperando = ev.estado === 'ESPERANDO_SENA';
  const tag = ev.tipo === 'fijo' ? 'Fijo' : ev.tipo === 'bloqueo' ? etiquetaMotivo(ev.motivo!) : '';
  const clasesColor =
    ev.tipo === 'fijo' ? ESTILO_TIPO.fijo.cal
    : ev.tipo === 'bloqueo' ? ESTILO_TIPO.bloqueo.cal
    : `${col.bg} ${col.text} ${col.border}`;
  const cuerpo = `${ev.titulo}${ev.subtitulo ? ' · ' + ev.subtitulo : ''}`;
  return (
    <button
      onClick={() => onEvento(ev)}
      className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[12px] leading-tight ${clasesColor} ${esReserva ? '' : 'border-dashed'} ${esperando ? 'opacity-60' : ''}`}
      title={`${cuerpo}${tag ? ' · ' + tag : ''}${esperando ? ' (seña)' : ''}`}
    >
      {tag && <span className="font-semibold uppercase tracking-wide opacity-70">{tag}: </span>}
      {cuerpo}{esperando ? ' (seña)' : ''}
    </button>
  );
}
```

### Helper puro (`lib/calendario.ts`)
```ts
/** Parte los eventos de una celda en visibles + ocultos, dejando lugar al botón "+N más". */
export function dividirCelda<T>(eventos: T[], max: number): { visibles: T[]; ocultos: T[] } {
  if (eventos.length <= max) return { visibles: eventos, ocultos: [] };
  return { visibles: eventos.slice(0, max - 1), ocultos: eventos.slice(max - 1) };
}
```
Con `max = 3`: hasta 3 eventos → se muestran todos; 4+ → se muestran 2 y el resto va a "+N más". La celda nunca supera 3 filas.

### Celda de escritorio (`FilaHora`)
- El contenedor interno pasa de `flex flex-wrap gap-1` a **`flex flex-col gap-0.5`** (apila una por fila).
- Usa `dividirCelda(evs, 3)`: renderiza `visibles` con `EventoBtn`; si `ocultos.length > 0`, agrega un botón chico:
  ```tsx
  {ocultos.length > 0 && (
    <button onClick={() => onMas(d, h, evs)} className="rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-neutral-500 hover:bg-neutral-100">
      + {ocultos.length} más
    </button>
  )}
  ```
- `FilaHora` recibe una prop nueva `onMas: (fecha: string, hora: number, eventos: EventoCal[]) => void`.

### Celda de mobile (vista de día)
- El contenedor de eventos pasa de `flex flex-1 flex-wrap gap-1` a **`flex flex-1 flex-col gap-1`** (apila a lo ancho). **Muestra todas** (sin cap): en mobile el espacio horizontal no es el problema y la página scrollea.

### Hoja "+N más" (todas las reservas de esa hora/día)
- Estado nuevo en `CalendarioSemana`: `const [selCelda, setSelCelda] = useState<{ fecha: string; hora: number; eventos: EventoCal[] } | null>(null);`
- `const onMas = (fecha, hora, eventos) => setSelCelda({ fecha, hora, eventos });`
- Un `Sheet` (mismo patrón que los otros) que lista TODAS con `EventoBtn`; al tocar una, cierra la hoja de celda y abre la hoja de acción/info de siempre:
  ```tsx
  <Sheet open={!!selCelda} onOpenChange={(o) => { if (!o) setSelCelda(null); }}>
    {selCelda && (
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{tituloCelda(selCelda.fecha, selCelda.hora, dias)}</SheetTitle>
          <p className="text-sm text-neutral-600">{selCelda.eventos.length} reservas</p>
        </SheetHeader>
        <div className="flex flex-col gap-1">
          {selCelda.eventos.map((ev) => (
            <EventoBtn key={ev.key} ev={ev} canchas={canchas} onEvento={(e) => { setSelCelda(null); onEvento(e); }} />
          ))}
        </div>
      </SheetContent>
    )}
  </Sheet>
  ```
  donde `tituloCelda(fecha, hora, dias)` arma el label (ej. "Vie 5 · 21:00") reusando `DIAS_LBL` y el índice de `dias.indexOf(fecha)`; si no está en `dias`, cae al `fecha` crudo. Definir el helper dentro del archivo (chico) o inline.
- `FilaHora` se invoca con `onMas={onMas}`.

## Testing
- `lib/calendario.test.ts` (nuevo, vitest): `dividirCelda`:
  - `[a,b,c]`, max 3 → `{ visibles: [a,b,c], ocultos: [] }`.
  - `[a,b,c,d]`, max 3 → `{ visibles: [a,b], ocultos: [c,d] }`.
  - `[]`, max 3 → `{ visibles: [], ocultos: [] }`.
- Verificación general: `pnpm exec tsc --noEmit && pnpm build`.

## Fuera de alcance
- Cambiar el tope 3 por configuración (queda fijo en 3).
- Backend / datos (el calendario ya recibe todo lo que necesita).
- Rediseñar la leyenda o la navegación de semana.

## Integración
Frontend → `master`. **Commitear SIN pushear** (se apila sobre lo acumulado sin pushear). Un repo.

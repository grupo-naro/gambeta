# Diferenciar fijos y bloqueos por color (lima / naranja) — Design

**Fecha:** 2026-06-30
**Estado:** Aprobado
**Componente:** frontend (Vista Hoy + Calendario). Solo presentación.

## Problema

En el panel, los **turnos fijos** y **bloqueos** se distinguen poco de las reservas (fijo = acento celeste sutil; bloqueo = borde punteado gris). El usuario quiere que **salten** con color: **fijo = lima brillante**, **bloqueo = naranja fuerte**.

## Enfoque

Tratamiento por **tipo** que domina la tarjeta/bloque (barra de color gruesa + fondo tenido + acento), manteniendo el chip de color-de-cancha como dato secundario. Las **reservas quedan como están** (tarjeta blanca + chip de cancha), así fijos (lima) y bloqueos (naranja) resaltan al lado. Intensidad: color fuerte pero legible (barra brillante + fondo tenue, no fondo neón lleno).

Colores (Tailwind, clases estáticas literales):
- **Fijo → lima:** barra `border-l-4 border-lime-500`, fondo `bg-lime-50`, ícono `text-lime-600`, badge `bg-lime-200 text-lime-900`.
- **Bloqueo → naranja:** barra `border-l-4 border-orange-500`, fondo `bg-orange-50`, ícono/texto `text-orange-700`.

## Diseño técnico

### Helper compartido — `src/lib/calendario.ts`
Agregar estilos por tipo (clases literales, reusados por Hoy y Calendario):
```ts
export const ESTILO_TIPO = {
  fijo:    { card: 'border-l-4 border-lime-500 bg-lime-50',   icono: 'text-lime-600',   badge: 'bg-lime-200 text-lime-900',
             cal: 'bg-lime-100 text-lime-900 border-lime-400' },
  bloqueo: { card: 'border-l-4 border-orange-500 bg-orange-50', icono: 'text-orange-700', texto: 'text-orange-800',
             cal: 'bg-orange-100 text-orange-900 border-orange-400' },
} as const;
```

### Vista Hoy
- `src/components/hoy/fijo-card.tsx`: la tarjeta usa `ESTILO_TIPO.fijo.card` (barra lima + fondo) en vez de `border bg-white`; el ícono `CalendarClock` pasa a `ESTILO_TIPO.fijo.icono`; el badge "Fijo · $…" usa `ESTILO_TIPO.fijo.badge`. Se mantiene el chip de color de cancha.
- `src/components/hoy/bloqueo-card.tsx`: la tarjeta usa `ESTILO_TIPO.bloqueo.card` (barra naranja + fondo) en vez de `border border-dashed bg-neutral-50`; ícono `Ban` a `ESTILO_TIPO.bloqueo.icono`; el texto del motivo a `ESTILO_TIPO.bloqueo.texto`. Se mantiene el chip de cancha.
- Las reservas (`turno-card.tsx`) **no se tocan**.

### Calendario
- `src/components/calendario/calendario-semana.tsx` (`EventoBtn`): para `ev.tipo === 'fijo'` usar `ESTILO_TIPO.fijo.cal` y para `'bloqueo'` `ESTILO_TIPO.bloqueo.cal`, en lugar del `colorDeCancha` (bg/text/border). Las **reservas siguen con `colorDeCancha`**. Se mantiene la etiqueta ("Fijo"/motivo) y el `border-dashed` para no-reservas.

## Testing / verificación
- `pnpm lint` + `pnpm build`.
- **Revisión visual (principal):** Vista Hoy con un fijo + un bloqueo + una reserva → confirmar que fijo salta en lima, bloqueo en naranja, reserva blanca; texto legible. Calendario: bloques de fijo lima y bloqueo naranja, reservas por color de cancha.

## Fuera de alcance
- No se diferencia por motivo del bloqueo (torneo/entrenamiento/mantenimiento) — todos naranja; el motivo se lee en la etiqueta.
- Reservas: sin cambios.
- La hoja espejo de Google Sheets (que ya colorea por tipo aparte) no se toca.

## Integración
Frontend → rama feature → merge a `master` + push → Vercel (`admin.canchitaortigoza.com.ar`).

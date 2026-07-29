# Buscador por nombre en Vista Hoy — Design

**Fecha:** 2026-06-30
**Estado:** Aprobado
**Componente:** frontend (`components/hoy/agenda-hoy.tsx`). Solo presentación / filtro client-side.

## Problema

En la Vista Hoy, para encontrar una reserva puntual (día con muchos turnos) hay que buscar a ojo. Se quiere un **buscador por nombre del cliente** que filtre la agenda del día en vivo.

## Comportamiento

- Un **input de búsqueda** (ícono lupa + botón "×" para limpiar) **arriba de los chips de cancha**, ancho completo. Placeholder: `Buscar por nombre…`.
- Estado local `q`; filtra **client-side** mientras se tipea, **sin acentos ni mayúsculas**.
- Matchea el **nombre del cliente** en **reservas** (`cliente.nombre`) y **turnos fijos** (`clienteNombre`), por substring.
- Se **combina con el filtro de cancha** existente (ambos deben cumplirse).
- **Bloqueos:** al no tener nombre de cliente, **se ocultan cuando hay texto** en el buscador (opción A). Con el buscador vacío, aparecen normal (sujetos al filtro de cancha).
- **Estado vacío:** si no hay resultados y hay búsqueda activa → "No se encontró ninguna reserva para «…»". Si es por el filtro de cancha (sin búsqueda), el mensaje actual se mantiene.

## Diseño técnico (todo en `agenda-hoy.tsx`)

- Nuevo estado: `const [q, setQ] = useState('')`.
- Helper local de normalización:
  ```ts
  const norm = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  ```
- `const buscando = q.trim() !== '';`
- `const matchNombre = (nombre?: string | null) => !buscando || norm(nombre ?? '').includes(norm(q));`
- Filtros (extienden los actuales, que ya usan `coincide(canchaId)`):
  - `reservas`: `... && coincide(r.canchaId) && matchNombre(r.cliente?.nombre)`
  - `fijos`: `... && coincide(f.canchaId) && matchNombre(f.clienteNombre)`
  - `bloqueos`: `... && coincide(b.canchaId) && !buscando`  (ocultos al buscar)
- UI: input controlado (`value={q}`) con ícono `Search` (lucide) a la izquierda y, si `buscando`, un botón "×" que hace `setQ('')`. Estilo consistente con los inputs del panel (borde redondeado, misma altura que los chips). Se coloca en un contenedor propio **antes** del `div` de los chips de cancha.
- Empty state: el `vacio` ya existe; ajustar el texto para contemplar `buscando` (mensaje "No se encontró ninguna reserva para «{q}»").

## Testing / verificación
- `pnpm lint` + `pnpm build`.
- **Revisión visual:** en un día con turnos, tipear un nombre → quedan solo los que matchean (reservas/fijos), los bloqueos se ocultan; limpiar (×) → vuelve todo; combinar con un chip de cancha → aplican los dos; buscar algo inexistente → mensaje de "sin resultados".

## Fuera de alcance
- Búsqueda por cancha/motivo (se descartó; solo nombre).
- Buscador en otras pantallas (Reservas ya tiene su tabla/filtros; esto es solo Hoy).
- Backend / datos: sin cambios (filtro puramente client-side sobre la agenda ya cargada).

## Integración
Frontend → rama feature → merge a `master` + push → Vercel.

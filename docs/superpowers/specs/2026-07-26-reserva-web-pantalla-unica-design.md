# Reserva online — pantalla única (rediseño web) — Diseño

**Fecha:** 2026-07-26
**Objetivo:** Rediseñar la web de reservas (`reservas/`) para que todo se vea en **una sola
pantalla** (según referencia del cliente): a la izquierda el texto instructivo, los botones de
deporte y un calendario mensual; a la derecha la grilla de disponibilidad. Reemplaza el wizard de
pasos actual. Tema oscuro. **Sin cambios de backend.**

## Decisiones tomadas

- **Turnos de 1 hora** (sin cambio de granularidad; la grilla muestra filas por hora, como hoy).
- **Celdas:** solo **Libre / Ocupado** (verde tocable / gris). Sin distinguir Fijo/Eventual.
- **Deportes:** Fútbol y Pádel (sin Tenis por ahora).
- **Layout:** una sola pantalla — controles a la izquierda, grilla a la derecha (tema oscuro).
- **Fecha:** calendario mensual propio (sin librerías nuevas).
- **Formulario:** modal sobre la misma pantalla al tocar una celda libre.
- **Backend:** sin cambios; usa `GET /disponibilidad/grilla` y `POST /reservas` que ya existen.

## Comportamiento

- Deporte y fecha están siempre visibles. **Al cambiar deporte o fecha, la grilla se recarga
  automáticamente** (llamando `getGrilla(deporte, fecha)`), sin pasos intermedios.
- Estado inicial: deporte = `futbol`, fecha = hoy (Argentina) → carga la grilla al entrar.
- La grilla: filas = `horas`, columnas = `canchas` (nombres reales); celda **libre** = botón verde
  tocable, **ocupada** = gris/no interactiva. Título tipo "PÁDEL · SÁBADO 25 DE JULIO"
  (deporte + fecha larga en español).
- Al tocar una celda libre → **modal** con resumen (cancha, fecha, hora) + inputs **nombre** y
  **teléfono** → Confirmar → `crearReserva` → cierra el modal, muestra confirmación breve
  (con la seña) y **recarga la grilla** (para reflejar la celda ahora ocupada).
- Errores: si `getGrilla` falla, se muestra el mensaje en el área de la grilla; si `crearReserva`
  falla (p. ej. horario recién tomado), se muestra en el modal y se recarga la grilla.

## Estructura de archivos (`reservas/`)

- Crear `src/components/calendario.tsx`: calendario mensual propio (mes actual navegable con
  ‹/›, semana Lu–Do, día seleccionado resaltado, días pasados deshabilitados). Props:
  `{ value: string /* YYYY-MM-DD */, onChange: (fecha: string) => void }`. Función pura interna
  para armar la matriz del mes (semanas × días).
- Reescribir `src/components/wizard-reserva.tsx` → renombrar a `src/components/pantalla-reserva.tsx`
  (o mantener el nombre; el import en la page se ajusta): pasa de wizard de pasos a la vista única
  (columna izquierda con instrucciones + botones de deporte + `Calendario`; columna derecha con la
  grilla; modal de formulario). Reusa `getGrilla`/`crearReserva` de `src/lib/actions.ts`.
- `src/app/reservar/page.tsx`: renderiza la pantalla única (sin `max-w-3xl`; usa el ancho para las
  dos columnas). Ajustar el import al componente.
- `src/app/globals.css` / layout: tema oscuro (fondo casi negro, acentos verde lima), coherente con
  la referencia. Evitar romper el modo claro/oscuro del sistema si aplica (la página fija el tema
  oscuro propio del sitio de reservas).
- Íconos de deporte: SVG inline simples (o emojis) para Fútbol y Pádel; no agregar dependencias.

## Layout responsive

- **Desktop:** dos columnas (izquierda ~grid de controles, derecha la grilla). La grilla puede
  tener su propio scroll vertical si hay muchas horas.
- **Mobile:** se apila — controles arriba, grilla abajo dentro de un contenedor con
  `overflow-x-auto` (columnas de canchas no deben romper el ancho de la página).

## Testing

- La app `reservas/` no tiene runner de tests (igual que en sub-proyecto A): verificación por
  `pnpm build` (typecheck) + revisión visual contra la referencia.
- La función pura que arma la matriz del mes en `calendario.tsx` se mantiene simple y determinista
  (se puede testear a mano; no se agrega runner en este alcance).

## Criterios de éxito

1. Todo (deporte + calendario + grilla) se ve en una sola pantalla, tema oscuro, como la referencia.
2. Cambiar deporte o día recarga la grilla automáticamente.
3. Tocar una celda libre abre el modal; al confirmar, crea la reserva y la grilla se actualiza.
4. En mobile no se rompe el ancho (grilla con scroll horizontal).
5. Sin cambios de backend; sigue usando `/disponibilidad/grilla` y `/reservas`.

## Fuera de alcance (YAGNI)

- Reservas de 30 minutos (queda en 1 hora).
- Estados Fijo/Eventual por celda.
- Tenis (se suma cuando haya canchas de ese tipo).
- Mercado Pago (sub-proyecto B, separado).
- Runner de tests en la app `reservas/`.

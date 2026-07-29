# Reservar por tamaño de cancha — Design

**Fecha:** 2026-06-12
**Estado:** Aprobado

## Objetivo

Que el cliente reserve eligiendo el **tamaño** de cancha (fútbol 5/7/9/11) en lugar
de la cancha puntual. El bot ofrece tamaños; elegidos tamaño+fecha+hora, **muestra las
canchas de ese tamaño que están libres** y el cliente elige una. El admin carga el
tamaño de cada cancha desde el panel.

## Decisiones (confirmadas)
- Tamaños: **5, 7, 9, 11**.
- Flujo: el bot **muestra** las canchas libres de ese tamaño (no auto-asigna).
- Tamaño por cancha lo setea el admin (la divisible: entera y partes cada una con su tamaño).
- Modelo: campo **`jugadores` Int** en `Cancha`. Default **5** para las existentes.
- Las canchas libres se muestran por su **`nombre`**.

## Backend

### Modelo
`Cancha` suma `jugadores Int @default(5)`. El `tipo` string actual queda (etiqueta libre,
sin uso funcional nuevo). Validación: `jugadores ∈ {5,7,9,11}` en los endpoints de creación/edición.

### Disponibilidad por tamaño
Nuevo `GET /disponibilidad/por-tamano?jugadores=N&fecha=YYYY-MM-DD` (authAny):
- Toma todas las canchas **activas** con `jugadores=N`.
- Para cada una calcula sus slots libres reusando la lógica de `disponibilidadService.listar`
  (que ya respeta sectores, fijos y bloqueos y usa el horario global).
- **Agrupa por hora**: devuelve `{ jugadores, fecha, slots: [{ horaInicio, horaFin, canchas: [{ id, nombre }] }] }`,
  donde `canchas` son las libres a esa hora. Sólo se incluyen horas con ≥1 cancha libre.

### Creación / edición de cancha
- `POST /canchas` y `POST /canchas/divisible` y `PATCH /canchas/:id` aceptan `jugadores`
  (5/7/9/11). En la divisible: `jugadoresEntera` y `jugadoresParte` (entera y partes pueden diferir).
- Reservar sigue igual (`POST /reservas` con el `canchaId` elegido).

## Bot (n8n)
- **Prompt/clasificador:** el `responseSchema` agrega `jugadores` (int, nullable). El sys ofrece
  "canchas de 5, 7, 9 y 11" en vez de la lista de canchas; Gemini extrae el tamaño de "cancha de 5",
  "fútbol 9", "para 11", etc. (mapea "5/cinco" → 5, etc.).
- **Cerebro, rama reservar/consultar (reescrita para keyear por tamaño):**
  1. Sin `jugadores` (ni en ctx) → "¿De cuántos jugadores? Tenemos canchas de 5, 7, 9 y 11."
  2. Con `jugadores`, sin `fecha` → "¿Para qué día?" (guarda jugadores en ctx).
  3. Con `jugadores`+`fecha` → `GET /disponibilidad/por-tamano` → si no hay nada, avisa; si hay,
     muestra las horas con cancha libre.
  4. + `hora` → de la respuesta, las canchas libres a esa hora → si hay 1, propone confirmar esa;
     si hay varias, las lista para que el cliente elija (por nombre); guarda en ctx `{jugadores, fecha, hora, canchaId, cancha}` al confirmar el cliente una.
  5. `confirmar` (SI / elige una) → `POST /reservas` con el `canchaId` resuelto (igual que hoy: contacto→sin seña, etc.).
- El contexto Redis pasa a guardar `jugadores` (+ `canchaId`/`cancha` cuando ya se eligió una concreta).
- `consultar_precio`: puede responder por tamaño (precio de las canchas de ese tamaño) o por nombre; se adapta.
- Resto del bot (audios, mis_reservas, cancelar, reprogramar, fijos/bloqueos vía disponibilidad) sin cambios.

## Frontend (panel)
- Crear/editar cancha: selector **tamaño (5/7/9/11)** (en simple y en divisible: tamaño de la entera + tamaño de las partes).
- Tabla de canchas: columna **tamaño** ("Fútbol 5", etc.).
- `Cancha` (tipo en `lib/types`) suma `jugadores: number`; schemas (`canchaSchema`, `canchaDivisibleSchema`) suman `jugadores`.

## Migración / datos
- Migración agrega `jugadores Int @default(5)`. Las canchas existentes quedan en 5 hasta que el admin
  las edite. (Se documenta para que el dueño cargue los tamaños reales tras el deploy.)

## Testing
- **Backend:** `GET /disponibilidad/por-tamano` agrupa correctamente (varias canchas del mismo tamaño;
  una ocupada y otra libre → la hora aparece con la libre; ninguna libre → no aparece; respeta sectores/fijos/bloqueos);
  validación `jugadores ∈ {5,7,9,11}` en crear/editar.
- **Frontend:** unit de los schemas con `jugadores`; resto tsc/lint/build.
- **Bot:** probado por WhatsApp (pedir "cancha de 5", ver horarios, elegir una).

## Fuera de alcance
- Auto-asignar sin mostrar.
- Reserva por nombre de cancha puntual desde el bot (el panel sí reserva por cancha).
- Filtros de tamaño en otras pantallas (reservas/dashboard).

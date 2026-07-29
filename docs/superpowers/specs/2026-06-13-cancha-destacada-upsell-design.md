# Cancha destacada — auto-asignación + upsell

**Fecha:** 2026-06-13
**Estado:** Aprobado

## Objetivo

Dentro de un tamaño, las canchas comunes son intercambiables: el bot **auto-asigna una sola**
sin hacer elegir al cliente. Las canchas **destacadas** (ej. Techada, mismo tamaño pero con techo
y distinto precio) se ofrecen como **upgrade** con su precio. El admin marca qué cancha es destacada
desde el panel.

## Decisiones (confirmadas)
- Marcar premium con un **campo `destacada` Boolean** en `Cancha` (+ toggle en el panel). No por nombre, no reusando `tipo`.
- Ofrecer la destacada **siempre que haya ≥1 destacada libre** a esa hora (upsell proactivo). Si el cliente la rechaza → común auto-asignada. Si solo quedan destacadas → ofrecerla igual. Si no hay destacadas → común sin preguntar.
- Auto-asignar entre comunes **evitando consumir la entera divisible**: suelta (sin grupo) → parte → entera.

## Backend (campo nuevo → workflow Superpowers)

### Modelo
`Cancha` suma `destacada Boolean @default(false)`. Migración.

### Validación / service
- `createCanchaSchema` y `updateCanchaSchema` aceptan `destacada` (boolean, opcional; default false en create).
- `crearDivisibleSchema` **no** toma `destacada`: la divisible nace con todas sus unidades en `false`; para marcar una como destacada se edita después (PATCH).
- `cancha.service.create` y `update` persisten `destacada`. `GET /canchas` ya devuelve el campo (escalar de Prisma).

### Endpoint
`GET /disponibilidad/por-tamano` **NO cambia** (sigue devolviendo `canchas:[{id,nombre}]` por slot). El bot ya hace `GET /canchas?activa=true` al entrar a la rama reservar, así que tiene `destacada`, `precioHora`, `esEntera`, `grupoId` de cada cancha y enriquece la lista de libres por `id`.

### Tests
- `POST /canchas` con `destacada:true` lo persiste y `GET /canchas` lo devuelve.
- `PATCH /canchas/:id` con `destacada:true` lo actualiza.
- Default `false` cuando se omite.

## Frontend (mismo plan)
- `Cancha` (tipo) suma `destacada: boolean`.
- `canchaSchema` suma `destacada` (boolean, default false). El dialog (form simple) suma un toggle/checkbox "Cancha destacada (se ofrece como upgrade)". Al editar pre-carga el valor actual.
- `canchas-actions` `CanchaInput` suma `destacada: boolean`.
- La tabla muestra un badge "Destacada" en las canchas con `destacada=true`.
- Unit test del schema con `destacada`.

## Bot (n8n directo, después del deploy del backend)

Se reescribe el paso "elegiste hora → canchas libres" del Cerebro (rama reservar/consultar_disponibilidad).
La rama ya tiene `const canchas = GET /canchas?activa=true`; se arma `byId = Map(id→cancha)` para enriquecer.

Con `libres = sl.canchas` (las libres a esa hora, del endpoint por-tamaño), enriquecidas vía `byId`:
- `destacadas = libres.filter(c => byId[c.id]?.destacada)`
- `comunes = libres.filter(c => !byId[c.id]?.destacada)`
- **Mejor común** (`pickComun`): ordenar comunes por preferencia — suelta (`!grupoId`) → parte (`grupoId && !esEntera`) → entera (`esEntera`); tomar la primera.

Ramas de respuesta:
1. **Hay comunes y hay destacada(s):** ofrecer upgrade nombrando la(s) destacada(s) con su `precioHora`
   ("…te puedo dar una cancha, y además tenemos la <Destacada> (con techo, $X). ¿Querés la <Destacada> o una común?").
   Guardar en ctx `{jugadores, fecha, hora, comunId, comunNombre, opciones:[{destacada...}, {id:comunId, nombre:'comun'}]}`.
   - Cliente nombra la destacada → `canchaId = destacada.id`.
   - Cliente dice común/normal/no/"la otra" (matchea la opción sintética `comun`) o solo "si/dale" → `canchaId = comunId`.
2. **Solo destacada(s) libre(s):** ofrecerla con precio ("a esa hora me queda la <Destacada> (con techo, $X). ¿Te la reservo?").
   Guardar `{…, canchaId: destacada.id, cancha: destacadaNombre, opciones:[destacada]}`. "si/dale" → confirmar esa.
3. **Solo comunes:** proponer directo la común auto-asignada ("Te confirmo <comunNombre> el <fecha> a las <hora>? SI"), sin listar.
   Guardar `{…, canchaId: comunId, cancha: comunNombre}`.

El cierre (`confirmar` → `POST /reservas`) **no cambia**; solo cambia qué `canchaId`/`cancha` se guarda en ctx.
La detección del "común vs destacada" reusa el `matchC` existente contra `ctx.opciones` (se agrega una opción sintética `{id:comunId, nombre:'comun'}` para que "una común" matchee).

## Fuera de alcance
- Ranking de comunes por precio (las comunes de un tamaño se asumen equivalentes).
- 2+ destacadas simultáneas a la misma hora: se degrada listándolas por nombre (no es el caso típico).
- Cambiar el endpoint `/disponibilidad/por-tamano`.

## Testing
- **Backend:** validación + persistencia de `destacada` (crear/editar/default).
- **Frontend:** unit del schema; tsc/lint/build.
- **Bot:** probado por WhatsApp (con una cancha marcada destacada: pedir tamaño→fecha→hora → ver el ofrecimiento de la destacada; aceptar y rechazar).

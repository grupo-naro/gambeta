# Turnos fijos + Bloqueos — Design

**Fecha:** 2026-06-12
**Estado:** Aprobado

## Objetivo

Que el dueño cargue desde el panel **turnos fijos** (habitués recurrentes) y
**bloqueos** (torneo/entrenamiento/mantenimiento), y que esos horarios **dejen de
ofrecerse** (bot y disponibilidad) y **no se puedan reservar**. Gestión 100% panel;
el bot solo los respeta vía `/disponibilidad` (sin cambios en el bot).

## Enfoque (Opción B — plantillas, sin materializar)
Fijos y bloqueos son **plantillas** que la disponibilidad resta al vuelo y que la
creación de reservas valida. El anti-overlap **alquiler↔alquiler** sigue garantizado
por la base (constraint en `ReservaSector`); fijos/bloqueos se chequean a nivel app
(complejo single-admin, riesgo de carrera mínimo). Todo respeta **sectores** (un fijo
en "Cancha 4 entera" afecta las partes y viceversa).

## Decisiones (confirmadas)
- Fijo: `clienteNombre` (texto) + `whatsapp?` + precio; recurrente semanal; indefinido
  (baja = `activo=false`/borrar); con **excepciones** (liberar una fecha puntual).
- Bloqueos: **puntuales y recurrentes**; motivo TORNEO/ENTRENAMIENTO/MANTENIMIENTO/OTRO.
- Dos pantallas separadas: **Turnos fijos** y **Bloqueos**.

## Modelo (Prisma/PostgreSQL)
```prisma
model TurnoFijo {
  id            String   @id @default(cuid())
  canchaId      String
  cancha        Cancha   @relation(fields: [canchaId], references: [id])
  clienteNombre String
  whatsapp      String?
  diaSemana     Int      // 0=domingo .. 6=sábado
  horaInicio    String   // "HH:MM"
  horaFin       String   // "HH:MM"
  precio        Decimal  @db.Decimal(10, 2)
  activo        Boolean  @default(true)
  creadoEn      DateTime @default(now())
  excepciones   TurnoFijoExcepcion[]
  @@index([canchaId, diaSemana])
}

model TurnoFijoExcepcion {
  id          String    @id @default(cuid())
  turnoFijoId String
  turnoFijo   TurnoFijo @relation(fields: [turnoFijoId], references: [id], onDelete: Cascade)
  fecha       DateTime  @db.Date
  @@unique([turnoFijoId, fecha])
}

enum MotivoBloqueo { TORNEO ENTRENAMIENTO MANTENIMIENTO OTRO }

model Bloqueo {
  id         String        @id @default(cuid())
  canchaId   String
  cancha     Cancha        @relation(fields: [canchaId], references: [id])
  motivo     MotivoBloqueo
  recurrente Boolean       @default(false)
  diaSemana  Int?          // si recurrente
  fecha      DateTime?     @db.Date // si puntual
  horaInicio String        // "HH:MM"
  horaFin    String        // "HH:MM"
  nota       String?
  activo     Boolean       @default(true)
  creadoEn   DateTime      @default(now())
  @@index([canchaId])
}
```
(`Cancha` suma las relaciones inversas `turnosFijos TurnoFijo[]` y `bloqueos Bloqueo[]`.)

## Lógica compartida: "ocupación por plantillas"
Helper `ocupacionService` (o dentro de disponibilidad) con:
- `canchasQueCompartenSector(canchaId)` → set de canchaIds que comparten algún sector
  (vía `CanchaSector`). Para canchas simples = ella misma; para una parte de la 4 incluye
  la entera y al revés.
- Dado `(canchaId, fecha)` o `(canchaId, inicio, fin)`, devolver los rangos `[horaInicio,horaFin)`
  ocupados por **fijos** (activos, de canchas relacionadas, `diaSemana` = día de la fecha, sin
  excepción para esa fecha) y por **bloqueos** (activos, de canchas relacionadas; recurrente con
  `diaSemana` = día, o puntual con `fecha` = fecha).

## Disponibilidad
`disponibilidad.service.listar` agrega a la ocupación actual (alquileres por sector) los rangos
de fijos y bloqueos (helper de arriba). Un slot está libre si no se solapa con ninguno.

## Validación al reservar
- En `reserva.service.crear`: antes de crear, si el `[inicio,fin)` choca con un fijo o bloqueo
  (helper) → `Conflict` (409) con mensaje claro ("ese horario está tomado por un turno fijo / bloqueado").
- Al **crear un fijo o bloqueo**: validar que no pise un alquiler activo (ReservaSector) ni otro
  fijo/bloqueo de canchas relacionadas en ese día/hora → 409. (También validar `horaInicio < horaFin`.)

## Endpoints (todos `authJwt` — solo panel)
- `GET /turnos-fijos` (lista, opcional `?canchaId`), `POST /turnos-fijos`, `DELETE /turnos-fijos/:id`.
- `POST /turnos-fijos/:id/excepciones` (body `{ fecha }`), `DELETE /turnos-fijos/:id/excepciones/:fecha` (liberar/restaurar).
- `GET /bloqueos`, `POST /bloqueos`, `DELETE /bloqueos/:id`.
- Montados en `apiRouter` (`/turnos-fijos`, `/bloqueos`). El bot no usa ninguno.

## Frontend (panel, BFF — patrón Canchas)
- Sidebar: **"Turnos fijos"** y **"Bloqueos"**.
- **Turnos fijos** (`/turnos-fijos`): tabla (cliente, cancha, día, hora, precio) + alta (dialog:
  cancha select, día select, horaInicio/Fin, cliente, whatsapp, precio) + baja + **"liberar fecha"**
  (agregar excepción con date picker; listar/quitar excepciones).
- **Bloqueos** (`/bloqueos`): tabla (cancha, motivo, día/fecha, hora) + alta (dialog: cancha, motivo,
  tipo puntual/recurrente → fecha o día, horaInicio/Fin, nota) + baja.
- Server Actions (`crearTurnoFijo`, `eliminarTurnoFijo`, `agregarExcepcion`, `quitarExcepcion`,
  `crearBloqueo`, `eliminarBloqueo`) con `run()` + `revalidatePath`.
- Validación Zod (`turnoFijoSchema`, `bloqueoSchema`): HH:MM, inicio<fin, diaSemana 0–6, precio>0,
  motivo enum, coherencia recurrente↔diaSemana / puntual↔fecha.

## Testing
- **Backend (integración):** fijo bloquea su slot el día que toca y deja libres los otros días;
  excepción libera esa fecha; bloqueo puntual resta solo esa fecha; bloqueo recurrente resta ese día;
  reservar sobre fijo/bloqueo → 409; crear fijo sobre alquiler existente → 409; respeta sectores
  (fijo en entera afecta partes).
- **Frontend:** unit de `turnoFijoSchema`/`bloqueoSchema`; resto con tsc/lint/build.

## Bot
Sin cambios de código. Al pedir `/disponibilidad` ya no recibe los slots de fijos/bloqueos.

## Fuera de alcance
- Materializar (Opción A) / job de generación.
- Cobro/seña automático de fijos (queda el precio guardado, sin flujo de pago).
- Mostrar fijos/bloqueos en la grilla de Reservas o en el dashboard.
- Vincular el fijo a un `Cliente` del sistema (se guarda nombre/WhatsApp como texto).

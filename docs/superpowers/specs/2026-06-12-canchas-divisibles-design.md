# Canchas divisibles (recursos compuestos) — Design

**Fecha:** 2026-06-12
**Estado:** Aprobado

## Objetivo

Soportar canchas que se alquilan **enteras o divididas en N partes** (ej. Cancha 4),
sin riesgo de doble reserva (reservar la entera bloquea las partes y viceversa).
**Administrable desde el panel:** el dueño crea una cancha divisible y el sistema
arma sola la entera, las partes y los sectores.

## Reglas de negocio (confirmadas)
- N partes **configurable** al crear (default 3). Cada parte se alquila suelta; también
  existe la unidad "entera".
- Precio: **uno para la entera + uno único para todas las partes**.
- Reservar la entera ocupa todas las partes; reservar una parte ocupa la entera (a nivel
  del tiempo reservado).
- Por ahora solo la Cancha 4, pero el modelo y el panel son genéricos.

## Modelo de datos (Prisma/PostgreSQL)

Idea central: separar **unidad vendible** (`Cancha`) de **sector físico** (`Sector`), y
poner el anti-overlap a nivel sector.

```prisma
model CanchaGrupo {
  id       String   @id @default(cuid())
  nombre   String
  creadoEn DateTime @default(now())
  canchas  Cancha[]
}

model Sector {
  id       String          @id @default(cuid())
  nombre   String
  canchas  CanchaSector[]
  ocupaciones ReservaSector[]
}

model Cancha {                       // unidad vendible (existente, + campos)
  // ...campos actuales (nombre, tipo, precioHora, activa, ...)
  grupoId  String?
  grupo    CanchaGrupo? @relation(fields: [grupoId], references: [id])
  esEntera Boolean      @default(false)   // true sólo para la "entera" de un grupo divisible
  sectores CanchaSector[]
}

model CanchaSector {                 // qué sectores ocupa cada cancha vendible
  canchaId String
  sectorId String
  cancha   Cancha @relation(fields: [canchaId], references: [id], onDelete: Cascade)
  sector   Sector @relation(fields: [sectorId], references: [id], onDelete: Cascade)
  @@id([canchaId, sectorId])
}

model ReservaSector {                // ocupación física de una reserva (mueve el anti-overlap acá)
  id          String        @id @default(cuid())
  reservaId   String
  reserva     Reserva       @relation(fields: [reservaId], references: [id], onDelete: Cascade)
  sectorId    String
  sector      Sector        @relation(fields: [sectorId], references: [id])
  estado      EstadoReserva
  fechaInicio DateTime      @db.Timestamptz(3)
  fechaFin    DateTime      @db.Timestamptz(3)
  @@index([sectorId])
}
```
- `Cancha` simple → `grupoId=null`, `esEntera=false`, mapea a **1 sector** propio.
- Cancha divisible → 1 `CanchaGrupo`; la **entera** (`esEntera=true`, precio entera) mapea a
  **todos** los sectores; cada **parte** (precio parte) mapea a **1** sector.
- `Reserva` **mantiene** `canchaId` (qué unidad se reservó, para precio/display/reportes);
  la ocupación real vive en `ReservaSector`.

### Constraint anti-overlap (migración)
Se **elimina** `reserva_no_overlap` de `Reserva` y se crea en `ReservaSector`:
```sql
ALTER TABLE "ReservaSector"
  ADD CONSTRAINT reservasector_no_overlap
  EXCLUDE USING gist (
    "sectorId" WITH =,
    tstzrange("fechaInicio", "fechaFin") WITH &&
  )
  WHERE (estado IN ('CONFIRMADA'::"EstadoReserva", 'ESPERANDO_SENA'::"EstadoReserva"));
```
Para canchas simples (1 sector) el comportamiento es idéntico al actual.

## Migración / backfill
1. Migración: crea tablas (`CanchaGrupo`, `Sector`, `CanchaSector`, `ReservaSector`) + columnas
   `Cancha.grupoId`/`esEntera`; crea el constraint nuevo (tabla vacía → OK); **deja de existir** el viejo.
2. Backfill idempotente (en `seed.ts` / función `ensureSectores`):
   - Cada `Cancha` sin `CanchaSector` → crear 1 `Sector` (nombre = cancha.nombre) + mapping.
   - Cada `Reserva` sin `ReservaSector` → crear filas (sectores de su cancha, copiando estado + horarios).
   Las reservas actuales no se solapan (constraint viejo) y cada cancha = 1 sector, así que el backfill no viola el nuevo constraint.

## Servicios (backend)
- **`cancha.service.create` (simple):** en transacción, crea `Cancha` + `Sector` + `CanchaSector`.
  (Reemplaza el actual `createDefaults` de horarios, que ya no aplica.)
- **`cancha.service.crearDivisible({ nombre, partes, precioEntera, precioParte })`:** en transacción crea
  `CanchaGrupo` + N `Sector` + cancha **entera** (`esEntera`, `precioHora=precioEntera`, mapea a los N sectores) +
  N canchas **parte** (`precioHora=precioParte`, cada una a 1 sector). Nombres: entera = `nombre`;
  partes = `${nombre} - ${i}` (i=1..N). Valida `partes` 2–6.
- **`cancha.service.eliminar`:** si la cancha tiene `grupoId`, borra **todo el grupo** (entera + partes + sectores),
  solo si ninguna unidad del grupo tiene reservas (si tiene → 409). Si es simple, borra cancha + su sector (si no tiene reservas).
- **`reservaRepo.create`:** inserta `Reserva` + `ReservaSector` (sectores de la cancha). El 23P01 en `ReservaSector` → `Conflict` (409), igual que hoy.
- **`reservaRepo.updateEstado`:** actualiza estado en `Reserva` y en sus `ReservaSector` (misma tx).
- **`reservaRepo.reprogramar`:** actualiza horarios en `Reserva` y `ReservaSector` (re-chequea overlap → 409).
- **`disponibilidad.service`:** obtiene los `sectorId` de la cancha; un slot está libre si **ningún** sector está
  ocupado por un `ReservaSector` activo que se solape. (Sigue usando el horario global de `Configuracion`.)

## Endpoints
- `POST /canchas` (authJwt) — simple, existente (ahora crea sector).
- **`POST /canchas/divisible`** (authJwt, nuevo) — body `{ nombre, partes, precioEntera, precioParte }`.
- `GET /canchas` (authAny) — incluye `grupoId`, `esEntera` para que el panel agrupe.
- `PATCH /canchas/:id` (authJwt) — precio/nombre por unidad (existente).
- `DELETE /canchas/:id` (authJwt) — ahora group-aware (borra el grupo si corresponde).

## Frontend (panel)
- **"Nueva cancha"**: selector **tipo Simple / Divisible**.
  - Simple → form actual.
  - Divisible → `nombre`, `cantidad de partes` (número, default 3), `precio entera`, `precio por parte` → `POST /canchas/divisible`.
- **Tabla de canchas**: agrupa las divisibles (muestra la entera con sus partes; badge "Divisible"). Simples como hoy.
- **Eliminar** una divisible → confirma que borra todo el grupo.
- Validación Zod (`canchaDivisibleSchema`): partes 2–6, precios > 0, nombre requerido.

## Bot (n8n)
Impacto casi nulo: el bot lista canchas dinámicas (verá "Cancha 4", "Cancha 4 - 1/2/3") y pide disponibilidad,
que ahora cruza por sectores. Sin cambios de código en el bot. (Nombres claros para el cliente vía los nombres de las unidades.)

## Testing
- Reservar la **entera** bloquea las 3 partes (409 al intentar una parte en el mismo horario).
- Reservar una **parte** bloquea la entera (409 al intentar la entera).
- Dos **partes distintas** en el mismo horario conviven (200 ambas).
- **Disponibilidad** de una parte refleja la ocupación de la entera y al revés.
- **Cancha simple** sigue igual (reserva + overlap).
- **crearDivisible** crea grupo + N sectores + N+1 canchas con los precios correctos.
- **eliminar** divisible borra el grupo; 409 si alguna unidad tiene reservas.
- **Backfill**: reservas existentes obtienen `ReservaSector`.

## Fuera de alcance
- Precios por parte individuales (todas las partes mismo precio).
- Precios por combinación.
- Sub-divisiones anidadas (una parte que a su vez se divide).
- Editar la estructura de un grupo ya creado (cambiar N partes) — se elimina y recrea.

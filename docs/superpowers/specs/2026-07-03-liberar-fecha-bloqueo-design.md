# "Liberar fecha" de bloqueos recurrentes — Design

**Fecha:** 2026-07-03
**Estado:** Aprobado
**Componentes:** backend (modelo + migración + servicio + rutas + read-paths + tests) + frontend (tabla de bloqueos + diálogo + tipos + acciones). Sin bot.

## Problema

Un **bloqueo recurrente** (ej. la clase de un profe todos los lunes 18–19) bloquea la cancha esa franja cada semana. Si un día el profe falta, hay que **liberar solo esa fecha** para que la cancha se pueda volver a vender (panel y bot), sin borrar el bloqueo recurrente.

Es el análogo exacto del "Liberar fecha" de los **turnos fijos** (`TurnoFijoExcepcion`). Diferencia clave: un bloqueo **no se materializa** en reserva, así que liberar una fecha solo requiere que ese día el bloqueo no aplique (no hay reserva que cancelar).

## Modelo (backend)

Nueva tabla espejo de `TurnoFijoExcepcion`:
```prisma
model BloqueoExcepcion {
  id        String   @id @default(cuid())
  bloqueoId String
  bloqueo   Bloqueo  @relation(fields: [bloqueoId], references: [id], onDelete: Cascade)
  fecha     DateTime @db.Date
  @@unique([bloqueoId, fecha])
}
```
`Bloqueo` gana `excepciones BloqueoExcepcion[]`. Migración a mano (crear tabla + FK cascade + índice único), como las anteriores. ⚠️ Correr `prisma migrate deploy` al deployar.

## Servicio + rutas (backend)

Espejando `turnoFijoService`:
- `bloqueoService.agregarExcepcion(id, fecha)` → `upsert` de `BloqueoExcepcion` (fecha como `new Date(fecha+'T00:00:00.000Z')`, igual que fijos). Marca la semana sucia para la hoja.
- `bloqueoService.quitarExcepcion(id, fecha)` → `deleteMany`.
- `bloqueoService.list` → `include: { excepciones: true }` (para que el panel muestre las fechas liberadas).
- Rutas (authJwt + `requireRole('ADMIN')`, como el resto de bloqueos):
  - `POST /bloqueos/:id/excepciones` (body `{ fecha }`, validado `YYYY-MM-DD`).
  - `DELETE /bloqueos/:id/excepciones/:fecha`.
- Validador `excepcionBloqueoSchema` (fecha `YYYY-MM-DD`).

## Read-paths (que la excepción libere de verdad)

En cada lugar donde se aplica un bloqueo, si hay excepción para esa fecha, **no aplica**:

1. **`ocupacion.service.rangosPlantilla`** — la query de bloqueos suma `include: { excepciones: { where: { fecha: fechaDate } } }` y se filtran los que tengan `excepciones.length > 0`. Esto libera la cancha en **disponibilidad** y en el chequeo de conflictos → reservable de nuevo (panel y bot). *(Este es el "que se vuelva a comprar".)*
2. **`agenda.service.delDia`** — la query `bloqueosRaw` suma el mismo `include`/filtro → Hoy/Reservas no muestran el bloqueo liberado ese día.
3. **Hoja espejo (`sheets/`)** — al expandir bloqueos por día, saltar los que tengan excepción para esa fecha (mismo patrón que ya usan los fijos en `expandir.ts`). `sheetsData` debe traer las `excepciones` del bloqueo.
4. **Frontend `lib/calendario.ts` `materializar`** — al dibujar bloqueos, saltar si hay excepción para el día (igual que fijos: `b.excepciones?.some(e => e.fecha.slice(0,10) === dia)`).

**Nota:** `fechaDate = new Date(fecha + 'T00:00:00.000Z')`, consistente con cómo se guarda la excepción y con el resto del sistema.

## Frontend (panel)

- **Tipos (`lib/types.ts`):** `Bloqueo` gana `excepciones?: { id: string; fecha: string }[]`.
- **Acciones (`lib/bloqueos-actions.ts`):** `agregarExcepcionBloqueo(id, fecha)` y `quitarExcepcionBloqueo(id, fecha)` (vía `run`, que ya revalida `/bloqueos` + `/calendario` + `/hoy`).
- **Tabla de bloqueos (`components/bloqueos/bloqueos-table.tsx`):** para bloqueos **recurrentes**, un botón **"Liberar fecha"** que abre un diálogo espejo del de fijos (elegir fecha a liberar + lista de fechas liberadas con opción de quitar). Reusar el patrón de `components/fijos/excepcion-dialog.tsx` (crear `components/bloqueos/excepcion-bloqueo-dialog.tsx`). Los bloqueos **puntuales** no muestran "Liberar fecha" (se manejan con "Eliminar").

## Testing (backend, integración)
- Bloqueo recurrente (ej. lunes 18–19) con excepción para un lunes concreto → `GET /disponibilidad?canchaId=&fecha=<ese lunes>` muestra la franja **libre** (18:00 disponible); otro lunes sin excepción sigue **bloqueado**.
- `POST /bloqueos/:id/excepciones` crea la excepción (idempotente); `DELETE` la quita → el bloqueo vuelve a aplicar.
- Agenda de ese día no incluye el bloqueo liberado.

## Fuera de alcance
- Bloqueos **puntuales** (se borran con "Eliminar"; no necesitan excepción).
- Bot / n8n (no hay intención de liberar bloqueos por WhatsApp; la disponibilidad ya sale correcta sola).
- Materialización de bloqueos (no existe; no aplica).

## Integración
Backend → `main` (+ migración). Frontend → `master`. Definir en el plan si se pushea o se deja commiteado. Dos repos.

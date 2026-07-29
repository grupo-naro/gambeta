# Spec técnica — Backend "Canchitas Ortigoza"

- **Fecha:** 2026-06-08
- **Autor:** Naro Gráfica (backend engineering)
- **Estado:** Aprobado para planificación
- **Stack:** Node.js · Express · TypeScript · Prisma · PostgreSQL · Zod · JWT · dotenv
- **Tests:** Vitest · Supertest · Testcontainers

---

## 1. Contexto y alcance

Canchitas Ortigoza es un complejo de canchas (fútbol) en Argentina. El sistema global automatiza
reservas por WhatsApp: `Cliente → Evolution API → n8n → Gemini → PostgreSQL`, más un panel admin en React.

Este documento cubre **solo el backend Node.js**, que es la **fuente de verdad** de reservas,
disponibilidad y pagos. No incluye n8n, el bot, Gemini ni el panel front.

### Consumidores
1. **n8n (bot WhatsApp)** — autenticación por **API key de servicio** (`x-api-key`).
2. **Panel admin (React)** — autenticación por **JWT** (login email + password).

### Principio de propiedad de datos
n8n **nunca** escribe directo en Postgres. Toda escritura de reservas pasa por la API del backend,
para garantizar el constraint anti-overlap. El **timing** de los jobs diferidos (timeout de seña a los
30 min, recordatorio 24 h antes) lo orquesta **n8n**; el backend expone endpoints idempotentes y
consultas de apoyo (p. ej. listar reservas con seña vencida).

---

## 2. Objetivos

### Funcionales
- Generar disponibilidad (slots de 60 min) por cancha respetando sus horarios.
- Crear reservas previniendo **doble reserva** concurrente (responder 409 ante solapamiento).
- Gestionar el flujo de seña: cliente de confianza → confirma directo; cliente nuevo → espera seña.
- Aprobar/rechazar seña (automático por IA vía n8n, o manual por admin desde el panel).
- Cancelar reservas con regla de anticipación mínima.
- Exponer analíticas del negocio (ocupación, ingresos, canchas top, horarios pico).
- Autenticar admins (JWT) y servicios (API key).

### No funcionales
- **Concurrencia:** imposibilidad de doble reserva a nivel de motor (exclusion constraint).
- **Mantenibilidad:** capas con responsabilidades separadas; servicios testeables sin HTTP.
- **Simplicidad / YAGNI:** single-tenant, sin features especulativas.
- **Trazabilidad:** audit log de acciones sensibles (seña, cancelación, login).
- **Zona horaria correcta:** `timestamptz` en UTC, interpretación en `America/Argentina/Buenos_Aires`.

### Restricciones
- Stack obligatorio (arriba). PostgreSQL con extensión `btree_gist`.
- Argentina es UTC-3 fijo (sin horario de verano), pero la TZ se centraliza en config.

---

## 3. Supuestos

- Un solo complejo (single-tenant). Sin columna `negocioId`. Migrar a multi-tenant después es acotado.
- Slots de **60 min** alineados a la hora en punto. `precioHora` = precio del turno.
- La detección "es contacto de WhatsApp" la hace n8n (Evolution API) y la envía al backend como
  booleano en el `POST /reservas`. El backend no consulta la agenda.
- La verificación del comprobante con Gemini Vision la hace n8n; el backend solo recibe el resultado
  (`POST .../aprobar-sena` con `verificadoPor=IA` o admin con `verificadoPor=HUMANO`).
- Subida de comprobante: n8n provee una `comprobanteUrl` ya almacenada; el backend no maneja archivos.

---

## 4. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Doble reserva concurrente | Exclusion constraint `btree_gist` sobre `(canchaId, tsrange)` + manejo de 409 |
| Password admin en texto plano | `passwordHash` con bcrypt; nunca se persiste ni loguea el plano |
| Seña vencida nunca liberada | `GET /reservas/vencidas-sena` + `PATCH .../cancelar`; n8n dispara el timing |
| Desfase de horarios por TZ | `timestamptz` UTC + helpers de TZ centralizados; tests sobre límites de día |
| n8n escribiendo directo a DB | Política explícita: escritura solo vía API; constraint como red de seguridad |
| Estados ambiguos | Máquina de estados de 5 estados con transiciones validadas en el service |
| Reservas en el pasado / fin ≤ inicio | Validación Zod + regla de negocio (422) |

### Deuda técnica aceptada (consciente)
- Sin multi-tenant (se asume migración futura si aparece otra sede).
- Jobs diferidos delegados a n8n (el backend no corre scheduler propio en el MVP).
- Sin manejo de archivos de comprobante (se delega a n8n / storage externo).
- Analytics con queries directas (sin capa de agregación/materialized views) — suficiente al volumen.

---

## 5. Entidades y modelo de datos

### 5.1 Enums
```
EstadoReserva   = CONFIRMADA | ESPERANDO_SENA | CANCELADA | COMPLETADA
EstadoPago      = PENDIENTE | APROBADO | RECHAZADO
VerificadoPor   = IA | HUMANO
```

### 5.2 Modelos

**Cancha**
- `id` (cuid, PK), `nombre`, `tipo`, `precioHora` (Decimal), `activa` (bool, default true), `creadoEn`
- Relaciones: `reservas[]`, `horarios[]`
- Soft delete vía `activa`.

**HorarioDisponible**
- `id` (PK), `canchaId` (FK), `diaSemana` (Int 0–6), `horaInicio` (time), `horaFin` (time), `activo`
- Índice: `(canchaId, diaSemana)`

**Cliente**
- `id` (PK), `nombre`, `whatsapp` (unique), `esContacto` (bool — estado actual en agenda),
  `primeraReserva` (DateTime?), `totalReservas` (Int default 0), `creadoEn`
- Nunca se borra (historial). Upsert por `whatsapp`.

**Reserva**
- `id` (PK), `canchaId` (FK), `clienteId` (FK), `fechaInicio` (timestamptz), `fechaFin` (timestamptz),
  `estado` (EstadoReserva), `esContacto` (bool — **snapshot** del momento de reservar),
  `monto` (Decimal), `montoSena` (Decimal?), `notas` (String?), `creadoEn`
- Relación: `pago?` (1:1)
- **Exclusion constraint** (migración SQL cruda):
  `EXCLUDE USING gist (canchaId WITH =, tsrange(fechaInicio, fechaFin) WITH &&)`
  `WHERE (estado IN ('CONFIRMADA','ESPERANDO_SENA'))`
- Índices: `(canchaId, fechaInicio)`, `(clienteId)`, `(estado)`

**Pago**
- `id` (PK), `reservaId` (FK, unique → 1:1), `montoDetectado` (Decimal?), `comprobanteUrl` (String?),
  `verificadoPor` (VerificadoPor?), `aprobadoPor` (FK AdminUser?, nullable), `estado` (EstadoPago),
  `creadoEn`

**AdminUser**
- `id` (PK), `email` (unique), `passwordHash`, `nombre`, `creadoEn`
- Relación: `pagosAprobados[]`

**AuditLog**
- `id` (PK), `adminId` (FK?, nullable para acciones de sistema/IA), `accion` (String),
  `entidad` (String), `entidadId` (String?), `payload` (Json?), `creadoEn`
- Acciones: `LOGIN`, `APROBAR_SENA`, `RECHAZAR_SENA`, `CANCELAR_RESERVA`, `CREAR_RESERVA_MANUAL`
- Índices: `(entidad, entidadId)`, `(creadoEn)`

### 5.3 Máquina de estados de Reserva
```
[crear]
  ├─ esContacto = true  → CONFIRMADA
  └─ esContacto = false → ESPERANDO_SENA

ESPERANDO_SENA ──(seña aprobada: IA o admin)──► CONFIRMADA
ESPERANDO_SENA ──(timeout 30 min / rechazo)───► CANCELADA
CONFIRMADA     ──(admin o cliente cancela)─────► CANCELADA   [si cumple anticipación mínima]
CONFIRMADA     ──(turno finalizó)──────────────► COMPLETADA
```
Transiciones inválidas → 409. La validación vive en `ReservaService`.

---

## 6. Reglas de negocio

- **Disponibilidad:** para `(canchaId, fecha)`, generar slots de 60 min entre `horaInicio`/`horaFin`
  del `diaSemana` correspondiente; excluir slots solapados con reservas en estado
  `CONFIRMADA` o `ESPERANDO_SENA`. Interpretar la fecha en TZ Argentina.
- **Estado inicial:** `esContacto=true` → `CONFIRMADA`; `esContacto=false` → `ESPERANDO_SENA`.
- **Anti-overlap:** insertar dentro de transacción; si el constraint dispara → capturar y devolver 409.
- **Cancelación:** permitida hasta `CANCELACION_ANTICIPACION_HORAS` (configurable, default 12 h) antes
  de `fechaInicio`. La seña pagada **no** se reembolsa automáticamente. El admin puede forzar siempre.
- **Aprobar seña:** solo desde `ESPERANDO_SENA`; crea/actualiza `Pago(estado=APROBADO)` y pasa la
  reserva a `CONFIRMADA`. Registra `AuditLog`.
- **Rechazar seña:** `Pago(estado=RECHAZADO)` y reserva → `CANCELADA`. Registra `AuditLog`.
- **Cliente upsert:** al crear reserva, upsert por `whatsapp`; setear `primeraReserva` si es nuevo;
  incrementar `totalReservas`.
- **Validaciones temporales:** `fechaFin > fechaInicio`; no reservar en el pasado (422).

---

## 7. Autenticación

- **Panel (JWT):** `POST /auth/login` (email + password) → access token firmado (`JWT_SECRET`, exp
  configurable). Middleware `authJwt` valida `Authorization: Bearer`. `GET /auth/me`.
- **Servicio (n8n):** middleware `authApiKey` valida header `x-api-key` contra `SERVICE_API_KEY`.
- Endpoints de escritura de reservas aceptan **JWT (admin) o API key (n8n)**; analytics y gestión de
  canchas/usuarios requieren **JWT**.
- Passwords con **bcrypt**. Secretos vía `dotenv` / variables de entorno.

---

## 8. Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/auth/login` | — | Login admin, devuelve JWT |
| GET | `/auth/me` | JWT | Datos del admin autenticado |
| GET | `/canchas` | JWT/API | Lista canchas (filtro `activa`) |
| GET | `/canchas/:id` | JWT/API | Detalle de cancha |
| POST | `/canchas` | JWT | Crear cancha |
| PATCH | `/canchas/:id` | JWT | Editar cancha |
| PATCH | `/canchas/:id/activa` | JWT | Activar/desactivar (soft delete) |
| GET | `/disponibilidad?canchaId&fecha` | JWT/API | Slots de 60 min disponibles |
| POST | `/reservas` | JWT/API | Crear reserva (overlap → 409) |
| GET | `/reservas` | JWT | Lista con filtros (fecha, cancha, estado, whatsapp) |
| GET | `/reservas/:id` | JWT | Detalle |
| GET | `/reservas/vencidas-sena` | JWT/API | Reservas `ESPERANDO_SENA` vencidas (para n8n) |
| PATCH | `/reservas/:id/cancelar` | JWT/API | Cancelar (regla de anticipación) |
| PATCH | `/reservas/:id/aprobar-sena` | JWT/API | Aprobar seña → CONFIRMADA |
| PATCH | `/reservas/:id/rechazar-sena` | JWT/API | Rechazar seña → CANCELADA |
| GET | `/clientes` | JWT | Lista de clientes |
| GET | `/clientes/:id` | JWT | Detalle + historial |
| POST | `/clientes` | JWT/API | Upsert por whatsapp |
| GET | `/analytics/ocupacion` | JWT | Ocupación por día/hora |
| GET | `/analytics/ingresos` | JWT | Ingresos por período |
| GET | `/analytics/canchas-top` | JWT | Canchas más reservadas |
| GET | `/analytics/horarios-pico` | JWT | Horarios de mayor demanda |

---

## 9. Errores esperados

Formato uniforme: `{ "error": { "code": string, "message": string, "details"?: object } }`

| HTTP | Caso |
|---|---|
| 400 | Validación Zod (payload/query inválidos) |
| 401 | Sin credenciales / token inválido |
| 403 | Credencial válida sin permiso (p. ej. API key intentando analytics) |
| 404 | Recurso inexistente |
| 409 | Overlap de reserva / transición de estado inválida |
| 422 | Regla de negocio (fecha en el pasado, cancelación fuera de plazo) |
| 500 | Error inesperado (logueado, sin filtrar internals al cliente) |

`AppError` tipado + `errorHandler` central como último middleware.

---

## 10. Arquitectura en capas

```
src/
  routes/         Wiring HTTP. Sin lógica de negocio.
  middlewares/    authJwt, authApiKey, validate(zod), errorHandler
  validators/     Schemas Zod por endpoint + parsing de fechas con TZ
  services/       Reglas de negocio, transacciones, máquina de estados
  repositories/   Acceso Prisma; encapsula el SQL del exclusion constraint
  db/             PrismaClient singleton
  types/          Tipos compartidos, enums de dominio
  utils/          AppError, logger (pino), helpers de TZ, hashing
  index.ts        Bootstrap Express
prisma/
  schema.prisma
  migrations/     Incluye migración SQL cruda del exclusion constraint
  seed.ts
```

**Flujo de dependencias:** `routes → middlewares → services → repositories → db`.
Los services no conocen HTTP; los repositories no conocen reglas de negocio. Esto permite testear
services con repositorios mockeados y tener tests de integración que validen el constraint contra
Postgres real.

**Justificación:** se descartó (a) controladores monolíticos (deuda inmediata) y (b) hexagonal/DDD
con puertos y adaptadores (sobreingeniería para 7 entidades). La arquitectura en capas es el punto
óptimo entre claridad y velocidad.

---

## 11. Testing (TDD)

- **Unit (services):** disponibilidad (generación/exclusión de slots, bordes de día y TZ),
  transiciones de estado, regla de cancelación, upsert de cliente. Repos mockeados.
- **Integración (rutas + Postgres real vía Testcontainers):** creación de reserva, **409 por overlap
  concurrente** (dos inserts en paralelo sobre el mismo slot), aprobar/rechazar seña, auth.
- Vitest + Supertest. Cada feature sigue RED → GREEN → REFACTOR.

---

## 12. Docker y seeds

- **Dockerfile** multi-stage: etapa build (deps + `tsc` + `prisma generate`) → runtime slim (solo
  artefactos + deps de producción).
- **docker-compose**: servicio `api` + servicio `postgres` (con `btree_gist` habilitado en init).
- **Seeds** (`prisma/seed.ts`): canchas de ejemplo, sus horarios semanales, 1 `AdminUser` (password
  hasheada vía env).

---

## 13. Variables de entorno (`.env.example`)

```
DATABASE_URL=postgresql://user:pass@localhost:5432/canchitas
JWT_SECRET=change-me
JWT_EXPIRES_IN=12h
SERVICE_API_KEY=change-me
TZ_NEGOCIO=America/Argentina/Buenos_Aires
CANCELACION_ANTICIPACION_HORAS=12
SENA_TIMEOUT_MINUTOS=30
ADMIN_SEED_EMAIL=admin@canchitas.com
ADMIN_SEED_PASSWORD=change-me
PORT=3000
```

---

## 14. Validación final (criterios de cierre)

Antes de dar por terminado: `vitest` en verde, `tsc --noEmit` sin errores, `docker compose up`
levanta API + DB, seeds corren, smoke test de los endpoints clave, revisión de seguridad
(hashing, secretos fuera del código, sin internals en errores 500).

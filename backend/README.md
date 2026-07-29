# Canchitas Ortigoza — Backend API

Source of truth for **canchas** (fields), **availability**, **reservations**, and **seña** (deposit) payments. Consumed by:

- **n8n** automation workflows via `x-api-key` header (write operations: create reservations, approve/reject deposits, cancel)
- **Admin panel** (React frontend) via JWT (read/write everything)

Built with **Express 5**, **Prisma 7**, **TypeScript (ESM)**, and **PostgreSQL 16** with `btree_gist` for double-booking prevention.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | 22 recommended |
| Docker | any recent | Required for Testcontainers (tests) and `docker compose` |
| npm | 11+ | Lock file was generated with npm 11 |

---

## Local Setup

```bash
# 1. Copy environment file and fill in values
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Start a local Postgres (or use the compose one)
docker run -d --name canchitas-dev-pg \
  -e POSTGRES_USER=canchitas -e POSTGRES_PASSWORD=canchitas -e POSTGRES_DB=canchitas \
  -p 5433:5432 postgres:16-alpine \
  -c shared_preload_libraries=btree_gist

# 4. Apply migrations
npx prisma migrate dev

# 5. Seed the database (1 admin + 2 canchas + 14 horarios)
npm run seed

# 6. Start development server (hot-reload via tsx)
npm run dev
```

The API listens on `http://localhost:3000` by default (`PORT` env var).

---

## Testing

```bash
npm test
```

Runs **Vitest** with **Testcontainers** — Docker must be running. Tests spin up a throwaway Postgres container automatically (no manual setup needed). Currently ~40 integration + unit tests.

```bash
npm run typecheck   # tsc --noEmit (no compilation, type errors only)
npm run test:watch  # interactive watch mode
```

---

## Docker Compose

Brings up Postgres + API with migrations applied automatically on startup:

```bash
docker compose build
docker compose up -d
curl http://localhost:3000/health  # => {"ok":true}
docker compose down -v
```

Postgres is mapped to host port **5434** (to avoid conflicts with local installs).
The API is on **3000**.

Environment variables for the API container are defined in `docker-compose.yml`. Override them with a `.env` file at the project root if needed.

---

## Prisma 7 Notes

- **Client location:** generated to `src/generated/prisma` (gitignored). Run `npx prisma generate` after schema changes.
- **Barrel import:** all app code imports Prisma types via `src/db/client.ts` → `export * from '../generated/prisma/client.js'`.
- **Runtime singleton:** `src/db/prisma.ts` creates a `PrismaClient` with the `@prisma/adapter-pg` driver adapter (`PrismaPg`).
- **Config file:** `prisma.config.ts` at project root (not `package.json`). Defines schema path, seed command, and datasource URL via `env("DATABASE_URL")`.
- **Seed command:** `npx prisma db seed` (wired in `prisma.config.ts` → `migrations.seed`) or `npm run seed` (direct tsx).

---

## API Endpoints

### Authentication (`/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | — | Admin login → returns JWT |
| GET | `/auth/me` | JWT | Returns current admin info |

### Canchas (`/canchas`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/canchas` | JWT or API Key | List canchas (`?activa=true`) |
| GET | `/canchas/:id` | JWT or API Key | Get single cancha |
| POST | `/canchas` | JWT | Create cancha |
| PATCH | `/canchas/:id` | JWT | Update cancha fields |
| PATCH | `/canchas/:id/activa` | JWT | Enable/disable cancha |

### Disponibilidad (`/disponibilidad`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/disponibilidad?canchaId=&fecha=` | JWT or API Key | List available time slots for a cancha on a date |

### Reservas (`/reservas`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/reservas` | JWT or API Key | Create reservation (n8n entry point) |
| GET | `/reservas` | JWT | List reservations (filterable by estado, canchaId, fecha) |
| GET | `/reservas/vencidas-sena` | JWT or API Key | Get reservations with expired seña window (n8n polling) |
| GET | `/reservas/:id` | JWT | Get single reservation |
| PATCH | `/reservas/:id/aprobar-sena` | JWT or API Key | Approve seña payment |
| PATCH | `/reservas/:id/rechazar-sena` | JWT or API Key | Reject seña payment |
| PATCH | `/reservas/:id/cancelar` | JWT or API Key | Cancel reservation |

### Clientes (`/clientes`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/clientes` | JWT | List all clients |
| GET | `/clientes/:id` | JWT | Get single client |
| POST | `/clientes` | JWT or API Key | Upsert client by WhatsApp number |

### Analytics (`/analytics`)

All analytics endpoints require **JWT**.

| Method | Path | Description |
|---|---|---|
| GET | `/analytics/ingresos` | Revenue by period |
| GET | `/analytics/canchas-top` | Top canchas by usage |
| GET | `/analytics/horarios-pico` | Peak booking hours |
| GET | `/analytics/ocupacion` | Field occupancy rate |

---

## n8n Integration Contract

All n8n requests must include: `x-api-key: <SERVICE_API_KEY>`.

### Create Reservation

```http
POST /reservas
x-api-key: <key>
Content-Type: application/json

{
  "canchaId": "cmc123...",
  "esContacto": false,
  "fecha": "2026-07-15",
  "horaInicio": "18:00",
  "duracionHoras": 1,
  "whatsapp": "5491112345678",
  "nombreCliente": "Juan Perez",
  "montoSena": 5000
}
```

Response includes the created reservation with `estado: "ESPERANDO_SENA"` (when `montoSena` is provided) or `"CONFIRMADA"`.

### Approve Seña

```http
PATCH /reservas/:id/aprobar-sena
x-api-key: <key>
Content-Type: application/json

{
  "comprobanteUrl": "https://cdn.example.com/comprobante.jpg",
  "montoDetectado": 5000,
  "verificadoPor": "IA"
}
```

### Cancel Reservation

```http
PATCH /reservas/:id/cancelar
x-api-key: <key>
```

### Get Expired Seña Reservations (n8n polling)

```http
GET /reservas/vencidas-sena
x-api-key: <key>
```

Returns an array of reservations in `ESPERANDO_SENA` state whose seña window (`SENA_TIMEOUT_MINUTOS`) has expired. n8n calls this on a schedule and cancels them automatically.

---

## Reservation State Machine

```
                  POST /reservas
                  (montoSena set)
                       │
                       ▼
              ESPERANDO_SENA
             /              \
PATCH /aprobar-sena    PATCH /cancelar
(or timeout by n8n)    PATCH /rechazar-sena
        │                    │
        ▼                    ▼
   CONFIRMADA           CANCELADA
        │
  (event passes)
        │
        ▼
   COMPLETADA
```

| State | Meaning |
|---|---|
| `ESPERANDO_SENA` | Reservation created, waiting for deposit payment |
| `CONFIRMADA` | Seña approved (or no seña required) |
| `CANCELADA` | Cancelled by admin, n8n timeout, or client request |
| `COMPLETADA` | Reservation fulfilled (past event, seña approved) |

### Double-Booking Guarantee

A PostgreSQL **exclusion constraint** (`btree_gist`) on `(canchaId, [fechaInicio, fechaFin))` prevents two `CONFIRMADA` or `ESPERANDO_SENA` reservations from overlapping for the same cancha. Violations return **HTTP 409**.

---

## Security Notes

- Passwords are stored as **bcrypt hashes only** (cost factor 10).
- All secrets come from environment variables; `.env` is gitignored.
- `500` error responses never expose stack traces or internal messages (see `src/middlewares/errorHandler.ts`).
- Analytics endpoints require JWT; n8n write endpoints accept API key.
- `src/generated/` is gitignored and not committed.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Gambeteando** — booking/management system for football & padel courts ("canchitas") in Argentina. Four independently deployed pieces live side by side in this repo:

Note: `canchitas` also survives as an *infrastructure* identifier (Docker network, DB name, volumes, image/container names, the `canchitas-infra/` directory, the `canchitas-backend` GitHub repo). Those are provisioned on the live VPS and are deliberately **not** renamed — only the brand text is Gambeteando.

| Directory | What | Package manager | Deployed to |
|---|---|---|---|
| [backend/](backend/) | Express 5 + Prisma 7 REST API. Source of truth for everything. | **npm** | VM/VPS via Docker Compose + self-hosted GitHub Actions runner |
| [frontend/](frontend/) | Next.js 16 admin panel (+ `/mostrador` buffet POS) | **pnpm** | VM/VPS (Docker) or Vercel |
| [reservas/](reservas/) | Next.js 16 public self-booking site | **pnpm** | Vercel |
| [canchitas-infra/](canchitas-infra/) | Docker composes + n8n WhatsApp-bot workflows + `bootstrap.sh` installer | — | VPS |

[deploy-demo/](deploy-demo/) is a self-contained demo stack (own Traefik + Postgres + backend + frontend, no WhatsApp bot). [docs/](docs/) holds client-facing HTML/PDF deliverables, not developer docs.

**Code, comments, and domain vocabulary are in Spanish.** Match that — don't translate `cancha`, `seña`, `turno fijo`, `bloqueo`, `cobro`, `buffet` into English in new code.

**Next.js 16 warning** (see `frontend/AGENTS.md`, `reservas/AGENTS.md`): these use a Next.js version newer than most training data. Read the relevant guide under `node_modules/next/dist/docs/` before writing Next-specific code.

## Commands

### backend (npm)

```bash
npm run dev                 # tsx watch, listens on PORT (default 3000)
npm run build               # prisma generate && tsc
npm run typecheck           # tsc --noEmit
npm test                    # ALL tests — requires Docker (Testcontainers spins up Postgres 16)
npm run test:unit           # tests/unit only — no Docker needed
npm run test:watch
npm run seed                # idempotent: admin + canchas + horarios
npm run seed:demo           # fictional data for the demo stack
```

Single test file / single test:

```bash
npx vitest run tests/unit/precio.service.test.ts                       # needs no Docker
npx vitest run tests/integration/sena.test.ts                          # boots a container
npx vitest run tests/integration/sena.test.ts -t "nombre del caso"
```

`tests/helpers/global-setup.ts` starts the container, sets **all** env vars the app needs, and runs `prisma migrate deploy` once per run. Integration tests share one container and run serially (`fileParallelism: false`, `singleFork`) — `resetTables()` in `tests/helpers/db.ts` truncates between files and must be updated when a model is added.

### frontend / reservas (pnpm)

```bash
pnpm dev        # both default to port 3000 — run only one at a time, or set PORT
pnpm build
pnpm lint
pnpm test       # frontend only; vitest over src/**/*.test.{ts,tsx}
```

`npx vitest run src/lib/hora.test.ts` for a single frontend test. `reservas` has no test setup.

### Prisma 7 specifics

- Client is generated to `src/generated/prisma` (gitignored). Run `npx prisma generate` after any schema edit.
- **Never import from `@prisma/client` directly.** App code imports types via `src/db/client.ts`, and the runtime singleton is `src/db/prisma.ts` (uses the `@prisma/adapter-pg` driver adapter).
- Config lives in `prisma.config.ts` at the backend root, *not* in `package.json`.
- New migration: `npx prisma migrate dev --name <nombre>`. Deploys run `prisma migrate deploy` on container start.

## Backend architecture

Strict layering, one direction only:

```
routes/ → services/ → repositories/ → db/prisma.ts
   ↑ middlewares/ (auth, validate, rateLimiters, errorHandler)
   ↑ validators/  (zod schemas)
```

Routes are thin: authenticate → `validate(schema)` → call a service → `auditService.log(...)` → respond. Business rules belong in `services/`; raw Prisma access belongs in `repositories/` (services may query Prisma directly for read-only joins, but writes that touch the exclusion constraint go through `reserva.repo.ts`).

### Three kinds of caller — pick the right middleware

| Middleware | Accepts | Used by |
|---|---|---|
| `authJwt` | admin `Authorization: Bearer` only | admin panel |
| `authAny` | JWT **or** `x-api-key` (`SERVICE_API_KEY`) | endpoints n8n and the public booking site also hit |
| `authBuffet` | `x-buffet-key` only — deliberately rejects JWT and service key | `/buffet` POS routes |
| `requireRole('ADMIN')` | layered after `authJwt`/`authAny` | admin-only mutations |

`req.principal` is `{ kind: 'service' }` or `{ kind: 'admin', adminId, email, rol }` — routes branch on `principal.kind` to decide staff-only behaviour (see `reserva.routes.ts`). Service keys are compared with `timingSafeEqual` and read from `process.env` on every call so `SERVICE_API_KEYS` (comma-separated extras) supports rotation without a restart.

### Double booking is prevented by the database, not by code

Courts can be **divisible**: a large cancha and the two half-canchas that make it up are different `Cancha` rows that share `Sector` rows via `CanchaSector`. Every reservation writes one `ReservaSector` row per sector it occupies, and a Postgres `btree_gist` **exclusion constraint** on `ReservaSector (sectorId, tstzrange(fechaInicio, fechaFin))` — filtered to `CONFIRMADA`/`ESPERANDO_SENA` — rejects overlaps. `reserva.repo.ts` catches that violation and converts it to `Conflict` → HTTP 409. Never "check then insert"; let the constraint fire.

Consequences: any write that changes a reservation's time, court, or state must mirror the change into `ReservaSector` (`updateEstado`, `reprogramar`, `moverDeCancha` all do this). A cancha with no sectors gets an auto-created one on first booking.

`turnosFijos` (weekly recurring slots) and `bloqueos` (maintenance/tournaments) are *not* reservations — they're templates with per-date `excepciones`. `ocupacion.service.ts` is the single place that expands them into occupied minute-ranges and checks conflicts across all sector-related canchas; `disponibilidad.service.ts` subtracts both real reservations and those template ranges when building slots.

### Time zone

All timestamps are `Timestamptz`; business hours are `"HH:MM"` strings interpreted in `TZ_NEGOCIO` (default `America/Argentina/Buenos_Aires`). Always convert via `src/utils/tz.ts` (`combineDateTimeUtc`, `dayOfWeekInTz`, `dayWindowUtc`, `cierreMin`) — never `new Date(fecha + 'T' + hora)`. Note `cierreMin("00:00") === 1440` (midnight = end of day), which is how weekend closing hours work.

### Errors & validation

Throw the factories in `src/utils/errors.ts` (`BadRequest`, `NotFound`, `Conflict`, `BusinessRule`, `Forbidden`, …) — never raw `Error` for expected failures. `errorHandler` serialises them as `{ error: { code, message, details } }`; 500s are scrubbed of internals. `validate(schema)` parses `{ body, query, params }` together and puts the result on `req.valid`.

### Reservation state machine

`ESPERANDO_SENA` → `CONFIRMADA` (deposit approved) → `COMPLETADA`; any state → `CANCELADA`. n8n polls `GET /reservas/vencidas-sena` and cancels reservations whose `SENA_TIMEOUT_MINUTOS` window elapsed. Deposit amount resolution lives in `sena.service.ts`: per-cancha `senaMonto` if set, else the global `Configuracion.senaMontoFijo`.

### Configuration comes from two places

`config/env.ts` (zod-validated `process.env`, fail-fast at boot) holds secrets and deploy-level settings. The `Configuracion` singleton row (id `"default"`, read via `configService`) holds business settings the admin edits at runtime — opening hours, weekend hours, peak windows, deposit rules, CBU/alias, buffet PIN hash. When adding a setting, decide which one it belongs in; runtime-editable ⇒ `Configuracion`.

## Frontend (admin panel) architecture

Server-first App Router. There is **no client-side API layer** — the browser never talks to the backend.

- `src/lib/api.ts` — `server-only` `apiFetch`, reads the `token` cookie, prefixes `process.env.API_URL`, `cache: 'no-store'`. Throws `ApiAuthError` on 401 and `ApiError` otherwise.
- `src/lib/*-actions.ts` — `'use server'` modules, one per domain. They wrap `apiFetch`, `revalidatePath` the affected routes, and return a `{ ok: true } | { ok: false, error }` result instead of throwing, so client components can render the message. **Every export in a `'use server'` file must be an `async function`** — the RSC compiler rejects non-async exports even though tsc/eslint accept them.
- Pages under `src/app/(panel)/` are server components that fetch and pass data down; interactivity lives in `src/components/<dominio>/*` client components.
- `src/middleware.ts` gates routes by *decoding* (not verifying) the JWT — the backend is the real guard. It deletes stale cookies to break the `/dashboard ↔ /login` loop, and explicitly skips `/mostrador`. `requireAdmin()` in `src/lib/require-admin.ts` is the server-side role guard (recepcionista → `/reservas`).
- The buffet POS (`/mostrador`) has its **own** auth: a PIN-gated, HMAC-signed cookie (`src/lib/buffet-session.ts`) using `BUFFET_API_KEY` as both the HMAC secret and the backend's `x-buffet-key`. It does not use the admin JWT at all.
- UI: Tailwind v4 + shadcn-style components over `@base-ui/react` in `src/components/ui/`, `sonner` toasts, `recharts` dashboards.

## Public booking site (reservas/)

Much smaller. `src/lib/api.ts` calls the backend with `x-api-key: SERVICE_API_KEY` from the server only — that key must never reach the browser (no `NEXT_PUBLIC_` prefix anywhere). Mercado Pago checkout returns to `/reservar/pago/exito|pendiente`; the authoritative confirmation is the backend webhook (`/webhooks`, signature-checked), not the redirect.

## Deployment topology

Backend, n8n, Evolution API (WhatsApp), Redis and Postgres share the Docker network `canchitas-network`; n8n and the frontend reach the API at `http://backend:3000` internally, Traefik fronts it publicly. Pushing to `main` triggers `backend/.github/workflows/deploy.yml` on a self-hosted runner inside the VM, which does `git reset --hard origin/main` + `docker compose -f docker-compose.vm.yml up -d --build`; the container's `CMD` runs `prisma migrate deploy` before starting. See `backend/DEPLOY-VM.md`, `deploy-demo/DEPLOY-DEMO.md`, and `canchitas-infra/INSTALL.md`.

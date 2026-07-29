# Endurecimiento de seguridad del backend (A1 + A2) — Design

**Fecha:** 2026-06-24
**Estado:** Aprobado
**Componente:** backend (Express 5 + Prisma 7). Origen: auditoría 2026-06-24 (hallazgos A1 y A2).

## Problema

- **A1:** [app.ts](../../backend/src/app.ts) no usa `helmet` (sin headers de seguridad) ni rate limiting. `POST /auth/login` ([auth.routes.ts](../../backend/src/routes/auth.routes.ts)) es vulnerable a fuerza bruta. Hay **Traefik** delante, así que sin `trust proxy` el rate-limit contaría la IP del proxy, no la del cliente.
- **A2:** la `SERVICE_API_KEY` es una sola string comparada por igualdad exacta en [authAny.ts](../../backend/src/middlewares/authAny.ts) y [authApiKey.ts](../../backend/src/middlewares/authApiKey.ts). No hay forma de rotarla sin downtime (cambiarla invalida al bot de golpe). Lo admin va por `authJwt`, separado, así que la service key ya NO alcanza endpoints de admin (no se hace scoping por-endpoint: YAGNI para un único consumidor).

## A1 — Headers de seguridad + rate limiting

Dependencias nuevas: `helmet`, `express-rate-limit`.

En `buildApp()` ([app.ts](../../backend/src/app.ts)), en este orden, antes de `app.use(apiRouter)`:
1. `app.set('trust proxy', 1)` — confía solo en el primer proxy (Traefik); `req.ip` y el rate-limit usan el `X-Forwarded-For` real sin ser spoofeable por el cliente.
2. `app.use(helmet())` — headers de seguridad con el default (API pura, sin HTML/CSP que ajustar).
3. **Limiter general** (anti-flood, holgado): `windowMs: 60_000`, `limit: 600`, `standardHeaders: 'draft-7'`, `legacyHeaders: false`. Aplicado a todo `apiRouter`. `/health` queda fuera (se registra antes del router). Holgado a propósito para no estrangular al bot ni al panel (comparten pocas IPs).
4. **Limiter estricto de login**: `windowMs: 15 * 60_000`, `limit: 10`, `standardHeaders: 'draft-7'`, `legacyHeaders: false`, mensaje JSON `{ error: 'Demasiados intentos, probá más tarde' }`. Se monta SOLO en `POST /auth/login` (como middleware de esa ruta, antes de `validate`).

El handler de exceso devuelve **429**. El orden importa: `/health` (sin limiter) → `helmet` + general limiter → router; el login limiter es específico de la ruta.

## A2 — Rotación de `SERVICE_API_KEY` sin downtime

- **env.ts:** mantener `SERVICE_API_KEY: z.string().min(1)` (requerida, back-compat). Agregar `SERVICE_API_KEYS: z.string().default('')` (lista separada por comas, opcional, claves adicionales aceptadas).
- **Helper `isValidServiceKey(provided: string | undefined): boolean`** (archivo nuevo `src/utils/serviceAuth.ts`):
  - Arma el conjunto aceptado: `[SERVICE_API_KEY, ...SERVICE_API_KEYS.split(',')]`, trim, sin vacíos, únicas.
  - Compara `provided` contra cada una con **`crypto.timingSafeEqual`** (constant-time). Maneja largos distintos sin tirar excepción (si difiere el largo → no matchea esa, sigue). Devuelve `true` si matchea alguna.
- **Middlewares:** `authAny` y `authApiKey` reemplazan `apiKey === getEnv().SERVICE_API_KEY` por `isValidServiceKey(apiKey)`. El resto de su lógica (JWT en authAny, `req.principal`) queda igual.
- **Operacional:** declarar `SERVICE_API_KEYS` en el bloque `environment:` de `docker-compose.vm.yml` (si no, no entra al contenedor — gotcha conocido). Mientras esté vacía, el comportamiento es idéntico al actual.

## Testing

- **Unit** `src/utils/serviceAuth.test.ts` (sin Docker): con `SERVICE_API_KEY='primaria'` y `SERVICE_API_KEYS='segunda,tercera'` → `isValidServiceKey('primaria')`=true, `('segunda')`=true, `('otra')`=false, `(undefined)`=false, `('')`=false; no lanza con largos distintos. (Setear `process.env` + resetear el cache de `getEnv` dentro del test.)
- **Integración** (Testcontainers, `tests/integration/hardening.test.ts`):
  - `helmet`: un `GET /health` (o cualquier ruta) trae el header `x-dns-prefetch-control` (o `x-content-type-options: nosniff`).
  - Login rate-limit: 10 × `POST /auth/login` con credenciales inválidas → 401; el intento 11 → **429**. (Aislar: este test corre en su propio archivo para no compartir el contador con otros; el limiter cuenta por IP y supertest usa 127.0.0.1.)
  - Service key rotación: con `SERVICE_API_KEYS` seteada a una key extra, un endpoint `authAny` (ej. `GET /reservas/mias?whatsapp=...`) responde 200 tanto con la key primaria como con la extra; con una key inválida → 401.

## Orden de implementación y cierre

1. A1 y A2 son backend → plan único, merge a `main` + push, deploy en la VM lo corre el usuario (acordarse de declarar `SERVICE_API_KEYS` en el compose).
2. **Follow-on (bot, directo en n8n, fuera de este plan):** generar una key nueva → agregarla a `SERVICE_API_KEYS` (2 válidas) → mover la `SERVICE_API_KEY` fuera de los nodos Code del bot (a `$env` de n8n vía docker-compose, referenciada como `$env.SERVICE_API_KEY`) y apuntar el bot a la nueva → promover la nueva a `SERVICE_API_KEY` y vaciar la vieja de `SERVICE_API_KEYS`. Esto completa la rotación y de paso de-hardcodea la key (cierra B2).

## Fuera de alcance

- Scoping por-endpoint de la service key (YAGNI: `authJwt` ya separa admin de service).
- CORS (el panel usa BFF server-side, no llama al backend desde el browser).
- El cambio del bot (es el follow-on directo).

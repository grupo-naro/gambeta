# Panel Admin (Frontend) — Design

**Fecha:** 2026-06-10
**Estado:** Aprobado
**Alcance:** MVP (Login + Dashboard + Reservas). Fase 2 fuera de alcance.

## Objetivo

Panel web de administración para Canchitas Ortigoza: que el dueño/encargado
gestione reservas y vea métricas del negocio. Next.js desplegado en Vercel,
consumiendo el backend Express/Prisma ya existente.

## Contexto / stack

- Proyecto existente en `c:/Users/Lautaro/Desktop/ortigoza/frontend`: **Next 16.2.9
  (app router) + React 19 + Tailwind 4 + TypeScript**, gestor **pnpm**. Scaffold
  limpio (`src/app`).
- A agregar: **shadcn/ui** (sobre Radix), **lucide-react** (íconos),
  **recharts** (gráficos del dashboard), **zod** (validación de formularios).
- Backend (ya existe) — endpoints relevantes:
  - `POST /auth/login` (email, password) → `{ token }`; `GET /auth/me` (JWT).
  - `GET /analytics/ingresos | /canchas-top | /horarios-pico | /ocupacion` (JWT).
  - `GET /reservas?fecha&canchaId&estado&whatsapp` (JWT); `POST /reservas`;
    `PATCH /reservas/:id/{cancelar,reprogramar,aprobar-sena,rechazar-sena}`.
  - `GET /canchas` (lista, authAny); `GET /disponibilidad?canchaId&fecha`.
  - `GET /config/sena`.
  - Estados de reserva: CONFIRMADA / ESPERANDO_SENA / CANCELADA / COMPLETADA.

## Arquitectura — BFF (Backend For Frontend)

El navegador **nunca** habla directo con el backend. El servidor de Next es el
intermediario:

- **Server Components** leen datos (server-side) llamando al backend con el JWT.
- **Server Actions** ejecutan mutaciones (crear/cancelar/reprogramar/aprobar/rechazar).
- El **JWT vive en una cookie httpOnly** (no accesible por JS del browser).
- **`API_URL`** (env var, solo server-side) define el backend. Dev: backend
  local/LAN. Prod: URL pública del VPS. Sin hardcode.
- Beneficio: token y URL ocultos al cliente; **no requiere CORS** en el backend
  (mismo origen browser↔Next).

### Helper de API (`src/lib/api.ts`)

`apiFetch(path, init?)`: lee la cookie `token` (vía `next/headers cookies()`),
hace `fetch(${process.env.API_URL}${path}, { headers: { Authorization: Bearer ... } })`.
- Si la respuesta es 401 → señal de sesión expirada (la capa que llama redirige a
  `/login` y limpia la cookie).
- Si no es ok (otros 4xx/5xx) → lanza un error con el `message` del backend, para
  que la UI lo muestre en un toast.
- Devuelve JSON parseado.

## Auth

- `/login`: form (email + password) con validación Zod. Submit → **Server Action**
  `login()` → `POST /auth/login`. Éxito: guarda `token` en cookie httpOnly
  (`secure` en prod, `sameSite=lax`, maxAge ~12h) y `redirect('/dashboard')`.
  Error (401/credenciales) → mensaje en el form.
- `middleware.ts`: en rutas del panel (`/dashboard`, `/reservas`, ...) si no hay
  cookie `token` → `redirect('/login')`. En `/login` con cookie válida → redirige a
  `/dashboard`.
- Logout: Server Action que borra la cookie y redirige a `/login`. Botón en topbar.
- 401 en cualquier llamada → la acción/página borra la cookie y manda a `/login`.

## Layout

- **App shell**: sidebar fija (logo "Canchitas Ortigoza" + nav: Dashboard,
  Reservas) + topbar (email del admin + botón Logout).
- Estilo **minimal neutro**: blanco/grises (escala neutral/zinc de Tailwind),
  tipografía Geist (la que trae Next), componentes shadcn/ui. Light-first; la
  estructura queda lista para dark mode pero no es objetivo del MVP.
- Responsive: el sidebar colapsa en mobile (drawer).

## Pantallas del MVP

### Dashboard (`/dashboard`)
- Server Component que consulta `/analytics/*`.
- **Cards de métricas**: ingresos (período), ocupación (%), reservas de hoy,
  cancha top.
- **Gráficos (recharts)**: ingresos en el tiempo + horarios pico (barras). Si un
  endpoint falla, la card/gráfico muestra un estado de error local sin tirar la
  página entera.

### Reservas (`/reservas`)
- Server Component que consulta `GET /reservas` con filtros desde query params:
  **fecha** (date picker, default hoy), **cancha** (select desde `/canchas`),
  **estado** (select). Cambiar filtros actualiza la URL (searchParams).
- **Tabla**: cliente, cancha, fecha/hora, estado (badge), monto/seña. Orden por
  fecha.
- **Acciones por fila** (según estado):
  - CONFIRMADA/ESPERANDO_SENA: **Cancelar** (confirm dialog), **Reprogramar**
    (dialog con fecha+hora, valida contra `/disponibilidad`).
  - ESPERANDO_SENA: **Aprobar seña** / **Rechazar seña**.
  - Cada acción = Server Action → `PATCH` correspondiente → `revalidatePath('/reservas')`.
- **Nueva reserva**: botón → dialog (cancha + fecha + hora + nombre/whatsapp del
  cliente). Muestra slots libres desde `/disponibilidad`. Submit → Server Action
  `POST /reservas` → revalida. Maneja 409 (turno ocupado) y 422 (fecha inválida)
  con mensaje claro.

## Data flow

1. Navegación a una página → Server Component llama `apiFetch` (con cookie token)
   → renderiza con datos frescos.
2. Acción del usuario (botón) → Server Action → `apiFetch` con method/body →
   `revalidatePath` de la ruta afectada → la UI se re-renderiza con el estado nuevo.
3. Toasts (shadcn `sonner`) para feedback de éxito/error de cada acción.

## Manejo de errores y estados

- Loading: `loading.tsx` con skeletons por ruta.
- Vacío: mensajes claros ("No hay reservas para este día").
- Error de acción: toast con el `message` del backend.
- 401: logout + redirect a `/login`.
- Validación de formularios con Zod antes de enviar (espeja las reglas del backend:
  fecha `YYYY-MM-DD`, hora `HH:MM`, whatsapp, etc.).

## Configuración / deploy

- `.env.local` (dev) y env vars en Vercel (prod): **`API_URL`** (URL del backend).
  En dev apunta al backend local/LAN; en prod, al VPS público.
- `.env.example` documentando `API_URL`.
- No se commitea `.env.local`.

## Testing

- **tsc (`--noEmit`) + eslint** verdes como gate principal.
- **Unit (Vitest)** de los helpers puros: parseo/armado de query de filtros,
  validadores Zod de formularios, y el manejo de errores de `apiFetch` (mockeando
  fetch). No se testean Server Components con I/O real en el MVP.
- E2E (Playwright): **fuera de alcance** del MVP (propuesto para más adelante).

## Fuera de alcance (Fase 2)

- **Canchas**: ABM, precio por hora, activar/desactivar (`POST/PATCH /canchas`).
- **Clientes**: listado y detalle (`GET /clientes`).
- **Config de seña**: editar modo/porcentaje/CBU/alias/titular.
- Dark mode, exportes, auditoría visual (AuditLog), notificaciones.

## Estructura de archivos (orientativa)

```
src/
  app/
    login/page.tsx
    (panel)/
      layout.tsx            # app shell (sidebar + topbar), protegido
      dashboard/page.tsx
      reservas/page.tsx
      reservas/loading.tsx
    layout.tsx              # root (fonts, <Toaster/>)
  middleware.ts             # protección de rutas
  lib/
    api.ts                  # apiFetch (BFF)
    auth.ts                 # login()/logout() server actions, cookie
    types.ts                # tipos de la API (Reserva, Cancha, etc.)
  components/
    ui/                     # shadcn/ui
    reservas/               # tabla, dialogs (nueva/reprogramar), badges
    dashboard/              # cards, charts
```

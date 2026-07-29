# Spec técnica — Configuración del flujo de seña (backend)

- **Fecha:** 2026-06-10
- **Componente:** backend `canchitas-backend` (Node/Express/TS/Prisma/Postgres/Zod)
- **Estado:** Aprobado para planificación
- **Alcance:** solo backend — proveer el monto y los datos de pago de la seña. La verificación del
  comprobante (Gemini Vision) y el envío por WhatsApp son del lado n8n/bot (build posterior).

---

## 1. Objetivo

Que el **backend** sea la fuente de verdad de la seña:
1. Calcula `montoSena` al crear una reserva en estado `ESPERANDO_SENA` (cliente nuevo).
2. Expone los datos de pago (CBU/alias/titular) para que el bot envíe las instrucciones.

Modo de cálculo y datos de pago **configurables por variables de entorno** (sin DB, sin migración).

## 2. Variables de entorno (en `src/config/env.ts`, Zod + defaults)

| Var | Tipo / regla | Default |
|---|---|---|
| `SENA_MODO` | `porcentaje` \| `fijo` | `porcentaje` |
| `SENA_PORCENTAJE` | número entero 0–100 | `50` |
| `SENA_MONTO_FIJO` | número ≥ 0 | `5000` |
| `SENA_CBU` | string | `''` |
| `SENA_ALIAS` | string | `''` |
| `SENA_TITULAR` | string | `''` |

Valores inválidos (porcentaje fuera de 0–100, monto fijo negativo) → falla al bootear (Zod).

## 3. Unidad nueva: `src/services/sena.service.ts`

Una responsabilidad: la política de seña. Lee `getEnv()`.

- `montoParaPrecio(precioHora: number): number`
  - `porcentaje`: `Math.round(precioHora * SENA_PORCENTAJE / 100)`
  - `fijo`: `SENA_MONTO_FIJO`
- `datosPago(): { modo, porcentaje, cbu, alias, titular }`

## 4. Integración en `reservaService.crear`

Al crear, si `estado === 'ESPERANDO_SENA'`:
`montoSena = input.montoSena ?? senaService.montoParaPrecio(Number(cancha.precioHora))`

(Si el bot manda `montoSena`, se respeta; si no, lo calcula el backend.) Para `CONFIRMADA`,
`montoSena = null` (sin cambios respecto a hoy).

La respuesta de `POST /reservas`, cuando es `ESPERANDO_SENA`, incluye además:
`datosPago: { cbu, alias, titular }` (junto al `montoSena` ya presente en la reserva), para que el
bot mande las instrucciones de pago en una sola llamada. Para `CONFIRMADA` no se incluye `datosPago`.

## 5. Endpoint `GET /config/sena`

- Auth: `authAny` (bot vía API key o admin vía JWT).
- Responde: `senaService.datosPago()` → `{ modo, porcentaje, cbu, alias, titular }`.
- Útil para el bot y el futuro panel admin.
- Montado en `src/routes/index.ts` como `apiRouter.use('/config', configRoutes)` con
  `src/routes/config.routes.ts`.

## 6. Errores esperados

- Config inválida → error al iniciar (Zod), formato uniforme no aplica (es boot).
- `GET /config/sena` sin auth → 401 (igual que el resto).

## 7. Testing (TDD)

- **Unit `tests/unit/sena.service.test.ts`** (mock de `../config/env.js`):
  - modo `porcentaje`: 50% de 12000 → 6000; redondeo (50% de 12345 → 6173).
  - modo `fijo`: devuelve `SENA_MONTO_FIJO`.
  - `datosPago()` devuelve los campos del env.
- **Integration `tests/integration/sena.test.ts`** (Testcontainers):
  - `POST /reservas` con `esContacto=false` → `montoSena` computado (6000 para cancha de 12000 al
    50%) y `datosPago` presente en la respuesta.
  - `POST /reservas` con `esContacto=true` → `montoSena` null, sin `datosPago`.
  - `GET /config/sena` (con API key) → devuelve `{ modo, porcentaje, cbu, alias, titular }`.
- El `global-setup.ts` de tests setea los `SENA_*` (modo porcentaje, 50, etc.) para resultados
  deterministas.

## 8. Archivos

- Modificar: `src/config/env.ts`, `src/services/reserva.service.ts`, `src/routes/index.ts`,
  `tests/helpers/global-setup.ts`, `.env.example`, `.env.vm.example`, `DEPLOY-VM.md`.
- Crear: `src/services/sena.service.ts`, `src/routes/config.routes.ts`,
  `tests/unit/sena.service.test.ts`, `tests/integration/sena.test.ts`.

## 9. Despliegue

Cambio compatible hacia atrás (defaults sensatos). Tras merge: `git pull` + rebuild del contenedor
en la VM, y completar `SENA_CBU/ALIAS/TITULAR` (y opcionalmente `SENA_MODO/PORCENTAJE/MONTO_FIJO`) en
el `.env`.

## 10. Deuda técnica aceptada

- Config por env (no editable en runtime). Migrar a tabla de config cuando exista el panel.
- Sin verificación de comprobante ni envío por WhatsApp (lado n8n, build posterior).

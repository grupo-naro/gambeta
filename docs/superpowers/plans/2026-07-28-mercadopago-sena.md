# Mercado Pago — pago de la seña (Sub-proyecto B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al confirmar una reserva online con seña, redirigir a Mercado Pago (Checkout Pro, sandbox); un webhook confirma el pago y pasa la reserva a `CONFIRMADA` sola, con aviso por WhatsApp.

**Architecture:** El backend usa el SDK oficial `mercadopago` para crear una preferencia de pago y validar la firma del webhook. Dos rutas nuevas (`POST /pagos/mercadopago/preferencia`, `POST /webhooks/mercadopago`) reusan `reservaService.aprobarSena` (extendida con un flag `notificar`) para la transición de estado. La web `reservas/` redirige al checkout y agrega dos pantallas de retorno.

**Tech Stack:** Node 22, Express, Prisma 7 + Postgres, Zod, SDK `mercadopago`, vitest + supertest + testcontainers (backend); Next.js 16 + React 19 (app `reservas/`, pnpm).

## Global Constraints

- Checkout Pro (preferencia + redirect), no Checkout API. Credenciales de **sandbox** (`TEST-...`, app `canchas-dev`).
- Al aprobarse el pago (webhook): la reserva pasa a `CONFIRMADA` sola, reusando `reservaService.aprobarSena`.
- La web deja de ofrecer transferencia manual; siempre redirige a Mercado Pago cuando hay seña.
- Preferencia: `items` (título, `unit_price = montoSena`, `currency_id: 'ARS'`), `back_urls` (éxito/pendiente/error), `auto_return: 'approved'`, `external_reference = reservaId`, `notification_url` al backend. Respuesta real verificada: `id`, `init_point`, `sandbox_init_point` (usar este último — credenciales de prueba).
- Firma del webhook: header `x-signature` (`ts=...,v1=...`) + `x-request-id` + `data.id` de la query. Manifest: `id:{data.id};request-id:{x-request-id};ts:{ts};` (si falta `data.id` o `x-request-id`, se omite ese segmento), HMAC-SHA256 hex con `MP_WEBHOOK_SECRET`. Se usa `WebhookSignatureValidator` del SDK oficial.
- Webhook idempotente: si la reserva ya no está `ESPERANDO_SENA` (reintento de MP), responde 200 sin reprocesar. Firma inválida → 401, no se procesa.
- `POST /webhooks/mercadopago` es público (sin `authAny`); se protege solo por firma.
- `POST /pagos/mercadopago/preferencia` usa `authAny` (mismo tipo de auth que ya usan `/reservas` y `/disponibilidad/grilla` desde `reservas/`, header `x-api-key`).
- Si falla la creación de la preferencia, la reserva queda igual registrada (no se bloquea al cliente).
- Tests backend: testcontainers, `x-api-key: 'svc'`. Servicios externos se testean con `vi.spyOn` sobre el service local (mismo patrón que `evolutionService`), no mockeando la red.
- No tocar `ortigoza/`.

---

## Task 1: Backend — modelo, config y repo

**Files:**
- Modify: `backend/prisma/schema.prisma` (+ migración `<ts>_pago_mercadopago`)
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/repositories/pago.repo.ts`
- Modify: `backend/package.json` (dependencia `mercadopago`)

**Interfaces:**
- Produces:
  - `pagoRepo.setPreferencia(reservaId: string, mpPreferenceId: string) → Promise<void>`
  - `pagoRepo.setPago(reservaId: string, mpPaymentId: string) → Promise<void>`
  - Env: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `RESERVAS_PUBLIC_URL`, `BACKEND_PUBLIC_URL` (todas `string`, default `''`).

- [ ] **Step 1: Instalar el SDK**

```bash
cd backend && npm install mercadopago
```
Expected: se agrega `"mercadopago": "^X.Y.Z"` a `dependencies` en `package.json` y se actualiza `package-lock.json`.

- [ ] **Step 2: Agregar los campos al modelo `Pago`**

En `backend/prisma/schema.prisma`, dentro de `model Pago`, agregar (después de `comprobanteUrl`):
```prisma
  mpPreferenceId String?
  mpPaymentId    String?
```

- [ ] **Step 3: Generar la migración**

```bash
docker run -d --name mp-pg -e POSTGRES_USER=canchitas -e POSTGRES_PASSWORD=canchitas -e POSTGRES_DB=canchitas -p 5604:5432 postgres:16-alpine
cd backend && DATABASE_URL=postgresql://canchitas:canchitas@localhost:5604/canchitas?schema=public npx prisma migrate dev --name pago_mercadopago && DATABASE_URL=postgresql://canchitas:canchitas@localhost:5604/canchitas?schema=public npx prisma generate
```
Expected: crea `prisma/migrations/<ts>_pago_mercadopago/migration.sql` (`ALTER TABLE "Pago" ADD COLUMN "mpPreferenceId" TEXT; ADD COLUMN "mpPaymentId" TEXT;`). Dejá `mp-pg` levantado hasta el Step 6; luego `docker rm -f mp-pg`.

- [ ] **Step 4: Agregar las env vars**

En `backend/src/config/env.ts`, dentro del `schema`, agregar (después del grupo `EVOLUTION_*`):
```ts
  MP_ACCESS_TOKEN: z.string().default(''),
  MP_WEBHOOK_SECRET: z.string().default(''),
  RESERVAS_PUBLIC_URL: z.string().default(''),
  BACKEND_PUBLIC_URL: z.string().default(''),
```

- [ ] **Step 5: Agregar los métodos al repo**

En `backend/src/repositories/pago.repo.ts`, agregar dentro de `pagoRepo` (después de `upsertForReserva`):
```ts
  setPreferencia: async (reservaId: string, mpPreferenceId: string): Promise<void> => {
    await prisma.pago.update({ where: { reservaId }, data: { mpPreferenceId } });
  },
  setPago: async (reservaId: string, mpPaymentId: string): Promise<void> => {
    await prisma.pago.update({ where: { reservaId }, data: { mpPaymentId } });
  },
```

- [ ] **Step 6: Verificar que compila**

```bash
cd backend && npx tsc --noEmit
```
Expected: sin errores. Luego `docker rm -f mp-pg`.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/src/config/env.ts backend/src/repositories/pago.repo.ts backend/package.json backend/package-lock.json
git commit -m "feat(pagos): modelo, config y repo para Mercado Pago"
```

---

## Task 2: Backend — `mercadoPago.service.ts`

**Files:**
- Create: `backend/src/services/mercadoPago.service.ts`
- Test: `backend/tests/unit/mercadopago-firma.test.ts`

**Interfaces:**
- Consumes: env vars de Task 1 (`getEnv()`).
- Produces:
  - `mercadoPagoService.crearPreferencia(reserva: { id: string; montoSena: number; canchaNombre: string }) → Promise<{ preferenceId: string; checkoutUrl: string }>`
  - `mercadoPagoService.obtenerPago(paymentId: string) → Promise<{ id: string; status: string; externalReference: string | null; montoAprobado: number }>`
  - `mercadoPagoService.verificarFirma(input: { xSignature: string | undefined; xRequestId: string | undefined; dataId: string | undefined }) → boolean`

- [ ] **Step 1: Crear el service**

`backend/src/services/mercadoPago.service.ts`:
```ts
import { MercadoPagoConfig, Preference, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError } from 'mercadopago';
import { getEnv } from '../config/env.js';
import { Conflict } from '../utils/errors.js';

function client(): MercadoPagoConfig {
  const env = getEnv();
  if (!env.MP_ACCESS_TOKEN) throw Conflict('Mercado Pago no está configurado');
  return new MercadoPagoConfig({ accessToken: env.MP_ACCESS_TOKEN });
}

export const mercadoPagoService = {
  async crearPreferencia(reserva: { id: string; montoSena: number; canchaNombre: string }): Promise<{ preferenceId: string; checkoutUrl: string }> {
    const env = getEnv();
    if (!env.RESERVAS_PUBLIC_URL) throw Conflict('Mercado Pago no está configurado');
    const preference = new Preference(client());
    const result = await preference.create({
      body: {
        items: [
          { id: reserva.id, title: `Seña reserva - ${reserva.canchaNombre}`, quantity: 1, unit_price: reserva.montoSena, currency_id: 'ARS' },
        ],
        back_urls: {
          success: `${env.RESERVAS_PUBLIC_URL}/reservar/pago/exito?external_reference=${reserva.id}`,
          pending: `${env.RESERVAS_PUBLIC_URL}/reservar/pago/pendiente?external_reference=${reserva.id}`,
          failure: `${env.RESERVAS_PUBLIC_URL}/reservar/pago/pendiente?external_reference=${reserva.id}`,
        },
        auto_return: 'approved',
        external_reference: reserva.id,
        notification_url: `${env.BACKEND_PUBLIC_URL}/webhooks/mercadopago`,
      },
    });
    const checkoutUrl = result.sandbox_init_point ?? result.init_point;
    if (!result.id || !checkoutUrl) throw Conflict('Mercado Pago no devolvió una preferencia válida');
    return { preferenceId: result.id, checkoutUrl };
  },

  async obtenerPago(paymentId: string): Promise<{ id: string; status: string; externalReference: string | null; montoAprobado: number }> {
    const payment = new Payment(client());
    const p = await payment.get({ id: paymentId });
    return {
      id: String(p.id),
      status: String(p.status),
      externalReference: p.external_reference ?? null,
      montoAprobado: Number(p.transaction_amount ?? 0),
    };
  },

  verificarFirma(input: { xSignature: string | undefined; xRequestId: string | undefined; dataId: string | undefined }): boolean {
    const env = getEnv();
    if (!env.MP_WEBHOOK_SECRET || !input.xSignature || !input.dataId) return false;
    try {
      WebhookSignatureValidator.validate({
        xSignature: input.xSignature,
        xRequestId: input.xRequestId ?? '',
        dataId: input.dataId,
        secret: env.MP_WEBHOOK_SECRET,
      });
      return true;
    } catch (e) {
      if (e instanceof InvalidWebhookSignatureError) return false;
      throw e;
    }
  },
};
```

> **Nota de implementación:** los nombres exactos de las clases/tipos exportados por el paquete
> `mercadopago` (`MercadoPagoConfig`, `Preference`, `Payment`, `WebhookSignatureValidator`,
> `InvalidWebhookSignatureError`) deben confirmarse contra los tipos reales una vez instalado
> (`node_modules/mercadopago`). El formato de la respuesta de `Preference.create` (`id`,
> `init_point`, `sandbox_init_point`, `external_reference`) ya fue **verificado contra la API
> real** con las credenciales de sandbox del proyecto — ver el Step 3 de este task para repetir
> esa verificación end-to-end con el SDK.

- [ ] **Step 2: Escribir el test de firma (pure, sin red)**

`backend/tests/unit/mercadopago-firma.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { mercadoPagoService } from '../../src/services/mercadoPago.service.js';

const SECRET = 'test-secret';

function firmar(dataId: string, requestId: string, ts: string): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', SECRET).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('mercadoPagoService.verificarFirma', () => {
  beforeEach(() => { process.env.MP_WEBHOOK_SECRET = SECRET; });

  it('acepta una firma válida', () => {
    const ts = String(Date.now());
    const xSignature = firmar('123456', 'req-1', ts);
    const ok = mercadoPagoService.verificarFirma({ xSignature, xRequestId: 'req-1', dataId: '123456' });
    expect(ok).toBe(true);
  });

  it('rechaza una firma con el v1 alterado', () => {
    const ts = String(Date.now());
    const [tsPart] = firmar('123456', 'req-1', ts).split(',');
    const xSignature = `${tsPart},v1=${'0'.repeat(64)}`;
    const ok = mercadoPagoService.verificarFirma({ xSignature, xRequestId: 'req-1', dataId: '123456' });
    expect(ok).toBe(false);
  });

  it('rechaza si el dataId no coincide con el firmado', () => {
    const ts = String(Date.now());
    const xSignature = firmar('123456', 'req-1', ts);
    const ok = mercadoPagoService.verificarFirma({ xSignature, xRequestId: 'req-1', dataId: 'otro-id' });
    expect(ok).toBe(false);
  });

  it('rechaza si falta la firma o el dataId', () => {
    expect(mercadoPagoService.verificarFirma({ xSignature: undefined, xRequestId: 'req-1', dataId: '1' })).toBe(false);
    expect(mercadoPagoService.verificarFirma({ xSignature: 'ts=1,v1=abc', xRequestId: 'req-1', dataId: undefined })).toBe(false);
  });

  it('rechaza si MP_WEBHOOK_SECRET no está configurado', () => {
    process.env.MP_WEBHOOK_SECRET = '';
    const xSignature = firmar('123456', 'req-1', String(Date.now()));
    const ok = mercadoPagoService.verificarFirma({ xSignature, xRequestId: 'req-1', dataId: '123456' });
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 3: Correr el test (y verificar la creación de preferencia contra la API real)**

```bash
cd backend && npm run test:unit -- mercadopago-firma
```
Expected: los 5 casos pasan.

Verificación adicional (una sola vez, manual, no automatizada) para confirmar que el SDK real
funciona igual que la llamada REST ya verificada:
```bash
node -e "
const { MercadoPagoConfig, Preference } = require('mercadopago');
const client = new MercadoPagoConfig({ accessToken: 'TEST-5942728768546324-072712-624ac91a1a5a98ef9b5052870772ba8e-2475900085' });
new Preference(client).create({ body: {
  items: [{ id: 'verif-2', title: 'Verificacion SDK', quantity: 1, unit_price: 100, currency_id: 'ARS' }],
  back_urls: { success: 'https://example.com/s', pending: 'https://example.com/p', failure: 'https://example.com/f' },
  auto_return: 'approved', external_reference: 'verif-sdk-1', notification_url: 'https://example.com/w',
}}).then((r) => console.log(JSON.stringify({ id: r.id, init_point: r.init_point, sandbox_init_point: r.sandbox_init_point }, null, 2)));
"
```
Expected: imprime un JSON con `id`, `init_point` (`https://www.mercadopago.com.ar/checkout/...`) y
`sandbox_init_point` (`https://sandbox.mercadopago.com.ar/checkout/...`). Si algún nombre de campo
sale distinto al usado en `mercadoPago.service.ts`, ajustar el service para que coincida.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/mercadoPago.service.ts backend/tests/unit/mercadopago-firma.test.ts
git commit -m "feat(pagos): mercadoPagoService (crear preferencia, obtener pago, verificar firma)"
```

---

## Task 3: Backend — `aprobarSena` acepta aprobación no-admin con aviso

**Files:**
- Modify: `backend/src/services/reserva.service.ts`
- Test: `backend/tests/integration/aviso-sena-aprobada.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `reservaService.aprobarSena(id: string, by: { adminId?: string; notificar?: boolean }, detalle?: { montoDetectado?: number; comprobanteUrl?: string })` — mismo comportamiento que hoy para `by.adminId`; nuevo: si `by.notificar` es `true` (con o sin `adminId`), también envía el aviso de WhatsApp.

- [ ] **Step 1: Escribir el test (falla primero)**

Agregar al final del `describe('aviso de seña aprobada', ...)` en
`backend/tests/integration/aviso-sena-aprobada.test.ts` (reusa el helper `crear` ya definido en
el archivo):
```ts
  it('aprobación automática (notificar:true, sin adminId) también envía WhatsApp', async () => {
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);
    const r = await crear('5491150000060');
    expect(r.body.estado).toBe('ESPERANDO_SENA');

    const { reservaService } = await import('../../src/services/reserva.service.js');
    const actualizada = await reservaService.aprobarSena(r.body.id, { notificar: true }, {});
    expect(actualizada.estado).toBe('CONFIRMADA');
    expect(spy).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Correr el test (debe fallar)**

```bash
cd backend && npm test -- aviso-sena-aprobada
```
Expected: FALLA el caso nuevo (hoy `notificar` no existe en el tipo/condición, así que no envía).

- [ ] **Step 3: Extender `aprobarSena`**

En `backend/src/services/reserva.service.ts`, dentro de `aprobarSena`:

a) Cambiar la firma:
```ts
  async aprobarSena(
    id: string,
    by: { adminId?: string; notificar?: boolean },
    detalle?: { montoDetectado?: number; comprobanteUrl?: string },
  ) {
```

b) Cambiar la condición del aviso (reemplazar `if (by.adminId) {`):
```ts
    // Aviso al cliente en aprobación manual del admin O cuando el caller pide notificar
    // explícitamente (ej. webhook de Mercado Pago). El bot NO pasa notificar:true porque
    // ya avisa por su cuenta.
    if (by.adminId || by.notificar) {
```
(El resto del bloque —try/catch, `mensajeSenaAprobada`, `evolutionService.enviarWhatsapp`— queda igual.)

- [ ] **Step 4: Correr el test (debe pasar)**

```bash
cd backend && npm test -- aviso-sena-aprobada
```
Expected: pasan los 5 casos (los 4 existentes + el nuevo).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reserva.service.ts backend/tests/integration/aviso-sena-aprobada.test.ts
git commit -m "feat(reservas): aprobarSena acepta notificar:true para aprobaciones no-admin (Mercado Pago)"
```

---

## Task 4: Backend — `POST /pagos/mercadopago/preferencia`

**Files:**
- Create: `backend/src/validators/pago.schema.ts`
- Create: `backend/src/routes/pago.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/mercadopago-preferencia.test.ts`

**Interfaces:**
- Consumes: `mercadoPagoService.crearPreferencia` (Task 2, se mockea con `vi.spyOn` en el test), `pagoRepo.setPreferencia` (Task 1), `reservaService.get` (existente).
- Produces: ruta `POST /pagos/mercadopago/preferencia` `{ reservaId }` → `{ checkoutUrl }`.

- [ ] **Step 1: Crear el validador**

`backend/src/validators/pago.schema.ts`:
```ts
import { z } from 'zod';
const empty = z.looseObject({});

export const crearPreferenciaSchema = z.object({
  body: z.object({ reservaId: z.string().min(1) }),
  query: empty, params: empty,
});
```

- [ ] **Step 2: Escribir el test (falla primero)**

`backend/tests/integration/mercadopago-preferencia.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { mercadoPagoService } from '../../src/services/mercadoPago.service.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaMontoFijo: 5000 } });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 1', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } })).id;
});
const svc = (r: any) => r.set('x-api-key', 'svc');
const fut = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const crearEsperandoSena = () =>
  svc(supertest(app).post('/reservas')).send({ canchaId, whatsapp: '5491150000070', nombreCliente: 'Nuevo', esContacto: false, fecha: fut(), horaInicio: '18:00' });

describe('POST /pagos/mercadopago/preferencia', () => {
  it('crea la preferencia y guarda el mpPreferenceId', async () => {
    vi.spyOn(mercadoPagoService, 'crearPreferencia').mockResolvedValue({ preferenceId: 'pref-1', checkoutUrl: 'https://sandbox.mercadopago.com.ar/checkout/x' });
    const r = await crearEsperandoSena();
    expect(r.body.estado).toBe('ESPERANDO_SENA');

    const res = await svc(supertest(app).post('/pagos/mercadopago/preferencia')).send({ reservaId: r.body.id });
    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toBe('https://sandbox.mercadopago.com.ar/checkout/x');

    const pago = await getPrisma().pago.findUnique({ where: { reservaId: r.body.id } });
    expect(pago!.mpPreferenceId).toBe('pref-1');
  });

  it('reserva inexistente devuelve 404', async () => {
    const res = await svc(supertest(app).post('/pagos/mercadopago/preferencia')).send({ reservaId: 'no-existe' });
    expect(res.status).toBe(404);
  });

  it('reserva que no está ESPERANDO_SENA devuelve 409', async () => {
    const r = await crearEsperandoSena();
    await getPrisma().reserva.update({ where: { id: r.body.id }, data: { estado: 'CONFIRMADA' } });
    const res = await svc(supertest(app).post('/pagos/mercadopago/preferencia')).send({ reservaId: r.body.id });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 3: Correr el test (debe fallar)**

```bash
cd backend && npm test -- mercadopago-preferencia
```
Expected: FALLA (la ruta no existe aún → 404 en todos los casos, incluido el primero).

- [ ] **Step 4: Crear la ruta**

`backend/src/routes/pago.routes.ts`:
```ts
import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authAny } from '../middlewares/authAny.js';
import { crearPreferenciaSchema } from '../validators/pago.schema.js';
import { reservaService } from '../services/reserva.service.js';
import { mercadoPagoService } from '../services/mercadoPago.service.js';
import { pagoRepo } from '../repositories/pago.repo.js';
import { Conflict } from '../utils/errors.js';

export const pagoRoutes = Router();

pagoRoutes.post('/mercadopago/preferencia', authAny, validate(crearPreferenciaSchema), async (req, res, next) => {
  try {
    const { reservaId } = (req as any).valid.body;
    const reserva = await reservaService.get(reservaId);
    if (reserva.estado !== 'ESPERANDO_SENA') throw Conflict('La reserva no está esperando seña');
    const { preferenceId, checkoutUrl } = await mercadoPagoService.crearPreferencia({
      id: reserva.id,
      montoSena: Number(reserva.montoSena),
      canchaNombre: reserva.cancha.nombre,
    });
    await pagoRepo.setPreferencia(reserva.id, preferenceId);
    res.json({ checkoutUrl });
  } catch (e) { next(e); }
});
```

En `backend/src/routes/index.ts`, agregar el import y el `use`:
```ts
import { pagoRoutes } from './pago.routes.js';
// ...
apiRouter.use('/pagos', pagoRoutes);
```

- [ ] **Step 5: Correr el test (debe pasar)**

```bash
cd backend && npm test -- mercadopago-preferencia
```
Expected: pasan los 3 casos.

- [ ] **Step 6: Commit**

```bash
git add backend/src/validators/pago.schema.ts backend/src/routes/pago.routes.ts backend/src/routes/index.ts backend/tests/integration/mercadopago-preferencia.test.ts
git commit -m "feat(pagos): endpoint POST /pagos/mercadopago/preferencia"
```

---

## Task 5: Backend — `POST /webhooks/mercadopago`

**Files:**
- Create: `backend/src/routes/webhook.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/integration/mercadopago-webhook.test.ts`

**Interfaces:**
- Consumes: `mercadoPagoService.verificarFirma`/`obtenerPago` (Task 2, mockeados con `vi.spyOn`), `reservaService.aprobarSena(id, { notificar: true }, { montoDetectado })` (Task 3), `pagoRepo.setPago` (Task 1).
- Produces: ruta pública `POST /webhooks/mercadopago`.

- [ ] **Step 1: Escribir el test (falla primero)**

`backend/tests/integration/mercadopago-webhook.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { mercadoPagoService } from '../../src/services/mercadoPago.service.js';
import { evolutionService } from '../../src/services/evolution.service.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaMontoFijo: 5000 } });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 1', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } })).id;
});
const svc = (r: any) => r.set('x-api-key', 'svc');
const fut = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const crearEsperandoSena = (whatsapp: string) =>
  svc(supertest(app).post('/reservas')).send({ canchaId, whatsapp, nombreCliente: 'Nuevo', esContacto: false, fecha: fut(), horaInicio: '18:00' });

const notif = (dataId: string) =>
  supertest(app).post(`/webhooks/mercadopago?data.id=${dataId}&type=payment`).set('x-signature', 'ts=1,v1=deadbeef').set('x-request-id', 'req-1');

describe('POST /webhooks/mercadopago', () => {
  it('firma inválida devuelve 401 y no toca la reserva', async () => {
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(false);
    const r = await crearEsperandoSena('5491150000080');
    const res = await notif('pago-1');
    expect(res.status).toBe(401);
    const reserva = await getPrisma().reserva.findUnique({ where: { id: r.body.id } });
    expect(reserva!.estado).toBe('ESPERANDO_SENA');
  });

  it('pago aprobado confirma la reserva, guarda mpPaymentId y avisa por WhatsApp', async () => {
    const r = await crearEsperandoSena('5491150000081');
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(true);
    vi.spyOn(mercadoPagoService, 'obtenerPago').mockResolvedValue({ id: 'pago-2', status: 'approved', externalReference: r.body.id, montoAprobado: 5000 });
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);

    const res = await notif('pago-2');
    expect(res.status).toBe(200);

    const reserva = await getPrisma().reserva.findUnique({ where: { id: r.body.id } });
    expect(reserva!.estado).toBe('CONFIRMADA');
    const pago = await getPrisma().pago.findUnique({ where: { reservaId: r.body.id } });
    expect(pago!.mpPaymentId).toBe('pago-2');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('pago no aprobado (pending) no cambia la reserva', async () => {
    const r = await crearEsperandoSena('5491150000082');
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(true);
    vi.spyOn(mercadoPagoService, 'obtenerPago').mockResolvedValue({ id: 'pago-3', status: 'pending', externalReference: r.body.id, montoAprobado: 5000 });

    const res = await notif('pago-3');
    expect(res.status).toBe(200);
    const reserva = await getPrisma().reserva.findUnique({ where: { id: r.body.id } });
    expect(reserva!.estado).toBe('ESPERANDO_SENA');
  });

  it('reintento de un pago ya procesado (reserva ya CONFIRMADA) es idempotente', async () => {
    const r = await crearEsperandoSena('5491150000083');
    vi.spyOn(mercadoPagoService, 'verificarFirma').mockReturnValue(true);
    vi.spyOn(mercadoPagoService, 'obtenerPago').mockResolvedValue({ id: 'pago-4', status: 'approved', externalReference: r.body.id, montoAprobado: 5000 });
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);

    const primero = await notif('pago-4');
    expect(primero.status).toBe(200);
    const segundo = await notif('pago-4');
    expect(segundo.status).toBe(200);

    expect(spy).toHaveBeenCalledTimes(1); // no se reprocesó ni se avisó dos veces
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

```bash
cd backend && npm test -- mercadopago-webhook
```
Expected: FALLA (la ruta no existe aún).

- [ ] **Step 3: Crear la ruta**

`backend/src/routes/webhook.routes.ts`:
```ts
import { Router } from 'express';
import { mercadoPagoService } from '../services/mercadoPago.service.js';
import { reservaService } from '../services/reserva.service.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { pagoRepo } from '../repositories/pago.repo.js';
import { logger } from '../utils/logger.js';

export const webhookRoutes = Router();

webhookRoutes.post('/mercadopago', async (req, res, next) => {
  try {
    const type = (req.query.type ?? req.query.topic) as string | undefined;
    if (type !== 'payment') { res.sendStatus(200); return; }

    const dataId = req.query['data.id'] as string | undefined;
    const xSignature = req.header('x-signature');
    const xRequestId = req.header('x-request-id');

    const firmaOk = mercadoPagoService.verificarFirma({ xSignature, xRequestId, dataId });
    if (!firmaOk) { res.sendStatus(401); return; }

    const pago = await mercadoPagoService.obtenerPago(dataId!);
    if (pago.status !== 'approved') { res.sendStatus(200); return; }
    if (!pago.externalReference) { res.sendStatus(200); return; }

    const reserva = await reservaRepo.findById(pago.externalReference);
    if (!reserva) {
      logger.warn({ reservaId: pago.externalReference }, 'webhook MP: reserva no encontrada');
      res.sendStatus(200);
      return;
    }
    if (reserva.estado !== 'ESPERANDO_SENA') { res.sendStatus(200); return; }

    await reservaService.aprobarSena(reserva.id, { notificar: true }, { montoDetectado: pago.montoAprobado });
    await pagoRepo.setPago(reserva.id, pago.id);
    res.sendStatus(200);
  } catch (e) { next(e); }
});
```

En `backend/src/routes/index.ts`, agregar el import y el `use` (sin `authAny`, es público):
```ts
import { webhookRoutes } from './webhook.routes.js';
// ...
apiRouter.use('/webhooks', webhookRoutes);
```

- [ ] **Step 4: Correr el test (debe pasar)**

```bash
cd backend && npm test -- mercadopago-webhook
```
Expected: pasan los 4 casos.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/webhook.routes.ts backend/src/routes/index.ts backend/tests/integration/mercadopago-webhook.test.ts
git commit -m "feat(pagos): endpoint POST /webhooks/mercadopago (confirma la sena automaticamente)"
```

---

## Task 6: Frontend — redirigir a Mercado Pago + pantallas de retorno

**Files:**
- Modify: `reservas/src/lib/types.ts`
- Modify: `reservas/src/lib/actions.ts`
- Modify: `reservas/src/components/pantalla-reserva.tsx`
- Create: `reservas/src/app/reservar/pago/exito/page.tsx`
- Create: `reservas/src/app/reservar/pago/pendiente/page.tsx`

**Interfaces:**
- Consumes: `POST /pagos/mercadopago/preferencia` (Task 4).
- Produces: `crearPreferenciaPago(reservaId) → Promise<Resultado<{ checkoutUrl: string }>>`.

- [ ] **Step 1: Tipo de resultado**

En `reservas/src/lib/types.ts`, agregar:
```ts
export interface PreferenciaPago { checkoutUrl: string }
```

- [ ] **Step 2: Server action**

En `reservas/src/lib/actions.ts`, agregar (junto a `crearReserva`):
```ts
export async function crearPreferenciaPago(reservaId: string): Promise<Resultado<PreferenciaPago>> {
  try {
    const data = await apiReservas<PreferenciaPago>('/pagos/mercadopago/preferencia', {
      method: 'POST',
      body: JSON.stringify({ reservaId }),
    });
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Error' }; }
}
```
(Ajustar el import de tipos en la parte superior del archivo para sumar `PreferenciaPago`.)

- [ ] **Step 3: Redirigir al confirmar**

En `reservas/src/components/pantalla-reserva.tsx`:

a) Sumar `crearPreferenciaPago` al import de `@/lib/actions`.

b) Reemplazar la función `confirmar` por:
```tsx
  function confirmar() {
    if (!sel) return;
    if (nombre.trim().length < 2) { setErrorForm('Ingresá tu nombre'); return; }
    if (telefono.replace(/\D/g, '').length < 10) { setErrorForm('Ingresá un teléfono válido (10 dígitos)'); return; }
    setErrorForm('');
    start(async () => {
      const r = await crearReserva({ canchaId: sel.canchaId, fecha, horaInicio: sel.hora, nombre: nombre.trim(), telefono });
      if (!r.ok) { setErrorForm(r.error); recargar(); return; }
      const senia = r.data.montoSena == null ? null : Number(r.data.montoSena);
      if (senia != null && senia > 0) {
        const pref = await crearPreferenciaPago(r.data.id);
        if (pref.ok) { window.location.href = pref.data.checkoutUrl; return; }
        // La reserva quedó registrada igual; avisamos que no se pudo generar el link de pago.
        setOk({ senia });
        setErrorForm('Tu reserva quedó registrada, pero no pudimos generar el link de pago. Te contactaremos para coordinarlo.');
        recargar();
        return;
      }
      setOk({ senia });
      recargar();
    });
  }
```

- [ ] **Step 4: Pantalla de éxito**

`reservas/src/app/reservar/pago/exito/page.tsx`:
```tsx
import Link from 'next/link';

export default function PagoExitoPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 p-6 text-center text-neutral-100">
      <div className="text-6xl">✅</div>
      <h1 className="text-2xl font-bold">¡Gracias!</h1>
      <p className="text-neutral-400">Estamos confirmando tu pago. En unos minutos vas a recibir la confirmación por WhatsApp.</p>
      <Link href="/reservar" className="rounded-xl border-2 border-lime-500 px-6 py-3 font-semibold text-lime-400">Hacer otra reserva</Link>
    </main>
  );
}
```

- [ ] **Step 5: Pantalla de pendiente/error con reintento**

`reservas/src/app/reservar/pago/pendiente/page.tsx`:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { crearPreferenciaPago } from '@/lib/actions';

export default function PagoPendientePage() {
  const params = useSearchParams();
  const reservaId = params.get('external_reference');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  function reintentar() {
    if (!reservaId) return;
    setError('');
    start(async () => {
      const r = await crearPreferenciaPago(reservaId);
      if (!r.ok) { setError(r.error); return; }
      window.location.href = r.data.checkoutUrl;
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 p-6 text-center text-neutral-100">
      <div className="text-6xl">⚠️</div>
      <h1 className="text-2xl font-bold">No se completó el pago</h1>
      <p className="text-neutral-400">Tu reserva sigue registrada. Podés reintentar el pago o contactarnos directamente.</p>
      {error && <p className="text-red-400">{error}</p>}
      {reservaId && (
        <button type="button" disabled={pending} onClick={reintentar}
          className="rounded-xl bg-lime-500 px-6 py-3 font-bold text-black disabled:opacity-50">
          {pending ? 'Generando link…' : 'Reintentar pago'}
        </button>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Verificar build**

```bash
cd reservas && pnpm build
```
Expected: compila/typecheck limpio; rutas `/reservar/pago/exito` y `/reservar/pago/pendiente` generadas.

- [ ] **Step 7: Commit**

```bash
git add reservas/src/lib/types.ts reservas/src/lib/actions.ts reservas/src/components/pantalla-reserva.tsx reservas/src/app/reservar/pago
git commit -m "feat(reservas): redirigir a Mercado Pago al confirmar y pantallas de retorno"
```

---

## Notas de cierre

- **Env vars a completar en el deploy** (backend): `MP_ACCESS_TOKEN` (sandbox `TEST-...` de la app
  `canchas-dev`), `MP_WEBHOOK_SECRET` (se obtiene al registrar el webhook), `RESERVAS_PUBLIC_URL`
  (dominio de `reservas/`), `BACKEND_PUBLIC_URL` (dominio público del backend).
- **Registrar el webhook y crear usuarios de prueba** se hace con las tools del MCP de Mercado
  Pago (`save_webhook`, `create_test_user`, `add_money_test_user`) una vez que el endpoint
  `POST /webhooks/mercadopago` esté desplegado y accesible públicamente — son acciones que
  modifican la cuenta de Mercado Pago de forma permanente (los usuarios de prueba no se pueden
  borrar), así que se hacen a propósito, no dentro de un task automatizado.
- **Verificación end-to-end real** (después de mergear y desplegar): registrar el webhook con
  `save_webhook`, loguearse con el usuario de prueba **comprador**, completar una reserva por la
  web, pagar con una tarjeta de prueba, y confirmar que la reserva pasa a `CONFIRMADA` sola.
- El monto mostrado/cobrado es siempre `montoSena` (no el precio total de la cancha).

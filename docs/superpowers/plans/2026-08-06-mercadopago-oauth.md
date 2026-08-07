# Vincular Mercado Pago por OAuth — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño del complejo vincule su cuenta de Mercado Pago desde el panel con un botón, y que las señas vayan a esa cuenta.

**Architecture:** Una aplicación de Mercado Pago (la del desarrollador) pide autorización al vendedor por OAuth. El backend guarda el par de tokens del vendedor cifrado con AES-256-GCM en una tabla propia, los renueva perezosamente serializando por fila, y crea las preferencias con el token del vendedor en vez de con `MP_ACCESS_TOKEN`, que se elimina. Sin cuenta vinculada no se cobra online y la web pública deja de tomar reservas.

**Tech Stack:** Express 5, Prisma 7 (cliente en `src/generated/prisma`, singleton `src/db/prisma.ts`), zod, vitest + Testcontainers, Next.js 16 (panel y web pública), Tailwind v4.

**Diseño de referencia:** `docs/superpowers/specs/2026-08-06-mercadopago-oauth-design.md`

## Global Constraints

- **Código, comentarios y textos de UI en español.** No traducir `cancha`, `seña`, `reserva`, `cuenta`.
- **Nunca importar de `@prisma/client`.** Tipos desde `src/db/client.ts`; runtime desde `src/db/prisma.ts`.
- Errores esperados = factories de `src/utils/errors.ts`. Nunca `Error` crudo.
- Capas en una sola dirección: `routes/ → services/ → repositories/ → db/prisma.ts`.
- **Toda variable de entorno nueva se declara en `backend/docker-compose.vm.yml`.** Ese archivo **enumera** las variables; una que no esté ahí llega vacía al contenedor en silencio. Fue la causa real del bug "no puede generar el enlace de pago".
- Los secretos **nunca** se devuelven en una respuesta HTTP ni se escriben en un log.
- Backend usa **npm**; `frontend/` y `reservas/` usan **pnpm**.
- En `frontend/`, todo export de un archivo `'use server'` debe ser `async function`.
- Tests de integración necesitan Docker. **Correr archivos puntuales, nunca `npm test` entero.**
- Next.js 16 es más nuevo que la mayoría de los datos de entrenamiento: leer las guías en `node_modules/next/dist/docs/` antes de escribir código específico de Next.

---

## Antes de empezar (esto lo hace el humano, no un agente)

Sin esto la Task 3 no se puede probar de punta a punta.

1. Entrar a <https://www.mercadopago.com.ar/developers/panel> con **la cuenta del desarrollador**, no la del complejo.
2. Crear una aplicación. Tipo de solución: **Pagos online**. Producto: **Checkout Pro**.
3. Anotar el **Client ID** y el **Client Secret** de producción.
4. En la aplicación, configurar la **URL de redirección** (redirect URI) apuntando exactamente a:
   `https://<dominio-del-panel>/configuracion/mercadopago/callback`
   Tiene que coincidir carácter por carácter con `PANEL_PUBLIC_URL` + esa ruta, o Mercado Pago rechaza el intercambio.
5. Verificar que el **secreto de webhook** de esa misma aplicación sea el que ya está en `MP_WEBHOOK_SECRET`. Si se creó una aplicación nueva, el secreto cambia y hay que actualizar la variable.
6. Generar la clave de cifrado:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   Guardarla como `MP_ENCRYPTION_KEY`. **Si se pierde, los tokens guardados son irrecuperables y hay que revincular.**

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/src/utils/cripto.ts` (crear) | Cifrar/descifrar un texto con AES-256-GCM. No sabe nada de Mercado Pago. |
| `backend/prisma/schema.prisma` (modificar) | Modelo `MercadoPagoCuenta`, fila única. |
| `backend/src/config/env.ts` (modificar) | `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_ENCRYPTION_KEY`, `PANEL_PUBLIC_URL`. Se va `MP_ACCESS_TOKEN`. |
| `backend/src/repositories/mercadoPagoCuenta.repo.ts` (crear) | Acceso a esa tabla, incluido el bloqueo de fila para renovar. |
| `backend/src/services/mercadoPagoOauth.service.ts` (crear) | El flujo: URL de autorización, `state` firmado, intercambio de código, renovación perezosa, desvinculación, estado para el panel. |
| `backend/src/services/mercadoPago.service.ts` (modificar) | `client()` pasa a usar el token del vendedor. |
| `backend/src/routes/pago.routes.ts` (modificar) | Rutas de vinculación, estado y desvinculación. |
| `backend/src/services/sena.service.ts` (modificar) | `datosPago()` informa si los cobros online están activos. |
| `frontend/src/lib/mercadopago-actions.ts` (crear) | Server actions del panel. |
| `frontend/src/components/config/cuenta-mercadopago.tsx` (crear) | La tarjeta. Molde: `planilla-google.tsx`. |
| `frontend/src/app/(panel)/configuracion/mercadopago/callback/page.tsx` (crear) | Donde vuelve Mercado Pago. |
| `reservas/src/components/pantalla-reserva.tsx` (modificar) | Estado "no se toman reservas online". |

---

### Task 1: Cifrado y modelo de datos

Base para todo lo demás. El cifrado se prueba **sin Docker**.

**Files:**
- Create: `backend/src/utils/cripto.ts`
- Modify: `backend/src/config/env.ts`
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/docker-compose.vm.yml`, `backend/.env.example`
- Test: `backend/tests/unit/cripto.test.ts`

**Interfaces:**
- Produces: `cifrar(texto: string): string` y `descifrar(guardado: string): string` en `src/utils/cripto.ts`.
- Produces: modelo `MercadoPagoCuenta`.
- Produces: `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_ENCRYPTION_KEY`, `PANEL_PUBLIC_URL` en `getEnv()`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/unit/cripto.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';

// La clave se lee de getEnv(), que cachea process.env en la primera llamada.
// Hay que setearla ANTES de importar el módulo.
beforeAll(() => { process.env.MP_ENCRYPTION_KEY = randomBytes(32).toString('base64'); });

describe('cripto', () => {
  it('lo cifrado se puede descifrar', async () => {
    const { cifrar, descifrar } = await import('../../src/utils/cripto.js');
    const secreto = 'APP_USR-1234567890-abcdef';
    expect(descifrar(cifrar(secreto))).toBe(secreto);
  });

  it('dos cifrados del mismo texto dan resultados distintos', async () => {
    const { cifrar } = await import('../../src/utils/cripto.js');
    // Cada cifrado usa un IV nuevo. Si dieran igual, un atacante con la base podría
    // saber que dos filas guardan el mismo token.
    expect(cifrar('mismo')).not.toBe(cifrar('mismo'));
  });

  it('el texto cifrado no contiene el original', async () => {
    const { cifrar } = await import('../../src/utils/cripto.js');
    expect(cifrar('APP_USR-secreto')).not.toContain('APP_USR');
  });

  it('un dato alterado se rechaza en vez de devolver basura', async () => {
    const { cifrar, descifrar } = await import('../../src/utils/cripto.js');
    const guardado = cifrar('APP_USR-secreto');
    const [iv, tag, datos] = guardado.split('.');
    // Se cambia el último carácter del contenido: GCM tiene que detectarlo.
    const alterado = `${iv}.${tag}.${datos.slice(0, -2)}${datos.slice(-2) === 'AA' ? 'AB' : 'AA'}`;
    expect(() => descifrar(alterado)).toThrow();
  });

  it('un formato inválido se rechaza', async () => {
    const { descifrar } = await import('../../src/utils/cripto.js');
    expect(() => descifrar('cualquier-cosa')).toThrow();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/cripto.test.ts`
Expected: FAIL — no existe `src/utils/cripto.ts`.

- [ ] **Step 3: Escribir el módulo de cifrado**

Crear `backend/src/utils/cripto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '../config/env.js';
import { Conflict } from './errors.js';

const ALGORITMO = 'aes-256-gcm';

/**
 * GCM además de cifrar autentica: si alguien edita el dato en la base, `descifrar` falla
 * en vez de devolver basura silenciosamente.
 */
function clave(): Buffer {
  const raw = getEnv().MP_ENCRYPTION_KEY;
  if (!raw) throw Conflict('Falta la variable MP_ENCRYPTION_KEY en el backend');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw Conflict('MP_ENCRYPTION_KEY tiene que ser de 32 bytes en base64');
  return k;
}

/** Devuelve `iv.tag.datos`, los tres en base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12); // 12 bytes es el tamaño recomendado para GCM
  const c = createCipheriv(ALGORITMO, clave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join('.');
}

export function descifrar(guardado: string): string {
  const [ivB64, tagB64, datosB64] = guardado.split('.');
  if (!ivB64 || !tagB64 || !datosB64) throw Conflict('El dato cifrado está corrupto');
  const d = createDecipheriv(ALGORITMO, clave(), Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datosB64, 'base64')), d.final()]).toString('utf8');
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/cripto.test.ts`
Expected: PASS, los 5 casos.

- [ ] **Step 5: Agregar las variables de entorno**

En `backend/src/config/env.ts`, dentro del `schema`: **borrar** la línea de `MP_ACCESS_TOKEN` y agregar

```ts
  MP_CLIENT_ID: z.string().default(''),
  MP_CLIENT_SECRET: z.string().default(''),
  MP_ENCRYPTION_KEY: z.string().default(''),
  PANEL_PUBLIC_URL: z.string().default(''),
```

Todas con `.default('')` como las otras: el backend tiene que arrancar sin ellas y fallar recién cuando se usan, nombrando la que falta. Si `tsc` marca que `MP_ACCESS_TOKEN` sigue usándose en `mercadoPago.service.ts`, dejalo así — lo arregla la Task 3.

En `backend/docker-compose.vm.yml`, en el bloque `environment` del servicio `backend`, agregar las cuatro nuevas y **borrar** `MP_ACCESS_TOKEN`:

```yaml
      MP_CLIENT_ID: ${MP_CLIENT_ID}
      MP_CLIENT_SECRET: ${MP_CLIENT_SECRET}
      MP_ENCRYPTION_KEY: ${MP_ENCRYPTION_KEY}
      PANEL_PUBLIC_URL: ${PANEL_PUBLIC_URL}
```

Hacer lo mismo en `backend/.env.example` (con valores vacíos y un comentario en español de para qué sirve cada una), y revisar si `backend/docker-compose.yml` y `deploy-demo/` también enumeran `MP_ACCESS_TOKEN`; si lo hacen, actualizarlos igual.

- [ ] **Step 6: Agregar el modelo y crear la migración**

En `backend/prisma/schema.prisma`, junto a los demás modelos:

```prisma
/// Fila única (id "default"): la cuenta de Mercado Pago del complejo, vinculada por OAuth.
/// Los tokens se guardan cifrados con AES-256-GCM (ver src/utils/cripto.ts).
model MercadoPagoCuenta {
  id            String   @id @default("default")
  accessToken   String
  refreshToken  String
  venceEn       DateTime
  mpUserId      String
  apodo         String   @default("")
  /// true cuando la renovación falló: el panel lo muestra en rojo y hay que revincular.
  caida         Boolean  @default(false)
  vinculadaEn   DateTime @default(now())
  actualizadoEn DateTime @updatedAt
}
```

Run: `npx prisma migrate dev --name mercadopago_cuenta`

**Si Prisma pide un reset destructivo**, es la deriva ya conocida de la base local (`Cobro.suscripcionId`), no un problema de esta migración: **no aceptar el reset**. Generar el SQL a mano con `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`, revisarlo, y guardarlo como `prisma/migrations/<timestamp>_mercadopago_cuenta/migration.sql`. Avisar en el reporte si pasó esto.

- [ ] **Step 7: Sumar la tabla al reseteo entre tests**

En `backend/tests/helpers/db.ts`, agregar `MercadoPagoCuenta` a `resetTables()`, siguiendo el formato exacto de las demás. Si no se agrega, una vinculación de un test se filtra al siguiente.

- [ ] **Step 8: Verificar**

Run: `npx prisma generate && npm run typecheck 2>&1 | head -20`
Expected: el typecheck puede fallar **solo** en `mercadoPago.service.ts` por `MP_ACCESS_TOKEN`. Cualquier otro error es un problema de este task.

Run: `npx vitest run tests/unit/cripto.test.ts` → PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/utils/cripto.ts backend/tests/unit/cripto.test.ts backend/src/config/env.ts backend/prisma/ backend/docker-compose.vm.yml backend/.env.example backend/tests/helpers/db.ts
git commit -m "feat(pagos): cifrado y modelo para la cuenta de Mercado Pago"
```

---

### Task 2: El servicio de OAuth

El corazón. Todo lo delicado vive acá: el `state` firmado, el intercambio, y la renovación serializada.

**Files:**
- Create: `backend/src/repositories/mercadoPagoCuenta.repo.ts`
- Create: `backend/src/services/mercadoPagoOauth.service.ts`
- Test: `backend/tests/integration/mercadopago-oauth.test.ts`

**Interfaces:**
- Consumes: `cifrar`/`descifrar` (Task 1), modelo `MercadoPagoCuenta` (Task 1).
- Produces, en `mercadoPagoOauthService`:
  - `urlDeAutorizacion(): { url: string; state: string }`
  - `vincular(code: string, state: string): Promise<{ apodo: string }>`
  - `desvincular(): Promise<void>`
  - `estado(): Promise<{ vinculada: boolean; apodo: string | null; venceEn: string | null; caida: boolean }>`
  - `tokenDeAcceso(): Promise<string>` — renueva si hace falta; lanza `Conflict` si no hay cuenta.
  - `cobrosOnlineActivos(): Promise<boolean>`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/tests/integration/mercadopago-oauth.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(async () => {
  process.env.MP_CLIENT_ID = 'app-123';
  process.env.MP_CLIENT_SECRET = 'secreto-app';
  process.env.PANEL_PUBLIC_URL = 'https://panel.test';
  await setupTestDb();
});
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); vi.restoreAllMocks(); });

/** Respuesta típica del endpoint /oauth/token de Mercado Pago. */
const respuestaToken = (over: Partial<Record<string, unknown>> = {}) => ({
  access_token: 'APP_USR-token-vendedor',
  refresh_token: 'TG-refresh-vendedor',
  expires_in: 15552000, // 180 días
  user_id: 987654321,
  ...over,
});

/** Sustituye fetch: ningún test puede pegarle a Mercado Pago de verdad. */
function mockFetch(respuesta: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    text: async () => JSON.stringify(respuesta),
  } as Response);
}

/** Inserta una cuenta ya vinculada que vence dentro de `dias`. */
async function cuentaVinculada(dias: number) {
  const { cifrar } = await import('../../src/utils/cripto.js');
  await getPrisma().mercadoPagoCuenta.create({
    data: {
      id: 'default',
      accessToken: cifrar('APP_USR-viejo'),
      refreshToken: cifrar('TG-viejo'),
      venceEn: new Date(Date.now() + dias * 86400000),
      mpUserId: '987654321',
      apodo: 'COMPLEJO',
    },
  });
}

describe('vincular', () => {
  it('guarda los tokens cifrados: en la base no se leen en claro', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    const { state } = svc.urlDeAutorizacion();
    mockFetch(respuestaToken());

    await svc.vincular('codigo-de-mp', state);

    const fila = await getPrisma().mercadoPagoCuenta.findUniqueOrThrow({ where: { id: 'default' } });
    expect(fila.accessToken).not.toContain('APP_USR-token-vendedor');
    expect(fila.refreshToken).not.toContain('TG-refresh-vendedor');
    expect(fila.mpUserId).toBe('987654321');
    // Y sin embargo el servicio lo devuelve descifrado.
    expect(await svc.tokenDeAcceso()).toBe('APP_USR-token-vendedor');
  });

  it('rechaza un state adulterado y no guarda nada', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    mockFetch(respuestaToken());

    await expect(svc.vincular('codigo-de-mp', 'state-inventado')).rejects.toThrow();
    expect(await getPrisma().mercadoPagoCuenta.findUnique({ where: { id: 'default' } })).toBeNull();
  });

  it('si Mercado Pago rechaza el código, no queda cuenta a medias', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    const { state } = svc.urlDeAutorizacion();
    mockFetch({ error: 'invalid_grant', message: 'El código expiró' }, false);

    await expect(svc.vincular('codigo-vencido', state)).rejects.toThrow();
    expect(await getPrisma().mercadoPagoCuenta.findUnique({ where: { id: 'default' } })).toBeNull();
  });

  it('la URL de autorización lleva offline_access y el redirect del panel', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    const { url } = svc.urlDeAutorizacion();
    // Sin offline_access no hay refresh token y a los 180 días se corta el cobro.
    expect(url).toContain('offline_access');
    expect(url).toContain(encodeURIComponent('https://panel.test/configuracion/mercadopago/callback'));
    expect(url).toContain('app-123');
  });
});

describe('renovación', () => {
  it('un token lejos de vencer NO se renueva', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(100);
    const f = mockFetch(respuestaToken());

    expect(await svc.tokenDeAcceso()).toBe('APP_USR-viejo');
    expect(f).not.toHaveBeenCalled();
  });

  it('un token por vencer se renueva y guarda el par nuevo', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(2); // menos de los 7 días de margen
    mockFetch(respuestaToken({ access_token: 'APP_USR-nuevo', refresh_token: 'TG-nuevo' }));

    expect(await svc.tokenDeAcceso()).toBe('APP_USR-nuevo');

    // El refresh token rota: si no se guarda el nuevo, la próxima renovación falla.
    const { descifrar } = await import('../../src/utils/cripto.js');
    const fila = await getPrisma().mercadoPagoCuenta.findUniqueOrThrow({ where: { id: 'default' } });
    expect(descifrar(fila.refreshToken)).toBe('TG-nuevo');
    expect(fila.venceEn.getTime()).toBeGreaterThan(Date.now() + 170 * 86400000);
  });

  it('dos renovaciones simultáneas no se pisan: una sola llamada a Mercado Pago', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(2);
    const f = mockFetch(respuestaToken({ access_token: 'APP_USR-nuevo', refresh_token: 'TG-nuevo' }));

    // Mercado Pago invalida el refresh token en cada uso. Si las dos renovaran, la segunda
    // usaría un token ya muerto y perderíamos la vinculación entera.
    const [a, b] = await Promise.all([svc.tokenDeAcceso(), svc.tokenDeAcceso()]);

    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toBe('APP_USR-nuevo');
    expect(b).toBe('APP_USR-nuevo');
  });

  it('si la renovación falla, la cuenta queda caída', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(2);
    mockFetch({ error: 'invalid_grant' }, false);

    await expect(svc.tokenDeAcceso()).rejects.toThrow();

    const estado = await svc.estado();
    expect(estado.caida).toBe(true);
    expect(estado.vinculada).toBe(true); // sigue existiendo, pero rota
  });
});

describe('estado y desvinculación', () => {
  it('sin cuenta, no está vinculada y pedir el token falla', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    expect(await svc.cobrosOnlineActivos()).toBe(false);
    expect((await svc.estado()).vinculada).toBe(false);
    await expect(svc.tokenDeAcceso()).rejects.toThrow();
  });

  it('el estado no filtra los tokens', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(100);
    const estado = await svc.estado();
    expect(JSON.stringify(estado)).not.toContain('APP_USR');
    expect(JSON.stringify(estado)).not.toContain('TG-');
    expect(estado.apodo).toBe('COMPLEJO');
  });

  it('desvincular borra la cuenta', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await cuentaVinculada(100);
    await svc.desvincular();
    expect(await svc.cobrosOnlineActivos()).toBe(false);
  });

  it('desvincular sin cuenta no rompe', async () => {
    const svc = (await import('../../src/services/mercadoPagoOauth.service.js')).mercadoPagoOauthService;
    await expect(svc.desvincular()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/integration/mercadopago-oauth.test.ts`
Expected: FAIL — no existe el servicio.

- [ ] **Step 3: Escribir el repositorio**

Crear `backend/src/repositories/mercadoPagoCuenta.repo.ts`:

```ts
import { prisma } from '../db/prisma.js';
import type { Prisma } from '../db/client.js';

const ID = 'default';

export const mercadoPagoCuentaRepo = {
  get: () => prisma.mercadoPagoCuenta.findUnique({ where: { id: ID } }),

  guardar: (datos: { accessToken: string; refreshToken: string; venceEn: Date; mpUserId: string; apodo: string }) =>
    prisma.mercadoPagoCuenta.upsert({
      where: { id: ID },
      create: { id: ID, ...datos, caida: false },
      update: { ...datos, caida: false, vinculadaEn: new Date() },
    }),

  borrar: () => prisma.mercadoPagoCuenta.deleteMany({ where: { id: ID } }),

  marcarCaida: () => prisma.mercadoPagoCuenta.updateMany({ where: { id: ID }, data: { caida: true } }),

  /**
   * Corre `fn` con la fila bloqueada (`FOR UPDATE`), para que dos renovaciones simultáneas
   * se serialicen. La segunda entra recién cuando la primera hizo commit, y ahí ve el token
   * ya renovado y no vuelve a llamar a Mercado Pago.
   *
   * El lock es de base de datos, no del proceso: una bandera en memoria no serviría el día
   * que haya más de un backend, y este es justo el caso donde perder la carrera cuesta la
   * vinculación entera (Mercado Pago invalida el refresh token en cada uso).
   */
  conFilaBloqueada: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MercadoPagoCuenta" WHERE id = ${ID} FOR UPDATE`;
      return fn(tx);
    }),

  actualizarTokens: (
    tx: Prisma.TransactionClient,
    datos: { accessToken: string; refreshToken: string; venceEn: Date },
  ) => tx.mercadoPagoCuenta.update({ where: { id: ID }, data: { ...datos, caida: false } }),

  leerEn: (tx: Prisma.TransactionClient) => tx.mercadoPagoCuenta.findUnique({ where: { id: ID } }),
};
```

- [ ] **Step 4: Escribir el servicio**

Crear `backend/src/services/mercadoPagoOauth.service.ts`:

```ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../config/env.js';
import { cifrar, descifrar } from '../utils/cripto.js';
import { logger } from '../utils/logger.js';
import { BadRequest, Conflict } from '../utils/errors.js';
import { mercadoPagoCuentaRepo } from '../repositories/mercadoPagoCuenta.repo.js';

const AUTORIZACION_URL = 'https://auth.mercadopago.com.ar/authorization';
const TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
const RUTA_CALLBACK = '/configuracion/mercadopago/callback';

/** Margen para renovar antes de vencer. Holgado a propósito: con el complejo cerrado una
 * semana entera, la primera reserva que entre después todavía renueva a tiempo. */
const MARGEN_RENOVACION_MS = 7 * 86400000;
/** Cuánto vale un `state`. Es el tiempo que el dueño tiene para completar el login en MP. */
const STATE_VALIDO_MS = 10 * 60000;

function requerida(nombre: string, valor: string): string {
  if (!valor) throw Conflict(`Mercado Pago no está configurado: falta la variable ${nombre} en el backend`);
  return valor;
}

function redirectUri(): string {
  return `${requerida('PANEL_PUBLIC_URL', getEnv().PANEL_PUBLIC_URL)}${RUTA_CALLBACK}`;
}

/**
 * `state` = `<nonce>.<emitidoEn>.<firma>`, firmado con JWT_SECRET.
 *
 * Sin esto cualquiera puede armar un enlace de callback y vincular SU cuenta al sistema del
 * complejo, quedándose con todas las señas. No hace falta guardarlo en la base: la firma y la
 * marca de tiempo alcanzan para verificar que lo emitimos nosotros y hace poco.
 */
function firmarState(): string {
  const nonce = randomBytes(16).toString('hex');
  const emitido = String(Date.now());
  const firma = createHmac('sha256', getEnv().JWT_SECRET).update(`${nonce}.${emitido}`).digest('hex');
  return `${nonce}.${emitido}.${firma}`;
}

function verificarState(state: string): void {
  const [nonce, emitido, firma] = (state ?? '').split('.');
  if (!nonce || !emitido || !firma) throw BadRequest('La vinculación con Mercado Pago no es válida. Volvé a intentarla.');
  const esperada = createHmac('sha256', getEnv().JWT_SECRET).update(`${nonce}.${emitido}`).digest('hex');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw BadRequest('La vinculación con Mercado Pago no es válida. Volvé a intentarla.');
  }
  if (Date.now() - Number(emitido) > STATE_VALIDO_MS) {
    throw BadRequest('La vinculación tardó demasiado. Volvé a intentarla.');
  }
}

interface RespuestaToken { access_token: string; refresh_token: string; expires_in: number; user_id: number | string }

async function pedirToken(cuerpo: Record<string, string>): Promise<RespuestaToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!res.ok) {
    // El mensaje de MP se muestra tal cual: tragárselo deja al dueño sin saber qué pasó.
    const msg = (datos as { message?: string } | null)?.message ?? 'Mercado Pago rechazó la operación';
    throw Conflict(`Mercado Pago: ${msg}`);
  }
  if (!datos?.access_token || !datos?.refresh_token) throw Conflict('Mercado Pago no devolvió los tokens esperados');
  return datos as RespuestaToken;
}

export const mercadoPagoOauthService = {
  urlDeAutorizacion(): { url: string; state: string } {
    const clientId = requerida('MP_CLIENT_ID', getEnv().MP_CLIENT_ID);
    const state = firmarState();
    const q = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      platform_id: 'mp',
      // offline_access es lo que habilita el refresh token. Sin él, a los 180 días
      // habría que rehacer el flujo a mano.
      scope: 'offline_access read write',
      state,
      redirect_uri: redirectUri(),
    });
    return { url: `${AUTORIZACION_URL}?${q.toString()}`, state };
  },

  async vincular(code: string, state: string): Promise<{ apodo: string }> {
    verificarState(state);
    const env = getEnv();
    const datos = await pedirToken({
      client_id: requerida('MP_CLIENT_ID', env.MP_CLIENT_ID),
      client_secret: requerida('MP_CLIENT_SECRET', env.MP_CLIENT_SECRET),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    });
    const apodo = String(datos.user_id);
    await mercadoPagoCuentaRepo.guardar({
      accessToken: cifrar(datos.access_token),
      refreshToken: cifrar(datos.refresh_token),
      venceEn: new Date(Date.now() + datos.expires_in * 1000),
      mpUserId: String(datos.user_id),
      apodo,
    });
    logger.info({ mpUserId: apodo }, 'cuenta de Mercado Pago vinculada');
    return { apodo };
  },

  async desvincular(): Promise<void> {
    await mercadoPagoCuentaRepo.borrar();
    logger.info('cuenta de Mercado Pago desvinculada');
  },

  async cobrosOnlineActivos(): Promise<boolean> {
    const c = await mercadoPagoCuentaRepo.get();
    return !!c && !c.caida;
  },

  async estado() {
    const c = await mercadoPagoCuentaRepo.get();
    // Devuelve solo lo que el panel necesita mostrar. Nunca los tokens.
    if (!c) return { vinculada: false, apodo: null, venceEn: null, caida: false };
    return { vinculada: true, apodo: c.apodo, venceEn: c.venceEn.toISOString(), caida: c.caida };
  },

  /** Token del vendedor, renovándolo si está por vencer. */
  async tokenDeAcceso(): Promise<string> {
    const actual = await mercadoPagoCuentaRepo.get();
    if (!actual) throw Conflict('No hay una cuenta de Mercado Pago vinculada');
    if (actual.venceEn.getTime() - Date.now() > MARGEN_RENOVACION_MS) return descifrar(actual.accessToken);

    const env = getEnv();
    try {
      return await mercadoPagoCuentaRepo.conFilaBloqueada(async (tx) => {
        // Releer DENTRO del lock: si otra petición ya renovó mientras esperábamos,
        // acá se ve el token nuevo y no se llama a Mercado Pago de nuevo.
        const c = await mercadoPagoCuentaRepo.leerEn(tx);
        if (!c) throw Conflict('No hay una cuenta de Mercado Pago vinculada');
        if (c.venceEn.getTime() - Date.now() > MARGEN_RENOVACION_MS) return descifrar(c.accessToken);

        const datos = await pedirToken({
          client_id: requerida('MP_CLIENT_ID', env.MP_CLIENT_ID),
          client_secret: requerida('MP_CLIENT_SECRET', env.MP_CLIENT_SECRET),
          grant_type: 'refresh_token',
          refresh_token: descifrar(c.refreshToken),
        });
        await mercadoPagoCuentaRepo.actualizarTokens(tx, {
          accessToken: cifrar(datos.access_token),
          refreshToken: cifrar(datos.refresh_token),
          venceEn: new Date(Date.now() + datos.expires_in * 1000),
        });
        logger.info('token de Mercado Pago renovado');
        return datos.access_token;
      });
    } catch (e) {
      // La renovación falló: la cuenta queda caída para que el panel lo muestre en rojo.
      await mercadoPagoCuentaRepo.marcarCaida();
      logger.error({ err: e }, 'falló la renovación del token de Mercado Pago');
      throw e;
    }
  },
};
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/integration/mercadopago-oauth.test.ts`
Expected: PASS, los 11 casos.

Si el test de renovaciones simultáneas es intermitente, **no lo relajes ni le pongas reintentos**: significa que el lock no está haciendo su trabajo y es exactamente el bug que el test existe para atrapar. Reportalo.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repositories/mercadoPagoCuenta.repo.ts backend/src/services/mercadoPagoOauth.service.ts backend/tests/integration/mercadopago-oauth.test.ts
git commit -m "feat(pagos): servicio de vinculacion de Mercado Pago por OAuth"
```

---

### Task 3: Conectarlo al cobro y exponer las rutas

Acá `MP_ACCESS_TOKEN` desaparece de verdad.

**Files:**
- Modify: `backend/src/services/mercadoPago.service.ts`
- Modify: `backend/src/routes/pago.routes.ts`
- Modify: `backend/src/services/sena.service.ts`
- Test: `backend/tests/integration/mercadopago-cuenta-rutas.test.ts`

**Interfaces:**
- Consumes: `mercadoPagoOauthService` (Task 2).
- Produces: `GET /pagos/mercadopago/cuenta`, `POST /pagos/mercadopago/vincular`, `POST /pagos/mercadopago/callback`, `DELETE /pagos/mercadopago/cuenta`.
- Produces: `senaService.datosPago()` suma el campo `cobrosOnline: boolean`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/tests/integration/mercadopago-cuenta-rutas.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
let tokenAdmin: string;

beforeAll(async () => {
  process.env.MP_CLIENT_ID = 'app-123';
  process.env.MP_CLIENT_SECRET = 'secreto-app';
  process.env.PANEL_PUBLIC_URL = 'https://panel.test';
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const admin = await getPrisma().admin.create({
    data: { email: 'admin@test.com', passwordHash: 'x', nombre: 'Admin', rol: 'ADMIN' },
  });
  tokenAdmin = jwt.sign({ sub: admin.id, email: admin.email, rol: 'ADMIN' }, process.env.JWT_SECRET!);
});

describe('rutas de la cuenta de Mercado Pago', () => {
  it('el estado sin cuenta dice que no está vinculada', async () => {
    const res = await supertest(app).get('/pagos/mercadopago/cuenta').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.vinculada).toBe(false);
  });

  it('vincular devuelve la URL de autorización', async () => {
    const res = await supertest(app).post('/pagos/mercadopago/vincular').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('auth.mercadopago.com');
    expect(res.body.url).toContain('offline_access');
  });

  it('sin JWT de admin no se puede tocar nada', async () => {
    // Ojo: la service key NO alcanza. Vincular una cuenta redirige plata.
    expect((await supertest(app).get('/pagos/mercadopago/cuenta').set('x-api-key', 'svc')).status).toBe(401);
    expect((await supertest(app).post('/pagos/mercadopago/vincular').set('x-api-key', 'svc')).status).toBe(401);
    expect((await supertest(app).delete('/pagos/mercadopago/cuenta').set('x-api-key', 'svc')).status).toBe(401);
  });

  it('un state adulterado en el callback devuelve 400', async () => {
    const res = await supertest(app).post('/pagos/mercadopago/callback')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ code: 'x', state: 'inventado' });
    expect(res.status).toBe(400);
  });

  it('crear una preferencia sin cuenta vinculada falla con un mensaje claro', async () => {
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const reserva = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({
      canchaId: cancha.id, whatsapp: '+5491150000000', nombreCliente: 'Juan',
      esContacto: false, fecha: manana, horaInicio: '18:00',
    });
    expect(reserva.status).toBe(201);

    const res = await supertest(app).post('/pagos/mercadopago/preferencia')
      .set('x-api-key', 'svc').send({ reservaId: reserva.body.id });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/cuenta de Mercado Pago/i);
  });

  it('datosPago informa que los cobros online están apagados', async () => {
    const res = await supertest(app).get('/config/sena').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.cobrosOnline).toBe(false);
  });
});
```

**Antes de correrlo:** el `beforeEach` de arriba firma un JWT de admin a mano. Verificá contra
`src/middlewares/authJwt.ts` qué campos espera el payload y contra el modelo `Admin` del schema
qué campos son obligatorios, y ajustá el fixture a lo real — los nombres de arriba son los
esperados pero no están verificados. Si otro test de integración ya firma un JWT de admin,
copiá ese fixture en vez de inventar uno.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/integration/mercadopago-cuenta-rutas.test.ts`
Expected: FAIL — las rutas no existen y `cobrosOnline` no está.

- [ ] **Step 3: Hacer que el cliente de MP use el token del vendedor**

En `backend/src/services/mercadoPago.service.ts`:

- Borrar la función `client()` y reemplazarla por una asíncrona que pide el token al servicio de OAuth:

```ts
async function client(): Promise<MercadoPagoConfig> {
  return new MercadoPagoConfig({ accessToken: await mercadoPagoOauthService.tokenDeAcceso() });
}
```

- Importar `mercadoPagoOauthService` desde `./mercadoPagoOauth.service.js`.
- En `crearPreferencia`: `const preference = new Preference(await client());`
- En `obtenerPago`: `const payment = new Payment(await client());` — **es importante**: el pago pertenece al vendedor, con el token viejo no se podría consultar.
- Borrar de `crearPreferencia` la línea que valida `MP_ACCESS_TOKEN` (ya no existe). Dejar intactas las de `RESERVAS_PUBLIC_URL` y `BACKEND_PUBLIC_URL`.
- **No tocar `verificarFirma`**: el secreto del webhook es de la aplicación, no del vendedor.

Actualizar el comentario del bloque `requerida` para que mencione las variables nuevas en vez de `MP_ACCESS_TOKEN`.

- [ ] **Step 4: Agregar las rutas**

En `backend/src/routes/pago.routes.ts`, agregar (importando `authJwt`, `requireRole`, `auditService`, `mercadoPagoOauthService` y `validate`):

```ts
pagoRoutes.get('/mercadopago/cuenta', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json(await mercadoPagoOauthService.estado()); } catch (e) { next(e); }
});

pagoRoutes.post('/mercadopago/vincular', authJwt, requireRole('ADMIN'), async (_req, res, next) => {
  try { res.json({ url: mercadoPagoOauthService.urlDeAutorizacion().url }); } catch (e) { next(e); }
});

pagoRoutes.post('/mercadopago/callback', authJwt, requireRole('ADMIN'), validate(callbackMpSchema), async (req, res, next) => {
  try {
    const { code, state } = (req as any).valid.body;
    const { apodo } = await mercadoPagoOauthService.vincular(code, state);
    await auditService.log(req, { accion: 'ACTUALIZAR', entidad: 'Config', descripcion: 'Vinculó la cuenta de Mercado Pago' });
    res.json({ apodo });
  } catch (e) { next(e); }
});

pagoRoutes.delete('/mercadopago/cuenta', authJwt, requireRole('ADMIN'), async (req, res, next) => {
  try {
    await mercadoPagoOauthService.desvincular();
    await auditService.log(req, { accion: 'ELIMINAR', entidad: 'Config', descripcion: 'Desvinculó la cuenta de Mercado Pago' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
```

Crear `callbackMpSchema` en `backend/src/validators/pago.schema.ts`, siguiendo el estilo de `crearPreferenciaSchema` que ya está ahí:

```ts
export const callbackMpSchema = z.object({
  body: z.object({ code: z.string().min(1), state: z.string().min(1) }),
});
```

Verificar que `auditService.log` acepte esos valores de `accion` y `entidad`; si el enum no los tiene, usar los que correspondan según cómo lo hace `config.routes.ts`.

- [ ] **Step 5: Informar si los cobros online están activos**

En `backend/src/services/sena.service.ts`, en `datosPago()`:

```ts
  async datosPago(): Promise<DatosPago> {
    const c = await configService.get();
    return {
      modo: 'fijo', porcentaje: c.senaPorcentaje, cbu: c.cbu, alias: c.alias, titular: c.titular,
      // La web pública lo usa para decidir si toma reservas. Sin cuenta vinculada no hay
      // forma de cobrar la seña, así que no se vende online.
      cobrosOnline: await mercadoPagoOauthService.cobrosOnlineActivos(),
    };
  },
```

Agregar `cobrosOnline: boolean` al tipo `DatosPago` donde esté declarado.

- [ ] **Step 6: Correr los tests**

Run: `npx vitest run tests/integration/mercadopago-cuenta-rutas.test.ts tests/integration/mercadopago-oauth.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio (ya no debería quedar ninguna referencia a `MP_ACCESS_TOKEN`).

- [ ] **Step 7: Correr la regresión de pagos**

Run: `npx vitest run tests/integration/mercadopago-webhook.test.ts tests/integration/mercadopago-preferencia.test.ts tests/integration/sena.test.ts`

Expected: estos tests **van a fallar** si esperaban que alcanzara con `MP_ACCESS_TOKEN`. Es el cambio buscado: ahora hace falta una cuenta vinculada. Actualizarlos para que creen una cuenta vinculada de prueba (mismo helper que en `mercadopago-oauth.test.ts`) y dejar constancia en el reporte de cuáles se tocaron y por qué.

Run: `grep -rn "MP_ACCESS_TOKEN" backend/ --include=*.ts --include=*.yml --include=*.example` → no debe quedar nada.

- [ ] **Step 8: Commit**

```bash
git add backend/src
git commit -m "feat(pagos): cobrar con la cuenta vinculada y retirar MP_ACCESS_TOKEN"
```

---

### Task 4: La tarjeta en el panel

**Files:**
- Create: `frontend/src/lib/mercadopago-actions.ts`
- Create: `frontend/src/components/config/cuenta-mercadopago.tsx`
- Create: `frontend/src/app/(panel)/configuracion/mercadopago/callback/page.tsx`
- Modify: `frontend/src/app/(panel)/configuracion/page.tsx`
- Modify: `frontend/src/lib/types.ts`

**Interfaces:**
- Consumes: las rutas de la Task 3.
- Produces: `CuentaMp` en types; `getCuentaMp`, `vincularMp`, `completarVinculacionMp`, `desvincularMp` en actions.

- [ ] **Step 1: Tipos y server actions**

En `frontend/src/lib/types.ts`, junto a `SheetsInfo`:

```ts
export interface CuentaMp { vinculada: boolean; apodo: string | null; venceEn: string | null; caida: boolean }
```

Crear `frontend/src/lib/mercadopago-actions.ts` siguiendo exactamente el molde de `sheets-actions.ts`. **Todo export tiene que ser `async function`** — el compilador de RSC rechaza cualquier otra cosa aunque tsc lo acepte.

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { CuentaMp } from './types';

export async function getCuentaMp(): Promise<CuentaMp> {
  try { return await apiFetch<CuentaMp>('/pagos/mercadopago/cuenta'); }
  catch { return { vinculada: false, apodo: null, venceEn: null, caida: false }; }
}

export async function vincularMp(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const r = await apiFetch<{ url: string }>('/pagos/mercadopago/vincular', { method: 'POST' });
    return { ok: true, url: r.url };
  } catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function completarVinculacionMp(code: string, state: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await apiFetch('/pagos/mercadopago/callback', { method: 'POST', body: JSON.stringify({ code, state }) });
    revalidatePath('/configuracion');
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function desvincularMp(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await apiFetch('/pagos/mercadopago/cuenta', { method: 'DELETE' });
    revalidatePath('/configuracion');
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}
```

- [ ] **Step 2: La tarjeta**

Crear `frontend/src/components/config/cuenta-mercadopago.tsx`, cliente, con el mismo molde visual que `planilla-google.tsx` (mismo `Card`/`CardHeader`/`CardTitle`/`CardContent`, mismos tamaños de texto).

Tiene que cubrir los tres estados:

- **Sin vincular:** explicar en una línea que sin cuenta vinculada la web no toma reservas online, y un botón **Vincular Mercado Pago** que llama a `vincularMp()` y hace `window.location.href = r.url`.
- **Vinculada:** mostrar la cuenta (`apodo`) y hasta cuándo vale la vinculación, formateado en español con el helper de fechas que ya use el panel. **Si faltan menos de 14 días**, un aviso visible de que conviene revincular. Botón **Desvincular**, en el estilo destructivo que ya usa el panel.
- **Caída** (`caida: true`): el mismo bloque pero en rojo, diciendo que se perdió la conexión con Mercado Pago, que **no se están tomando reservas online**, y con el botón principal **Volver a vincular**.

**Desvincular pide confirmación** con el componente de confirmación destructiva que ya existe en el panel (buscar cómo lo hacen otras acciones destructivas y reusar ese componente, no inventar uno). El texto tiene que decir que se cortan los cobros online y que la web deja de tomar reservas hasta volver a vincular.

Errores y éxitos con `toast` de `sonner`, como hace `planilla-google.tsx`.

- [ ] **Step 3: La página de retorno**

Crear `frontend/src/app/(panel)/configuracion/mercadopago/callback/page.tsx`. Server component. Lee `code`, `state` y `error` de los search params.

**Next.js 16:** `searchParams` es una promesa y hay que `await`. Confirmalo en `node_modules/next/dist/docs/` antes de escribir esto.

Comportamiento:
- Si viene `error` (el dueño canceló en Mercado Pago) → redirigir a `/configuracion` sin tocar nada.
- Si faltan `code` o `state` → redirigir a `/configuracion`.
- Si están → llamar `completarVinculacionMp(code, state)` y redirigir a `/configuracion` en los dos casos.

El resultado se comunica con un search param en el destino (por ejemplo `?mp=ok` / `?mp=error`) que la tarjeta lee para mostrar el toast. Si el panel ya tiene un mecanismo para esto, usar ese.

- [ ] **Step 4: Montar la tarjeta**

En `frontend/src/app/(panel)/configuracion/page.tsx`, sumar la carga del estado al `Promise.all` que ya está y renderizar `<CuentaMercadoPago cuenta={cuentaMp} />` **arriba** de `<PlanillaGoogle />`: cobrar es más importante que la planilla.

- [ ] **Step 5: Verificar**

Run: `pnpm lint && pnpm build` desde `frontend/`
Expected: sin errores nuevos. Comparar con el baseline de lint antes de empezar; si sube, es tuyo.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(panel): tarjeta para vincular la cuenta de Mercado Pago"
```

---

### Task 5: La web pública deja de vender sin cuenta vinculada

**Files:**
- Modify: `reservas/src/lib/actions.ts`
- Modify: `reservas/src/components/pantalla-reserva.tsx`
- Modify: `reservas/src/lib/types.ts` (donde estén los tipos de la web)

**Interfaces:**
- Consumes: `GET /config/sena` → `{ ..., cobrosOnline: boolean }` (Task 3).

- [ ] **Step 1: Traer el dato**

En `reservas/src/lib/actions.ts`, agregar una función que consulte `/config/sena` con `apiReservas` y devuelva si los cobros online están activos, con el mismo manejo de errores que las demás funciones del archivo. **Si la consulta falla, devolver `false`**: ante la duda, no vender algo que no se puede cobrar.

- [ ] **Step 2: Cerrar la venta**

En `reservas/src/components/pantalla-reserva.tsx`, cuando los cobros online estén apagados, en lugar de la grilla mostrar un bloque centrado, en el mismo estilo oscuro del resto de la pantalla, que diga que en este momento no se están tomando reservas por la web y que hay que comunicarse para reservar.

**Ojo con el contacto:** `negocio.whatsapp.numero` en `reservas/src/lib/negocio.ts` está **vacío a propósito** y `whatsappUrl()` devuelve `null`. El bloque tiene que funcionar igual sin número: si `whatsappUrl()` da `null`, mostrar el texto sin botón de WhatsApp en vez de un enlace roto. Si hay teléfono cargado en `negocio`, mostrarlo.

No tocar el resto del flujo: cuando `cobrosOnline` es `true` todo funciona exactamente como hoy.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` desde `reservas/`
Expected: limpio.

Verificación visual, en un solo comando que levante y baje el server:
```bash
cd reservas && timeout 25 pnpm dev
```
Abrir la web con el backend sin cuenta vinculada y confirmar que aparece el bloque de "no se toman reservas" y **no** la grilla.

- [ ] **Step 4: Commit**

```bash
git add reservas/src
git commit -m "feat(web): no tomar reservas online sin cuenta de Mercado Pago vinculada"
```

---

## Procedimiento de deploy (leer antes de desplegar)

**El riesgo real no es el código, son las reservas en vuelo.** Toda reserva que esté en
`ESPERANDO_SENA` con una preferencia ya creada apunta a la cuenta vieja. Después del deploy, si
ese cliente paga, la plata cae en la cuenta del desarrollador; el webhook llega, consulta el pago
con el token del vendedor nuevo, Mercado Pago no se lo devuelve, y la reserva se cancela sola a
los 30 minutos. Nadie se entera salvo por el cliente enojado.

Por eso el orden importa:

1. **Esperar a que no queden reservas en `ESPERANDO_SENA`.** Con `SENA_TIMEOUT_MINUTOS` en 30,
   alcanza con media hora sin tráfico — de madrugada es el momento obvio.
2. Cargar las cuatro variables nuevas en el `.env` de la VM. **`PANEL_PUBLIC_URL` tiene que
   coincidir carácter por carácter** con el redirect URI registrado en Mercado Pago.
3. Desplegar.
4. **Entrar al panel y vincular inmediatamente.** Entre el deploy y la vinculación, la web no
   toma reservas: es una caída deliberada del canal de venta, pero hay que hacerla corta.
5. **Hacer un pago real de prueba** y confirmar dos cosas: que la plata entra en la cuenta del
   complejo, y que la reserva pasa sola a `CONFIRMADA` (eso último prueba que la firma del
   webhook valida; si no, buscá `firma inválida` en el log).
6. Revisar el saldo de la cuenta vieja de Mercado Pago los días siguientes, por si entró algo
   de una reserva en vuelo.

**Antes del paso 4, cargar el WhatsApp del complejo** en `reservas/src/lib/negocio.ts`. Hoy está
vacío, así que la pantalla de "no tomamos reservas por la web" —que es justo lo que se ve entre
el deploy y la vinculación— no muestra ningún número ni dirección. Degrada bien, pero deja al
cliente sin salida.

**En el primer pago real, mirar también** que el checkout no sea de sandbox:
`mercadoPago.service.ts` usa `sandbox_init_point ?? init_point`, y con credenciales de
producción del vendedor eso podría mandar a todos los clientes a un checkout de prueba donde no
entra un peso. Es preexistente, pero recién ahora es plata real.

## Notas para el deploy

- **Una migración** (`mercadopago_cuenta`), sin datos que migrar.
- **Cuatro variables nuevas**: `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_ENCRYPTION_KEY`, `PANEL_PUBLIC_URL`. Tienen que estar **en el `.env` de la VM y declaradas en `docker-compose.vm.yml`**. Si están solo en el `.env`, llegan vacías.
- **`MP_ACCESS_TOKEN` se elimina.** Sacarla también del `.env` de la VM para que no quede una credencial viva sin uso.
- **Apenas se despliegue, las reservas online quedan cerradas** hasta que el dueño entre al panel y vincule. Desplegar y vincular seguido, y avisarle antes.
- **`MP_ENCRYPTION_KEY` no se puede perder ni rotar** sin invalidar la vinculación guardada. Si se pierde, hay que revincular a mano. Guardarla donde se guardan los demás secretos del proyecto.

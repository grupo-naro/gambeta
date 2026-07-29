# Aviso automático de seña aprobada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al aprobar la seña manualmente desde el panel, el backend le avise automáticamente al cliente por WhatsApp (vía Evolution) que su turno quedó confirmado.

**Architecture:** Un cliente Evolution nuevo en el backend (`evolution.service.ts`) que manda texto por WhatsApp, best-effort. Se dispara desde `reservaService.aprobarSena` únicamente cuando la aprobación viene de un admin (`by.adminId` presente), no cuando aprueba el bot (que ya avisa por su cuenta). El envío nunca bloquea ni hace fallar la aprobación.

**Tech Stack:** Node 22/24 + Express 5 + TypeScript ESM + Prisma 7 + Postgres · Vitest + Supertest · `fetch` nativo · logger pino (`src/utils/logger.js`).

## Global Constraints

- **NO PUSHEAR.** Commit + merge a `main` **en local**. El usuario pushea. Nunca `git push`.
- Backend es **ESM**: imports internos con extensión `.js` (ej. `import { logger } from '../utils/logger.js'`).
- Backend usa **npm**: `npx vitest run <archivo>`, `npm run typecheck`.
- **El envío es best-effort y NUNCA bloquea ni revierte la aprobación.** Si Evolution está caído o falta config, se loguea y `aprobarSena` igual devuelve la reserva CONFIRMADA.
- **El aviso se manda SOLO cuando `by.adminId` está presente** (aprobación manual del admin). Con aprobación del bot (service key, sin `adminId`) NO se envía.
- El `evolution.service` lee la config de **`process.env` directo en cada llamada** (memoria: `getEnv()` memoiza, así que no sirve para esto; además permite rotar sin reiniciar), igual que `src/utils/serviceAuth.ts`/`buffetAuth.ts`.
- Formato de envío de Evolution (verificado contra el bot): `POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}`, header `apikey: <key>`, body `{ number, text }`. `EVOLUTION_URL` default `http://evolution:8080`.
- El `number` es `r.cliente.whatsapp` tal como está guardado (no re-normalizar).

---

## Task 1: Cliente Evolution + env vars

**Files:**
- Modify: `backend/src/config/env.ts`
- Create: `backend/src/services/evolution.service.ts`
- Modify: `backend/.env.example`
- Test: `backend/tests/unit/evolution.service.test.ts`

**Interfaces:**
- Produces: `evolutionService.enviarWhatsapp(number: string, text: string): Promise<boolean>` — best-effort, nunca lanza; `true` solo si Evolution respondió 2xx.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/unit/evolution.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { evolutionService } from '../../src/services/evolution.service.js';

describe('evolutionService.enviarWhatsapp', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.EVOLUTION_URL = 'http://evo:8080';
    process.env.EVOLUTION_INSTANCE = 'inst';
  });
  afterEach(() => { process.env = { ...OLD }; });

  it('sin API key no envía y devuelve false', async () => {
    process.env.EVOLUTION_API_KEY = '';
    const spy = vi.spyOn(globalThis, 'fetch' as any);
    const ok = await evolutionService.enviarWhatsapp('549110', 'hola');
    expect(ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('con config hace POST a /message/sendText/<instancia> con {number,text} y devuelve true en 2xx', async () => {
    process.env.EVOLUTION_API_KEY = 'k';
    const spy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200 } as any);
    const ok = await evolutionService.enviarWhatsapp('549110', 'hola');
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    const [url, opts] = spy.mock.calls[0] as any;
    expect(url).toBe('http://evo:8080/message/sendText/inst');
    expect(opts.method).toBe('POST');
    expect(opts.headers.apikey).toBe('k');
    expect(JSON.parse(opts.body)).toEqual({ number: '549110', text: 'hola' });
  });

  it('respuesta no-2xx devuelve false', async () => {
    process.env.EVOLUTION_API_KEY = 'k';
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: false, status: 500 } as any);
    await expect(evolutionService.enviarWhatsapp('549110', 'hola')).resolves.toBe(false);
  });

  it('si fetch falla, devuelve false y no lanza', async () => {
    process.env.EVOLUTION_API_KEY = 'k';
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new Error('down'));
    await expect(evolutionService.enviarWhatsapp('549110', 'hola')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/evolution.service.test.ts
```
Expected: FAIL — no existe `../../src/services/evolution.service.js`.

- [ ] **Step 3: Implementar el servicio**

Crear `backend/src/services/evolution.service.ts`:

```ts
import { logger } from '../utils/logger.js';

const TIMEOUT_MS = 8000;

/**
 * Envía un texto por WhatsApp vía Evolution. Best-effort: NUNCA lanza.
 * Lee la config de process.env en cada llamada (permite rotar sin reiniciar
 * y hace testeable el módulo). Si falta la API key o la instancia, no intenta
 * enviar y devuelve false. Devuelve true solo si Evolution respondió 2xx.
 */
export const evolutionService = {
  async enviarWhatsapp(number: string, text: string): Promise<boolean> {
    const base = process.env.EVOLUTION_URL || 'http://evolution:8080';
    const apiKey = process.env.EVOLUTION_API_KEY || '';
    const instance = process.env.EVOLUTION_INSTANCE || '';
    if (!apiKey || !instance) {
      logger.warn('evolution: EVOLUTION_API_KEY/INSTANCE sin configurar, no se envía el WhatsApp');
      return false;
    }
    if (!number) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/message/sendText/${instance}`, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'evolution: envío de WhatsApp devolvió no-2xx');
        return false;
      }
      return true;
    } catch (e) {
      logger.warn({ err: e }, 'evolution: falló el envío de WhatsApp');
      return false;
    } finally {
      clearTimeout(timer);
    }
  },
};
```

- [ ] **Step 4: Agregar las env vars al schema**

En `backend/src/config/env.ts`, dentro del `z.object({ ... })`, agregar (después de `BUFFET_API_KEY`):

```ts
  EVOLUTION_URL: z.string().default('http://evolution:8080'),
  EVOLUTION_API_KEY: z.string().default(''),
  EVOLUTION_INSTANCE: z.string().default(''),
```

(Son opcionales para que el backend arranque igual si faltan; el `evolution.service` igual lee `process.env` directo. Estar en el schema las documenta y valida al boot.)

- [ ] **Step 5: Documentar en `.env.example`**

En `backend/.env.example`, agregar al final:

```
# Evolution (WhatsApp) — para el aviso automático de seña aprobada.
# Deben ser los MISMOS valores que usa el bot en n8n.
EVOLUTION_URL=http://evolution:8080
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=
```

- [ ] **Step 6: Correr el test — debe pasar**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/evolution.service.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 7: Typecheck y commit**

```bash
cd backend
npm run typecheck
git checkout -b feat/aviso-sena-aprobada
git add src/config/env.ts src/services/evolution.service.ts .env.example tests/unit/evolution.service.test.ts
git commit -m "feat(evolution): cliente best-effort para enviar WhatsApp via Evolution"
```

---

## Task 2: Disparar el aviso al aprobar la seña (solo admin)

**Files:**
- Modify: `backend/src/services/reserva.service.ts` (método `aprobarSena`, ~líneas 149-187, + un helper de mensaje)
- Test: `backend/tests/integration/aviso-sena-aprobada.test.ts`

**Interfaces:**
- Consumes: `evolutionService.enviarWhatsapp(number, text)` (Task 1). `reservaService.aprobarSena(id, by, detalle)` ya existe; `by = { adminId?: string }`. La reserva `r = await reservaService.get(id)` incluye `r.cliente.whatsapp`, `r.cancha.nombre`, `r.fechaInicio` (verificado: `findById` incluye `cliente`, `cancha`, `pago`).
- Produces: sin cambios en la firma ni el valor de retorno de `aprobarSena`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/aviso-sena-aprobada.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { evolutionService } from '../../src/services/evolution.service.js';

let app: any; let canchaId: string; let token: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaMontoFijo: 5000 } });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 1', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } })).id;
  const admin = await getPrisma().adminUser.create({ data: { email: 'a@test.com', passwordHash: 'x', nombre: 'A', rol: 'ADMIN' } });
  token = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

const fut = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const crear = (whatsapp: string) =>
  supertest(app).post('/reservas').set('x-api-key', 'svc')
    .send({ canchaId, whatsapp, nombreCliente: 'Nuevo', esContacto: false, fecha: fut(), horaInicio: '18:00' });

describe('aviso de seña aprobada', () => {
  it('aprobación MANUAL (admin) envía WhatsApp al cliente con cancha y hora', async () => {
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);
    const r = await crear('5491150000050');
    expect(r.body.estado).toBe('ESPERANDO_SENA');

    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('authorization', `Bearer ${token}`).send({});
    expect(ap.status).toBe(200);
    expect(ap.body.estado).toBe('CONFIRMADA');

    const cli = await getPrisma().cliente.findFirst();
    expect(spy).toHaveBeenCalledTimes(1);
    const [num, texto] = spy.mock.calls[0];
    expect(num).toBe(cli!.whatsapp); // robusto ante normalización del whatsapp
    expect(texto).toContain('Cancha 1');
    expect(texto).toContain('18:00');
  });

  it('aprobación del BOT (service key) NO envía WhatsApp', async () => {
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);
    const r = await crear('5491150000051');
    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('x-api-key', 'svc').send({});
    expect(ap.status).toBe(200);
    expect(ap.body.estado).toBe('CONFIRMADA');
    expect(spy).not.toHaveBeenCalled();
  });

  it('si el envío falla, la aprobación igual queda CONFIRMADA (best-effort)', async () => {
    vi.spyOn(evolutionService, 'enviarWhatsapp').mockRejectedValue(new Error('evo down'));
    const r = await crear('5491150000052');
    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('authorization', `Bearer ${token}`).send({});
    expect(ap.status).toBe(200);
    expect(ap.body.estado).toBe('CONFIRMADA');
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

```bash
cd backend && npx vitest run tests/integration/aviso-sena-aprobada.test.ts
```
Expected: FAIL — el primer test falla porque `enviarWhatsapp` no se llama (spy con 0 llamadas).

- [ ] **Step 3: Agregar el helper de mensaje + el import**

En `backend/src/services/reserva.service.ts`, agregar el import junto a los demás (arriba del archivo):

```ts
import { evolutionService } from './evolution.service.js';
```

Y una función a nivel de módulo (fuera del objeto `reservaService`, junto a otros helpers del archivo):

```ts
function mensajeSenaAprobada(r: { cancha: { nombre: string }; fechaInicio: Date }, tz: string): string {
  const hora = r.fechaInicio.toLocaleTimeString('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const ymd = r.fechaInicio.toLocaleDateString('en-CA', { timeZone: tz });
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const manana = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: tz });
  let dia: string;
  if (ymd === hoy) dia = 'hoy';
  else if (ymd === manana) dia = 'mañana';
  else {
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const [y, m, d] = ymd.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    dia = `el ${dias[dow]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  }
  return `¡Listo! Confirmamos tu seña ✅. Tu turno de ${r.cancha.nombre} ${dia} a las ${hora} quedó reservado. ¡Te esperamos!`;
}
```

- [ ] **Step 4: Disparar el envío en `aprobarSena`**

En `backend/src/services/reserva.service.ts`, dentro de `aprobarSena`, DESPUÉS de `sheetsSync.marcarSucio(ymdEnTz(r.fechaInicio));` y ANTES de `return result;`, insertar:

```ts
    // Aviso al cliente SOLO en aprobación manual del admin (el bot ya avisa por su cuenta).
    // Fire-and-forget best-effort: enviarWhatsapp nunca lanza; el .catch es defensa extra.
    if (by.adminId) {
      const texto = mensajeSenaAprobada(r, getEnv().TZ_NEGOCIO);
      void evolutionService.enviarWhatsapp(r.cliente.whatsapp, texto).catch(() => {});
    }
```

(`getEnv` ya está importado en el archivo. `r` es el `await reservaService.get(id)` del comienzo de `aprobarSena`, que incluye `cliente` y `cancha`.)

- [ ] **Step 5: Correr los tests — deben pasar**

```bash
cd backend && npx vitest run tests/integration/aviso-sena-aprobada.test.ts tests/integration/aprobar-sena-monto.test.ts
```
Expected: PASS. El archivo nuevo 3/3, y `aprobar-sena-monto` sigue 3/3 (esos usan `x-api-key` = bot, así que no disparan el aviso: confirma que no rompimos nada).

- [ ] **Step 6: Suite completa (chequear que no rompimos nada) + typecheck**

```bash
cd backend && npm run typecheck && npm test
```
Expected: typecheck limpio; suite PASS salvo los **4 fallos preexistentes** (3 en `sena`, 1 en `disponibilidad-tamano`). Cualquier otro fallo es nuestro: arreglarlo.

- [ ] **Step 7: Commit y merge a `main` (SIN PUSH)**

```bash
cd backend
git add src/services/reserva.service.ts tests/integration/aviso-sena-aprobada.test.ts
git commit -m "feat(reservas): avisar al cliente por WhatsApp al aprobar la sena manualmente"
git checkout main
git merge --no-ff feat/aviso-sena-aprobada -m "Merge feat/aviso-sena-aprobada: aviso automatico de sena aprobada"
git log --oneline -1
```

**NO ejecutar `git push`.** Avisar al usuario que al deployar hay que cargar `EVOLUTION_API_KEY` y `EVOLUTION_INSTANCE` en el `.env` de la VM (los mismos valores que usa el bot en n8n); si no, el aviso no se manda pero nada más se rompe.

---

## Cierre: qué queda en manos del usuario

1. **Nada está pusheado.** `main` tiene el merge en local.
2. Al deployar: agregar `EVOLUTION_API_KEY` y `EVOLUTION_INSTANCE` al `.env` de la VM (mismos valores que el bot en n8n). `EVOLUTION_URL` puede quedar en el default `http://evolution:8080`.
3. Probar: aprobar una seña real desde el panel y confirmar que llega el WhatsApp al cliente.

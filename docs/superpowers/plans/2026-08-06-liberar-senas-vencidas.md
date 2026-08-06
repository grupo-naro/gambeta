# Liberar solo las reservas con seña vencida — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el backend cancele por su cuenta las reservas que quedaron en `ESPERANDO_SENA` más de `SENA_TIMEOUT_MINUTOS`, liberando el horario, sin depender de n8n.

**Architecture:** Un intervalo que arranca junto al servidor HTTP (`src/index.ts`, nunca en `buildApp()`) y cada 2 minutos pide las vencidas con `reservaService.vencidasSena()` —que ya existe— y las cancela con `reservaService.rechazarSena()`, el mismo camino que llamaba el workflow de n8n. Antes de eso, `rechazarSena` se vuelve **condicional a nivel base de datos**: solo cancela si la reserva sigue en `ESPERANDO_SENA`, para que el job no pise una seña que el admin acaba de aprobar.

**Tech Stack:** Express 5, Prisma 7 (cliente en `src/generated/prisma`, singleton en `src/db/prisma.ts`), vitest + Testcontainers, pino.

## Global Constraints

- **Código, comentarios y vocabulario en español.** No traducir `cancha`, `seña`, `reserva`, `turno fijo`.
- **Nunca importar de `@prisma/client`.** Los tipos salen de `src/db/client.ts`; el runtime de `src/db/prisma.ts`.
- **Errores esperados = factories de `src/utils/errors.ts`** (`Conflict`, `NotFound`, …), nunca `Error` crudo.
- **El job no debe correr durante los tests.** Arranca solo en `src/index.ts`, jamás dentro de `buildApp()`, que es lo que instancian los tests.
- **Los tests de integración necesitan Docker.** Correr archivos puntuales, no la suite entera.
- El intervalo es una **constante en el código**, no una variable de entorno. Motivo en el diseño: `docker-compose.vm.yml` enumera las variables y una no declarada llega vacía en silencio (fue la causa del bug de Mercado Pago).

**Diseño de referencia:** `docs/superpowers/specs/2026-08-06-liberar-senas-vencidas-design.md`

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/repositories/reserva.repo.ts` (modificar) | Nuevo `cancelarSiEsperandoSena`: cancela `Reserva` **y** `ReservaSector` solo si sigue esperando seña. Espejo exacto del `confirmarSiEsperandoSena` que ya está ahí. |
| `src/services/reserva.service.ts` (modificar) | `rechazarSena` pasa a usarlo y devuelve `null` si perdió la carrera. |
| `src/routes/reserva.routes.ts` (modificar) | Traduce ese `null` a `Conflict` (409). |
| `src/jobs/liberarSenasVencidas.ts` (crear) | El job: qué hace una pasada y cómo se programa. Directorio `jobs/` nuevo. |
| `src/index.ts` (modificar) | Lo arranca junto al servidor. |
| `tests/integration/senas-vencidas.test.ts` (crear) | Cubre la cancelación condicional y la pasada del job. |

---

### Task 1: Cancelación condicional de la seña

Hoy `rechazarSena` llama a `reservaRepo.updateEstado`, que cancela sin mirar el estado actual. `assertTransition` permite `CONFIRMADA → CANCELADA`, así que si el admin aprueba la seña en el instante entre que el job lista las vencidas y las cancela, **el job cancela una reserva ya pagada**. Con una reserva de 30 minutos de antigüedad la ventana es de milisegundos, pero es plata: hay que cerrarla en la base, no con un chequeo previo que tendría el mismo hueco.

La solución es la que el propio repo ya usa para el caso simétrico: un `updateMany` con el estado en el `where`, que en una sola sentencia comprueba y escribe.

**Efecto sobre el panel (deliberado):** rechazar la seña de una reserva que ya está `CONFIRMADA` pasa a devolver 409 en vez de cancelarla. Es lo correcto —para eso está "cancelar"— y hoy que funcione es un bug latente.

**Files:**
- Modify: `backend/src/repositories/reserva.repo.ts` (agregar método junto a `confirmarSiEsperandoSena`, líneas 62-68)
- Modify: `backend/src/services/reserva.service.ts:256-276` (`rechazarSena`)
- Modify: `backend/src/routes/reserva.routes.ts:118-124`
- Test: `backend/tests/integration/senas-vencidas.test.ts`

**Interfaces:**
- Produces: `reservaRepo.cancelarSiEsperandoSena(id: string, tx?: Prisma.TransactionClient): Promise<Reserva | null>`
- Produces: `reservaService.rechazarSena(id: string, by: { adminId?: string }): Promise<Reserva | null>` — **cambia**: antes nunca devolvía `null`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/tests/integration/senas-vencidas.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
let canchaId: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } })).id;
});

// Fecha RELATIVA: `crear()` rechaza reservas en el pasado con 422, así que una fecha
// hardcodeada rompe estos tests en cuanto queda atrás.
const manana = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const body = (over: Partial<any> = {}) => ({
  canchaId,
  whatsapp: '+5491150000000',
  nombreCliente: 'Juan',
  esContacto: false,
  fecha: manana(),
  horaInicio: '18:00',
  ...over,
});

/** Crea una reserva que queda en ESPERANDO_SENA y devuelve su id. */
async function crearEsperandoSena(over: Partial<any> = {}): Promise<string> {
  const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(over));
  expect(res.status).toBe(201);
  expect(res.body.estado).toBe('ESPERANDO_SENA');
  return res.body.id;
}

/**
 * Envejece la reserva más allá de cualquier SENA_TIMEOUT_MINUTOS razonable.
 * `vencidasSena()` filtra por `creadoEn`, que Prisma setea solo al insertar.
 */
async function envejecer(id: string, horas = 24): Promise<void> {
  await getPrisma().reserva.update({
    where: { id },
    data: { creadoEn: new Date(Date.now() - horas * 3600000) },
  });
}

describe('rechazarSena es condicional', () => {
  it('cancela la reserva y libera el horario para otra reserva', async () => {
    const id = await crearEsperandoSena();

    const rechazo = await supertest(app).patch(`/reservas/${id}/rechazar-sena`).set('x-api-key', 'svc');
    expect(rechazo.status).toBe(200);
    expect(rechazo.body.estado).toBe('CANCELADA');

    // La prueba de fondo: que el horario quedó libre. Se verifica reservando de nuevo el
    // mismo slot — si los ReservaSector siguieran ocupados, la restricción de exclusión
    // de Postgres devolvería 409.
    const otra = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body());
    expect(otra.status).toBe(201);
  });

  it('no toca una reserva ya CONFIRMADA: responde 409', async () => {
    const id = await crearEsperandoSena();
    await getPrisma().reserva.update({ where: { id }, data: { estado: 'CONFIRMADA' } });
    await getPrisma().reservaSector.updateMany({ where: { reservaId: id }, data: { estado: 'CONFIRMADA' } });

    const rechazo = await supertest(app).patch(`/reservas/${id}/rechazar-sena`).set('x-api-key', 'svc');
    expect(rechazo.status).toBe(409);

    const despues = await getPrisma().reserva.findUniqueOrThrow({ where: { id } });
    expect(despues.estado).toBe('CONFIRMADA');
  });

  it('rechazar dos veces la misma reserva no rompe: la segunda es 409', async () => {
    const id = await crearEsperandoSena();
    expect((await supertest(app).patch(`/reservas/${id}/rechazar-sena`).set('x-api-key', 'svc')).status).toBe(200);
    expect((await supertest(app).patch(`/reservas/${id}/rechazar-sena`).set('x-api-key', 'svc')).status).toBe(409);
  });
});
```

`envejecer` no se usa todavía — la Task 2 la usa. Dejarla escrita ya evita reabrir el archivo.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/integration/senas-vencidas.test.ts`

Expected: FAIL. El primer caso puede pasar (el comportamiento actual ya cancela), pero **el segundo falla**: hoy `rechazar-sena` sobre una `CONFIRMADA` devuelve 200 y la cancela, cuando se espera 409. El tercero también falla: hoy la segunda llamada devuelve 200.

- [ ] **Step 3: Agregar `cancelarSiEsperandoSena` al repositorio**

En `backend/src/repositories/reserva.repo.ts`, justo debajo de `confirmarSiEsperandoSena`:

```ts
  /**
   * Cancela solo si la reserva sigue esperando seña. El estado va en el `where` del
   * updateMany para que comprobar y escribir sean una sola sentencia: si el admin aprueba
   * la seña en el mismo instante en que el job la da por vencida, gana el que llegue
   * primero y el otro recibe `null` en vez de pisar una reserva ya pagada.
   * Espejo de `confirmarSiEsperandoSena`.
   */
  cancelarSiEsperandoSena: async (id: string, tx?: Prisma.TransactionClient) => {
    const db = tx ?? prisma;
    const { count } = await db.reserva.updateMany({ where: { id, estado: 'ESPERANDO_SENA' }, data: { estado: 'CANCELADA' } });
    if (count !== 1) return null;
    // Sin esto el horario NO se libera: la restricción de exclusión mira ReservaSector.
    await db.reservaSector.updateMany({ where: { reservaId: id }, data: { estado: 'CANCELADA' } });
    return db.reserva.findUniqueOrThrow({ where: { id } });
  },
```

- [ ] **Step 4: Hacer `rechazarSena` condicional**

En `backend/src/services/reserva.service.ts`, reemplazar el cuerpo de `rechazarSena` (líneas 256-276):

```ts
  async rechazarSena(id: string, by: { adminId?: string }) {
    const r = await reservaService.get(id);
    assertTransition(r.estado, 'CANCELADA');
    return prisma.$transaction(async (tx) => {
      // Primero el update condicional: si perdió la carrera contra una aprobación, se corta
      // acá y no se escribe ni el pago rechazado ni la auditoría.
      const updated = await reservaRepo.cancelarSiEsperandoSena(id, tx);
      if (!updated) return null;
      await pagoRepo.upsertForReserva(
        id,
        {
          estado: 'RECHAZADO',
          verificadoPor: by.adminId ? 'HUMANO' : 'IA',
          aprobadoPorId: by.adminId ?? null,
        },
        tx,
      );
      await auditLogRepo.record(
        { adminId: by.adminId ?? null, accion: 'RECHAZAR_SENA', entidad: 'Reserva', entidadId: id, descripcion: 'Rechazó la seña de una reserva' },
        tx,
      );
      return updated;
    });
  },
```

- [ ] **Step 5: Traducir el `null` a 409 en la ruta**

En `backend/src/routes/reserva.routes.ts`, líneas 118-124:

```ts
reservaRoutes.patch('/:id/rechazar-sena', authAny, validate(idParamSchema), async (req, res, next) => {
  try {
    const r = await reservaService.rechazarSena(String(req.params.id), { adminId: adminId(req) });
    // null = ya no estaba esperando seña (la aprobaron o ya se canceló).
    if (!r) throw Conflict('La reserva ya no está esperando la seña');
    res.json(r);
  } catch (e) {
    next(e);
  }
});
```

`Conflict` **no** está importado todavía en ese archivo. Ampliar el import que ya existe en la línea 10:

```ts
import { BusinessRule, Conflict } from '../utils/errors.js';
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/integration/senas-vencidas.test.ts`
Expected: PASS, los 3 casos.

- [ ] **Step 7: Verificar que no se rompió nada alrededor**

Run: `npx vitest run tests/integration/sena.test.ts tests/integration/reserva.test.ts && npm run typecheck`
Expected: PASS. Si algún test existente esperaba que rechazar la seña de una `CONFIRMADA` devolviera 200, es exactamente el comportamiento que este task cambia a propósito: actualizar el test y dejar dicho en el mensaje del commit.

- [ ] **Step 8: Commit**

```bash
git add backend/src/repositories/reserva.repo.ts backend/src/services/reserva.service.ts backend/src/routes/reserva.routes.ts backend/tests/integration/senas-vencidas.test.ts
git commit -m "fix(senas): rechazar la sena solo si sigue esperandola"
```

---

### Task 2: El job que libera las vencidas

Una pasada del job es una función común y corriente, aparte del temporizador: así se la puede llamar desde un test sin esperar dos minutos ni manipular timers.

**Files:**
- Create: `backend/src/jobs/liberarSenasVencidas.ts`
- Test: `backend/tests/integration/senas-vencidas.test.ts` (agregar un `describe`)

**Interfaces:**
- Consumes: `reservaService.rechazarSena(id, by): Promise<Reserva | null>` (Task 1), `reservaService.vencidasSena()` (ya existe).
- Produces: `liberarSenasVencidas(): Promise<number>` — devuelve cuántas liberó.
- Produces: `iniciarJobSenasVencidas(): NodeJS.Timeout`
- Produces: `INTERVALO_MS: number`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `backend/tests/integration/senas-vencidas.test.ts`:

```ts
describe('job de señas vencidas', () => {
  it('cancela la vencida, deja la reciente y libera el horario', async () => {
    const { liberarSenasVencidas } = await import('../../src/jobs/liberarSenasVencidas.js');

    const vieja = await crearEsperandoSena({ horaInicio: '18:00' });
    const reciente = await crearEsperandoSena({ horaInicio: '20:00' });
    await envejecer(vieja);

    expect(await liberarSenasVencidas()).toBe(1);

    const prisma = getPrisma();
    expect((await prisma.reserva.findUniqueOrThrow({ where: { id: vieja } })).estado).toBe('CANCELADA');
    expect((await prisma.reserva.findUniqueOrThrow({ where: { id: reciente } })).estado).toBe('ESPERANDO_SENA');

    // El horario de la vieja quedó vendible otra vez.
    const otra = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ horaInicio: '18:00' }));
    expect(otra.status).toBe(201);
  });

  it('no toca una CONFIRMADA vieja', async () => {
    const { liberarSenasVencidas } = await import('../../src/jobs/liberarSenasVencidas.js');

    const id = await crearEsperandoSena();
    await envejecer(id);
    await getPrisma().reserva.update({ where: { id }, data: { estado: 'CONFIRMADA' } });
    await getPrisma().reservaSector.updateMany({ where: { reservaId: id }, data: { estado: 'CONFIRMADA' } });

    expect(await liberarSenasVencidas()).toBe(0);
    expect((await getPrisma().reserva.findUniqueOrThrow({ where: { id } })).estado).toBe('CONFIRMADA');
  });

  it('correrlo dos veces seguidas es inocuo', async () => {
    const { liberarSenasVencidas } = await import('../../src/jobs/liberarSenasVencidas.js');

    const id = await crearEsperandoSena();
    await envejecer(id);

    expect(await liberarSenasVencidas()).toBe(1);
    expect(await liberarSenasVencidas()).toBe(0);
    expect((await getPrisma().reserva.findUniqueOrThrow({ where: { id } })).estado).toBe('CANCELADA');
  });

  it('sin vencidas no hace nada', async () => {
    const { liberarSenasVencidas } = await import('../../src/jobs/liberarSenasVencidas.js');
    await crearEsperandoSena();
    expect(await liberarSenasVencidas()).toBe(0);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/integration/senas-vencidas.test.ts -t "job de señas vencidas"`
Expected: FAIL — no existe `src/jobs/liberarSenasVencidas.ts`.

- [ ] **Step 3: Escribir el job**

Crear `backend/src/jobs/liberarSenasVencidas.ts`:

```ts
import { reservaService } from '../services/reserva.service.js';
import { logger } from '../utils/logger.js';

/**
 * Cada cuánto se revisa. Con `SENA_TIMEOUT_MINUTOS = 30`, el horario se libera entre los
 * 30 y los 32 minutos.
 *
 * Es una constante a propósito, no una variable de entorno: `SENA_TIMEOUT_MINUTOS` ya es la
 * perilla que decide el negocio, y `docker-compose.vm.yml` enumera las variables una por una
 * —una que no esté declarada ahí llega vacía al contenedor sin avisar, que es exactamente
 * cómo se rompió Mercado Pago—.
 */
export const INTERVALO_MS = 2 * 60 * 1000;

/**
 * Una pasada: cancela las reservas cuya ventana de seña venció y devuelve cuántas liberó.
 *
 * Existe porque Gambeteando no despliega n8n. En canchitas, el workflow
 * `canchitas-timeout-se-a` pegaba a `GET /reservas/vencidas-sena` y después a
 * `PATCH /reservas/:id/rechazar-sena`; acá no hay nada externo que lo haga, y una reserva
 * abandonada en ESPERANDO_SENA sigue bloqueando el horario porque la restricción de
 * exclusión de Postgres la cuenta como ocupada.
 */
export async function liberarSenasVencidas(): Promise<number> {
  const vencidas = await reservaService.vencidasSena();
  let liberadas = 0;
  for (const r of vencidas) {
    try {
      // Sin adminId: queda registrado como verificadoPor 'IA', igual que lo dejaba n8n.
      // Devuelve null si la aprobaron entre el listado y esta línea; ahí no se toca.
      if (await reservaService.rechazarSena(r.id, {})) liberadas++;
    } catch (e) {
      // Una reserva que falla no puede frenar a las demás.
      logger.warn({ err: e, reservaId: r.id }, 'no se pudo liberar una reserva con seña vencida');
    }
  }
  if (liberadas > 0) logger.info({ liberadas }, 'reservas con seña vencida liberadas');
  return liberadas;
}

/**
 * Programa el job. Llamar SOLO desde `index.ts`, nunca desde `buildApp()`: los tests
 * construyen la app y un temporizador cancelando reservas de fondo los volvería intermitentes.
 */
export function iniciarJobSenasVencidas(): NodeJS.Timeout {
  const timer = setInterval(() => {
    liberarSenasVencidas().catch((e) => logger.error({ err: e }, 'falló la pasada del job de señas vencidas'));
  }, INTERVALO_MS);
  timer.unref(); // que no sea el temporizador lo que mantenga vivo al proceso
  return timer;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/integration/senas-vencidas.test.ts`
Expected: PASS, los 7 casos (3 de Task 1 + 4 de este).

- [ ] **Step 5: Commit**

```bash
git add backend/src/jobs/liberarSenasVencidas.ts backend/tests/integration/senas-vencidas.test.ts
git commit -m "feat(senas): job que libera las reservas con sena vencida"
```

---

### Task 3: Arrancar el job con el servidor

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `iniciarJobSenasVencidas()` de `./jobs/liberarSenasVencidas.js` (Task 2).

- [ ] **Step 1: Conectarlo**

Reemplazar el contenido de `backend/src/index.ts`:

```ts
import 'dotenv/config';
import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { iniciarJobSenasVencidas } from './jobs/liberarSenasVencidas.js';
import { logger } from './utils/logger.js';

const env = getEnv();
buildApp().listen(env.PORT, () => logger.info(`API on :${env.PORT}`));

// Acá y no en buildApp(): los tests construyen la app y no deben arrancar temporizadores.
iniciarJobSenasVencidas();
logger.info({ timeoutMin: env.SENA_TIMEOUT_MINUTOS }, 'job de señas vencidas iniciado');
```

- [ ] **Step 2: Verificar que compila y que la suite sigue limpia**

Run: `npm run typecheck && npx vitest run tests/integration/senas-vencidas.test.ts tests/integration/sena.test.ts`
Expected: PASS.

- [ ] **Step 3: Verificar a mano que arranca**

Run: `npm run dev`

Expected: en el log aparece `job de señas vencidas iniciado` junto con `API on :3000`. Cortar el proceso con Ctrl+C **en el mismo comando** (no dejarlo corriendo de fondo).

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(senas): arrancar el job de senas vencidas con el servidor"
```

---

## Notas para el deploy

- **No hay migración.** Nada de esto toca el esquema.
- **No hay variable de entorno nueva.** `SENA_TIMEOUT_MINUTOS=30` ya está declarada en `docker-compose.vm.yml`.
- **La primera pasada en producción puede cancelar varias reservas de golpe**: son las que quedaron colgadas desde siempre, porque nunca hubo nada que las liberara. Es el resultado buscado, pero conviene mirar el log de esa primera corrida y avisarle al complejo antes de desplegar.
- **Cambio de comportamiento en el panel:** rechazar la seña de una reserva ya confirmada ahora devuelve 409 en vez de cancelarla.

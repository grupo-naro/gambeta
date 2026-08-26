# Anticipación máxima de reservas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el sitio público solo pueda reservar dentro de una ventana móvil de N días (default 7), configurable desde el panel, sin limitar al staff.

**Architecture:** Un campo nuevo en el singleton `Configuracion` (`diasAnticipacionMax`). El backend rechaza en `reserva.service.crear` cuando la reserva no la carga un admin, usando aritmética de calendario en `TZ_NEGOCIO`. El valor viaja al sitio público por el `GET /config/sena` que ya se consulta en cada carga, y el calendario recorta los días fuera de ventana en desktop y mobile.

**Tech Stack:** Express 5 + Prisma 7 + zod + vitest/supertest (backend, npm) · Next.js 16 + Tailwind v4 (reservas y frontend, pnpm).

**Spec:** `docs/superpowers/specs/2026-08-26-anticipacion-maxima-reservas-design.md`

## Global Constraints

- **Código, comentarios y vocabulario en español.** No traducir `cancha`, `seña`, `turno fijo`, `anticipación`.
- **Nunca importar de `@prisma/client`.** Tipos vía `src/db/client.js`, runtime vía `src/db/prisma.js`.
- **Toda aritmética de fechas pasa por `src/utils/tz.ts`.** Nunca `new Date(fecha + 'T' + hora)` ni sumar `86400000` a un instante para obtener un día.
- **Errores esperados con las factories de `src/utils/errors.ts`** (`BusinessRule`), nunca `Error` crudo.
- **Nombre del campo, exacto y en todas las capas:** `diasAnticipacionMax`. Default `7`.
- **Semántica de la ventana:** inclusiva en los dos extremos — `hoy .. hoy + diasAnticipacionMax`. Con 7, hoy 26/08 el último día reservable es el 02/09 (8 días distintos).
- **Backend:** `npm`. **reservas/ y frontend/:** `pnpm`.
- Los tests de integración necesitan Docker. Los de `tests/unit` no.

---

### Task 1: Helpers de fecha en `utils/tz.ts`

Los dos helpers que la regla necesita y que hoy no existen. Existe `ymdEnTz` en `services/sheets/sheetsData.ts`, pero es del módulo de Google Sheets y no es de donde una regla de reservas debe sacar aritmética de fechas.

**Files:**
- Modify: `backend/src/utils/tz.ts`
- Test: `backend/tests/unit/tz.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `hoyEnTz(timeZone: string): string` — el día de hoy en esa zona, `"YYYY-MM-DD"`.
  - `sumarDias(date: string, dias: number): string` — suma días de calendario a un `"YYYY-MM-DD"`, devuelve `"YYYY-MM-DD"`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar dentro del `describe('tz', ...)` existente en `backend/tests/unit/tz.test.ts`. Sumar `hoyEnTz, sumarDias` al import de `../../src/utils/tz.js`, y `vi` al import de `vitest`:

```ts
  it('sumarDias hace aritmética de calendario, incluso cruzando de mes', () => {
    expect(sumarDias('2026-08-26', 7)).toBe('2026-09-02');
    expect(sumarDias('2026-12-28', 7)).toBe('2027-01-04');
    expect(sumarDias('2026-02-25', 7)).toBe('2026-03-04');
    expect(sumarDias('2026-08-26', 0)).toBe('2026-08-26');
  });

  it('hoyEnTz devuelve el día local, no el UTC', () => {
    // 2026-08-27T01:30:00Z es todavía el 26 en Buenos Aires (UTC-3). Es exactamente el caso
    // que rompe usar la fecha UTC como si fuera la del negocio.
    //
    // Va con vi.setSystemTime y NO pisando Date.now: en Node `new Date()` lee el reloj interno
    // sin pasar por Date.now(), así que reemplazar Date.now no afectaría a hoyEnTz y el test
    // pasaría por accidente, midiendo el día real de la corrida.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T01:30:00.000Z'));
    try {
      expect(hoyEnTz(TZ)).toBe('2026-08-26');
      expect(hoyEnTz('UTC')).toBe('2026-08-27');
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && npx vitest run tests/unit/tz.test.ts`
Expected: FAIL — `sumarDias is not a function` / `hoyEnTz is not a function`.

- [ ] **Step 3: Implementar**

Agregar al final de `backend/src/utils/tz.ts`:

```ts
/** El día de hoy en la zona del negocio, como "YYYY-MM-DD". */
export function hoyEnTz(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * Suma días de calendario a un "YYYY-MM-DD". Se usa `Date.UTC` a propósito: la fecha es un
 * rótulo sin hora, así que sumarle días en UTC no puede caer en un salto de huso.
 */
export function sumarDias(date: string, dias: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}
```

`hoyEnTz` usa `new Date()` (no `Date.now()`) igual que el resto del archivo; el test stubea `Date.now`, que es lo que `new Date()` consulta internamente en Node.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && npx vitest run tests/unit/tz.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/tz.ts backend/tests/unit/tz.test.ts
git commit -m "feat(tz): helpers hoyEnTz y sumarDias para aritmetica de calendario"
```

---

### Task 2: Campo `diasAnticipacionMax` en `Configuracion`

Schema, migración y validador. Sin regla todavía: esta tarea solo hace que el valor exista, se pueda leer y se pueda editar por la API.

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `Configuracion`, ~línea 296)
- Modify: `backend/src/validators/config.schema.ts`
- Create: `backend/prisma/migrations/<timestamp>_anticipacion_max/migration.sql` (la genera Prisma)
- Test: `backend/tests/integration/config.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `Configuracion.diasAnticipacionMax: number`, legible vía `configService.get()` y escribible con `PATCH /config`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integration/config.test.ts`:

```ts
  it('diasAnticipacionMax arranca en 7 y se puede cambiar por PATCH', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const get = await supertest(app).get('/config').set('authorization', `Bearer ${token}`);
    expect(get.body.diasAnticipacionMax).toBe(7);

    const patch = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ diasAnticipacionMax: 14 });
    expect(patch.status).toBe(200);
    expect(patch.body.diasAnticipacionMax).toBe(14);
  });

  it('diasAnticipacionMax rechaza 0 y valores no enteros', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    expect((await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ diasAnticipacionMax: 0 })).status).toBe(400);
    expect((await supertest(app).patch('/config').set('authorization', `Bearer ${token}`).send({ diasAnticipacionMax: 2.5 })).status).toBe(400);
  });
```

Si el archivo no importa `signAdminToken` o `supertest`, copiar el bloque de imports y el `beforeAll/afterAll/beforeEach` de `backend/tests/integration/reserva.routes.test.ts` (líneas 1-22), que es el patrón del repo.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/config.test.ts`
Expected: FAIL — `expected undefined to be 7`.

- [ ] **Step 3: Agregar el campo al schema**

En `backend/prisma/schema.prisma`, dentro de `model Configuracion`, justo antes de `actualizadoEn`:

```prisma
  /// Cuántos días adelante puede reservar el público. El staff no tiene techo.
  /// La ventana es móvil e inclusiva: hoy .. hoy + este valor.
  diasAnticipacionMax Int      @default(7)
```

- [ ] **Step 4: Generar la migración y el cliente**

Run: `cd backend && npx prisma migrate dev --name anticipacion_max`
Expected: crea `prisma/migrations/<timestamp>_anticipacion_max/` y regenera el cliente en `src/generated/prisma`. El `@default(7)` cubre la fila existente sin backfill.

- [ ] **Step 5: Agregar el campo al validador**

En `backend/src/validators/config.schema.ts`, dentro del `z.object({ ... })` del body, después de `senaMontoFijo`:

```ts
    // min(1) porque 0 dejaría reservar solo el día en curso: apaga el sitio, y es más fácil
    // de conseguir por accidente que a propósito.
    diasAnticipacionMax: z.coerce.number().int().min(1).max(365).optional(),
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/config.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/validators/config.schema.ts backend/tests/integration/config.test.ts
git commit -m "feat(config): campo diasAnticipacionMax en Configuracion"
```

---

### Task 3: Desactivar la mina de los tests existentes

**Hacer esta tarea ANTES de la Task 4.** La regla todavía no existe, así que estos cambios son verdes de entrada — y así la Task 4 no queda mezclada con 15 archivos de churn.

El problema: 14 archivos de test arman la fecha como `new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)`. Eso es la fecha **UTC** de dentro de 7 días, mientras la ventana nueva se calcula en **America/Argentina/Buenos_Aires** (UTC-3). Corriendo la suite entre las 21:00 y las 23:59 ART, esa expresión devuelve el día **8** en horario argentino y cae fuera de la ventana: 14 archivos empiezan a fallar según la hora del día.

Aparte, `reserva.routes.test.ts:141` crea una reserva a **30 días con `x-api-key`**. Con la regla puesta pasaría a dar 422, la reserva no se crearía, y el test seguiría **verde igual** — porque lo único que afirma es que esa fecha *no* aparece en el rango. Un test vacío que se ve sano es peor que uno roto.

**Files:**
- Modify: `backend/tests/integration/agenda-por-deporte.test.ts`
- Modify: `backend/tests/integration/aprobar-sena-monto.test.ts`
- Modify: `backend/tests/integration/aviso-sena-aprobada.test.ts`
- Modify: `backend/tests/integration/cancha-sena.test.ts`
- Modify: `backend/tests/integration/cliente-nombre.test.ts`
- Modify: `backend/tests/integration/cliente.routes.test.ts`
- Modify: `backend/tests/integration/config.test.ts`
- Modify: `backend/tests/integration/disponibilidad-duracion.test.ts`
- Modify: `backend/tests/integration/duracion.test.ts`
- Modify: `backend/tests/integration/mercadopago-preferencia.test.ts`
- Modify: `backend/tests/integration/mercadopago-webhook.test.ts`
- Modify: `backend/tests/integration/reserva-cobro.test.ts`
- Modify: `backend/tests/integration/reserva.routes.test.ts`
- Modify: `backend/tests/integration/reserva.sena.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: nada que otras tareas importen. Deja la suite lista para que la Task 4 no la vuelva dependiente de la hora del día.

- [ ] **Step 1: Ver el estado de partida**

Run: `cd backend && grep -rn "7 \* 86400000" tests/`
Expected: 18 ocurrencias repartidas en los 14 archivos de arriba. Anotar el número.

- [ ] **Step 2: Correr la suite completa y guardar el verde de referencia**

Run: `cd backend && npm test 2>&1 | tail -20`
Expected: PASS. Anotar cuántos tests pasan — es el número que la Task 4 tiene que preservar.

- [ ] **Step 3: Mover las fechas de +7 a +2 días**

Reemplazar en los 14 archivos:

```bash
cd backend && grep -rl "7 \* 86400000" tests/ | xargs sed -i 's/7 \* 86400000/2 * 86400000/g'
```

Dos días deja margen para el corrimiento de ±1 día entre UTC y ART sin acercarse nunca al borde de 7. Ninguno de estos tests trata sobre la anticipación: la fecha es solo "un día futuro cualquiera", y a +2 sigue siéndolo.

Verificar que no quedó ninguna: `grep -rn "7 \* 86400000" tests/` → sin resultados.

- [ ] **Step 4: Arreglar el test del rango, que sí necesita una fecha lejana**

En `backend/tests/integration/reserva.routes.test.ts`, el test `'devuelve reservas dentro del rango y excluye las de afuera'` (~línea 137). El paso 3 le movió `dentro` y `hasta` a +2, lo que además deja a `dentro` justo en el borde del rango consultado. Reemplazar el cuerpo completo del `it` por:

```ts
  it('devuelve reservas dentro del rango y excluye las de afuera', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    // dentro: dentro de 3 días; fuera: dentro de 30 días
    const dentro = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const fuera = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const resDentro = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true, fecha: dentro, horaInicio: '18:00' }));
    // `fuera` va con JWT a propósito: son 30 días de anticipación, y el público está limitado a
    // la ventana de `diasAnticipacionMax`. Con x-api-key esta reserva no se crearía, y el test
    // pasaría en falso: lo único que afirma es que esa fecha NO aparece en el rango.
    const resFuera = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body({ esContacto: true, fecha: fuera, horaInicio: '18:00' }));
    // Se afirma el 201 de las dos: sin esto, un 422 futuro vuelve a vaciar el test en silencio.
    expect(resDentro.status).toBe(201);
    expect(resFuera.status).toBe(201);

    const desde = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const res = await supertest(app).get(`/reservas?desde=${desde}&hasta=${hasta}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const fechas = (res.body as any[]).map((r) => r.fechaInicio.slice(0, 10));
    expect(fechas).toContain(dentro);
    expect(fechas).not.toContain(fuera);
  });
```

Notar que `dentro` vuelve a +3 y `hasta` pasa a +5: el sed del paso 3 los había llevado a +2 a los dos, y con rango `[+1, +2]` la reserva quedaba pegada al borde.

- [ ] **Step 5: Correr la suite y verificar que sigue igual de verde**

Run: `cd backend && npm test 2>&1 | tail -20`
Expected: PASS, con el mismo número de tests del paso 2.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/
git commit -m "test: sacar las fechas de reserva del borde de la ventana de anticipacion"
```

---

### Task 4: La regla en `reserva.service.crear`

**Files:**
- Modify: `backend/src/services/reserva.service.ts` (imports ~línea 14; `crear` líneas 67-96)
- Test: `backend/tests/integration/anticipacion-maxima.test.ts` (crear)

**Interfaces:**
- Consumes: `hoyEnTz`, `sumarDias` (Task 1); `Configuracion.diasAnticipacionMax` (Task 2).
- Produces: `reservaService.crear` lanza `BusinessRule` cuando `!opts.porStaff` y la fecha cae fuera de la ventana. La firma **no cambia**: `opts.porStaff` ya existe y `reserva.routes.ts:30` ya lo calcula como `req.principal?.kind === 'admin'`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/anticipacion-maxima.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hoyEnTz, sumarDias } from '../../src/utils/tz.js';

const TZ = 'America/Argentina/Buenos_Aires';
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
  const c = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
  canchaId = c.id;
});

const body = (fecha: string) => ({
  canchaId, whatsapp: '+5491150000000', nombreCliente: 'Juan',
  esContacto: false, fecha, horaInicio: '18:00', montoSena: 500,
});

const token = () => signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });

describe('anticipación máxima', () => {
  it('el público puede reservar el último día de la ventana', async () => {
    const ultimo = sumarDias(hoyEnTz(TZ), 7);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(ultimo));
    expect(res.status).toBe(201);
  });

  it('el público NO puede reservar un día después de la ventana', async () => {
    const pasado = sumarDias(hoyEnTz(TZ), 8);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(pasado));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('solo se puede reservar hasta');
  });

  it('el staff SÍ puede reservar fuera de la ventana', async () => {
    const lejos = sumarDias(hoyEnTz(TZ), 30);
    const res = await supertest(app).post('/reservas').set('authorization', `Bearer ${token()}`).send(body(lejos));
    expect(res.status).toBe(201);
  });

  it('la ventana se mueve con la configuración, no está hardcodeada', async () => {
    await supertest(app).patch('/config').set('authorization', `Bearer ${token()}`).send({ diasAnticipacionMax: 20 });
    const dia15 = sumarDias(hoyEnTz(TZ), 15);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body(dia15));
    expect(res.status).toBe(201);
  });

  it('el último día de la ventana vale entero, hasta el último turno de la noche', async () => {
    // El bug que rompería una implementación por milisegundos: a las 20:00 de hoy, un corte
    // hecho con Date.now() + 7 días caería a las 20:00 del día 7 y rechazaría este turno.
    const ultimo = sumarDias(hoyEnTz(TZ), 7);
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ ...body(ultimo), horaInicio: '22:00' });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/anticipacion-maxima.test.ts`
Expected: FAIL — el caso "un día después" devuelve 201 en vez de 422.

- [ ] **Step 3: Implementar la regla**

En `backend/src/services/reserva.service.ts`, agregar `hoyEnTz` y `sumarDias` al import de `../utils/tz.js` (línea 14):

```ts
import { combineDateTimeUtc, dayWindowUtc, hhmmAMin, cierreMin, dayOfWeekInTz, hoyEnTz, sumarDias } from '../utils/tz.js';
```

Dentro de `crear`, **mover** el `const cfg = await configService.get();` que hoy está más abajo (justo antes del cálculo de `cierre`) para que quede inmediatamente después de la línea de `fechaFin`, y agregar la regla pegada al chequeo del pasado:

```ts
    const fechaFin = new Date(fechaInicio.getTime() + duracionMin * 60 * 1000);
    const cfg = await configService.get();
    if (fechaInicio.getTime() <= Date.now()) throw BusinessRule('No se puede reservar en el pasado');

    // El público reserva dentro de una ventana móvil; el staff no tiene techo, porque tiene que
    // poder tomar por teléfono una reserva para dentro de un mes. Va pegado al chequeo del pasado
    // a propósito: son la misma pregunta —¿la fecha cae en la ventana permitida?— y separarlos
    // invita a que en un refactor se olvide uno.
    //
    // El límite es una FECHA de calendario, no un instante: con `Date.now() + N días` el último
    // día quedaría partido al medio y los turnos de la noche se rechazarían sin motivo visible.
    if (!opts.porStaff) {
      const limiteYmd = sumarDias(hoyEnTz(tz), cfg.diasAnticipacionMax);
      const finLimite = dayWindowUtc(limiteYmd, tz).end;
      if (fechaInicio >= finLimite) {
        const [, mes, dia] = limiteYmd.split('-');
        throw BusinessRule(`Por ahora solo se puede reservar hasta el ${dia}/${mes}`);
      }
    }
```

Borrar la línea `const cfg = await configService.get();` de su ubicación anterior (queda duplicada si no). El resto del método usa `cfg` igual que antes.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/anticipacion-maxima.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Correr la suite entera — es el paso que importa**

Run: `cd backend && npm test 2>&1 | tail -20`
Expected: PASS, con el número de tests del paso 2 de la Task 3 más los 5 nuevos. Si algo falla acá, es un test que dependía de poder reservar lejos: revisar contra la Task 3 antes de tocar la regla.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/reserva.service.ts backend/tests/integration/anticipacion-maxima.test.ts
git commit -m "feat(reservas): limitar la anticipacion del publico a diasAnticipacionMax"
```

---

### Task 5: Exponer el valor en `GET /config/sena`

El sitio público ya llama a este endpoint en cada carga para saber si hay métodos de pago. El campo viaja ahí: no hace falta ningún endpoint nuevo.

**Files:**
- Modify: `backend/src/services/sena.service.ts` (interface `DatosPago` líneas 6-19; `datosPago()` líneas 32-50)
- Test: `backend/tests/integration/config-sena-datos-pago.test.ts`

**Interfaces:**
- Consumes: `Configuracion.diasAnticipacionMax` (Task 2).
- Produces: `GET /config/sena` devuelve `diasAnticipacionMax: number` dentro del mismo objeto que ya trae `cobrosOnline`, `transferenciaDisponible` y `senaTimeoutMinutos`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integration/config-sena-datos-pago.test.ts`, dentro del `describe` existente:

```ts
  it('expone diasAnticipacionMax para que el sitio público recorte el calendario', async () => {
    const res = await supertest(app).get('/config/sena').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.diasAnticipacionMax).toBe(7);
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx vitest run tests/integration/config-sena-datos-pago.test.ts`
Expected: FAIL — `expected undefined to be 7`.

- [ ] **Step 3: Implementar**

En `backend/src/services/sena.service.ts`, agregar al final de la interface `DatosPago`:

```ts
  /** Cuántos días adelante puede reservar el público. El sitio recorta el calendario con esto. */
  diasAnticipacionMax: number;
```

Y al objeto que devuelve `datosPago()`, después de `senaTimeoutMinutos`:

```ts
      diasAnticipacionMax: c.diasAnticipacionMax,
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npx vitest run tests/integration/config-sena-datos-pago.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/sena.service.ts backend/tests/integration/config-sena-datos-pago.test.ts
git commit -m "feat(config): /config/sena expone diasAnticipacionMax"
```

---

### Task 6: El sitio de reservas recibe el valor

Solo el transporte del dato hasta `PantallaReserva`. El recorte visual es la Task 7.

**Files:**
- Modify: `reservas/src/lib/types.ts` (interface `MetodosPago`, líneas 29-37)
- Modify: `reservas/src/lib/actions.ts` (`getMetodosPago`, líneas 24-47)

**Interfaces:**
- Consumes: `GET /config/sena` con `diasAnticipacionMax` (Task 5).
- Produces: `MetodosPago.diasAnticipacionMax: number`, siempre presente. Lo consume la Task 7.

- [ ] **Step 1: Agregar el campo al tipo**

En `reservas/src/lib/types.ts`, al final de `interface MetodosPago`:

```ts
  /** Cuántos días adelante se puede reservar, contando hoy como día 0. */
  diasAnticipacionMax: number;
```

- [ ] **Step 2: Leerlo, con default**

En `reservas/src/lib/actions.ts`, junto a `SENA_TIMEOUT_MINUTOS_DEFAULT` (línea 7):

```ts
const DIAS_ANTICIPACION_DEFAULT = 7;
```

En el objeto `vacio` (línea 27), agregar `diasAnticipacionMax: DIAS_ANTICIPACION_DEFAULT`. En el tipo genérico de `apiReservas<...>` agregar `diasAnticipacionMax?: number`. Y en el `return` del `try`:

```ts
      // Default 7 y no 0: si el backend no contesta o es viejo, el sitio se cae a la ventana
      // esperada en vez de apagar el calendario entero.
      diasAnticipacionMax: d.diasAnticipacionMax ?? DIAS_ANTICIPACION_DEFAULT,
```

- [ ] **Step 3: Verificar que compila**

Run: `cd reservas && pnpm build`
Expected: `✓ Compiled successfully` y `Finished TypeScript`. Si el build se queja de tipos generados obsoletos, borrar `.next` y repetir.

- [ ] **Step 4: Commit**

```bash
git add reservas/src/lib/types.ts reservas/src/lib/actions.ts
git commit -m "feat(reservas): el sitio recibe diasAnticipacionMax del backend"
```

---

### Task 7: Recortar el calendario del sitio público

**Files:**
- Modify: `reservas/src/components/calendario.tsx`
- Modify: `reservas/src/components/selector-fecha-mobile.tsx`
- Modify: `reservas/src/components/pantalla-reserva.tsx`

`reservas/src/app/page.tsx` **no se toca**: ya le pasa el objeto `metodos` entero a `PantallaReserva`, así que el campo nuevo llega solo.

**Interfaces:**
- Consumes: `MetodosPago.diasAnticipacionMax` (Task 6).
- Produces: nada que otras tareas importen. `Calendario` pasa a aceptar `max?: string`; `SelectorFechaMobile` pasa a aceptar `min: string` y `max: string`.

- [ ] **Step 1: `Calendario` acepta `max`**

En `reservas/src/components/calendario.tsx`, cambiar la firma y el cálculo de `deshab`:

```tsx
export function Calendario({ value, onChange, min, max }: { value: string; onChange: (fecha: string) => void; min?: string; max?: string }) {
```

```tsx
          const deshab = (min ? fecha < min : false) || (max ? fecha > max : false);
```

Y cortar la navegación de mes, para que nadie llegue a un mes entero en gris. Después de `const semanas = ...`:

```tsx
  // Si el mes de al lado cae entero fuera de la ventana, se apaga la flecha: navegar hasta un
  // mes con 31 días grises es peor que no poder navegar.
  const primeroDelMes = iso(vista.anio, vista.mes0, 1);
  const ultimoDelMes = iso(vista.anio, vista.mes0, new Date(vista.anio, vista.mes0 + 1, 0).getDate());
  const hayAnterior = !min || primeroDelMes > min;
  const haySiguiente = !max || ultimoDelMes < max;
```

Aplicar a los dos botones, con el mismo tratamiento visual que las celdas deshabilitadas:

```tsx
        <button type="button" disabled={!hayAnterior} onClick={() => cambiarMes(-1)} aria-label="Mes anterior" className="px-3 py-1 text-lg text-neutral-400 hover:text-white disabled:text-neutral-700 disabled:hover:text-neutral-700">‹</button>
```

```tsx
        <button type="button" disabled={!haySiguiente} onClick={() => cambiarMes(1)} aria-label="Mes siguiente" className="px-3 py-1 text-lg text-neutral-400 hover:text-white disabled:text-neutral-700 disabled:hover:text-neutral-700">›</button>
```

- [ ] **Step 2: `SelectorFechaMobile` lista solo la ventana**

En `reservas/src/components/selector-fecha-mobile.tsx`, reemplazar el cuerpo del componente. Hoy arma dos meses completos con pastillas de mes; pasa a armar la lista de días de la ventana, que con 7 son 8 chips:

```tsx
export function SelectorFechaMobile({ value, onChange, min, max }: { value: string; onChange: (fecha: string) => void; min: string; max: string }) {
  // La ventana es corta (8 días con el default), así que se listan los días uno por uno y se
  // dejan de lado las pastillas de mes: con este rango no hay nada que elegir a nivel mes.
  const dias: string[] = [];
  for (let f = min; f <= max; ) {
    dias.push(f);
    const [y, m, d] = f.split('-').map(Number);
    f = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {dias.map((fecha) => {
        const [y, m, d] = fecha.split('-').map(Number);
        const sel = fecha === value;
        const dow = DIA_SEM[new Date(y, m - 1, d).getDay()];
        return (
          <button key={fecha} type="button" onClick={() => onChange(fecha)}
            className={`flex min-w-[64px] flex-col items-center rounded-xl px-3 py-2 ${sel ? 'bg-lime-500 text-black' : 'bg-neutral-900 text-neutral-300'}`}>
            <span className="text-xs uppercase">{MESES[m - 1].slice(0, 3)}</span>
            <span className="text-lg font-bold tabular-nums">{d}</span>
            <span className="text-xs uppercase">{dow}</span>
          </button>
        );
      })}
    </div>
  );
}
```

Quedan sin uso `useState`, `pad`, `iso` y `hoyISO` en ese archivo: borrar esos imports y constantes para que `pnpm lint` no marque nada. `MESES` y `DIA_SEM` se siguen usando.

- [ ] **Step 3: `PantallaReserva` calcula la ventana y la pasa**

En `reservas/src/components/pantalla-reserva.tsx`, junto a los otros helpers de arriba del archivo:

```tsx
const sumarDiasISO = (fecha: string, dias: number) => {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
};
```

Dentro del componente, después de `const [fecha, setFecha] = useState(hoyISO());`:

```tsx
  const hoy = hoyISO();
  const maxFecha = sumarDiasISO(hoy, metodos.diasAnticipacionMax);
```

Y antes del `useEffect` que pide la grilla, corregir una fecha que quedó fuera de ventana — pasa con la pestaña abierta de un día para el otro:

```tsx
  // Con la pestaña abierta cruzando la medianoche, `fecha` puede quedar fuera de la ventana.
  // Se corrige antes de pedir la grilla: si no, el cliente elige un turno que el backend va a
  // rechazar recién al confirmar.
  useEffect(() => {
    if (fecha < hoy || fecha > maxFecha) setFecha(hoy);
  }, [fecha, hoy, maxFecha]);
```

Pasar la ventana a los dos selectores:

```tsx
          <Calendario value={fecha} onChange={setFecha} min={hoy} max={maxFecha} />
```

```tsx
        <SelectorFechaMobile value={fecha} onChange={setFecha} min={hoy} max={maxFecha} />
```

Reemplazar también los `min={hoyISO()}` que hubiera, para no recalcular la fecha en cada render.

- [ ] **Step 4: Verificar que compila y lintea**

Run: `cd reservas && pnpm build && pnpm lint`
Expected: build OK. `pnpm lint` sigue mostrando **exactamente 1 error preexistente** en `src/components/pantalla-reserva.tsx:49` (`react-hooks/set-state-in-effect`). El `useEffect` nuevo del paso 3 también hace `setState`: si aparece un **segundo** error de esa misma regla, es esperado — anotarlo y seguir, no reescribir el componente en esta tarea.

- [ ] **Step 5: Verificar a ojo contra el server de producción**

```bash
cd reservas && PORT=3100 pnpm start
```

Abrir `http://localhost:3100/`, y confirmar las tres cosas:
1. En desktop, los días posteriores a hoy+7 están grises y no son clickeables.
2. La flecha "mes siguiente" está apagada cuando el mes que viene cae entero fuera de la ventana.
3. En mobile (DevTools, ancho < 768px), la tira de fechas tiene 8 chips y no más.

Si el backend configurado no devuelve métodos de pago, la página muestra "Por ahora no tomamos reservas por la web" y no se ve el calendario: en ese caso levantar el backend local con `npm run dev` + `npm run seed` y apuntar `API_URL` ahí.

- [ ] **Step 6: Commit**

```bash
git add reservas/src/components
git commit -m "feat(reservas): el calendario del sitio publico se corta en la ventana de anticipacion"
```

---

### Task 8: El campo en el panel

**Files:**
- Modify: `frontend/src/lib/types.ts` (interface `Config`, líneas 48-58)
- Modify: `frontend/src/lib/validators.ts` (`configSchema`, líneas 51-73)
- Modify: `frontend/src/components/config/config-form.tsx`

**Interfaces:**
- Consumes: `PATCH /config` aceptando `diasAnticipacionMax` (Task 2).
- Produces: nada. `guardarConfig` ya recibe `Record<string, unknown>` y no se toca.

- [ ] **Step 1: Agregar el campo al tipo**

En `frontend/src/lib/types.ts`, dentro de `interface Config`, después de `adminWhatsapp`:

```ts
  diasAnticipacionMax: number;
```

- [ ] **Step 2: Agregarlo al schema del formulario**

En `frontend/src/lib/validators.ts`, dentro de `configSchema`, después de `adminWhatsapp`:

```ts
  diasAnticipacionMax: z.coerce.number().int().min(1, 'Tiene que ser al menos 1 día').max(365, 'Máximo 365 días'),
```

- [ ] **Step 3: Agregar el input al formulario**

En `frontend/src/components/config/config-form.tsx`, agregar al estado inicial (después de `adminWhatsapp: config.adminWhatsapp,`):

```tsx
    diasAnticipacionMax: String(config.diasAnticipacionMax),
```

Y una `Card` nueva, entre la de "Contacto" y la de "Pagos / Seña":

```tsx
      <Card>
        <CardHeader><CardTitle className="text-base">Reservas del sitio público</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1">
            <Label htmlFor="antic">Anticipación máxima (días)</Label>
            <Input id="antic" type="number" min="1" max="365" value={f.diasAnticipacionMax} onChange={(e) => set('diasAnticipacionMax', e.target.value)} />
            <p className="text-xs text-neutral-600">
              Cuántos días adelante puede reservar un cliente desde la web. Con 7, hoy se puede reservar
              hasta dentro de una semana. No afecta al panel: desde acá se puede cargar cualquier fecha.
            </p>
          </div>
        </CardContent>
      </Card>
```

- [ ] **Step 4: Verificar que compila**

Run: `cd frontend && pnpm build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Verificar el ida y vuelta contra el backend**

Con el backend corriendo (`cd backend && npm run dev`) y el panel (`cd frontend && pnpm dev`), entrar a `/configuracion`, cambiar el campo a `14`, guardar, y confirmar que aparece el toast "Configuración guardada" y que al recargar el valor sigue en 14.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/validators.ts frontend/src/components/config/config-form.tsx
git commit -m "feat(panel): campo de anticipacion maxima del sitio publico"
```

---

### Task 9: Verificación de punta a punta

**Files:** ninguno. Es la corrida final antes de dar el trabajo por terminado.

**Interfaces:**
- Consumes: todas las tareas anteriores.
- Produces: nada.

- [ ] **Step 1: Suite completa del backend**

Run: `cd backend && npm test 2>&1 | tail -20`
Expected: PASS, sin tests salteados.

- [ ] **Step 2: Typecheck del backend**

Run: `cd backend && npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Builds de los dos frontends**

Run: `cd reservas && pnpm build` y `cd frontend && pnpm build`
Expected: los dos compilan.

- [ ] **Step 4: Confirmar el comportamiento contra un backend real**

Con backend + reservas levantados y `diasAnticipacionMax` en 7, comprobar que el sitio no deja elegir el día 8, y que forzando el pedido igual (por ejemplo con `curl` al backend con `x-api-key` y una fecha a 8 días) responde **422** con el mensaje que nombra la fecha.

Run (con el backend local levantado y seedeado):
```bash
cd backend
KEY=$(grep '^SERVICE_API_KEY' .env | cut -d= -f2)
CANCHA=$(curl -s http://localhost:3000/canchas -H "x-api-key: $KEY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
DIA8=$(TZ=America/Argentina/Buenos_Aires date -d "+8 days" +%F)
curl -s -X POST http://localhost:3000/reservas \
  -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d "{\"canchaId\":\"$CANCHA\",\"whatsapp\":\"+5491150000000\",\"nombreCliente\":\"Test\",\"esContacto\":false,\"fecha\":\"$DIA8\",\"horaInicio\":\"18:00\"}" \
  -w "\nstatus=%{http_code}\n"
```
Expected: `status=422`, y en el cuerpo un mensaje que **nombra la fecha límite** (`"Por ahora solo se puede reservar hasta el 02/09"`), no una cantidad de días.

- [ ] **Step 5: Reportar**

Informar qué se verificó y con qué salida, sin redondear. Si algo quedó sin correr (Docker no disponible, por ejemplo), decirlo explícitamente en vez de omitirlo.

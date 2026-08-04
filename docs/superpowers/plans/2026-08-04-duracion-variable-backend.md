# Duración variable y precio prorrateado — Plan A (backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el backend sepa reservar 1, 1½ o 2 horas, cobrando `precioHora × duración` y prorrateando cuando la reserva cruza el borde de la franja pico.

**Architecture:** Una función nueva `precioDeRango()` reemplaza a `precioEfectivo()` y prorratea por minutos. `reserva.service` deja de hardcodear `+60` y usa la duración recibida. `disponibilidad.service` baja el paso a 30 minutos y **agrega** a la grilla un campo con las duraciones viables y su precio, sin quitar nada del contrato actual.

**Tech Stack:** Node 22, Express 5, Prisma 7, TypeScript ESM, PostgreSQL 16 con `btree_gist`, vitest + Testcontainers. Gestor: **npm** (no pnpm — eso es solo para `frontend/` y `reservas/`).

**Spec:** `docs/superpowers/specs/2026-08-04-duracion-variable-precio-design.md`

## Global Constraints

- **Todo en español**: código, comentarios, mensajes de error, nombres de variables. No traducir `cancha`, `seña`, `turno`, `bloqueo`, `predio`.
- **Duraciones permitidas: exactamente `{60, 90, 120}` minutos.** Es una constante del código, no una tabla ni configuración.
- **`duracionMin` es opcional y su default es 60.** Los workflows de n8n (`x-api-key`) y el bot de WhatsApp crean reservas sin conocer el campo: si no lo mandan, deben obtener exactamente el comportamiento de hoy. Romper esto rompe el bot en producción.
- **El contrato de `grilla()` es aditivo.** `horas`, `libres` y `precios` se mantienen tal cual (`precios[canchaId][hora]` = precio de 60 minutos, que sigue siendo correcto). Solo se agregan campos. La web pública consume esto y **no** se toca en este plan.
- **Nunca "consultar y después insertar" contra la restricción de exclusión.** Los solapamientos con otras reservas los detecta la constraint de Postgres y `reserva.repo.ts` los convierte en `Conflict` (409). Los chequeos previos son solo contra turnos fijos y bloqueos, que son plantillas y no filas de `ReservaSector`.
- **Errores**: usar las factorías de `src/utils/errors.ts` (`BadRequest`, `BusinessRule`, `Conflict`, …), nunca `throw new Error`.
- **Sin migraciones de Prisma.** `Reserva.fechaFin`, `TurnoFijo.horaInicio/horaFin` y `Bloqueo.horaInicio/horaFin` ya existen. Si creés que hace falta una migración, algo entendiste mal: pará y preguntá.
- **Comandos desde `backend/`**: `npm run typecheck`, `npm run test:unit` (sin Docker), `npm test` (todo, **requiere Docker**).

## Estructura de archivos

| Archivo | Qué cambia |
|---|---|
| `src/services/precio.service.ts` | `precioEfectivo` → `precioDeRango`, con prorrateo y el arreglo de medianoche. |
| `tests/unit/precio.service.test.ts` | Se reescribe para la función nueva. |
| `src/services/turnoFijo.service.ts:122` | Pasa la duración real del fijo (`horaInicio`→`horaFin`). |
| `src/services/agenda.service.ts:40` | Ídem. |
| `src/validators/reserva.schema.ts` | Suma `duracionMin` opcional con enum `{60,90,120}`. |
| `src/services/reserva.service.ts` | `crear` y `reprogramar` dejan de asumir 60 min. (No hay `moverDeCancha` en el servicio: mover de cancha es `reprogramar` con `canchaId`.) |
| `src/services/disponibilidad.service.ts` | `SLOT_MIN` 60→30; `listar` y `grilla` publican duraciones viables. |
| `tests/integration/duracion.test.ts` (nuevo) | Solapamiento parcial, límite de cierre, preservación al reprogramar. |

## Nota sobre el orden

La Task 1 cambia **plata en producción** (los turnos fijos de más de una hora pasan a cobrar lo que corresponde, y la franja pico que termina a medianoche empieza a aplicarse). Está aprobada explícitamente por el dueño del proyecto y documentado en el spec. No lo "suavices" ni agregues flags para mantener el comportamiento viejo.

---

### Task 1: `precioDeRango()` y migración de sus cuatro consumidores

Se hace todo junto **a propósito**: `precioDeRango` reemplaza a `precioEfectivo`, así que si la
función nueva entrara sin migrar a los consumidores, ese commit no compilaría. Un solo commit,
verde de punta a punta.

Acá los turnos fijos empiezan a cobrarse por su duración real.

**Files:**
- Modify: `backend/src/services/precio.service.ts`
- Modify: `backend/src/services/reserva.service.ts:83`
- Modify: `backend/src/services/turnoFijo.service.ts:122`
- Modify: `backend/src/services/agenda.service.ts:40`
- Modify: `backend/src/services/disponibilidad.service.ts:101`
- Test: `backend/tests/unit/precio.service.test.ts`

**Interfaces:**
- Consumes: `hhmmAMin`, `cierreMin`, `dayOfWeekInTz` de `../utils/tz.js`; `getEnv` de `../config/env.js`.
- Produces: `precioDeRango(cancha: {precioHora: unknown; precioHoraPico: unknown}, fecha: string, horaInicio: string, duracionMin: number, cfg: {picoDesde: string; picoHasta: string; picoFindeDesde: string; picoFindeHasta: string}): number`

- [ ] **Step 1: Escribir los tests que fallan**

Reemplazar **todo** el contenido de `backend/tests/unit/precio.service.test.ts` por:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { precioDeRango } from '../../src/services/precio.service.js';

beforeAll(() => { process.env.TZ_NEGOCIO ||= 'America/Argentina/Buenos_Aires'; });

// Franja del complejo real: pico de 18:00 a medianoche.
const cfg = { picoDesde: '18:00', picoHasta: '00:00', picoFindeDesde: '18:00', picoFindeHasta: '00:00' };
// Precios reales de la cancha de pádel.
const padel = { precioHora: 30000, precioHoraPico: 36000 };
// 2026-06-10 = miércoles (semana); 2026-06-13 = sábado (finde)

describe('precioDeRango', () => {
  it('banda base: el precio escala con la duración', () => {
    expect(precioDeRango(padel, '2026-06-10', '08:00', 60, cfg)).toBe(30000);
    expect(precioDeRango(padel, '2026-06-10', '08:00', 90, cfg)).toBe(45000);
    expect(precioDeRango(padel, '2026-06-10', '08:00', 120, cfg)).toBe(60000);
  });

  it('banda pico: el precio escala con la duración', () => {
    expect(precioDeRango(padel, '2026-06-10', '19:00', 60, cfg)).toBe(36000);
    expect(precioDeRango(padel, '2026-06-10', '19:00', 90, cfg)).toBe(54000);
    expect(precioDeRango(padel, '2026-06-10', '19:00', 120, cfg)).toBe(72000);
  });

  it('cruza el borde de las 18:00 → prorratea por tramo', () => {
    // 17:00-19:00 = 60 min base + 60 min pico
    expect(precioDeRango(padel, '2026-06-10', '17:00', 120, cfg)).toBe(66000);
    // 17:00-18:30 = 60 min base + 30 min pico
    expect(precioDeRango(padel, '2026-06-10', '17:00', 90, cfg)).toBe(48000);
    // 17:30-18:30 = 30 min base + 30 min pico
    expect(precioDeRango(padel, '2026-06-10', '17:30', 60, cfg)).toBe(33000);
  });

  it('REGRESIÓN: una franja que termina a medianoche SÍ se aplica', () => {
    // El bug viejo comparaba strings: "18:00" >= "00:00" daba true y devolvía el precio base.
    expect(precioDeRango(padel, '2026-06-10', '19:00', 60, cfg)).toBe(36000);
    expect(precioDeRango(padel, '2026-06-10', '22:30', 90, cfg)).toBe(54000); // termina justo en el cierre
  });

  it('bordes de la franja: desde inclusive, hasta exclusivo', () => {
    expect(precioDeRango(padel, '2026-06-10', '18:00', 60, cfg)).toBe(36000);
    expect(precioDeRango(padel, '2026-06-10', '17:00', 60, cfg)).toBe(30000);
  });

  it('sin pico en la cancha (precioHoraPico=0) → todo a base', () => {
    expect(precioDeRango({ precioHora: 30000, precioHoraPico: 0 }, '2026-06-10', '19:00', 120, cfg)).toBe(60000);
  });

  it('franja vacía o invertida → todo a base', () => {
    const vacia = { picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '' };
    expect(precioDeRango(padel, '2026-06-10', '19:00', 60, vacia)).toBe(30000);
    const invertida = { picoDesde: '22:00', picoHasta: '20:00', picoFindeDesde: '22:00', picoFindeHasta: '20:00' };
    expect(precioDeRango(padel, '2026-06-10', '19:00', 60, invertida)).toBe(30000);
  });

  it('el finde usa su propia franja', () => {
    const mixta = { picoDesde: '19:00', picoHasta: '23:00', picoFindeDesde: '14:00', picoFindeHasta: '23:00' };
    expect(precioDeRango(padel, '2026-06-13', '14:00', 60, mixta)).toBe(36000); // sábado, en franja finde
    expect(precioDeRango(padel, '2026-06-10', '14:00', 60, mixta)).toBe(30000); // miércoles, fuera de franja semana
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

```bash
npx vitest run tests/unit/precio.service.test.ts
```

Esperado: FAIL — `precioDeRango` no existe / no es una función.

- [ ] **Step 3: Implementar**

Reemplazar **todo** el contenido de `backend/src/services/precio.service.ts` por:

```ts
import { getEnv } from '../config/env.js';
import { dayOfWeekInTz, hhmmAMin, cierreMin } from '../utils/tz.js';

interface CanchaPrecio { precioHora: unknown; precioHoraPico: unknown }
interface PicoCfg { picoDesde: string; picoHasta: string; picoFindeDesde: string; picoFindeHasta: string }

/**
 * Precio de una reserva de `duracionMin` minutos que arranca a `horaInicio` (HH:MM) el `fecha`
 * (YYYY-MM-DD). Prorratea: cobra a precio pico solo los minutos que caen dentro de la franja,
 * así una reserva de 17:00 a 19:00 sale 1 hora base + 1 hora pico y no una de las dos cosas.
 */
export function precioDeRango(
  cancha: CanchaPrecio,
  fecha: string,
  horaInicio: string,
  duracionMin: number,
  cfg: PicoCfg,
): number {
  const base = Number(cancha.precioHora);
  const pico = Number(cancha.precioHoraPico);
  const porMinutoBase = base / 60;
  if (!(pico > 0)) return duracionMin * porMinutoBase;

  const wd = dayOfWeekInTz(fecha, getEnv().TZ_NEGOCIO); // 0=domingo..6=sábado
  const esFinde = wd === 0 || wd === 6;
  const desdeStr = esFinde ? cfg.picoFindeDesde : cfg.picoDesde;
  const hastaStr = esFinde ? cfg.picoFindeHasta : cfg.picoHasta;
  if (!desdeStr || !hastaStr) return duracionMin * porMinutoBase;

  // cierreMin() mapea "00:00" a 1440. Sin esto, la comparación de strings del código viejo
  // daba "18:00" >= "00:00" === true y anulaba el pico de toda franja que cerrara a medianoche.
  const desde = hhmmAMin(desdeStr);
  const hasta = cierreMin(hastaStr);
  if (desde >= hasta) return duracionMin * porMinutoBase;

  const ini = hhmmAMin(horaInicio);
  const fin = ini + duracionMin;
  const minutosPico = Math.max(0, Math.min(fin, hasta) - Math.max(ini, desde));
  const minutosBase = duracionMin - minutosPico;
  return minutosPico * (pico / 60) + minutosBase * porMinutoBase;
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

```bash
npx vitest run tests/unit/precio.service.test.ts
```

Esperado: PASS, 8 tests.

En este punto `npm run typecheck` todavía falla, porque los cuatro consumidores importan
`precioEfectivo`, que ya no existe. **No commitees acá**: los pasos 5 y 6 lo dejan verde.

- [ ] **Step 5: Confirmar el alcance real de la migración**

```bash
grep -rn "precioEfectivo" backend/src/
```

Esperado: exactamente cuatro líneas — `reserva.service.ts:83`, `turnoFijo.service.ts:122`, `agenda.service.ts:40`, `disponibilidad.service.ts:101`. Si aparece alguna más, migrala también.

- [ ] **Step 6: Migrar los cuatro**

En cada archivo, cambiar el import de `precioEfectivo` por `precioDeRango` y la llamada:

- **`reserva.service.ts:83`** — por ahora sigue siendo una hora fija; la duración real llega en la Task 2:
  ```ts
  const precio = precioDeRango(cancha, input.fecha, input.horaInicio, 60, cfg);
  ```

- **`turnoFijo.service.ts:122`** — el fijo ya tiene `horaInicio` y `horaFin`, así que su duración es real:
  ```ts
  const duracion = hhmmAMin(fijo.horaFin) - hhmmAMin(fijo.horaInicio);
  const precio = precioDeRango(fijo.cancha, fecha, fijo.horaInicio, duracion, cfg);
  ```
  Agregar `hhmmAMin` al import de `../utils/tz.js` si no está.

- **`agenda.service.ts:40`** — mismo caso, `f` es el fijo:
  ```ts
  precio: precioDeRango(f.cancha, fecha, f.horaInicio, hhmmAMin(f.horaFin) - hhmmAMin(f.horaInicio), cfg),
  ```
  Agregar `hhmmAMin` al import de `../utils/tz.js` si no está.

- **`disponibilidad.service.ts:101`** — la matriz `precios` es, por contrato, el precio de 60 minutos:
  ```ts
  precios[pc.id][h] = precioDeRango({ precioHora: pc.precioHora, precioHoraPico: pc.precioHoraPico }, fecha, h, 60, cfg);
  ```

- [ ] **Step 7: Verificar que compila y que no quedan referencias**

```bash
npm run typecheck
grep -rn "precioEfectivo" backend/src/ ; echo "exit=$?"
```

Esperado: typecheck sin errores; el grep sin resultados (exit=1).

- [ ] **Step 8: Correr la suite completa**

```bash
npm run test:unit
npm test
```

Esperado: todo pasa. `npm test` **requiere Docker levantado**. Si algún test de integración
existente falla porque los turnos fijos ahora cobran su duración real, **ese test viejo es el que
hay que actualizar** — el cambio está aprobado en el spec. Dejá asentado en el informe cuáles
tocaste y por qué.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/ backend/tests/
git commit -m "feat(precio): prorratear por tramo y cobrar los fijos por su duracion real

precioDeRango reemplaza a precioEfectivo: cobra precioHora x duracion y
prorratea cuando el rango cruza el borde de la franja pico.

Arregla dos bugs preexistentes: una franja que termina a medianoche nunca
se aplicaba (comparacion de strings, "18:00" >= "00:00"), y turnoFijo y
agenda cobraban los fijos de mas de una hora como si fueran de una."
```

---

### Task 2: `duracionMin` al crear una reserva

**Files:**
- Modify: `backend/src/validators/reserva.schema.ts`
- Modify: `backend/src/services/reserva.service.ts` (interfaz `CreateReservaInput` y método `crear`)
- Test: `backend/tests/integration/duracion.test.ts` (nuevo)

**Interfaces:**
- Consumes: `precioDeRango` (Task 1); `ocupacionService.conflictoReserva(canchaId, fecha, iniMin, finMin)`; `configService.get()`.
- Produces: `POST /reservas` acepta `duracionMin?: 60 | 90 | 120`. `CreateReservaInput` gana `duracionMin?: number`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/duracion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

// Fecha futura fija para que "no se puede reservar en el pasado" nunca interfiera.
const fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

async function crearCancha() {
  return getPrisma().cancha.create({ data: { nombre: 'Pádel 1', tipo: 'padel', precioHora: 30000, precioHoraPico: 36000 } });
}

function reservar(canchaId: string, horaInicio: string, duracionMin?: number) {
  const body: Record<string, unknown> = { canchaId, fecha, horaInicio, whatsapp: '5491133334444', nombreCliente: 'Test', esContacto: true };
  if (duracionMin != null) body.duracionMin = duracionMin;
  return supertest(app).post('/reservas').set('x-api-key', 'svc').send(body);
}

describe('duración variable', () => {
  it('sin duracionMin reserva una hora, como antes', async () => {
    const c = await crearCancha();
    const res = await reservar(c.id, '17:00');
    expect(res.status).toBe(201);
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    expect(r!.fechaFin.getTime() - r!.fechaInicio.getTime()).toBe(60 * 60 * 1000);
  });

  it('duracionMin=120 crea una reserva de dos horas', async () => {
    const c = await crearCancha();
    const res = await reservar(c.id, '17:00', 120);
    expect(res.status).toBe(201);
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    expect(r!.fechaFin.getTime() - r!.fechaInicio.getTime()).toBe(120 * 60 * 1000);
  });

  it('una duración fuera de {60,90,120} se rechaza con 400', async () => {
    const c = await crearCancha();
    expect((await reservar(c.id, '17:00', 45)).status).toBe(400);
    expect((await reservar(c.id, '17:00', 180)).status).toBe(400);
  });

  it('un solapamiento parcial de 30 minutos se rechaza con 409', async () => {
    const c = await crearCancha();
    expect((await reservar(c.id, '17:00', 120)).status).toBe(201); // 17:00-19:00
    // 18:30-19:30 pisa la última media hora: lo tiene que atajar la restricción de exclusión.
    expect((await reservar(c.id, '18:30', 60)).status).toBe(409);
  });

  it('una reserva que termina después del cierre se rechaza con 422', async () => {
    const c = await crearCancha();
    // El cierre por defecto de la config es 23:00 en semana y 00:00 el finde.
    const { configService } = await import('../../src/services/config.service.js');
    await configService.get();
    await configService.update({ horaApertura: '08:00', horaCierre: '23:00', horaAperturaFinde: '08:00', horaCierreFinde: '23:00' });
    expect((await reservar(c.id, '22:00', 60)).status).toBe(201);  // termina 23:00, justo en el cierre
    expect((await reservar(c.id, '22:30', 120)).status).toBe(422); // terminaría 00:30
  });
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

```bash
npx vitest run tests/integration/duracion.test.ts
```

Esperado: FAIL — las duraciones distintas de 60 no se respetan y no hay validación de cierre. **Requiere Docker.**

- [ ] **Step 3: Sumar `duracionMin` al validador**

En `backend/src/validators/reserva.schema.ts`, dentro del `body` del schema de creación, agregar:

```ts
duracionMin: z.union([z.literal(60), z.literal(90), z.literal(120)]).optional(),
```

- [ ] **Step 4: Usar la duración en `crear`**

En `backend/src/services/reserva.service.ts`, agregar `duracionMin?: number;` a la interfaz `CreateReservaInput`, y en `crear` reemplazar las líneas que hoy asumen 60 minutos:

```ts
const duracionMin = input.duracionMin ?? 60;
const fechaInicio = combineDateTimeUtc(input.fecha, input.horaInicio, tz);
const fechaFin = new Date(fechaInicio.getTime() + duracionMin * 60 * 1000);
if (fechaInicio.getTime() <= Date.now()) throw BusinessRule('No se puede reservar en el pasado');

const iniMin = hhmmAMin(input.horaInicio);
const finMin = iniMin + duracionMin;

// La reserva tiene que terminar antes o justo en el cierre. Antes no hacía falta:
// todos los turnos medían lo mismo y la grilla ya no ofrecía horarios inválidos.
const cfgHorario = await configService.get();
const dow = dayOfWeekInTz(input.fecha, tz);
const esFinde = dow === 0 || dow === 6;
const cierre = cierreMin(esFinde ? cfgHorario.horaCierreFinde : cfgHorario.horaCierre);
if (finMin > cierre) throw BusinessRule('La reserva termina después del horario de cierre');

const motivo = await ocupacionService.conflictoReserva(input.canchaId, input.fecha, iniMin, finMin);
```

Y más abajo, el precio pasa a usar la duración:

```ts
const precio = precioDeRango(cancha, input.fecha, input.horaInicio, duracionMin, cfg);
```

Agregar `hhmmAMin`, `cierreMin` y `dayOfWeekInTz` al import de `../utils/tz.js` si faltan. Si ya se obtuvo `cfg` con `configService.get()` más abajo, reusar esa variable en vez de pedirla dos veces.

- [ ] **Step 5: Correr el test y confirmar que pasa**

```bash
npx vitest run tests/integration/duracion.test.ts
npm run typecheck
```

Esperado: los 5 tests pasan; typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add backend/src/validators/reserva.schema.ts backend/src/services/reserva.service.ts backend/tests/integration/duracion.test.ts
git commit -m "feat(reservas): aceptar duraciones de 60, 90 y 120 minutos"
```

---

### Task 3: Preservar la duración al reprogramar

**Ojo con esto:** no existe un método `moverDeCancha` en el servicio. `reservaService.reprogramar`
(línea 275) resuelve **los dos casos** — cambiar de horario y cambiar de cancha — según venga o no
el `canchaId` opcional. `reservaRepo.moverDeCancha` sí existe, pero es del repositorio y no calcula
tiempos. O sea: hay **un solo lugar** que arreglar, con dos líneas hardcodeadas adentro (288 y 297).

**Files:**
- Modify: `backend/src/services/reserva.service.ts` (solo `reprogramar`, líneas 288 y 297)
- Test: `backend/tests/integration/duracion.test.ts` (agregar casos)

**Interfaces:**
- Consumes: lo de la Task 2.
- Produces: nada nuevo para tareas posteriores.

- [ ] **Step 1: Agregar los tests que fallan**

Agregar al final de `backend/tests/integration/duracion.test.ts`, dentro de un `describe` nuevo:

```ts
// La ruta es PATCH (verificado en src/routes/reserva.routes.ts:134) y el cuerpo acepta
// { fecha, horaInicio, canchaId? }: con canchaId, el mismo endpoint mueve de cancha.
describe('reprogramar preserva la duración', () => {
  it('reprogramar mantiene las dos horas', async () => {
    const c = await crearCancha();
    const creada = await reservar(c.id, '17:00', 120);
    expect(creada.status).toBe(201);

    const res = await supertest(app).patch(`/reservas/${creada.body.id}/reprogramar`)
      .set('x-api-key', 'svc').send({ fecha, horaInicio: '09:00' });
    expect(res.status).toBe(200);

    const r = await getPrisma().reserva.findUnique({ where: { id: creada.body.id } });
    expect(r!.fechaFin.getTime() - r!.fechaInicio.getTime()).toBe(120 * 60 * 1000);
  });

  it('la reserva reprogramada sigue ocupando su rango completo', async () => {
    const c = await crearCancha();
    const creada = await reservar(c.id, '17:00', 120);
    await supertest(app).patch(`/reservas/${creada.body.id}/reprogramar`)
      .set('x-api-key', 'svc').send({ fecha, horaInicio: '09:00' });
    // 09:00-11:00 ocupado: una reserva a las 10:30 pisa la última media hora.
    expect((await reservar(c.id, '10:30', 60)).status).toBe(409);
  });

  it('mover de cancha también preserva la duración', async () => {
    const c1 = await crearCancha();
    const c2 = await getPrisma().cancha.create({ data: { nombre: 'Pádel 2', tipo: 'padel', precioHora: 30000, precioHoraPico: 36000 } });
    const creada = await reservar(c1.id, '17:00', 120);
    const res = await supertest(app).patch(`/reservas/${creada.body.id}/reprogramar`)
      .set('x-api-key', 'svc').send({ fecha, horaInicio: '17:00', canchaId: c2.id });
    expect(res.status).toBe(200);
    const r = await getPrisma().reserva.findUnique({ where: { id: creada.body.id } });
    expect(r!.canchaId).toBe(c2.id);
    expect(r!.fechaFin.getTime() - r!.fechaInicio.getTime()).toBe(120 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run tests/integration/duracion.test.ts
```

Esperado: los dos casos nuevos fallan (la reserva vuelve a durar 60 minutos).

- [ ] **Step 3: Implementar**

En `reprogramar`, línea 288, reemplazar el `+ 60 * 60 * 1000` hardcodeado por la duración de la
reserva existente (`r` ya está en scope desde la línea 277):

```ts
const duracionMs = r.fechaFin.getTime() - r.fechaInicio.getTime();
const nuevaFin = new Date(nuevaInicio.getTime() + duracionMs);
```

Y en la línea 297, el chequeo de conflicto por la duración real:

```ts
const iniMin = hhmmAMin(input.horaInicio);
const motivo = await ocupacionService.conflictoReserva(canchaDestino, input.fecha, iniMin, iniMin + duracionMs / 60000);
```

Reemplazar de paso el cálculo manual de `iniMin` de la línea 296
(`Number(input.horaInicio.split(':')[0]) * 60 + …`) por `hhmmAMin`, que hace exactamente eso y ya
se importa en este archivo desde la Task 2.

**No recalcular el monto.** El precio queda congelado al reservar, igual que hoy: lo dice el
comentario de la línea 276 (`el monto NO se recalcula al reprogramar`). Una reserva de dos horas
reprogramada a una franja más cara sigue costando lo que costó.

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npx vitest run tests/integration/duracion.test.ts
npm run typecheck
```

Esperado: los 7 tests del archivo pasan; typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reserva.service.ts backend/tests/integration/duracion.test.ts
git commit -m "fix(reservas): preservar la duracion al reprogramar y al mover de cancha"
```

---

### Task 4: Disponibilidad cada 30 minutos, con duraciones viables

**Files:**
- Modify: `backend/src/services/disponibilidad.service.ts`
- Test: `backend/tests/integration/disponibilidad-duracion.test.ts` (nuevo)

**Interfaces:**
- Consumes: `precioDeRango` (Task 1); `ocupacionService.rangosPlantilla(canchaId, fecha)`.
- Produces: `Slot` gana `duraciones: { min: number; horaFin: string; precio: number }[]`. Los campos actuales (`horaInicio`, `horaFin`, `inicioUtc`, `finUtc`) **se mantienen** y siguen describiendo el bloque de 60 minutos.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/disponibilidad-duracion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

const fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

async function escenario() {
  const { configService } = await import('../../src/services/config.service.js');
  await configService.get();
  await configService.update({ horaApertura: '08:00', horaCierre: '23:00', horaAperturaFinde: '08:00', horaCierreFinde: '23:00', picoDesde: '18:00', picoHasta: '23:00', picoFindeDesde: '18:00', picoFindeHasta: '23:00' });
  const cancha = await getPrisma().cancha.create({ data: { nombre: 'Pádel 1', tipo: 'padel', precioHora: 30000, precioHoraPico: 36000 } });
  const { disponibilidadService } = await import('../../src/services/disponibilidad.service.js');
  return { cancha, disponibilidadService };
}

describe('disponibilidad con duraciones', () => {
  it('los turnos arrancan cada 30 minutos', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const { slots } = await disponibilidadService.listar(cancha.id, fecha);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas).toContain('08:00');
    expect(horas).toContain('08:30');
  });

  it('cada slot informa sus duraciones viables con el precio prorrateado', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const { slots } = await disponibilidadService.listar(cancha.id, fecha);
    const s17 = slots.find((s) => s.horaInicio === '17:00')!;
    expect(s17.duraciones).toEqual([
      { min: 60, horaFin: '18:00', precio: 30000 },
      { min: 90, horaFin: '18:30', precio: 48000 },
      { min: 120, horaFin: '19:00', precio: 66000 },
    ]);
  });

  it('cerca del cierre solo quedan las duraciones que entran', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const { slots } = await disponibilidadService.listar(cancha.id, fecha);
    const s2200 = slots.find((s) => s.horaInicio === '22:00')!;
    expect(s2200.duraciones.map((d) => d.min)).toEqual([60]); // 90 y 120 pasarían las 23:00
    expect(slots.find((s) => s.horaInicio === '22:30')).toBeUndefined(); // ni una hora entra
  });

  it('una reserva existente recorta las duraciones de los slots anteriores', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const { reservaService } = await import('../../src/services/reserva.service.js');
    await reservaService.crear({ canchaId: cancha.id, fecha, horaInicio: '19:00', whatsapp: '5491133334444', nombreCliente: 'X', esContacto: true } as any);
    const { slots } = await disponibilidadService.listar(cancha.id, fecha);
    const s18 = slots.find((s) => s.horaInicio === '18:00')!;
    expect(s18.duraciones.map((d) => d.min)).toEqual([60]); // 90 y 120 pisarían la reserva de las 19:00
    expect(slots.find((s) => s.horaInicio === '19:00')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run tests/integration/disponibilidad-duracion.test.ts
```

Esperado: FAIL — `duraciones` no existe y los slots van de a una hora.

- [ ] **Step 3: Implementar**

En `backend/src/services/disponibilidad.service.ts`:

1. Cambiar el paso y declarar las duraciones:
   ```ts
   const SLOT_MIN = 30;
   const DURACIONES = [60, 90, 120] as const;
   ```
2. Ampliar la interfaz:
   ```ts
   export interface DuracionSlot { min: number; horaFin: string; precio: number }
   export interface Slot { horaInicio: string; horaFin: string; inicioUtc: string; finUtc: string; duraciones: DuracionSlot[] }
   ```
3. Reescribir el cuerpo de `listar` desde el bucle. Necesita la cancha con sus precios, así que reemplazar `await canchaService.get(canchaId)` por `const cancha = await canchaService.get(canchaId);` y usarla:

```ts
    const slots: Slot[] = [];
    const { apertura, cierre } = horarioDe(fecha, tz);
    const cierreM = cierreMin(cierre);
    // `libre` responde si el rango [ini, fin) en minutos está libre de reservas y de plantillas.
    const libre = (ini: number, fin: number) => {
      const iniUtc = combineDateTimeUtc(fecha, toHHMM(ini), tz);
      const finUtc = combineDateTimeUtc(fecha, toHHMM(fin), tz);
      const pisaReserva = ocup.some((r) => r.fechaInicio < finUtc && iniUtc < r.fechaFin);
      const pisaPlantilla = plantillas.some((p) => p.ini < fin && ini < p.fin);
      return !pisaReserva && !pisaPlantilla;
    };

    for (let t = fromHHMM(apertura); t + SLOT_MIN <= cierreM; t += SLOT_MIN) {
      const duraciones: DuracionSlot[] = [];
      for (const min of DURACIONES) {
        if (t + min > cierreM) continue;      // no puede pasar del cierre
        if (!libre(t, t + min)) continue;      // no puede pisar nada
        duraciones.push({
          min,
          horaFin: toHHMM(t + min),
          precio: precioDeRango(cancha, fecha, toHHMM(t), min, cfg),
        });
      }
      if (duraciones.length === 0) continue;   // un slot sin duraciones viables no se publica
      const horaInicio = toHHMM(t);
      const horaFin = toHHMM(t + 60);
      slots.push({
        horaInicio,
        horaFin,
        inicioUtc: combineDateTimeUtc(fecha, horaInicio, tz).toISOString(),
        finUtc: combineDateTimeUtc(fecha, horaFin, tz).toISOString(),
        duraciones,
      });
    }
    return { canchaId, fecha, slots };
```

**Dejá `horarioDe(fecha, tz, cfg)` con su firma actual de tres parámetros** (está definida en la
línea 15 de este mismo archivo). El fragmento de arriba la llama con dos por brevedad: escribila
como `horarioDe(fecha, tz, cfg)`. No cambies su firma — no aporta nada y ensucia el diff.

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npx vitest run tests/integration/disponibilidad-duracion.test.ts
npm run typecheck
```

Esperado: los 4 tests pasan; typecheck limpio.

- [ ] **Step 5: Correr la suite completa, que acá es donde se rompe lo demás**

```bash
npm test
```

`listarPorTamano` consume `listar` y agrupa por `horaInicio`: verificá que sigue funcionando con el paso de 30 minutos. Si algún test existente de disponibilidad o de grilla falla porque ahora hay el doble de slots, **el test viejo es el que hay que actualizar** — el cambio de granularidad está aprobado en el spec. Dejá asentado en el informe cuáles actualizaste y por qué.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/disponibilidad.service.ts backend/tests/
git commit -m "feat(disponibilidad): turnos cada 30 minutos con duraciones viables y su precio"
```

---

### Task 5: `grilla()` publica las duraciones, sin romper el contrato

**Files:**
- Modify: `backend/src/services/disponibilidad.service.ts` (método `grilla`, ~línea 72)
- Test: `backend/tests/unit/grilla.test.ts` (revisar) y `backend/tests/integration/disponibilidad-duracion.test.ts` (agregar caso)

**Interfaces:**
- Consumes: `listar` con `duraciones` (Task 4).
- Produces: la respuesta de `grilla` suma `duraciones: Record<canchaId, Record<hora, { min: number; horaFin: string; precio: number }[]>>`. **`horas`, `libres`, `canchas` y `precios` no cambian de forma ni de significado.**

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integration/disponibilidad-duracion.test.ts`:

```ts
describe('grilla: contrato aditivo', () => {
  it('mantiene los campos viejos y agrega duraciones', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const g = await disponibilidadService.grilla('padel', fecha);

    // Contrato viejo intacto: la web pública lo sigue consumiendo tal cual.
    expect(Array.isArray(g.horas)).toBe(true);
    expect(g.libres[cancha.id]['17:00']).toBe(true);
    expect(g.precios[cancha.id]['17:00']).toBe(30000); // sigue siendo el precio de 60 minutos

    // Campo nuevo.
    expect(g.duraciones[cancha.id]['17:00']).toEqual([
      { min: 60, horaFin: '18:00', precio: 30000 },
      { min: 90, horaFin: '18:30', precio: 48000 },
      { min: 120, horaFin: '19:00', precio: 66000 },
    ]);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run tests/integration/disponibilidad-duracion.test.ts
```

Esperado: FAIL — `g.duraciones` es `undefined`.

- [ ] **Step 3: Implementar**

En `grilla`, guardar las duraciones por hora junto con el set de libres y devolverlas. En el bucle que arma `perCancha`, además de `free`, construir un mapa:

```ts
      const porHora = new Map<string, DuracionSlot[]>();
      for (const s of futuros) porHora.set(s.horaInicio, s.duraciones);
```

Agregar `porHora` al objeto que se empuja a `perCancha`, ampliar el tipo de retorno con
`duraciones: Record<string, Record<string, DuracionSlot[]>>`, y llenarlo en el bucle final junto a `libres` y `precios`:

```ts
      duraciones[pc.id][h] = pc.porHora.get(h) ?? [];
```

**No toques `precios`**: sigue siendo `precioDeRango(..., 60, cfg)` por contrato.

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npx vitest run tests/integration/disponibilidad-duracion.test.ts
npm run typecheck
npm test
```

Esperado: todo verde.

- [ ] **Step 5: Verificar que la web pública sigue compilando contra el contrato**

```bash
cd ../reservas && pnpm build
```

Esperado: build exitoso **sin haber tocado un solo archivo de `reservas/`**. Es la prueba de que el contrato quedó aditivo. Si falla, algo se rompió del contrato viejo y hay que arreglarlo acá, no en `reservas/`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/disponibilidad.service.ts backend/tests/
git commit -m "feat(disponibilidad): grilla publica duraciones sin romper el contrato existente"
```

---

## Cierre del Plan A

Al terminar, el backend acepta reservas de 60, 90 y 120 minutos, las cobra prorrateadas y publica las duraciones viables — y **n8n, el bot de WhatsApp, el panel y la web pública siguen funcionando exactamente igual que antes**, porque todo lo nuevo es opcional o aditivo.

El Plan B (selector de duración en el panel y la web, y calendario semanal con bloques proporcionales) se escribe aparte y se puede hacer en cualquier momento posterior.

**Antes de deployar:** avisarle al dueño del complejo que los turnos fijos de más de una hora pasan a cobrarse por su duración real, y que la franja pico que termina a medianoche empieza a aplicarse. Las dos cosas cambian plata y se van a notar en la caja.

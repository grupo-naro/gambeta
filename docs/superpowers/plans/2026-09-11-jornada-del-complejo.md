# La jornada del complejo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el complejo pueda abrir a las 07:00 y cerrar a la 01:00, con el último turno arrancando a las 00:00, y que ese turno pertenezca a la jornada del día anterior en agenda, precio, ocupación y caja.

**Architecture:** Se introduce un solo concepto — el *minuto de jornada* — en `utils/tz.ts`: una hora anterior a la apertura pertenece al día siguiente y suma 1440. Todo lo que hoy razona en "minutos del día calendario" pasa a razonar en minutos de jornada. La pieza crítica no es permitir el valor `01:00` sino migrar **todas** las consultas de ocupación: si queda una con la ventana de 24 horas, la grilla ofrece horarios ya tomados.

**Tech Stack:** Express 5 + Prisma 7 + Postgres (backend, npm), Next.js 16 (frontend y reservas, pnpm), vitest + supertest + Testcontainers.

**Spec:** [`docs/superpowers/specs/2026-09-11-jornada-del-complejo-design.md`](../specs/2026-09-11-jornada-del-complejo-design.md)

## Global Constraints

- **Rama:** trabajar sobre `fix/horarios-medianoche`, que ya tiene los dos arreglos previos (`d74eb4d`, `309675a`) de los que este trabajo depende. **No** trabajar en `main`: un push a `main` dispara el deploy de producción.
- **Idioma:** código, comentarios y nombres en español. No traducir `cancha`, `seña`, `turno fijo`, `bloqueo`, `jornada`, `apertura`, `cierre`.
- **Prisma 7:** nunca importar de `@prisma/client`. Tipos desde `src/db/client.js`, cliente runtime desde `src/db/prisma.js`.
- **Errores:** factories de `src/utils/errors.ts`, nunca `new Error` para fallas esperadas.
- **Package managers:** `backend/` usa **npm**; `frontend/` y `reservas/` usan **pnpm**.
- **Next.js 16** es más nuevo que la mayoría de los datos de entrenamiento: leer `node_modules/next/dist/docs/` antes de escribir código específico de Next.
- **La regla central, literal del spec:** `minutoDeJornada(hhmm, apertura) = hhmmAMin(hhmm) < hhmmAMin(apertura) ? m + 1440 : m`.
- **Etiqueta del último turno:** `00:00`, nunca `24:00`.
- **`diaSemana` de fijos y bloqueos se refiere a la jornada**, no al día calendario del instante.
- **Criterio de despliegue:** o se migran todas las consultas de ocupación, o no se despliega. Nada de esta rama es desplegable hasta que estén las 10 tareas.

### Qué significa "verde"

El repo no arranca limpio. Estos rojos son **anteriores a la rama**; no los toques ni los persigas:

- `backend`: `analytics.test.ts` (`ingresos sums…`, `canchas-top returns…`) y `disponibilidad-tamano.test.ts` (`rechaza jugadores=6`) — 3 fallas.
- `frontend`: `validators.test.ts` (`jugadores=6`, `jugadoresParte=6`) — 2 fallas. Lint: 6 problemas en 4 archivos ajenos.
- `reservas`: lint con 2 errores en `pantalla-reserva.tsx`.

Punto de partida de esta rama: backend **686 pasados / 3 fallados**, frontend **164 / 2**, reservas **19 / 0**.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/src/utils/tz.ts` (modificar) | Los cuatro helpers de jornada. Única fuente de verdad. |
| `backend/src/services/precio.service.ts` (modificar) | Pico y reserva en minutos de jornada |
| `backend/src/services/ocupacion.service.ts` (modificar) | Rangos de fijos y bloqueos en minutos de jornada |
| `backend/src/services/disponibilidad.service.ts` (modificar) | Ventana de ocupación y loop de slots |
| `backend/src/services/reserva.service.ts` (modificar) | Cierre e instante al crear y reprogramar |
| `backend/src/services/agenda.service.ts` (modificar) | Agenda del día = jornada |
| `backend/src/services/sheets/sheetsData.ts` (modificar) | Columnas de horas del espejo |
| `backend/src/validators/config.schema.ts` + `services/config.service.ts` (modificar) | Aceptar cierre posterior a medianoche |
| `frontend/src/lib/hora.ts` + `lib/calendario.ts` + `lib/validators.ts` (modificar) | Espejo de los helpers y horas del calendario |
| `reservas/src/components/pantalla-reserva.tsx` (modificar) | Etiqueta del turno de las 00:00 |

**Orden deliberado:** la validación que habilita guardar `01:00` es la **Tarea 8**, no la 1. Todo lo que la hace segura viene antes, así que en ningún punto de la historia de la rama se puede guardar una configuración que el motor todavía no sabe atender.

---

### Task 1: Los helpers de jornada

**Files:**
- Modify: `backend/src/utils/tz.ts`
- Test: `backend/tests/unit/jornada.test.ts`

**Interfaces:**
- Consumes: `hhmmAMin`, `combineDateTimeUtc`, `sumarDias`, ya en `tz.ts`.
- Produces, todos exportados desde `backend/src/utils/tz.ts`:
  - `minutoDeJornada(hhmm: string, apertura: string): number`
  - `hhmmDeMin(m: number): string` — minuto de jornada a etiqueta; 1440 → `"00:00"`, 1500 → `"01:00"`
  - `instanteDeJornada(fecha: string, m: number, tz: string): Date`
  - `jornadaWindowUtc(fecha: string, tz: string, apertura: string, cierre: string): { start: Date; end: Date }`

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/unit/jornada.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { minutoDeJornada, hhmmDeMin, instanteDeJornada, jornadaWindowUtc } from '../../src/utils/tz.js';

const TZ = 'America/Argentina/Buenos_Aires';

describe('minutoDeJornada', () => {
  it('una hora posterior a la apertura es el minuto del día', () => {
    expect(minutoDeJornada('07:00', '07:00')).toBe(420);
    expect(minutoDeJornada('23:00', '07:00')).toBe(1380);
    expect(minutoDeJornada('22:30', '07:00')).toBe(1350);
  });

  it('una hora anterior a la apertura pertenece al día siguiente', () => {
    expect(minutoDeJornada('00:00', '07:00')).toBe(1440);
    expect(minutoDeJornada('01:00', '07:00')).toBe(1500);
    expect(minutoDeJornada('02:30', '07:00')).toBe(1590);
  });

  it('compatibilidad: para las configuraciones de hoy da lo mismo que cierreMin', () => {
    // 23:00 y 00:00 son los dos cierres que el sistema ya soportaba.
    expect(minutoDeJornada('23:00', '07:00')).toBe(1380);
    expect(minutoDeJornada('00:00', '07:00')).toBe(1440);
    expect(minutoDeJornada('00:00', '16:00')).toBe(1440);
  });
});

describe('hhmmDeMin', () => {
  it('etiqueta el minuto de jornada como lo diría un reloj', () => {
    expect(hhmmDeMin(420)).toBe('07:00');
    expect(hhmmDeMin(1380)).toBe('23:00');
    expect(hhmmDeMin(1440)).toBe('00:00'); // NO "24:00"
    expect(hhmmDeMin(1500)).toBe('01:00');
    expect(hhmmDeMin(1350)).toBe('22:30');
  });
});

describe('instanteDeJornada', () => {
  it('antes de medianoche usa la propia fecha', () => {
    // 23:00 del 11 en Argentina (UTC-3) es 02:00 UTC del 12.
    expect(instanteDeJornada('2026-09-11', 1380, TZ).toISOString()).toBe('2026-09-12T02:00:00.000Z');
  });

  it('a partir de 1440 cruza al día siguiente', () => {
    // 00:00 del 12 en Argentina (UTC-3) es 03:00 UTC del 12.
    expect(instanteDeJornada('2026-09-11', 1440, TZ).toISOString()).toBe('2026-09-12T03:00:00.000Z');
    // 01:00 del 12 en Argentina es 04:00 UTC del 12.
    expect(instanteDeJornada('2026-09-11', 1500, TZ).toISOString()).toBe('2026-09-12T04:00:00.000Z');
  });

  it('el minuto 1440 NO es la medianoche del arranque del día', () => {
    // Este es el error que la función existe para evitar: formatear 1440 como "00:00" y
    // combinarlo con la misma fecha daría 24 horas antes de lo correcto.
    const arranque = instanteDeJornada('2026-09-11', 0, TZ);
    const cierre = instanteDeJornada('2026-09-11', 1440, TZ);
    expect(cierre.getTime() - arranque.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('jornadaWindowUtc', () => {
  it('una jornada que no cruza medianoche coincide con el día calendario', () => {
    const { start, end } = jornadaWindowUtc('2026-09-11', TZ, '07:00', '23:00');
    expect(start.toISOString()).toBe('2026-09-11T10:00:00.000Z'); // 07:00 AR
    expect(end.toISOString()).toBe('2026-09-12T02:00:00.000Z');   // 23:00 AR
  });

  it('una jornada que cierra a la 01:00 termina en el día siguiente', () => {
    const { start, end } = jornadaWindowUtc('2026-09-11', TZ, '07:00', '01:00');
    expect(start.toISOString()).toBe('2026-09-11T10:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-12T04:00:00.000Z');   // 01:00 AR del 12
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/jornada.test.ts
```

Esperado: FAIL — las cuatro funciones no existen.

- [ ] **Step 3: Implementar los helpers**

En `backend/src/utils/tz.ts`, después de `cierreMin`:

```ts
/**
 * Minuto de una hora "HH:MM" dentro de la jornada que arranca en `apertura`. Una hora anterior
 * a la apertura pertenece al día siguiente y suma 1440: con apertura 07:00, "01:00" son 1500
 * minutos, no 60.
 *
 * Esta regla subsume a `cierreMin`, que sólo entiende "00:00" como fin de día. Para las
 * configuraciones que ya existen da exactamente el mismo resultado.
 */
export function minutoDeJornada(hhmm: string, apertura: string): number {
  const m = hhmmAMin(hhmm);
  return m < hhmmAMin(apertura) ? m + 1440 : m;
}

/** Etiqueta de un minuto de jornada, como lo diría un reloj: 1440 => "00:00", 1500 => "01:00". */
export function hhmmDeMin(m: number): string {
  const d = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
}

/**
 * Instante UTC del minuto `m` de la jornada de `fecha`. A partir de 1440 cruza al día siguiente.
 *
 * Se usa `combineDateTimeUtc` en las dos ramas —y no aritmética de milisegundos sobre el arranque
 * del día— para que siga siendo correcto ante un eventual cambio de huso.
 */
export function instanteDeJornada(fecha: string, m: number, timeZone: string): Date {
  return m < 1440
    ? combineDateTimeUtc(fecha, hhmmDeMin(m), timeZone)
    : combineDateTimeUtc(sumarDias(fecha, Math.floor(m / 1440)), hhmmDeMin(m), timeZone);
}

/** Ventana UTC real de la jornada: de la apertura al cierre, aunque cruce la medianoche. */
export function jornadaWindowUtc(fecha: string, timeZone: string, apertura: string, cierre: string): { start: Date; end: Date } {
  return {
    start: instanteDeJornada(fecha, hhmmAMin(apertura), timeZone),
    end: instanteDeJornada(fecha, minutoDeJornada(cierre, apertura), timeZone),
  };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/jornada.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/tz.ts backend/tests/unit/jornada.test.ts
git commit -m "feat(jornada): helpers de minuto, instante y ventana de jornada"
```

---

### Task 2: El precio razona en minutos de jornada

**Files:**
- Modify: `backend/src/services/precio.service.ts`
- Modify: `backend/src/services/disponibilidad.service.ts`, `reserva.service.ts`, `agenda.service.ts`, `turnoFijo.service.ts` (los cuatro llamadores)
- Test: `backend/tests/unit/precio-jornada.test.ts`

**Interfaces:**
- Consumes: `minutoDeJornada` de la Tarea 1.
- Produces: `precioDeRango(cancha, fecha, horaInicio, duracionMin, cfg)` donde `cfg` pasa a incluir `horaApertura` y `horaAperturaFinde` además de los cuatro campos de pico. El tipo `PicoCfg` se renombra a `JornadaCfg`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/unit/precio-jornada.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { precioDeRango } from '../../src/services/precio.service.js';

beforeAll(() => { process.env.TZ_NEGOCIO ||= 'America/Argentina/Buenos_Aires'; });

const cancha = { precioHora: 30000, precioHoraPico: 40000 };
// 2026-09-11 es viernes (día de semana).
const VIERNES = '2026-09-11';

// Complejo 07:00 a 01:00, pico de 20:00 hasta el cierre.
const cfg = {
  horaApertura: '07:00', horaAperturaFinde: '07:00',
  picoDesde: '20:00', picoHasta: '01:00',
  picoFindeDesde: '20:00', picoFindeHasta: '01:00',
};

describe('precio con jornada que cruza medianoche', () => {
  it('el turno de las 00:00 se cobra a precio PICO, no base', () => {
    expect(precioDeRango(cancha, VIERNES, '00:00', 60, cfg)).toBe(40000);
  });

  it('un turno de 21:00 dentro del pico también', () => {
    expect(precioDeRango(cancha, VIERNES, '21:00', 60, cfg)).toBe(40000);
  });

  it('un turno de la mañana sigue a precio base', () => {
    expect(precioDeRango(cancha, VIERNES, '10:00', 60, cfg)).toBe(30000);
  });

  it('un turno de 90 minutos que arranca 23:30 se prorratea cruzando la medianoche', () => {
    // 23:30 a 01:00: los 90 minutos caen enteros dentro del pico (20:00 a 01:00).
    expect(precioDeRango(cancha, VIERNES, '23:30', 90, cfg)).toBe(60000);
  });

  it('un turno que arranca antes del pico se prorratea', () => {
    // 19:00 a 21:00: 60 min base + 60 min pico.
    expect(precioDeRango(cancha, VIERNES, '19:00', 120, cfg)).toBe(70000);
  });
});

describe('regresión: las configuraciones de hoy dan el mismo precio', () => {
  const cfgHoy = {
    horaApertura: '16:00', horaAperturaFinde: '16:00',
    picoDesde: '18:00', picoHasta: '00:00',
    picoFindeDesde: '18:00', picoFindeHasta: '00:00',
  };

  it('pico que termina a medianoche, sin cruzarla', () => {
    expect(precioDeRango(cancha, VIERNES, '19:00', 60, cfgHoy)).toBe(40000);
    expect(precioDeRango(cancha, VIERNES, '23:00', 60, cfgHoy)).toBe(40000);
    expect(precioDeRango(cancha, VIERNES, '17:00', 60, cfgHoy)).toBe(30000);
  });

  it('prorrateo de 17:00 a 19:00: una hora base y una pico', () => {
    expect(precioDeRango(cancha, VIERNES, '17:00', 120, cfgHoy)).toBe(70000);
  });

  it('sin franja pico cargada, todo es precio base', () => {
    const sinPico = { horaApertura: '16:00', horaAperturaFinde: '16:00', picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '' };
    expect(precioDeRango(cancha, VIERNES, '21:00', 60, sinPico)).toBe(30000);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/precio-jornada.test.ts
```

Esperado: FAIL. El turno de las 00:00 da 30000 en vez de 40000, y el pico `20:00`→`01:00` no aplica nunca.

- [ ] **Step 3: Migrar `precioDeRango` a minutos de jornada**

En `backend/src/services/precio.service.ts`, reemplazar el import y la interfaz:

```ts
import { dayOfWeekInTz, minutoDeJornada } from '../utils/tz.js';

interface JornadaCfg {
  horaApertura: string; horaAperturaFinde: string;
  picoDesde: string; picoHasta: string;
  picoFindeDesde: string; picoFindeHasta: string;
}
```

Y el cuerpo de `precioDeRango`, desde el cálculo del día de semana hasta el final:

```ts
export function precioDeRango(
  cancha: CanchaPrecio,
  fecha: string,
  horaInicio: string,
  duracionMin: number,
  cfg: JornadaCfg,
): number {
  const { base, pico } = tarifasDe(cancha, duracionMin);
  if (!(pico > 0)) return Math.round((duracionMin * base) / 60);

  const wd = dayOfWeekInTz(fecha, getEnv().TZ_NEGOCIO); // 0=domingo..6=sábado
  const esFinde = wd === 0 || wd === 6;
  const apertura = esFinde ? cfg.horaAperturaFinde : cfg.horaApertura;
  const desdeStr = esFinde ? cfg.picoFindeDesde : cfg.picoDesde;
  const hastaStr = esFinde ? cfg.picoFindeHasta : cfg.picoHasta;
  if (!desdeStr || !hastaStr) return Math.round((duracionMin * base) / 60);

  // Todo en minutos de jornada: una hora anterior a la apertura pertenece al día siguiente.
  // Sin esto, un pico de 20:00 a 01:00 se leía como [1200, 60) —invertido— y la función caía al
  // precio base anulando el pico todo el día; y el turno de las 00:00 se leía como el minuto 0,
  // así que no caía dentro de ninguna franja y el turno más caro salía al precio más barato.
  const desde = minutoDeJornada(desdeStr, apertura);
  const hasta = minutoDeJornada(hastaStr, apertura);
  if (desde >= hasta) return Math.round((duracionMin * base) / 60);

  const ini = minutoDeJornada(horaInicio, apertura);
  const fin = ini + duracionMin;
  const minutosPico = Math.max(0, Math.min(fin, hasta) - Math.max(ini, desde));
  const minutosBase = duracionMin - minutosPico;
  return Math.round((minutosPico * pico + minutosBase * base) / 60);
}
```

- [ ] **Step 4: Actualizar los cuatro llamadores**

Los cuatro ya reciben el `cfg` completo de `configService.get()`, que **ya incluye** `horaApertura` y `horaAperturaFinde`. Verificá que compila sin cambios en las llamadas:

```bash
cd backend && npm run typecheck
```

Si algún llamador arma un objeto parcial en vez de pasar el `cfg` entero, completalo con los dos campos de apertura. Los llamadores son:
`disponibilidad.service.ts:75`, `disponibilidad.service.ts:145`, `reserva.service.ts:134`, `agenda.service.ts:57`, `turnoFijo.service.ts:198`.

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/precio-jornada.test.ts tests/unit/precio.service.test.ts
```

Esperado: PASS los dos archivos. El de `precio.service.test.ts` es el de regresión que ya existía: **si rompe, rompiste los precios actuales.**

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/precio.service.ts backend/tests/unit/precio-jornada.test.ts
git commit -m "fix(precio): pico y reserva en minutos de jornada"
```

---

### Task 3: La ocupación razona en minutos de jornada

**Files:**
- Modify: `backend/src/services/ocupacion.service.ts`
- Modify: `backend/src/services/bloqueo.service.ts`, `turnoFijo.service.ts` (los llamadores)
- Test: `backend/tests/integration/ocupacion-jornada.test.ts`

**Interfaces:**
- Consumes: `minutoDeJornada` de la Tarea 1.
- Produces: `rangosPlantilla(canchaId, fecha)` devuelve rangos en minutos de jornada; `conflictoReserva` y `conflictoAlCrear` reciben y comparan minutos de jornada.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/ocupacion-jornada.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { ocupacionService } from '../../src/services/ocupacion.service.js';

let canchaId: string;
beforeAll(setupTestDb);
afterAll(teardownTestDb);

const EN_30 = new Date(Date.now() + 30 * 86400000);
const FECHA = EN_30.toISOString().slice(0, 10);
const DIA = new Date(FECHA + 'T12:00:00.000Z').getUTCDay();

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  await p.configuracion.upsert({
    where: { id: 'default' },
    create: { id: 'default', horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00' },
    update: { horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00' },
  });
  const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } });
  canchaId = c.id;
  const s = await p.sector.create({ data: { nombre: 'S1' } });
  await p.canchaSector.create({ data: { canchaId, sectorId: s.id } });
});

describe('ocupación en una jornada que cierra a la 01:00', () => {
  it('un fijo de 23:00 a 01:00 ocupa [1380, 1500), no un rango negativo', async () => {
    await getPrisma().turnoFijo.create({
      data: { canchaId, clienteNombre: 'Juan', diaSemana: DIA, horaInicio: '23:00', horaFin: '01:00', activo: true },
    });
    const rangos = await ocupacionService.rangosPlantilla(canchaId, FECHA);
    expect(rangos[0]).toMatchObject({ ini: 1380, fin: 1500, tipo: 'fijo' });
  });

  it('un fijo de 00:00 a 01:00 ocupa [1440, 1500)', async () => {
    await getPrisma().turnoFijo.create({
      data: { canchaId, clienteNombre: 'Ana', diaSemana: DIA, horaInicio: '00:00', horaFin: '01:00', activo: true },
    });
    const rangos = await ocupacionService.rangosPlantilla(canchaId, FECHA);
    expect(rangos[0]).toMatchObject({ ini: 1440, fin: 1500, tipo: 'fijo' });
  });

  it('ese fijo choca con un turno de las 00:00 y no con uno de las 23:00', async () => {
    await getPrisma().turnoFijo.create({
      data: { canchaId, clienteNombre: 'Ana', diaSemana: DIA, horaInicio: '00:00', horaFin: '01:00', activo: true },
    });
    expect(await ocupacionService.conflictoReserva(canchaId, FECHA, 1440, 1500)).toBe('fijo');
    expect(await ocupacionService.conflictoReserva(canchaId, FECHA, 1380, 1440)).toBeNull();
  });

  it('un bloqueo de 00:00 a 01:00 también ocupa su rango', async () => {
    await getPrisma().bloqueo.create({
      data: { canchaId, motivo: 'MANTENIMIENTO', recurrente: true, diaSemana: DIA, horaInicio: '00:00', horaFin: '01:00', activo: true },
    });
    const rangos = await ocupacionService.rangosPlantilla(canchaId, FECHA);
    expect(rangos[0]).toMatchObject({ ini: 1440, fin: 1500, tipo: 'bloqueo' });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/ocupacion-jornada.test.ts
```

Esperado: FAIL. El fijo `23:00`→`01:00` da `fin: 60` (rango negativo) y el de `00:00` da `ini: 0`.

- [ ] **Step 3: Migrar `ocupacion.service.ts`**

Reemplazar los helpers locales por los de jornada. `rangosPlantilla` necesita la apertura del día, que sale de `configService`:

```ts
import { dayOfWeekInTz, minutoDeJornada } from '../utils/tz.js';
import { configService } from './config.service.js';
```

En `rangosPlantilla`, después de calcular `dia`:

```ts
const cfg = await configService.get();
const esFinde = dia === 0 || dia === 6;
const apertura = esFinde ? cfg.horaAperturaFinde : cfg.horaApertura;
```

Y los dos `out.push` pasan a usar la apertura:

```ts
for (const f of fijos) if (f.excepciones.length === 0) out.push({ ini: minutoDeJornada(f.horaInicio, apertura), fin: minutoDeJornada(f.horaFin, apertura), tipo: 'fijo' });
```

```ts
for (const b of bloqueos) if (b.excepciones.length === 0) out.push({ ini: minutoDeJornada(b.horaInicio, apertura), fin: minutoDeJornada(b.horaFin, apertura), tipo: 'bloqueo' });
```

En `conflictoAlCrear`, la rama de `diaSemana` (hoy con `fromHHMM`/`finHHMM`) usa la misma apertura, y la comparación contra reservas usa el minuto de jornada del instante. Para eso, `partesAr` devuelve además el minuto relativo a la apertura:

```ts
// El minuto de jornada de un instante: si cae antes de la apertura, pertenece a la jornada
// anterior y suma 1440. Es la misma regla que `minutoDeJornada`, aplicada a un timestamp.
const minJornada = (p: { min: number }, apertura: string) =>
  p.min < hhmmAMin(apertura) ? p.min + 1440 : p.min;
```

y el `overlap` pasa a:

```ts
const iniAr = minJornada(pi, apertura);
const finAr = pf.dia !== pi.dia ? pf.min + 1440 : minJornada(pf, apertura);
const overlap = iniAr < finMin && iniMin < finAr;
```

- [ ] **Step 4: Actualizar los dos llamadores**

`bloqueo.service.ts:13` y `turnoFijo.service.ts:57` hoy convierten con `fromHHMM(horaInicio)` y `cierreMin(horaFin)`. Pasan a `minutoDeJornada(...)` con la apertura del día correspondiente, que obtienen de `configService.get()`.

- [ ] **Step 5: Correr los tests**

```bash
cd backend && npx vitest run tests/integration/ocupacion-jornada.test.ts tests/integration/ocupacion-medianoche.test.ts tests/integration/fijos-bloqueos.test.ts
```

Esperado: PASS los tres. `ocupacion-medianoche.test.ts` y `fijos-bloqueos.test.ts` son la regresión.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ocupacion.service.ts backend/src/services/bloqueo.service.ts backend/src/services/turnoFijo.service.ts backend/tests/integration/ocupacion-jornada.test.ts
git commit -m "fix(ocupacion): rangos de fijos y bloqueos en minutos de jornada"
```

---

### Task 4: La grilla publica la jornada completa

**Files:**
- Modify: `backend/src/services/disponibilidad.service.ts`
- Test: `backend/tests/integration/grilla-jornada.test.ts`

**Interfaces:**
- Consumes: `minutoDeJornada`, `hhmmDeMin`, `instanteDeJornada`, `jornadaWindowUtc` de la Tarea 1.
- Produces: `disponibilidadService.listar` publica slots hasta el cierre de la jornada, etiquetados con `hhmmDeMin`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/grilla-jornada.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { disponibilidadService } from '../../src/services/disponibilidad.service.js';

let canchaId: string;
beforeAll(setupTestDb);
afterAll(teardownTestDb);

const FECHA = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

async function configurar(horaCierre: string) {
  await getPrisma().configuracion.upsert({
    where: { id: 'default' },
    create: { id: 'default', horaApertura: '07:00', horaCierre, horaAperturaFinde: '07:00', horaCierreFinde: horaCierre },
    update: { horaApertura: '07:00', horaCierre, horaAperturaFinde: '07:00', horaCierreFinde: horaCierre },
  });
}

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } });
  canchaId = c.id;
  const s = await p.sector.create({ data: { nombre: 'S1' } });
  await p.canchaSector.create({ data: { canchaId, sectorId: s.id } });
});

describe('grilla con jornada que cierra a la 01:00', () => {
  it('publica el turno de las 00:00', async () => {
    await configurar('01:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas).toContain('23:00');
    expect(horas).toContain('00:00');
    expect(horas).not.toContain('24:00'); // la etiqueta es de reloj, no de minutos
  });

  it('el turno de las 00:00 apunta al instante del día siguiente', async () => {
    await configurar('01:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    const medianoche = slots.find((s) => s.horaInicio === '00:00')!;
    const esperado = new Date(`${FECHA}T00:00:00.000-03:00`);
    esperado.setDate(esperado.getDate() + 1);
    expect(new Date(medianoche.inicioUtc).toISOString()).toBe(esperado.toISOString());
  });

  it('no publica nada después del cierre', async () => {
    await configurar('01:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    expect(slots.map((s) => s.horaInicio)).not.toContain('01:00');
  });
});

describe('regresión: las configuraciones de hoy publican lo mismo', () => {
  it('con cierre 23:00 el último turno de pádel es 22:00', async () => {
    await configurar('23:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas[horas.length - 1]).toBe('22:00');
    expect(horas).not.toContain('23:00');
  });

  it('con cierre 00:00 el último turno de pádel es 23:00', async () => {
    await configurar('00:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas[horas.length - 1]).toBe('23:00');
    expect(horas).not.toContain('00:00');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/grilla-jornada.test.ts
```

Esperado: FAIL en los tres primeros casos; los dos de regresión deberían pasar ya.

- [ ] **Step 3: Migrar `listar`**

En `backend/src/services/disponibilidad.service.ts`:

- Reemplazar el import: `import { combineDateTimeUtc, jornadaWindowUtc, minutoDeJornada, hhmmDeMin, instanteDeJornada, dayOfWeekInTz } from '../utils/tz.js';`
- Borrar los helpers locales `toHHMM` y `fromHHMM` (los reemplazan `hhmmDeMin` y `hhmmAMin`).
- La ventana de ocupación pasa a ser la de la jornada:

```ts
const { apertura, cierre } = horarioDe(fecha, tz, cfg);
// Ventana de la JORNADA, no del día calendario: con la ventana de 24 horas, una reserva a las
// 00:00 cae afuera y la grilla la mostraría libre estando ocupada.
const { start, end } = jornadaWindowUtc(fecha, tz, apertura, cierre);
```

- El tope del loop y el conversor de instantes:

```ts
const cierreM = minutoDeJornada(cierre, apertura);
const utcDe = (m: number) => {
  let d = cacheUtc.get(m);
  if (!d) { d = instanteDeJornada(fecha, m, tz); cacheUtc.set(m, d); }
  return d;
};
```

- Todas las llamadas a `toHHMM(...)` pasan a `hhmmDeMin(...)`, y el arranque del loop a `hhmmAMin(apertura)`.
- `precioDeRango(cancha, fecha, hhmmDeMin(t), min, cfg)` sigue igual: la Tarea 2 ya hace que interprete la hora en minutos de jornada.

- [ ] **Step 4: Correr los tests**

```bash
cd backend && npx vitest run tests/integration/grilla-jornada.test.ts tests/integration/disponibilidad.test.ts
```

Esperado: PASS los dos.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/disponibilidad.service.ts backend/tests/integration/grilla-jornada.test.ts
git commit -m "feat(grilla): publicar la jornada completa, incluido el turno de las 00:00"
```

---

### Task 5: Crear y reprogramar dentro de la jornada

**Files:**
- Modify: `backend/src/services/reserva.service.ts`
- Test: `backend/tests/integration/reserva-jornada.test.ts`

**Interfaces:**
- Consumes: `minutoDeJornada`, `instanteDeJornada` de la Tarea 1; la ocupación de la Tarea 3.
- Produces: `POST /reservas` acepta `horaInicio: "00:00"` y guarda el instante del día siguiente.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/reserva-jornada.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { disponibilidadService } from '../../src/services/disponibilidad.service.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

const FECHA = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  await p.configuracion.upsert({
    where: { id: 'default' },
    create: { id: 'default', horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00' },
    update: { horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00' },
  });
  const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } });
  canchaId = c.id;
  const s = await p.sector.create({ data: { nombre: 'S1' } });
  await p.canchaSector.create({ data: { canchaId, sectorId: s.id } });
});

const crear = (horaInicio: string, whatsapp = '+5491150000000') =>
  supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp, nombreCliente: 'Juan', esContacto: true, fecha: FECHA, horaInicio,
  });

describe('reservar dentro de la jornada', () => {
  it('se puede reservar el turno de las 00:00', async () => {
    const res = await crear('00:00');
    expect(res.status).toBe(201);
  });

  it('ese turno se guarda con el instante del día siguiente', async () => {
    const res = await crear('00:00');
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    const esperado = new Date(`${FECHA}T00:00:00.000-03:00`);
    esperado.setDate(esperado.getDate() + 1);
    expect(r!.fechaInicio.toISOString()).toBe(esperado.toISOString());
  });

  it('una vez reservado, la grilla DEJA de ofrecerlo', async () => {
    // Este es el caso que prueba que la ventana de ocupación se migró de verdad. Si la grilla
    // sigue preguntando por 24 horas, el turno de las 00:00 cae afuera y se ofrece igual.
    await crear('00:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    expect(slots.map((s) => s.horaInicio)).not.toContain('00:00');
  });

  it('rechaza un turno que termina después del cierre', async () => {
    const res = await crear('00:30');
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/reserva-jornada.test.ts
```

Esperado: FAIL — `crear('00:00')` devuelve 422 porque el cierre se lee como 60 minutos.

- [ ] **Step 3: Migrar `crear`**

En `backend/src/services/reserva.service.ts`, dentro de `crear`:

```ts
const dow = dayOfWeekInTz(input.fecha, tz);
const esFinde = dow === 0 || dow === 6;
const apertura = esFinde ? cfg.horaAperturaFinde : cfg.horaApertura;
const cierre = minutoDeJornada(esFinde ? cfg.horaCierreFinde : cfg.horaCierre, apertura);

// En minutos de jornada: una hora anterior a la apertura pertenece al día siguiente, así que
// "00:00" son 1440 y el turno termina a los 1500, dentro de un cierre a la 01:00.
const iniMin = minutoDeJornada(input.horaInicio, apertura);
const finMin = iniMin + duracionMin;
if (finMin > cierre) throw BusinessRule('La reserva termina después del horario de cierre');
```

Y el instante pasa a resolverse con la jornada:

```ts
const fechaInicio = instanteDeJornada(input.fecha, iniMin, tz);
const fechaFin = new Date(fechaInicio.getTime() + duracionMin * 60 * 1000);
```

**Ojo con el orden:** hoy `fechaInicio` se calcula antes que `iniMin`. Hay que moverlo después, porque ahora depende de él. Y el chequeo `fechaInicio.getTime() <= Date.now()` sigue igual, después del cambio.

- [ ] **Step 4: Migrar `reprogramar`**

Mismo tratamiento en `reprogramar` (línea ~382): la apertura del nuevo día, `minutoDeJornada` para el cierre y para la hora, e `instanteDeJornada` para el instante.

- [ ] **Step 5: Correr los tests**

```bash
cd backend && npx vitest run tests/integration/reserva-jornada.test.ts tests/integration/sena.test.ts tests/integration/reprogramar.test.ts
```

Esperado: PASS. Los dos últimos son la regresión.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/reserva.service.ts backend/tests/integration/reserva-jornada.test.ts
git commit -m "feat(reservas): crear y reprogramar dentro de la jornada del complejo"
```

---

### Task 6: La agenda del día es la de la jornada

**Files:**
- Modify: `backend/src/services/agenda.service.ts`, `backend/src/services/reserva.service.ts` (`list`)
- Test: `backend/tests/integration/agenda-jornada.test.ts`

**Interfaces:**
- Consumes: `jornadaWindowUtc` de la Tarea 1.
- Produces: `reservaService.list({ fecha })` y `agendaService.delDia(fecha)` devuelven la jornada.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/agenda-jornada.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { agendaService } from '../../src/services/agenda.service.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

const FECHA = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const SIGUIENTE = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  await p.configuracion.upsert({
    where: { id: 'default' },
    create: { id: 'default', horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00' },
    update: { horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00' },
  });
  const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } });
  canchaId = c.id;
  const s = await p.sector.create({ data: { nombre: 'S1' } });
  await p.canchaSector.create({ data: { canchaId, sectorId: s.id } });
});

const crear = (horaInicio: string, whatsapp = '+5491150000000') =>
  supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp, nombreCliente: 'Juan', esContacto: true, fecha: FECHA, horaInicio,
  });

describe('la agenda del día es la de la jornada', () => {
  it('el turno de las 00:00 aparece en la agenda de SU jornada, no en la del día siguiente', async () => {
    await crear('00:00');
    const agenda = await agendaService.delDia(FECHA);
    expect(agenda.reservas).toHaveLength(1);

    const agendaSiguiente = await agendaService.delDia(SIGUIENTE);
    expect(agendaSiguiente.reservas).toHaveLength(0);
  });

  it('el turno de las 23:00 sigue apareciendo en su día', async () => {
    await crear('23:00');
    expect((await agendaService.delDia(FECHA)).reservas).toHaveLength(1);
  });

  it('buscar por nombre y fecha también encuentra el turno de las 00:00', async () => {
    await crear('00:00');
    const { reservaService } = await import('../../src/services/reserva.service.js');
    const encontradas = await reservaService.buscar({ nombre: 'Juan', fecha: FECHA });
    expect(encontradas).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run tests/integration/agenda-jornada.test.ts
```

Esperado: FAIL — el turno de las 00:00 aparece en la agenda del día siguiente.

- [ ] **Step 3: Migrar `reservaService.list` y `agendaService.delDia`**

Los tres puntos usan el mismo helper. En `reserva.service.ts`, tanto el filtro por `fecha` de `list` como la ventana de `buscar` (hoy `dayWindowUtc(input.fecha, tz)`):

```ts
// La agenda de un día es la de su JORNADA: el turno de las 00:00 pertenece al día anterior.
// `caja`, `alquileres` y `analytics` NO usan esto — responden preguntas contables por día
// calendario, y ahí la fecha del instante es la correcta.
const cfg = await configService.get();
const dow = dayOfWeekInTz(fecha, tz);
const esFinde = dow === 0 || dow === 6;
const { start, end } = jornadaWindowUtc(
  fecha, tz,
  esFinde ? cfg.horaAperturaFinde : cfg.horaApertura,
  esFinde ? cfg.horaCierreFinde : cfg.horaCierre,
);
```

En `agenda.service.ts`, `inicioDia`/`finDia` (hoy `combineDateTimeUtc(fecha, '00:00')` y `+86400000`) se reemplazan por esa misma ventana, y se usan tal cual en el `findMany` de fijos materializados.

**Lo que NO se toca, y es deliberado:** `caja.service.ts`, `alquiler.service.ts` y `analytics.routes.ts` siguen usando `dayWindowUtc`. Responden preguntas contables por día calendario, no de agenda.

- [ ] **Step 4: Correr los tests**

```bash
cd backend && npx vitest run tests/integration/agenda-jornada.test.ts tests/integration/agenda.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/agenda.service.ts backend/src/services/reserva.service.ts backend/tests/integration/agenda-jornada.test.ts
git commit -m "feat(agenda): la agenda del dia es la de la jornada"
```

---

### Task 7: Columnas de horas del espejo de Sheets

**Files:**
- Modify: `backend/src/services/sheets/sheetsData.ts`
- Test: `backend/tests/unit/sheets-horas-jornada.test.ts`

**Interfaces:**
- Consumes: `minutoDeJornada`, `hhmmDeMin` de la Tarea 1.
- Produces: `horasDeConfig(horaApertura, horaCierre)` devuelve las horas de la jornada.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest';
import { horasDeConfig } from '../../src/services/sheets/sheetsData.js';

describe('horasDeConfig', () => {
  it('una jornada que cierra a la 01:00 llega hasta las 00:00', () => {
    const horas = horasDeConfig('07:00', '01:00');
    expect(horas[0]).toBe('07:00');
    expect(horas[horas.length - 1]).toBe('00:00');
    expect(horas).toHaveLength(18); // 07:00..00:00
  });

  it('regresión: con cierre 23:00 no cambia', () => {
    const horas = horasDeConfig('16:00', '23:00');
    expect(horas).toEqual(['16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00']);
  });

  it('regresión: con cierre 00:00 tampoco', () => {
    const horas = horasDeConfig('16:00', '00:00');
    expect(horas[horas.length - 1]).toBe('23:00');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/sheets-horas-jornada.test.ts
```

- [ ] **Step 3: Migrar `horasDeConfig`**

```ts
export function horasDeConfig(horaApertura: string, horaCierre: string): string[] {
  const out: string[] = [];
  const fin = minutoDeJornada(horaCierre, horaApertura);
  for (let m = hhmmAMin(horaApertura); m + 60 <= fin; m += 60) out.push(hhmmDeMin(m));
  return out;
}
```

Y en `dataSemana`, la comparación `cierreU` pasa a usar `minutoDeJornada` con la apertura unificada.

- [ ] **Step 4: Correr los tests**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/sheets-horas-jornada.test.ts
cd backend && npx vitest run tests/integration/sheets.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sheets/sheetsData.ts backend/tests/unit/sheets-horas-jornada.test.ts
git commit -m "feat(sheets): columnas de horas de la jornada completa"
```

---

### Task 8: Habilitar la configuración — el interruptor

**Files:**
- Modify: `backend/src/validators/config.schema.ts`, `backend/src/services/config.service.ts`
- Modify: `frontend/src/lib/validators.ts`, `frontend/src/components/config/config-form.tsx`
- Test: `backend/tests/unit/config-jornada.test.ts`, `frontend/src/lib/validators.test.ts`

**Interfaces:**
- Consumes: `minutoDeJornada` de la Tarea 1.
- Produces: la configuración acepta un cierre posterior a la medianoche.

**Esta es la tarea que enciende la feature.** Va última a propósito: todo lo que la hace segura está antes, así que en ningún punto de la historia de la rama se puede guardar una configuración que el motor no sabe atender.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest';
import { updateConfigSchema } from '../../src/validators/config.schema.js';

const base = { query: {}, params: {} };
const parsear = (body: Record<string, unknown>) => updateConfigSchema.safeParse({ ...base, body });

describe('cierre posterior a la medianoche', () => {
  it('acepta abrir 07:00 y cerrar 01:00', () => {
    expect(parsear({ horaApertura: '07:00', horaCierre: '01:00' }).success).toBe(true);
    expect(parsear({ horaAperturaFinde: '07:00', horaCierreFinde: '02:00' }).success).toBe(true);
  });

  it('sigue aceptando los cierres de hoy', () => {
    expect(parsear({ horaApertura: '07:00', horaCierre: '23:00' }).success).toBe(true);
    expect(parsear({ horaApertura: '07:00', horaCierre: '00:00' }).success).toBe(true);
  });

  it('rechaza una jornada de duración cero', () => {
    expect(parsear({ horaApertura: '07:00', horaCierre: '07:00' }).success).toBe(false);
  });

  it('acepta el pico corriendo hasta un cierre de madrugada', () => {
    expect(parsear({ horaApertura: '07:00', picoDesde: '20:00', picoHasta: '01:00' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/config-jornada.test.ts
```

- [ ] **Step 3: Migrar las tres copias de la validación**

En `backend/src/validators/config.schema.ts`, los cuatro refines:

```ts
    // `minutoDeJornada` y no `cierreMin`: con apertura 07:00, un cierre a la 01:00 son 1500
    // minutos, no 60. Para los cierres de hoy (23:00, 00:00) da exactamente lo mismo.
    .refine((b) => !(b.horaApertura && b.horaCierre) || hhmmAMin(b.horaApertura) < minutoDeJornada(b.horaCierre, b.horaApertura), { message: 'La apertura (semana) debe ser anterior al cierre', path: ['horaCierre'] })
    .refine((b) => !(b.horaAperturaFinde && b.horaCierreFinde) || hhmmAMin(b.horaAperturaFinde) < minutoDeJornada(b.horaCierreFinde, b.horaAperturaFinde), { message: 'La apertura (finde) debe ser anterior al cierre', path: ['horaCierreFinde'] })
    .refine((b) => !(b.picoDesde && b.picoHasta && b.horaApertura) || minutoDeJornada(b.picoDesde, b.horaApertura) < minutoDeJornada(b.picoHasta, b.horaApertura), { message: 'La franja pico (semana) es inválida', path: ['picoHasta'] })
    .refine((b) => !(b.picoFindeDesde && b.picoFindeHasta && b.horaAperturaFinde) || minutoDeJornada(b.picoFindeDesde, b.horaAperturaFinde) < minutoDeJornada(b.picoFindeHasta, b.horaAperturaFinde), { message: 'La franja pico (finde) es inválida', path: ['picoFindeHasta'] }),
```

**Ojo con el PATCH parcial:** el schema valida sólo lo que viene en el body, así que un PATCH que manda `picoHasta` sin `horaApertura` no puede resolver la jornada. Por eso los refines del pico exigen que la apertura venga en el mismo body. La validación completa, sobre los valores **efectivos** (patch + lo guardado), es la de `config.service.ts`, que sí tiene los dos:

```ts
    const ap = (patch.horaApertura ?? current.horaApertura) as string;
    const ci = (patch.horaCierre ?? current.horaCierre) as string;
    if (hhmmAMin(ap) >= minutoDeJornada(ci, ap)) throw BusinessRule('La apertura (semana) debe ser anterior al cierre');
    const apF = (patch.horaAperturaFinde ?? current.horaAperturaFinde) as string;
    const ciF = (patch.horaCierreFinde ?? current.horaCierreFinde) as string;
    if (hhmmAMin(apF) >= minutoDeJornada(ciF, apF)) throw BusinessRule('La apertura (finde) debe ser anterior al cierre');
    const pd = (patch.picoDesde ?? current.picoDesde) as string;
    const ph = (patch.picoHasta ?? current.picoHasta) as string;
    if (pd && ph && minutoDeJornada(pd, ap) >= minutoDeJornada(ph, ap)) throw BusinessRule('La franja pico (semana) es inválida');
    const pfd = (patch.picoFindeDesde ?? current.picoFindeDesde) as string;
    const pfh = (patch.picoFindeHasta ?? current.picoFindeHasta) as string;
    if (pfd && pfh && minutoDeJornada(pfd, apF) >= minutoDeJornada(pfh, apF)) throw BusinessRule('La franja pico (finde) es inválida');
```

Y en `frontend/src/lib/validators.ts`, los cuatro refines del `configSchema` con la misma forma, usando el `minutoDeJornada` que la Tarea 9 agrega a `hora.ts`. **Por eso la Tarea 9 se puede hacer antes que ésta si conviene** — el helper del panel es su única dependencia cruzada.

- [ ] **Step 4: Actualizar el texto de ayuda del formulario**

En `config-form.tsx`, el texto que hoy dice *"Cerrar a las 00:00 = medianoche (último turno 23:00 a 00:00)"* pasa a explicar también la madrugada:

```tsx
<p className="text-xs text-neutral-500">
  Cerrar a las 00:00 = medianoche (último turno 23:00 a 00:00). Si el complejo sigue abierto
  después de medianoche, poné la hora de cierre real: 01:00 deja el último turno de 00:00 a 01:00.
</p>
```

- [ ] **Step 5: Correr los tests**

```bash
cd backend && npx vitest run --config vitest.unit.config.ts tests/unit/config-jornada.test.ts tests/unit/config-pico-medianoche.test.ts
cd frontend && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/validators/config.schema.ts backend/src/services/config.service.ts frontend/src/lib/validators.ts frontend/src/lib/validators.test.ts frontend/src/components/config/config-form.tsx backend/tests/unit/config-jornada.test.ts
git commit -m "feat(config): aceptar un cierre posterior a la medianoche"
```

---

### Task 9: El calendario del panel muestra la jornada

**Files:**
- Modify: `frontend/src/lib/hora.ts`, `frontend/src/lib/calendario.ts`
- Test: `frontend/src/lib/calendario.test.ts`

**Interfaces:**
- Consumes: nada del backend; espeja `minutoDeJornada` y `hhmmDeMin`.
- Produces: `horasDelDia(apertura, cierre)` devuelve las horas de la jornada.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `frontend/src/lib/calendario.test.ts`:

```ts
describe('horasDelDia con jornada que cruza medianoche', () => {
  it('con cierre 01:00 llega hasta las 00:00', () => {
    const horas = horasDelDia('07:00', '01:00');
    expect(horas[horas.length - 1]).toBe('00:00');
    expect(horas).not.toContain('01:00');
  });

  it('regresión: con cierre 23:00 no cambia', () => {
    expect(horasDelDia('16:00', '23:00')).toEqual(['16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00']);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd frontend && npx vitest run src/lib/calendario.test.ts
```

- [ ] **Step 3: Agregar `minutoDeJornada` y `hhmmDeMin` a `hora.ts`**

Espejo exacto de los del backend. `hhmmAMin` ya existe ahí (lo agregó `d74eb4d`):

```ts
/**
 * Minuto de una hora "HH:MM" dentro de la jornada que arranca en `apertura`. Una hora anterior
 * a la apertura pertenece al día siguiente y suma 1440: con apertura 07:00, "01:00" son 1500.
 * Espejo de `minutoDeJornada` del backend.
 */
export function minutoDeJornada(hhmm: string, apertura: string): number {
  const m = hhmmAMin(hhmm);
  return m < hhmmAMin(apertura) ? m + 1440 : m;
}

/** Etiqueta de un minuto de jornada, como lo diría un reloj: 1440 => "00:00", 1500 => "01:00". */
export function hhmmDeMin(m: number): string {
  const d = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Migrar `horasDelDia` en `calendario.ts`**

```ts
export function horasDelDia(apertura: string, cierre: string): string[] {
  const out: string[] = [];
  const fin = minutoDeJornada(cierre, apertura);
  for (let m = hhmmAMin(apertura); m + 60 <= fin; m += 60) out.push(hhmmDeMin(m));
  return out;
}
```

- [ ] **Step 5: Correr los tests y el build**

```bash
cd frontend && pnpm test && pnpm typecheck && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/hora.ts frontend/src/lib/calendario.ts frontend/src/lib/calendario.test.ts
git commit -m "feat(panel): el calendario muestra la jornada completa"
```

---

### Task 10: El sitio público y el cierre

**Files:**
- Modify: `reservas/src/components/pantalla-reserva.tsx` (sólo si hace falta)
- Test: verificación manual con curl

**Interfaces:**
- Consumes: la grilla de la Tarea 4, que ya entrega `horaInicio: "00:00"`.

- [ ] **Step 1: Verificar que el sitio público ya funciona sin cambios**

El sitio consume `horaInicio` y `duraciones[].precio` del backend y los muestra tal cual, así que el turno de las 00:00 debería aparecer solo. Verificalo con el backend local:

```bash
cd backend && npm run dev
```

y en otra terminal, con la configuración en 07:00→01:00:

```bash
curl -s 'http://localhost:3000/disponibilidad/grilla?deporte=padel&fecha=<FECHA>' -H 'x-api-key: <la de backend/.env>' | grep -o '"horaInicio":"[^"]*"' | tail -5
```

Esperado: aparece `"horaInicio":"00:00"` al final.

**Regla dura:** `reservas/.env` apunta a la **API de producción del cliente**. Si levantás el sitio, hacelo con override inline (`API_URL=http://localhost:3000 SERVICE_API_KEY=<la local> PORT=3001 pnpm dev`). **Prohibido editar cualquier `.env`** y prohibido correr nada contra producción.

- [ ] **Step 2: Ordenar las horas si hiciera falta**

Si el sitio ordena las horas como texto, `"00:00"` quedaría **primero** en vez de último. Verificalo en la pantalla; si pasa, ordenar por minuto de jornada en vez de alfabéticamente.

- [ ] **Step 3: Verificación final de las tres suites**

```bash
cd backend  && npm run typecheck && npm test
cd frontend && pnpm typecheck && pnpm lint && pnpm test && pnpm build
cd reservas && pnpm lint && pnpm test && pnpm build
```

Con el criterio de "verde" de las Global Constraints. Bajá los servers al terminar.

- [ ] **Step 4: Commit**

```bash
git add reservas/src
git commit -m "feat(reservas): el turno de las 00:00 en el sitio publico"
```

---

## Cierre

- [ ] **Cambiar la configuración de producción**

Recién con todo desplegado, en **Configuración → horarios**: apertura `07:00`, cierre `01:00`. Ahí aparece el turno de las 00:00 y se recuperan los dos turnos perdidos por cancha por día.

- [ ] **Revisar la franja pico**

Con el cierre a la 01:00, lo más probable es que el pico tenga que correr hasta el cierre (`20:00`→`01:00`). Antes de este trabajo eso era imposible de guardar.

- [ ] **PR**

```bash
git push -u origin fix/horarios-medianoche
gh pr create --title "feat: la jornada del complejo cruza la medianoche" --body "Implementa docs/superpowers/specs/2026-09-11-jornada-del-complejo-design.md"
```

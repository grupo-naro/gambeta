# Hoja espejo idéntica al Excel (fijos + bloqueos + color por tipo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la hoja espejo de Google Sheets muestre, además de las reservas, los turnos fijos y bloqueos de la semana, coloreando por TIPO de turno (como el Excel del complejo).

**Architecture:** Una función pura `expandirSemana` combina reservas + fijos (expandidos por día de semana, salteando excepciones) + bloqueos (recurrentes y puntuales) en celdas por hora, con dedupe. `grilla.ts` colorea por tipo. `dataSemana` alimenta la función desde la DB y `escribirDia` (sin cambios) ya pinta el color por celda. Se agrega frescura al crear/editar fijos y bloqueos.

**Tech Stack:** Node + Express 5 + TypeScript, Prisma 7, Vitest (unit, sin Docker). Repo: `backend`, rama `main` (crear rama `feat/sheets-espejo-tipo`).

## Global Constraints

- Imports CON extensión `.js` (ESM/NodeNext).
- `dayOfWeekInTz(fecha, tz)` → 0=domingo … 6=sábado (helper existente en `utils/tz`).
- Formato de hora en la grilla: `"HH:00"` (turnos por hora). Expandir un turno `[horaInicio, horaFin)` a una fila por hora.
- Colores (texto del nombre) por tipo: fijo=negro `(0,0,0)`, suelto=rojo `(0.8,0,0)`, escuela=naranja `(0.9,0.45,0)`, torneo=violeta `(0.5,0.2,0.7)`, otro=gris `(0.4,0.4,0.4)`.
- Mapeo motivo→tipo: `TORNEO`→`torneo`, `ENTRENAMIENTO`→`escuela`, `MANTENIMIENTO`/`OTRO`→`otro`.
- Dedupe: si una reserva ya ocupa `canchaId|fecha|hora`, NO agregar fijo/bloqueo en esa clave.
- Tests: `npx vitest run <archivo>` (unit, sin Docker); cierre `npx tsc --noEmit && npx vitest run`.

---

## File Structure

- `backend/src/services/sheets/grilla.ts` (Modify): color por tipo (`TipoTurno`, `COLORES_TIPO`, `colorPorTipo`, `ReservaCelda.tipo`).
- `backend/src/services/sheets/expandir.ts` (Create): `expandirSemana` + tipos `FijoInput`/`BloqueoInput`.
- `backend/tests/unit/grilla.test.ts` (Modify): adaptar al color por tipo.
- `backend/tests/unit/expandir.test.ts` (Create): unit de la expansión.
- `backend/src/services/sheets/sheetsData.ts` (Modify): traer fijos+bloqueos y llamar `expandirSemana`.
- `backend/src/services/sheets/sheetsSync.service.ts` (Modify): `marcarSemanaSucia()`.
- `backend/src/services/turnoFijo.service.ts` (Modify): frescura en crear/eliminar/excepciones.
- `backend/src/services/bloqueo.service.ts` (Modify): frescura en crear/eliminar.

---

### Task 1: Lógica pura — color por tipo + `expandirSemana` (TDD, sin Docker)

**Files:**
- Modify: `backend/src/services/sheets/grilla.ts`
- Modify: `backend/tests/unit/grilla.test.ts`
- Create: `backend/src/services/sheets/expandir.ts`
- Create: `backend/tests/unit/expandir.test.ts`

**Interfaces:**
- Produces (lo usa Task 2):
  - `type TipoTurno = 'fijo' | 'suelto' | 'escuela' | 'torneo' | 'otro'` y `interface ReservaCelda { canchaId; fecha?; hora; cliente; monto; pagado; tipo }` en `grilla.ts`.
  - `colorPorTipo(tipo: TipoTurno): ColorRGB`.
  - `interface FijoInput { canchaId; clienteNombre; diaSemana; horaInicio; horaFin; precio: number|null; excepciones: string[] }`, `interface BloqueoInput { canchaId; motivo: 'TORNEO'|'ENTRENAMIENTO'|'MANTENIMIENTO'|'OTRO'; recurrente; diaSemana: number|null; fecha: string|null; horaInicio; horaFin; nota: string|null }`, y `expandirSemana(input: { reservas: ReservaCelda[]; fijos: FijoInput[]; bloqueos: BloqueoInput[] }, dias: { dia: string; fecha: string }[], horas: string[], tz: string): ReservaCelda[]` en `expandir.ts`.

- [ ] **Step 1: Reescribir `grilla.ts` (color por tipo)**

Reemplazar TODO `backend/src/services/sheets/grilla.ts` por:

```ts
export interface ColorRGB { red: number; green: number; blue: number }

export type TipoTurno = 'fijo' | 'suelto' | 'escuela' | 'torneo' | 'otro';

// Color del TEXTO del nombre según el TIPO de turno (igual que el Excel del complejo).
export const COLORES_TIPO: Record<TipoTurno, ColorRGB> = {
  fijo:    { red: 0,   green: 0,    blue: 0 },
  suelto:  { red: 0.8, green: 0,    blue: 0 },
  escuela: { red: 0.9, green: 0.45, blue: 0 },
  torneo:  { red: 0.5, green: 0.2,  blue: 0.7 },
  otro:    { red: 0.4, green: 0.4,  blue: 0.4 },
};
export function colorPorTipo(tipo: TipoTurno): ColorRGB { return COLORES_TIPO[tipo]; }

export interface ReservaCelda { canchaId: string; fecha?: string; hora: string; cliente: string; monto: number; pagado: number; tipo: TipoTurno }
export interface Celda { texto: string; colorTexto: ColorRGB | null }
export interface FilaGrilla { hora: string; celdas: Celda[] }
export interface GrillaDia { header: string[]; filas: FilaGrilla[]; totalesPorCancha: number[]; totalGeneral: number; nCanchas: number }

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function construirGrillaDia(horas: string[], canchas: { id: string; nombre: string }[], reservas: ReservaCelda[]): GrillaDia {
  const header = ['', ...canchas.flatMap((c) => [c.nombre, '$$'])];
  const byKey = new Map<string, ReservaCelda>();
  for (const r of reservas) byKey.set(`${r.canchaId}|${r.hora}`, r);
  const totalesPorCancha = canchas.map(() => 0);
  const filas: FilaGrilla[] = horas.map((hora) => {
    const celdas: Celda[] = [];
    canchas.forEach((c, i) => {
      const r = byKey.get(`${c.id}|${hora}`);
      if (r) {
        celdas.push({ texto: r.cliente, colorTexto: colorPorTipo(r.tipo) }, { texto: money(r.monto), colorTexto: null });
        totalesPorCancha[i] += Number(r.monto);
      } else {
        celdas.push({ texto: '', colorTexto: null }, { texto: '', colorTexto: null });
      }
    });
    return { hora, celdas };
  });
  const totalGeneral = totalesPorCancha.reduce((s, n) => s + n, 0);
  return { header, filas, totalesPorCancha, totalGeneral, nCanchas: canchas.length };
}
```

- [ ] **Step 2: Reescribir `tests/unit/grilla.test.ts` (color por tipo)**

Reemplazar TODO `backend/tests/unit/grilla.test.ts` por:

```ts
import { describe, it, expect } from 'vitest';
import { construirGrillaDia, colorPorTipo, type ReservaCelda } from '../../src/services/sheets/grilla.js';

const canchas = [{ id: 'c1', nombre: 'Cancha 1' }, { id: 'c2', nombre: 'Cancha 2' }];
const horas = ['16:00', '17:00', '18:00'];

function celda(o: Partial<ReservaCelda>): ReservaCelda {
  return { canchaId: 'c1', hora: '17:00', cliente: 'Juan', monto: 10000, pagado: 0, tipo: 'suelto', ...o };
}

describe('construirGrillaDia', () => {
  it('header con A vacío + pares; ubica la reserva en (cancha, hora)', () => {
    const g = construirGrillaDia(horas, canchas, [celda({ canchaId: 'c1', hora: '17:00', cliente: 'Juan', monto: 10000, tipo: 'suelto' })]);
    expect(g.header).toEqual(['', 'Cancha 1', '$$', 'Cancha 2', '$$']);
    const f17 = g.filas.find((f) => f.hora === '17:00')!;
    expect(f17.celdas[0].texto).toBe('Juan');
    expect(f17.celdas[1].texto).toBe('$10.000');
    expect(f17.celdas[0].colorTexto).toEqual(colorPorTipo('suelto'));
    expect(f17.celdas[1].colorTexto).toBe(null);
    expect(f17.celdas[2].texto).toBe('');
    expect(g.nCanchas).toBe(2);
  });

  it('color de TEXTO por tipo: fijo=negro, suelto=rojo, escuela=naranja, torneo=violeta', () => {
    const g = construirGrillaDia(horas, canchas, [
      celda({ canchaId: 'c1', hora: '16:00', tipo: 'fijo' }),
      celda({ canchaId: 'c2', hora: '16:00', tipo: 'escuela' }),
      celda({ canchaId: 'c1', hora: '17:00', tipo: 'suelto' }),
      celda({ canchaId: 'c2', hora: '17:00', tipo: 'torneo' }),
    ]);
    const f16 = g.filas.find((f) => f.hora === '16:00')!;
    expect(f16.celdas[0].colorTexto).toEqual({ red: 0, green: 0, blue: 0 });        // fijo negro
    expect(f16.celdas[2].colorTexto).toEqual({ red: 0.9, green: 0.45, blue: 0 });   // escuela naranja
    const f17 = g.filas.find((f) => f.hora === '17:00')!;
    expect(f17.celdas[0].colorTexto).toEqual({ red: 0.8, green: 0, blue: 0 });      // suelto rojo
    expect(f17.celdas[2].colorTexto).toEqual({ red: 0.5, green: 0.2, blue: 0.7 });  // torneo violeta
  });

  it('totales por cancha y total general', () => {
    const g = construirGrillaDia(horas, canchas, [
      celda({ canchaId: 'c1', hora: '16:00', monto: 10000 }),
      celda({ canchaId: 'c2', hora: '17:00', monto: 5000 }),
    ]);
    expect(g.totalesPorCancha).toEqual([10000, 5000]);
    expect(g.totalGeneral).toBe(15000);
  });
});
```

- [ ] **Step 3: Escribir el test de `expandirSemana` (debe fallar)**

Crear `backend/tests/unit/expandir.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { expandirSemana, type FijoInput, type BloqueoInput } from '../../src/services/sheets/expandir.js';
import type { ReservaCelda } from '../../src/services/sheets/grilla.js';

const TZ = 'America/Argentina/Buenos_Aires';
// Semana con lunes 2026-06-29 (lunes) … usamos 2 días para los tests.
const dias = [
  { dia: 'LUNES', fecha: '2026-06-29' },   // lunes (dow 1)
  { dia: 'MARTES', fecha: '2026-06-30' },  // martes (dow 2)
];
const horas = ['18:00', '19:00', '20:00', '21:00'];

const fijo = (o: Partial<FijoInput>): FijoInput => ({ canchaId: 'c1', clienteNombre: 'Pepe', diaSemana: 1, horaInicio: '20:00', horaFin: '22:00', precio: 10000, excepciones: [], ...o });
const bloqueo = (o: Partial<BloqueoInput>): BloqueoInput => ({ canchaId: 'c1', motivo: 'TORNEO', recurrente: true, diaSemana: 1, fecha: null, horaInicio: '20:00', horaFin: '22:00', nota: null, ...o });

describe('expandirSemana', () => {
  it('un fijo de lunes 20-22 aparece el lunes en 20 y 21, tipo fijo', () => {
    const out = expandirSemana({ reservas: [], fijos: [fijo({})], bloqueos: [] }, dias, horas, TZ);
    const lun = out.filter((c) => c.fecha === '2026-06-29');
    expect(lun.map((c) => c.hora).sort()).toEqual(['20:00', '21:00']);
    expect(lun.every((c) => c.tipo === 'fijo' && c.cliente === 'Pepe' && c.monto === 10000)).toBe(true);
    expect(out.some((c) => c.fecha === '2026-06-30')).toBe(false); // no es martes
  });

  it('una excepción en esa fecha excluye el fijo', () => {
    const out = expandirSemana({ reservas: [], fijos: [fijo({ excepciones: ['2026-06-29'] })], bloqueos: [] }, dias, horas, TZ);
    expect(out.length).toBe(0);
  });

  it('bloqueo recurrente (TORNEO) por diaSemana → tipo torneo; puntual sólo en su fecha', () => {
    const rec = expandirSemana({ reservas: [], fijos: [], bloqueos: [bloqueo({})] }, dias, horas, TZ);
    expect(rec.filter((c) => c.fecha === '2026-06-29').map((c) => c.hora).sort()).toEqual(['20:00', '21:00']);
    expect(rec.every((c) => c.tipo === 'torneo')).toBe(true);
    const punt = expandirSemana({ reservas: [], fijos: [], bloqueos: [bloqueo({ recurrente: false, diaSemana: null, fecha: '2026-06-30' })] }, dias, horas, TZ);
    expect(punt.every((c) => c.fecha === '2026-06-30')).toBe(true);
  });

  it('dedupe: si hay reserva en cancha|fecha|hora, el fijo no se duplica', () => {
    const reservas: ReservaCelda[] = [{ canchaId: 'c1', fecha: '2026-06-29', hora: '20:00', cliente: 'Reserva', monto: 5000, pagado: 0, tipo: 'suelto' }];
    const out = expandirSemana({ reservas, fijos: [fijo({})], bloqueos: [] }, dias, horas, TZ);
    const en20 = out.filter((c) => c.fecha === '2026-06-29' && c.hora === '20:00');
    expect(en20).toHaveLength(1);
    expect(en20[0].cliente).toBe('Reserva'); // gana la reserva
  });

  it('horas fuera del rango de config se descartan', () => {
    const out = expandirSemana({ reservas: [], fijos: [fijo({ horaInicio: '08:00', horaFin: '10:00' })], bloqueos: [] }, dias, horas, TZ);
    expect(out.length).toBe(0); // 08 y 09 no están en horas
  });
});
```

- [ ] **Step 4: Correr el test → debe fallar**

Run: `cd backend && npx vitest run tests/unit/expandir.test.ts`
Expected: FAIL — `expandir.js` no existe.

- [ ] **Step 5: Implementar `expandir.ts`**

Crear `backend/src/services/sheets/expandir.ts`:

```ts
import { dayOfWeekInTz } from '../../utils/tz.js';
import type { ReservaCelda, TipoTurno } from './grilla.js';

export interface FijoInput {
  canchaId: string; clienteNombre: string; diaSemana: number;
  horaInicio: string; horaFin: string; precio: number | null; excepciones: string[];
}
export interface BloqueoInput {
  canchaId: string; motivo: 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO';
  recurrente: boolean; diaSemana: number | null; fecha: string | null;
  horaInicio: string; horaFin: string; nota: string | null;
}
export interface ExpandInput { reservas: ReservaCelda[]; fijos: FijoInput[]; bloqueos: BloqueoInput[] }

const hNum = (hhmm: string) => Number(hhmm.slice(0, 2));

function tipoDeMotivo(m: BloqueoInput['motivo']): TipoTurno {
  if (m === 'TORNEO') return 'torneo';
  if (m === 'ENTRENAMIENTO') return 'escuela';
  return 'otro';
}
function etiquetaMotivo(m: BloqueoInput['motivo'], nota: string | null): string {
  const base = m === 'TORNEO' ? 'Torneo' : m === 'ENTRENAMIENTO' ? 'Entrenamiento' : m === 'MANTENIMIENTO' ? 'Mantenimiento' : 'Bloqueo';
  return nota ? `${base} · ${nota}` : base;
}

export function expandirSemana(input: ExpandInput, dias: { dia: string; fecha: string }[], horas: string[], tz: string): ReservaCelda[] {
  const out: ReservaCelda[] = [...input.reservas];
  const horasSet = new Set(horas);
  const ocupado = new Set(input.reservas.map((r) => `${r.canchaId}|${r.fecha}|${r.hora}`));

  const expandir = (canchaId: string, fecha: string, horaInicio: string, horaFin: string, make: (hora: string) => ReservaCelda) => {
    for (let h = hNum(horaInicio); h < hNum(horaFin); h++) {
      const hora = String(h).padStart(2, '0') + ':00';
      if (!horasSet.has(hora)) continue;
      const key = `${canchaId}|${fecha}|${hora}`;
      if (ocupado.has(key)) continue;
      ocupado.add(key);
      out.push(make(hora));
    }
  };

  for (const { fecha } of dias) {
    const dow = dayOfWeekInTz(fecha, tz);
    for (const f of input.fijos) {
      if (f.diaSemana !== dow || f.excepciones.includes(fecha)) continue;
      expandir(f.canchaId, fecha, f.horaInicio, f.horaFin, (hora) => ({
        canchaId: f.canchaId, fecha, hora, cliente: f.clienteNombre,
        monto: Number(f.precio ?? 0), pagado: 0, tipo: 'fijo',
      }));
    }
    for (const b of input.bloqueos) {
      const aplica = b.recurrente ? b.diaSemana === dow : b.fecha === fecha;
      if (!aplica) continue;
      expandir(b.canchaId, fecha, b.horaInicio, b.horaFin, (hora) => ({
        canchaId: b.canchaId, fecha, hora, cliente: etiquetaMotivo(b.motivo, b.nota),
        monto: 0, pagado: 0, tipo: tipoDeMotivo(b.motivo),
      }));
    }
  }
  return out;
}
```

- [ ] **Step 6: Correr los unit tests → deben pasar**

Run: `cd backend && npx vitest run tests/unit/expandir.test.ts tests/unit/grilla.test.ts`
Expected: PASS (los dos archivos).

- [ ] **Step 7: Typecheck + suite unit completa**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/unit`
Expected: tsc sin errores; unit suite verde.

- [ ] **Step 8: Commit**

```bash
cd backend && git add src/services/sheets/grilla.ts src/services/sheets/expandir.ts tests/unit/grilla.test.ts tests/unit/expandir.test.ts
git commit -m "feat(sheets): color por tipo + expandir fijos/bloqueos en la grilla espejo"
```

---

### Task 2: Wiring — datos + frescura

**Files:**
- Modify: `backend/src/services/sheets/sheetsData.ts`
- Modify: `backend/src/services/sheets/sheetsSync.service.ts`
- Modify: `backend/src/services/turnoFijo.service.ts`
- Modify: `backend/src/services/bloqueo.service.ts`

**Interfaces:**
- Consumes: `expandirSemana`, `FijoInput`, `BloqueoInput` de `./expandir.js`; `ReservaCelda` de `./grilla.js` (Task 1); `sheetsSync` y `diasSemanaActual` existentes.
- Produces: `sheetsSync.marcarSemanaSucia(): void`.

- [ ] **Step 1: Reescribir `dataSemana` en `sheetsData.ts`**

En `backend/src/services/sheets/sheetsData.ts`:

1. Agregar imports (debajo del import existente `import type { ReservaCelda } from './grilla.js';`):

```ts
import { expandirSemana, type FijoInput, type BloqueoInput } from './expandir.js';
```

2. Reemplazar la función `dataSemana` entera por:

```ts
export async function dataSemana() {
  const dias = diasSemanaActual();
  const cfg = await configService.get();
  const horas = horasDeConfig(cfg.horaApertura, cfg.horaCierre);
  const canchas = (await canchaRepo.list(true)).map((c) => ({ id: c.id, nombre: c.nombre }));
  const start = dayWindowUtc(dias[0].fecha, TZ()).start;
  const end = dayWindowUtc(dias[6].fecha, TZ()).end;

  const reservasDb = await prisma.reserva.findMany({
    where: { fechaInicio: { gte: start, lt: end }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA', 'COMPLETADA'] } },
    include: { cliente: { select: { nombre: true } }, cobros: { select: { monto: true } } },
  });
  const reservas: ReservaCelda[] = reservasDb.map((r) => {
    const { fecha, hora } = partesEnTz(r.fechaInicio);
    return {
      canchaId: r.canchaId, fecha, hora, cliente: r.cliente?.nombre ?? '-',
      monto: Number(r.monto), pagado: r.cobros.reduce((s, c) => s + Number(c.monto), 0),
      tipo: r.turnoFijoId ? 'fijo' : 'suelto',
    };
  });

  const fijosDb = await prisma.turnoFijo.findMany({ where: { activo: true }, include: { excepciones: true } });
  const fijos: FijoInput[] = fijosDb.map((f) => ({
    canchaId: f.canchaId, clienteNombre: f.clienteNombre, diaSemana: f.diaSemana,
    horaInicio: f.horaInicio, horaFin: f.horaFin,
    precio: f.precio == null ? null : Number(f.precio),
    excepciones: f.excepciones.map((e) => e.fecha.toISOString().slice(0, 10)),
  }));

  const bloqueosDb = await prisma.bloqueo.findMany({ where: { activo: true } });
  const bloqueos: BloqueoInput[] = bloqueosDb.map((b) => ({
    canchaId: b.canchaId, motivo: b.motivo, recurrente: b.recurrente, diaSemana: b.diaSemana,
    fecha: b.fecha ? b.fecha.toISOString().slice(0, 10) : null,
    horaInicio: b.horaInicio, horaFin: b.horaFin, nota: b.nota,
  }));

  const celdas = expandirSemana({ reservas, fijos, bloqueos }, dias, horas, TZ());
  return { dias, horas, canchas, celdas };
}
```

(El campo `tipo` en el objeto reserva puede necesitar el cast `tipo: (r.turnoFijoId ? 'fijo' : 'suelto') as const` si TS no infiere el literal; usar `as const` en cada literal o tipar el `.map` como `ReservaCelda[]` — ya está tipado, así que el literal se acota solo.)

- [ ] **Step 2: Agregar `marcarSemanaSucia` en `sheetsSync.service.ts`**

En `backend/src/services/sheets/sheetsSync.service.ts`:

1. Ampliar el import de `sheetsData` para incluir `diasSemanaActual`:

```ts
import { dataSemana, diasSemanaActual } from './sheetsData.js';
```

2. Agregar el método dentro del objeto `sheetsSync` (después de `marcarSucio`):

```ts
  /** Marca sucios los 7 días de la semana actual (fijos/bloqueos afectan toda la semana). */
  marcarSemanaSucia(): void {
    if (!estaConfigurado()) return;
    for (const d of diasSemanaActual()) this.marcarSucio(d.fecha);
  },
```

- [ ] **Step 3: Frescura en `turnoFijo.service.ts`**

En `backend/src/services/turnoFijo.service.ts`:

1. Agregar el import (junto a los demás imports del archivo):

```ts
import { sheetsSync } from './sheets/sheetsSync.service.js';
```

2. En cada uno de estos métodos, agregar `sheetsSync.marcarSemanaSucia();` **justo antes del `return`**: `crear`, `eliminar`, `agregarExcepcion`, `quitarExcepcion`.

Ejemplo en `crear` (queda así el final del método):

```ts
    const creado = await prisma.turnoFijo.create({ data: { /* ...lo que ya tenía... */ } });
    sheetsSync.marcarSemanaSucia();
    return creado;
```

> Aplicar el mismo patrón (una línea `sheetsSync.marcarSemanaSucia();` antes del `return`) en `eliminar`, `agregarExcepcion` y `quitarExcepcion`. No cambiar la lógica existente, sólo intercalar esa línea.

- [ ] **Step 4: Frescura en `bloqueo.service.ts`**

En `backend/src/services/bloqueo.service.ts`:

1. Agregar el import:

```ts
import { sheetsSync } from './sheets/sheetsSync.service.js';
```

2. En `crear`, antes del `return prisma.bloqueo.create(...)`, capturar y marcar:

```ts
    const creado = await prisma.bloqueo.create({ data: { /* ...lo que ya tenía... */ } });
    sheetsSync.marcarSemanaSucia();
    return creado;
```

3. En `eliminar`, antes del `return { ok: true };`, agregar:

```ts
    sheetsSync.marcarSemanaSucia();
    return { ok: true };
```

- [ ] **Step 5: Typecheck + suite unit**

Run: `cd backend && npx tsc --noEmit && npx vitest run tests/unit`
Expected: tsc sin errores; unit suite verde. (La escritura real a Google no se testea; la lógica quedó cubierta por los unit de Task 1.)

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/services/sheets/sheetsData.ts src/services/sheets/sheetsSync.service.ts src/services/turnoFijo.service.ts src/services/bloqueo.service.ts
git commit -m "feat(sheets): la hoja espejo incluye fijos y bloqueos + frescura al editarlos"
```

---

## Self-review (hecho)

- **Cobertura del spec:** color por tipo (`grilla.ts`, Task 1) ✓; `expandirSemana` con fijos/bloqueos/dedupe/horas-fuera-de-rango (Task 1) ✓; `dataSemana` trae fijos+bloqueos (Task 2) ✓; frescura `marcarSemanaSucia` + hooks (Task 2) ✓; `escribirDia`/`sincronizarTodo`/`reconstruirDia` sin cambios ✓; tests unit ✓.
- **Sin placeholders.** Código completo en cada step (los services se editan intercalando una línea; el resto son archivos completos).
- **Consistencia de tipos:** `ReservaCelda` (con `tipo`), `TipoTurno`, `colorPorTipo`, `expandirSemana(input, dias, horas, tz)`, `FijoInput`/`BloqueoInput` usados igual en Task 1 y Task 2.

## Cierre

Tras las 2 tareas: usar **superpowers:finishing-a-development-branch** — `npx tsc --noEmit` + `npx vitest run` (unit verde; las 3 fallas pre-existentes de `tests/integration/sena.test.ts` por contención de Testcontainers no cuentan, pasan en aislado y son ajenas), revisión whole-branch, merge de `feat/sheets-espejo-tipo` a `main` + push (deploy por la Action). No bloqueante para el go-live del martes.

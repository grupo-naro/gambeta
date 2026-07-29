# Espejo Google Sheets — Estilo de la planilla — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las pestañas de días del espejo de Google Sheets tengan el estilo de la planilla del dueño: columnas de cancha en celeste, "$$" en amarillo, fila TOTAL verde con total por cancha + general, encabezado `CANCHA n / $$ … / DIA`, y el estado de pago como color del TEXTO del nombre.

**Architecture:** `grilla.ts` cambia su modelo de celda (de color de fondo a `colorTexto`) y agrega `totalesPorCancha`/`totalGeneral`. `sheetsClient.ts` aplica los fondos por columna (celeste/amarillo/verde/blanco), encabezado en negrita y color de texto por celda. Solo backend; sin DB ni envs nuevas.

**Tech Stack:** Node, Express, Prisma, googleapis, Vitest. El test de `grilla` es **unitario (no necesita Docker)**.

**Spec:** `docs/superpowers/specs/2026-06-16-espejo-sheets-diseno-design.md`

**Gotchas:** `sheetsSync.service.ts` (reconstruirDia/sincronizarTodo) solo pasa la grilla a `escribirDia`, no lee `.total`/`.filaTotal`/`.color` → no hay que tocarlo. Imports con `.js`. Tests: `npx vitest run tests/unit/grilla.test.ts`.

> Rama: `cd backend && git checkout main && git pull && git checkout -b feat/espejo-sheets-diseno`.

---

### Task 1: `grilla.ts` (nuevo modelo + totales por cancha + color de texto)

**Files:** Modify `src/services/sheets/grilla.ts`; Test `tests/unit/grilla.test.ts`.

- [ ] **Step 1: Actualizar el test (TDD) — reemplazar TODO `tests/unit/grilla.test.ts` por:**

```typescript
import { describe, it, expect } from 'vitest';
import { construirGrillaDia, COLORES, type ReservaCelda } from '../../src/services/sheets/grilla.js';

const canchas = [{ id: 'c1', nombre: 'Cancha 1' }, { id: 'c2', nombre: 'Cancha 2' }];
const horas = ['16:00', '17:00', '18:00'];

function celda(o: Partial<ReservaCelda>): ReservaCelda {
  return { canchaId: 'c1', hora: '17:00', cliente: 'Juan', monto: 10000, pagado: 0, ...o };
}

describe('construirGrillaDia', () => {
  it('header con A vacío + pares; ubica la reserva en (cancha, hora)', () => {
    const g = construirGrillaDia(horas, canchas, [celda({ canchaId: 'c1', hora: '17:00', cliente: 'Juan', monto: 10000, pagado: 10000 })]);
    expect(g.header).toEqual(['', 'Cancha 1', '$$', 'Cancha 2', '$$']);
    const f17 = g.filas.find((f) => f.hora === '17:00')!;
    expect(f17.celdas[0].texto).toBe('Juan');      // col nombre Cancha 1
    expect(f17.celdas[1].texto).toBe('$10.000');   // col $$
    expect(f17.celdas[0].colorTexto).toBe(COLORES.PAGADO);
    expect(f17.celdas[1].colorTexto).toBe(null);   // el monto siempre en negro
    expect(f17.celdas[2].texto).toBe('');          // Cancha 2 vacía
    expect(g.nCanchas).toBe(2);
  });

  it('color de TEXTO: pagado=verde, parcial=naranja, sin pagar=rojo', () => {
    const g = construirGrillaDia(horas, canchas, [
      celda({ canchaId: 'c1', hora: '16:00', pagado: 10000, monto: 10000 }),
      celda({ canchaId: 'c2', hora: '16:00', pagado: 4000, monto: 10000 }),
      celda({ canchaId: 'c1', hora: '18:00', pagado: 0, monto: 10000 }),
    ]);
    const f16 = g.filas.find((f) => f.hora === '16:00')!;
    expect(f16.celdas[0].colorTexto).toBe(COLORES.PAGADO);
    expect(f16.celdas[2].colorTexto).toBe(COLORES.PARCIAL);
    const f18 = g.filas.find((f) => f.hora === '18:00')!;
    expect(f18.celdas[0].colorTexto).toBe(COLORES.SIN_PAGAR);
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

- [ ] **Step 2: Correr el test, verificar que FALLA** — `cd backend && npx vitest run tests/unit/grilla.test.ts` → FAIL (header espera `''`, `colorTexto`/`totalesPorCancha`/`nCanchas` no existen).

- [ ] **Step 3: Implementar — reemplazar TODO `src/services/sheets/grilla.ts` por:**

```typescript
export interface ColorRGB { red: number; green: number; blue: number }
// Colores de TEXTO del nombre del cliente, según estado de pago.
export const COLORES = {
  PAGADO: { red: 0.13, green: 0.55, blue: 0.13 } as ColorRGB,
  PARCIAL: { red: 0.9, green: 0.45, blue: 0 } as ColorRGB,
  SIN_PAGAR: { red: 0.8, green: 0, blue: 0 } as ColorRGB,
};
export interface ReservaCelda { canchaId: string; fecha?: string; hora: string; cliente: string; monto: number; pagado: number }
export interface Celda { texto: string; colorTexto: ColorRGB | null }
export interface FilaGrilla { hora: string; celdas: Celda[] }
export interface GrillaDia { header: string[]; filas: FilaGrilla[]; totalesPorCancha: number[]; totalGeneral: number; nCanchas: number }

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
function colorTextoDe(monto: number, pagado: number): ColorRGB {
  if (pagado >= monto && monto > 0) return COLORES.PAGADO;
  if (pagado > 0) return COLORES.PARCIAL;
  return COLORES.SIN_PAGAR;
}

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
        celdas.push({ texto: r.cliente, colorTexto: colorTextoDe(r.monto, r.pagado) }, { texto: money(r.monto), colorTexto: null });
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

- [ ] **Step 4: Correr el test, verificar que PASA** — `npx vitest run tests/unit/grilla.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/sheets/grilla.ts tests/unit/grilla.test.ts
git commit -m "feat(sheets): grilla con color de texto por pago + totales por cancha"
```

---

### Task 2: `sheetsClient.ts` (fondos por columna + negrita + color de texto + total verde)

**Files:** Modify `src/services/sheets/sheetsClient.ts` (reemplazar TODO el archivo).

- [ ] **Step 1: Reemplazar TODO `src/services/sheets/sheetsClient.ts` por:**

```typescript
import { google } from 'googleapis';
import { getEnv } from '../../config/env.js';
import type { GrillaDia, ColorRGB } from './grilla.js';

export function estaConfigurado(): boolean {
  const e = getEnv();
  return !!e.GOOGLE_SERVICE_ACCOUNT && !!e.SHEETS_SPREADSHEET_ID;
}
export function sheetUrl(): string | null {
  const id = getEnv().SHEETS_SPREADSHEET_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}` : null;
}

function sheetsApi() {
  const cred = JSON.parse(Buffer.from(getEnv().GOOGLE_SERVICE_ACCOUNT, 'base64').toString('utf8'));
  const auth = new google.auth.JWT({ email: cred.client_email, key: cred.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

const COL = {
  CYAN: { red: 0, green: 1, blue: 1 } as ColorRGB,
  YELLOW: { red: 1, green: 1, blue: 0 } as ColorRGB,
  GREEN: { red: 0, green: 1, blue: 0 } as ColorRGB,
  WHITE: { red: 1, green: 1, blue: 1 } as ColorRGB,
};
const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fechaDMY = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };

function cell(texto: string, bg: ColorRGB, opts: { textColor?: ColorRGB | null; bold?: boolean } = {}) {
  const textFormat: { bold?: boolean; foregroundColor?: ColorRGB } = {};
  if (opts.bold) textFormat.bold = true;
  if (opts.textColor) textFormat.foregroundColor = opts.textColor;
  const userEnteredFormat = (opts.bold || opts.textColor)
    ? { backgroundColor: bg, textFormat }
    : { backgroundColor: bg };
  return { userEnteredValue: { stringValue: texto }, userEnteredFormat };
}

/** Reconstruye una pestaña (la crea si falta) con el estilo de la planilla. */
export async function escribirDia(dia: string, fecha: string, g: GrillaDia): Promise<void> {
  const sheets = sheetsApi();
  const spreadsheetId = getEnv().SHEETS_SPREADSHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  let hoja = meta.data.sheets?.find((s) => s.properties?.title === dia);
  if (!hoja) {
    const add = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: dia } } }] } });
    hoja = add.data.replies?.[0]?.addSheet ? { properties: add.data.replies[0].addSheet!.properties } : undefined;
  }
  const sheetId = hoja?.properties?.sheetId;
  if (sheetId == null) return;

  // Fila 1: encabezado (blanco, negrita) + espaciador + "DIA"
  const headerRow = { values: [...g.header, '', 'DIA'].map((t) => cell(t, COL.WHITE, { bold: true })) };

  // Filas de horas: hora(blanco) + por cancha [nombre(celeste, texto por pago), $$(amarillo)] + espaciador + fecha (solo 1ra fila)
  const filasRows = g.filas.map((f, ri) => {
    const values = [cell(f.hora, COL.WHITE)];
    f.celdas.forEach((c, ci) => {
      const esNombre = ci % 2 === 0;
      values.push(cell(c.texto, esNombre ? COL.CYAN : COL.YELLOW, { textColor: c.colorTexto }));
    });
    values.push(cell('', COL.WHITE));                               // espaciador
    values.push(cell(ri === 0 ? fechaDMY(fecha) : '', COL.WHITE));  // DIA
    return { values };
  });

  // Fila TOTAL (verde): TOTAL + por cancha ['', $cancha] + espaciador + total general
  const totalValues = [cell('TOTAL', COL.GREEN, { bold: true })];
  g.totalesPorCancha.forEach((t) => {
    totalValues.push(cell('', COL.GREEN));
    totalValues.push(cell(money(t), COL.GREEN, { bold: true }));
  });
  totalValues.push(cell('', COL.GREEN));                                       // espaciador
  totalValues.push(cell(money(g.totalGeneral), COL.GREEN, { bold: true }));    // DIA

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            rows: [headerRow, ...filasRows, { values: totalValues }],
            fields: 'userEnteredValue,userEnteredFormat.backgroundColor,userEnteredFormat.textFormat',
            start: { sheetId, rowIndex: 0, columnIndex: 0 },
          },
        },
      ],
    },
  });
}
```

- [ ] **Step 2: Compilar (typecheck)** — `cd backend && npx tsc --noEmit` → 0 errores. (Si tsc se queja del tipo de `rows`/`cell` contra los tipos de googleapis, castear el array de filas a `any`: `rows: ([headerRow, ...filasRows, { values: totalValues }] as unknown[]) as never[]` o agregar `// @ts-expect-error` en la línea `rows:` — el shape es válido para la API; reportar si fue necesario.)

- [ ] **Step 3: Commit**

```bash
git add src/services/sheets/sheetsClient.ts
git commit -m "feat(sheets): estilo planilla (celeste/amarillo, total verde, color de texto por pago)"
```

---

### Task 3: Verificación + cierre

- [ ] **Step 1: Unit de grilla** — `cd backend && npx vitest run tests/unit/grilla.test.ts` → PASS.
- [ ] **Step 2: Typecheck/build** — `cd backend && npx tsc --noEmit` → 0 errores. (No correr la suite de integración completa salvo que haya Docker; este cambio no la afecta.)
- [ ] **Step 3: Cerrar la rama** — invocar **superpowers:finishing-a-development-branch** → merge a `main` + push.
- [ ] **Step 4 (usuario / deploy):** re-deploy a la VM para que el espejo cambie:
  ```
  cd /opt/canchitas/canchitas-backend && git fetch origin && git reset --hard origin/main && docker compose -f docker-compose.vm.yml up -d --build
  ```
  Luego, en el panel → Configuración → "Sincronizar ahora" (o cualquier reserva/cobro dispara `marcarSucio`) reescribe las pestañas con el nuevo estilo. **QA:** abrir una pestaña de día y verificar celeste/amarillo por columna, fila TOTAL verde con totales por cancha + general, encabezados CANCHA/$$/DIA, y el nombre del cliente coloreado según pago.

---

## Notas
- Solo backend; sin DB ni envs nuevas; sigue no-op si Google Sheets no está configurado.
- `sheetsSync.service.ts` no se toca (solo pasa la grilla a `escribirDia`).
- Las columnas reflejan las canchas activas reales (orden por nombre); el estilo aplica igual sea cual sea la cantidad de canchas.

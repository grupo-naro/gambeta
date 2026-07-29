# Horarios semana / finde (con cierre a medianoche) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Horario del complejo por grupo (Semana Lun-Vie / Finde Sáb-Dom), soportando cierre a medianoche (`00:00`), aplicado a disponibilidad, config, hoja, calendario y heatmap.

**Architecture:** Se reutilizan `Configuracion.horaApertura/horaCierre` como **semana** y se agregan `horaAperturaFinde/horaCierreFinde`. Un helper `cierreMin` trata `"00:00"` como fin del día (1440). `horarioDe(fecha,cfg)` elige semana/finde. La disponibilidad genera slots por día; el calendario/heatmap/hoja usan el rango unión.

**Tech Stack:** Backend Node/Express 5/TS/Prisma 7, Zod 4, Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 (custom — ver `frontend/AGENTS.md`), pnpm.

## Global Constraints

- **🚫 NO PUSHEAR.** Commit + merge a la rama principal EN LOCAL (backend `main`, frontend `master`), sin `git push`. Se apila sobre lo acumulado.
- Cierre `"00:00"` = **fin del día (1440 min / hora 24)**; último turno **23:00–00:00**. Apertura nunca es `"00:00"`.
- Semana = Lun-Vie; Finde = Sáb(6)/Dom(0) según `dayOfWeekInTz` (0=domingo..6=sábado).
- `horaApertura/horaCierre` existentes = **semana**; nuevos `horaAperturaFinde/horaCierreFinde` = finde.
- Migración a mano; recordar `prisma migrate deploy` al deployar.
- Frontend: NO training data de Next; Tailwind estático.
- Ramas: backend `feat/horarios-semana-finde` (base `main`), frontend `feat/horarios-semana-finde` (base `master`).

---

## REPO BACKEND (`canchitas-backend`, rama `feat/horarios-semana-finde` desde `main`)

### Task 1: Modelo + migración + helper `cierreMin` + validación de config (semana+finde, medianoche)

**Files:**
- Modify: `backend/prisma/schema.prisma` (modelo `Configuracion`)
- Create: `backend/prisma/migrations/20260703000000_horarios_finde/migration.sql`
- Modify: `backend/src/utils/tz.ts` (helpers `hhmmAMin`, `cierreMin`)
- Modify: `backend/src/validators/config.schema.ts`
- Modify: `backend/src/services/config.service.ts`
- Modify: `backend/src/routes/config.routes.ts` (labels de auditoría)
- Test: `backend/tests/integration/config.test.ts` (extender)

- [ ] **Step 1: Schema Prisma**

En `backend/prisma/schema.prisma`, modelo `Configuracion`, agregar junto a `horaCierre`:
```prisma
  horaAperturaFinde String @default("16:00")
  horaCierreFinde   String @default("00:00")
```

- [ ] **Step 2: Migración a mano**

Crear `backend/prisma/migrations/20260703000000_horarios_finde/migration.sql`:
```sql
-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN "horaAperturaFinde" TEXT NOT NULL DEFAULT '16:00';
ALTER TABLE "Configuracion" ADD COLUMN "horaCierreFinde" TEXT NOT NULL DEFAULT '00:00';
```

- [ ] **Step 3: `prisma generate`**

Run (desde `backend/`): `npx prisma generate` → "Generated Prisma Client" sin errores.

- [ ] **Step 4: Helpers en `utils/tz.ts`**

Agregar y exportar:
```ts
export function hhmmAMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
/** Minutos de cierre; "00:00" = fin del día (1440). */
export function cierreMin(hhmm: string): number { const min = hhmmAMin(hhmm); return min === 0 ? 1440 : min; }
```

- [ ] **Step 5: Test (RED)**

En `backend/tests/integration/config.test.ts`, agregar (con token admin, patrón del archivo):
```ts
  it('acepta horario de semana y finde con cierre 00:00', async () => {
    const r = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ horaApertura: '09:00', horaCierre: '00:00', horaAperturaFinde: '16:00', horaCierreFinde: '00:00' });
    expect(r.status).toBe(200);
    expect(r.body.horaAperturaFinde).toBe('16:00');
    expect(r.body.horaCierreFinde).toBe('00:00');
    expect(r.body.horaCierre).toBe('00:00');
  });
  it('rechaza apertura 00:00 (cierre efectivo no mayor)', async () => {
    const r = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ horaApertura: '00:00', horaCierre: '00:00' });
    expect(r.status).toBe(400);
  });
  it('rechaza finde con apertura posterior al cierre', async () => {
    const r = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ horaAperturaFinde: '20:00', horaCierreFinde: '18:00' });
    expect(r.status).toBe(400);
  });
```
(Ajustar `token`/`app` al patrón existente del archivo; si `config.test.ts` usa otra forma de setear la config base, seguirla.)

Run (desde `backend/`): `npx vitest run tests/integration/config.test.ts`
Expected: FAIL — hoy `horaCierre '00:00'` es rechazado (ap>=ci string), y los campos finde no existen/validan.

- [ ] **Step 6: Validador `config.schema.ts`**

- Agregar al `body`: `horaAperturaFinde: hhmm.optional()`, `horaCierreFinde: hhmm.optional()`.
- Reemplazar el `.refine` de apertura<cierre por dos, midnight-aware (helper local o importar `cierreMin`/`hhmmAMin` de `utils/tz`):
```ts
    .refine((b) => !(b.horaApertura && b.horaCierre) || hhmmAMin(b.horaApertura) < cierreMin(b.horaCierre), { message: 'La apertura (semana) debe ser anterior al cierre', path: ['horaCierre'] })
    .refine((b) => !(b.horaAperturaFinde && b.horaCierreFinde) || hhmmAMin(b.horaAperturaFinde) < cierreMin(b.horaCierreFinde), { message: 'La apertura (finde) debe ser anterior al cierre', path: ['horaCierreFinde'] })
```
(Importar `import { hhmmAMin, cierreMin } from '../utils/tz.js';`. Mantener los refines de pico.)

- [ ] **Step 7: `config.service.ts`**

Reemplazar la validación string por midnight-aware y sumar el par finde:
```ts
    const ap = (patch.horaApertura ?? current.horaApertura) as string;
    const ci = (patch.horaCierre ?? current.horaCierre) as string;
    if (hhmmAMin(ap) >= cierreMin(ci)) throw BusinessRule('La apertura (semana) debe ser anterior al cierre');
    const apF = (patch.horaAperturaFinde ?? current.horaAperturaFinde) as string;
    const ciF = (patch.horaCierreFinde ?? current.horaCierreFinde) as string;
    if (hhmmAMin(apF) >= cierreMin(ciF)) throw BusinessRule('La apertura (finde) debe ser anterior al cierre');
```
(Importar `hhmmAMin`, `cierreMin` de `../utils/tz.js`. Dejar la validación de pico como está.)

- [ ] **Step 8: `config.routes.ts` labels**

En el mapa de labels de auditoría, agregar: `horaAperturaFinde: 'el horario de apertura (finde)', horaCierreFinde: 'el horario de cierre (finde)'`.

- [ ] **Step 9: GREEN + commit**

Run: `npx vitest run tests/integration/config.test.ts` → PASS.
```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/utils/tz.ts backend/src/validators/config.schema.ts backend/src/services/config.service.ts backend/src/routes/config.routes.ts backend/tests/integration/config.test.ts
git commit -m "feat(config): horario de finde + cierre a medianoche (validación midnight-aware)"
```
NO push.

**Interfaces producidas:** `Configuracion.horaAperturaFinde/horaCierreFinde`; `hhmmAMin`, `cierreMin` en `utils/tz.ts`.

---

### Task 2: Disponibilidad por día (semana/finde) + hoja midnight-aware

**Files:**
- Modify: `backend/src/services/disponibilidad.service.ts`
- Modify: `backend/src/services/sheets/sheetsData.ts`
- Test: `backend/tests/integration/disponibilidad-tamano.test.ts` (extender) o `disponibilidad.test.ts`

**Interfaces consumidas:** `cierreMin`, `hhmmAMin` (Task 1); `dayOfWeekInTz` (ya existe); `Configuracion.*Finde` (Task 1).

- [ ] **Step 1: Test (RED)**

En `backend/tests/integration/disponibilidad-tamano.test.ts` (o el de disponibilidad), agregar un caso: config semana 09:00–00:00, finde 16:00–00:00, una cancha `jugadores:5`. Elegir una fecha que caiga **martes** y otra **sábado** (calcular con `new Date`), y verificar:
```ts
  // martes: primer slot 09:00, último 23:00
  // sábado: primer slot 16:00, NO hay 09:00; último 23:00
```
Concretamente, tras setear la config (crear `configuracion` con los 4 campos) y la cancha, `GET /disponibilidad/por-tamano?jugadores=5&fecha=<martesFuturo>` → `slots[0].horaInicio === '09:00'` y el último `=== '23:00'`; para `<sabadoFuturo>` → `slots[0].horaInicio === '16:00'` y ninguno `=== '09:00'`. (Elegir fechas futuras concretas cuyo weekday sea martes/sábado.)

Run: `npx vitest run tests/integration/disponibilidad-tamano.test.ts`
Expected: FAIL — hoy usa `cfg.horaApertura/horaCierre` global y `fromHHMM(cierre)` (con "00:00" → 0 → no genera slots).

- [ ] **Step 2: `disponibilidad.service.listar` usa `horarioDe` + `cierreMin`**

En `backend/src/services/disponibilidad.service.ts`:
- Import: `import { combineDateTimeUtc, dayWindowUtc, cierreMin } from '../utils/tz.js';` (sumar `cierreMin`).
- Agregar el helper `horarioDe` (arriba del `export const disponibilidadService` o como método privado):
```ts
function horarioDe(fecha: string, tz: string, cfg: { horaApertura: string; horaCierre: string; horaAperturaFinde: string; horaCierreFinde: string }) {
  const dow = dayOfWeekInTz(fecha, tz); // 0=domingo .. 6=sábado
  const finde = dow === 0 || dow === 6;
  return finde
    ? { apertura: cfg.horaAperturaFinde, cierre: cfg.horaCierreFinde }
    : { apertura: cfg.horaApertura, cierre: cfg.horaCierre };
}
```
(Importar `dayOfWeekInTz` de `../utils/tz.js`.)
- En `listar`, reemplazar el loop (~línea 32):
```ts
    const { apertura, cierre } = horarioDe(fecha, tz, cfg);
    for (let t = fromHHMM(apertura); t + SLOT_MIN <= cierreMin(cierre); t += SLOT_MIN) {
```
`listarPorTamano` NO se toca (reusa `listar`).

- [ ] **Step 3: Hoja `sheetsData.ts` midnight-aware + rango unión**

En `backend/src/services/sheets/sheetsData.ts`:
- Importar `cierreMin`, `hhmmAMin` de `../../utils/tz.js`.
- `horasDeConfig`: usar cierre efectivo:
```ts
export function horasDeConfig(horaApertura: string, horaCierre: string): string[] {
  const out: string[] = [];
  const finH = cierreMin(horaCierre) / 60;
  for (let h = Number(horaApertura.slice(0, 2)); h < finH; h++) out.push(String(h).padStart(2, '0') + ':00');
  return out;
}
```
- `dataSemana`: pasar el **rango unión** semana+finde:
```ts
  const aperturaU = hhmmAMin(cfg.horaApertura) <= hhmmAMin(cfg.horaAperturaFinde) ? cfg.horaApertura : cfg.horaAperturaFinde;
  const cierreU = cierreMin(cfg.horaCierre) >= cierreMin(cfg.horaCierreFinde) ? cfg.horaCierre : cfg.horaCierreFinde;
  const horas = horasDeConfig(aperturaU, cierreU);
```

- [ ] **Step 4: GREEN + commit**

Run: `npx vitest run tests/integration/disponibilidad-tamano.test.ts tests/integration/disponibilidad.test.ts` → PASS (ajustar si algún test viejo asumía el horario global 16-23; reportarlo). Fallos pre-existentes de `sena.test.ts` (fecha vencida) = fuera de alcance.
```bash
git add backend/src/services/disponibilidad.service.ts backend/src/services/sheets/sheetsData.ts backend/tests/integration/disponibilidad-tamano.test.ts
git commit -m "feat(disponibilidad): slots por semana/finde + cierre a medianoche; hoja midnight-aware"
```
NO push.

---

## REPO FRONTEND (`frontend`, rama `feat/horarios-semana-finde` desde `master`)

### Task 3: Config form (2 pares) + validador + tipos

**Files:**
- Modify: `frontend/src/lib/types.ts` (`Config`)
- Modify: `frontend/src/lib/hora.ts` (helper `cierreMin`)
- Modify: `frontend/src/lib/validators.ts` (`configSchema`)
- Modify: `frontend/src/components/config/config-form.tsx`

- [ ] **Step 1: Tipo `Config`**

En `frontend/src/lib/types.ts`, en `Config`, agregar `horaAperturaFinde: string; horaCierreFinde: string;` junto a `horaApertura/horaCierre`.

- [ ] **Step 2: Helper `cierreMin` en `lib/hora.ts`**

Agregar y exportar:
```ts
/** Minutos de una hora HH:MM; "00:00" como cierre = fin del día (1440). */
export function cierreMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); const min = h * 60 + m; return min === 0 ? 1440 : min; }
```

- [ ] **Step 3: `validators.ts` `configSchema`**

- Agregar `horaAperturaFinde: hhmm`, `horaCierreFinde: hhmm`.
- Reemplazar el `.refine(b => b.horaApertura < b.horaCierre, ...)` por dos midnight-aware (importar `cierreMin` de `./hora`; para la apertura usar comparación de minutos):
```ts
}).refine((b) => hhmmMin(b.horaApertura) < cierreMin(b.horaCierre), { message: 'La apertura (semana) debe ser anterior al cierre', path: ['horaCierre'] })
  .refine((b) => hhmmMin(b.horaAperturaFinde) < cierreMin(b.horaCierreFinde), { message: 'La apertura (finde) debe ser anterior al cierre', path: ['horaCierreFinde'] })
```
donde `hhmmMin(s)` = `Number(s.slice(0,2))*60 + Number(s.slice(3,5))` (helper local o de `./hora`). (Mantener el resto de refines del schema.)

- [ ] **Step 4: `config-form.tsx` — 2 pares**

- Estado inicial: agregar `horaAperturaFinde: config.horaAperturaFinde, horaCierreFinde: config.horaCierreFinde`.
- En la sección "Horarios del complejo", reemplazar el par único por 2 bloques rotulados:
```tsx
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-neutral-700">Semana (Lun a Vie)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label htmlFor="ap">Apertura</Label><Input id="ap" type="time" value={f.horaApertura} onChange={(e) => set('horaApertura', e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="ci">Cierre</Label><Input id="ci" type="time" value={f.horaCierre} onChange={(e) => set('horaCierre', e.target.value)} /></div>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-neutral-700">Finde (Sáb y Dom)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label htmlFor="apf">Apertura</Label><Input id="apf" type="time" value={f.horaAperturaFinde} onChange={(e) => set('horaAperturaFinde', e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="cif">Cierre</Label><Input id="cif" type="time" value={f.horaCierreFinde} onChange={(e) => set('horaCierreFinde', e.target.value)} /></div>
            </div>
          </div>
          <p className="text-xs text-neutral-500">Cerrar a las 00:00 = medianoche (último turno 23:00 a 00:00).</p>
        </CardContent>
```
(El `guardarConfig(parsed.data)` ya manda todo `f`; los 4 campos viajan.)

- [ ] **Step 5: Typecheck + build + commit**

Run (desde `frontend/`): `pnpm exec tsc --noEmit && pnpm build` → sin errores.
```bash
git add frontend/src/lib/types.ts frontend/src/lib/hora.ts frontend/src/lib/validators.ts frontend/src/components/config/config-form.tsx
git commit -m "feat(config): horario de finde + cierre a medianoche en el panel"
```
NO push.

**Interfaces producidas:** `Config.horaAperturaFinde/horaCierreFinde`; `cierreMin` en `lib/hora.ts`.

---

### Task 4: Calendario + heatmap (rango unión, midnight-aware)

**Files:**
- Modify: `frontend/src/lib/calendario.ts` (`horasDelDia`)
- Modify: `frontend/src/app/(panel)/calendario/page.tsx`
- Modify: `frontend/src/components/dashboard/ocupacion-heatmap.tsx`
- Modify: `frontend/src/app/(panel)/dashboard/page.tsx`

**Interfaces consumidas:** `cierreMin` (`lib/hora.ts`, Task 3); `Config.*Finde` (Task 3).

- [ ] **Step 1: `horasDelDia` midnight-aware**

En `frontend/src/lib/calendario.ts`, `horasDelDia`:
```ts
export function horasDelDia(horaApertura: string, horaCierre: string): number[] {
  const ap = Number(horaApertura.slice(0, 2));
  const ciRaw = Number(horaCierre.slice(0, 2));
  const ci = ciRaw === 0 ? 24 : ciRaw; // "00:00" = medianoche
  const out: number[] = [];
  for (let h = ap; h < ci; h++) out.push(h);
  return out;
}
```
(Mantener el resto de la función/retorno tal como esté; solo el cálculo de `ci` cambia.)

- [ ] **Step 2: `calendario/page.tsx` pasa el rango unión**

Importar `cierreMin` de `@/lib/hora`. Antes del render, computar la unión y pasarla:
```ts
  const aperturaU = Number(config.horaApertura.slice(0,2)) <= Number(config.horaAperturaFinde.slice(0,2)) ? config.horaApertura : config.horaAperturaFinde;
  const cierreU = cierreMin(config.horaCierre) >= cierreMin(config.horaCierreFinde) ? config.horaCierre : config.horaCierreFinde;
```
y en `<CalendarioSemana ... horaApertura={aperturaU} horaCierre={cierreU} />`.

- [ ] **Step 3: Heatmap midnight-aware + unión**

En `frontend/src/components/dashboard/ocupacion-heatmap.tsx`, el `fin`:
```ts
  const finRaw = Number(horaCierre.slice(0, 2));
  const fin = finRaw === 0 ? 24 : finRaw;
```
En `frontend/src/app/(panel)/dashboard/page.tsx`, pasar el rango unión al `<OcupacionHeatmap>` (mismo cálculo que Step 2; importar `cierreMin`). Ajustar el fallback `safe(...)` de config para incluir `horaAperturaFinde: '16:00', horaCierreFinde: '00:00'`.

- [ ] **Step 4: Typecheck + build + commit**

Run (desde `frontend/`): `pnpm exec tsc --noEmit && pnpm build` → sin errores.
```bash
git add frontend/src/lib/calendario.ts "frontend/src/app/(panel)/calendario/page.tsx" frontend/src/components/dashboard/ocupacion-heatmap.tsx "frontend/src/app/(panel)/dashboard/page.tsx"
git commit -m "feat(calendario/heatmap): rango unión semana/finde + cierre a medianoche"
```
NO push.

---

## Cierre (SIN PUSH)
- Backend: merge `feat/horarios-semana-finde` → `main` local. Frontend: merge → `master` local. Sin push.
- Recordatorio (al pushear): `docker exec canchitas-backend npx prisma migrate deploy` (columnas finde). Bot FAQ de horario = follow-up opcional.

## Self-Review
- **Cobertura spec:** modelo+migración (T1 S1-2); cierreMin (T1 S4); validación config semana+finde midnight (T1 S6-7); disponibilidad por día (T2 S2); hoja midnight+unión (T2 S3); config-form 2 pares + validador + tipos (T3); calendario+heatmap unión+midnight (T4); bot=fuera de alcance. ✓
- **Placeholders:** ninguno.
- **Consistencia:** `cierreMin` (backend `utils/tz`, frontend `lib/hora`) misma semántica ("00:00"→1440); `horarioDe` solo en disponibilidad; `listarPorTamano` reusa `listar` (no se toca); campos `horaAperturaFinde/horaCierreFinde` con mismos nombres en schema, config, validadores, types, form, páginas.
- **NO PUSH:** ningún step pushea. ✓

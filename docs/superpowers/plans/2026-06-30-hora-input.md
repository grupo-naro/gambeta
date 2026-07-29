# Input de hora simple (24h) en fijos y bloqueos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el input de hora nativo (AM/PM + minutos) por un campo de texto simple donde se tipea la hora en 24h (`21`, `21:30`, `9`) y se normaliza a `HH:MM`, en los diálogos de turno fijo y bloqueo.

**Architecture:** Un helper puro `normalizeHora` (testeable) + un componente `HoraInput` que lo usa onBlur; los dos diálogos reemplazan sus `<Input type="time">` por `HoraInput` y normalizan también en el submit (red de seguridad). Backend intacto (sigue `HH:MM`).

**Tech Stack:** Next 16, Tailwind v4, Vitest, pnpm. Repo: `frontend`, rama git `master` (crear `feat/hora-input`).

## Global Constraints

- Backend SIN cambios: la hora final debe ser `HH:MM` con hora de 2 dígitos (el schema exige `([01]\d|2[0-3]):[0-5]\d`) → `normalizeHora` SIEMPRE padea a 2 dígitos.
- Imports SIN extensión `.js` (frontend). Clases Tailwind estáticas.
- Verificación de cada tarea: `pnpm lint` + `pnpm build`. La T1 además tiene unit test; la T2 es visual.
- Cierre: merge a `master` + push → Vercel.

---

## File Structure

- `frontend/src/lib/hora.ts` (Create): `normalizeHora`.
- `frontend/src/lib/hora.test.ts` (Create): unit.
- `frontend/src/components/ui/hora-input.tsx` (Create): componente `HoraInput`.
- `frontend/src/components/fijos/turno-fijo-dialog.tsx` (Modify): usar `HoraInput` + normalizar en submit.
- `frontend/src/components/bloqueos/bloqueo-dialog.tsx` (Modify): idem.

---

### Task 1: Helper `normalizeHora` (TDD, sin Docker)

**Files:**
- Create: `frontend/src/lib/hora.ts`
- Create: `frontend/src/lib/hora.test.ts`

**Interfaces:**
- Produces: `normalizeHora(raw: string): string | null` en `@/lib/hora`. `'21'`→`'21:00'`, `'21:30'`→`'21:30'`, `'9'`→`'09:00'`, `'9:5'`→`'09:05'`; inválido/vacío → `null`. Siempre hora de 2 dígitos.

- [ ] **Step 1: Escribir el test (debe fallar)**

Crear `frontend/src/lib/hora.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeHora } from './hora';

describe('normalizeHora', () => {
  it('hora sola -> HH:00 (padea)', () => {
    expect(normalizeHora('21')).toBe('21:00');
    expect(normalizeHora('9')).toBe('09:00');
    expect(normalizeHora('0')).toBe('00:00');
    expect(normalizeHora('00')).toBe('00:00');
    expect(normalizeHora('23')).toBe('23:00');
  });
  it('hora:min -> HH:MM (padea ambos)', () => {
    expect(normalizeHora('21:30')).toBe('21:30');
    expect(normalizeHora('9:5')).toBe('09:05');
    expect(normalizeHora('09:00')).toBe('09:00');
  });
  it('recorta espacios', () => {
    expect(normalizeHora('  21  ')).toBe('21:00');
  });
  it('invalido -> null', () => {
    for (const v of ['24', '25', '9:60', '9:70', '', '   ', 'abc', '21:', ':30', '-1', '1:2:3', '21.30']) {
      expect(normalizeHora(v)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Correr el test → falla**

Run: `cd frontend && pnpm vitest run src/lib/hora.test.ts`
Expected: FAIL — `hora` no existe (import error).

- [ ] **Step 3: Implementar `hora.ts`**

Crear `frontend/src/lib/hora.ts`:

```ts
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Normaliza una hora tipeada a "HH:MM" (24h). "21"->"21:00", "21:30"->"21:30", "9"->"09:00". Inválido/vacío -> null. */
export function normalizeHora(raw: string): string | null {
  const s = (raw ?? '').trim();
  let h: number;
  let m: number;
  const soloHora = s.match(/^(\d{1,2})$/);
  const conMin = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (soloHora) {
    h = Number(soloHora[1]);
    m = 0;
  } else if (conMin) {
    h = Number(conMin[1]);
    m = Number(conMin[2]);
  } else {
    return null;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}
```

- [ ] **Step 4: Correr el test → pasa**

Run: `cd frontend && pnpm vitest run src/lib/hora.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck rápido + commit**

Run: `cd frontend && pnpm lint`
Expected: sin errores.

```bash
cd frontend && git add src/lib/hora.ts src/lib/hora.test.ts
git commit -m "feat(hora): helper normalizeHora (tipeo 24h -> HH:MM) con tests"
```

---

### Task 2: `HoraInput` + wiring en los diálogos

**Files:**
- Create: `frontend/src/components/ui/hora-input.tsx`
- Modify: `frontend/src/components/fijos/turno-fijo-dialog.tsx`
- Modify: `frontend/src/components/bloqueos/bloqueo-dialog.tsx`

**Interfaces:**
- Consumes: `normalizeHora` de `@/lib/hora` (Task 1).
- Produces: `HoraInput` (componente) — props `{ id?: string; value: string; onChange: (v: string) => void; placeholder?: string }`.

- [ ] **Step 1: Crear el componente `HoraInput`**

Crear `frontend/src/components/ui/hora-input.tsx`:

```tsx
'use client';
import { Input } from '@/components/ui/input';
import { normalizeHora } from '@/lib/hora';

export function HoraInput({
  id,
  value,
  onChange,
  placeholder = '21:00',
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const n = normalizeHora(value);
        if (n) onChange(n);
      }}
    />
  );
}
```

- [ ] **Step 2: Turno fijo — imports**

En `frontend/src/components/fijos/turno-fijo-dialog.tsx`, agregar debajo del `import { Input } from '@/components/ui/input';`:

```tsx
import { HoraInput } from '@/components/ui/hora-input';
import { normalizeHora } from '@/lib/hora';
```

- [ ] **Step 3: Turno fijo — reemplazar los inputs de hora**

Reemplazar:
```tsx
              <Input id="tf-inicio" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
```
por:
```tsx
              <HoraInput id="tf-inicio" value={horaInicio} onChange={setHoraInicio} />
```
y reemplazar:
```tsx
              <Input id="tf-fin" type="time" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} />
```
por:
```tsx
              <HoraInput id="tf-fin" value={horaFin} onChange={setHoraFin} />
```

- [ ] **Step 4: Turno fijo — normalizar en el submit**

Reemplazar:
```tsx
  function submit() {
    const parsed = turnoFijoSchema.safeParse({ canchaId, clienteNombre, whatsapp, diaSemana, horaInicio, horaFin });
```
por:
```tsx
  function submit() {
    const hi = normalizeHora(horaInicio);
    const hf = normalizeHora(horaFin);
    if (!hi || !hf) { toast.error('Hora inválida. Usá formato 24h, ej: 21:00'); return; }
    const parsed = turnoFijoSchema.safeParse({ canchaId, clienteNombre, whatsapp, diaSemana, horaInicio: hi, horaFin: hf });
```

- [ ] **Step 5: Bloqueo — imports**

En `frontend/src/components/bloqueos/bloqueo-dialog.tsx`, agregar debajo del `import { Input } from '@/components/ui/input';`:

```tsx
import { HoraInput } from '@/components/ui/hora-input';
import { normalizeHora } from '@/lib/hora';
```

- [ ] **Step 6: Bloqueo — reemplazar los inputs de hora**

Reemplazar:
```tsx
              <Input id="bl-inicio" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
```
por:
```tsx
              <HoraInput id="bl-inicio" value={horaInicio} onChange={setHoraInicio} />
```
y reemplazar:
```tsx
              <Input id="bl-fin" type="time" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} />
```
por:
```tsx
              <HoraInput id="bl-fin" value={horaFin} onChange={setHoraFin} />
```

- [ ] **Step 7: Bloqueo — normalizar en el submit**

Reemplazar:
```tsx
  function submit() {
    const recurrente = tipo === 'recurrente';
    const parsed = bloqueoSchema.safeParse({
      canchaId,
      motivo,
      recurrente,
      diaSemana: recurrente ? diaSemana : undefined,
      fecha: recurrente ? undefined : fecha,
      horaInicio,
      horaFin,
      nota: nota || undefined,
    });
```
por:
```tsx
  function submit() {
    const recurrente = tipo === 'recurrente';
    const hi = normalizeHora(horaInicio);
    const hf = normalizeHora(horaFin);
    if (!hi || !hf) { toast.error('Hora inválida. Usá formato 24h, ej: 21:00'); return; }
    const parsed = bloqueoSchema.safeParse({
      canchaId,
      motivo,
      recurrente,
      diaSemana: recurrente ? diaSemana : undefined,
      fecha: recurrente ? undefined : fecha,
      horaInicio: hi,
      horaFin: hf,
      nota: nota || undefined,
    });
```

- [ ] **Step 8: Verificar build + lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 9: Commit**

```bash
cd frontend && git add src/components/ui/hora-input.tsx src/components/fijos/turno-fijo-dialog.tsx src/components/bloqueos/bloqueo-dialog.tsx
git commit -m "feat(fijos/bloqueos): input de hora 24h con tipeo libre (reemplaza type=time)"
```

---

## Self-review (hecho)

- **Cobertura del spec:** `normalizeHora` con padeo (T1) ✓; `HoraInput` onBlur (T2 step 1) ✓; reemplazo en fijos + bloqueos, inicio+fin (T2 steps 3,6) ✓; red de seguridad en submit (T2 steps 4,7) ✓; validación inicio<fin intacta (los schemas no se tocan) ✓; backend sin cambios ✓.
- **Sin placeholders.** Código completo en cada step.
- **Consistencia:** `normalizeHora(raw): string | null` y `HoraInput` props usados igual en T1 y T2; `hi`/`hf` en ambos submits.

## Cierre

Tras las 2 tareas: **superpowers:finishing-a-development-branch** — `pnpm vitest run src/lib/hora.test.ts` + `pnpm lint` + `pnpm build`, **revisión visual** (Nuevo turno fijo y Nuevo bloqueo: tipear `21`→`21:00`, `21:30` queda, `25`→error al guardar; confirmar que crea bien), merge de `feat/hora-input` a `master` + push (Vercel). Verificar en `admin.canchitaortigoza.com.ar`.

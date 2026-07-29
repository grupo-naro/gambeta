# Normalizar WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cualquier número cargado a mano en el panel (reserva, turno fijo, cliente) se guarde en el formato canónico del bot (`5491136620274`), tipeando solo el local de 10 dígitos, y se muestre lindo (`+54 9 11 3662-0274`).

**Architecture:** Una función pura `normalizarWhatsapp` en el backend es la fuente de verdad, aplicada como `transform` de Zod en los validadores de crear-reserva / crear-fijo / upsert-cliente. El frontend tiene su espejo (`aCanonico` + `previewWhatsapp`) que valida en el form y muestra el preview en vivo, pero manda el texto crudo: el backend normaliza igual.

**Tech Stack:** Backend Node/Express/Prisma 7/Zod 4, Vitest (unit, sin Docker para esto). Frontend Next 16/React 19/Zod/Vitest.

## Global Constraints

- Backend: imports con extensión `.js` (ESM). Errores de validación salen 400 vía el middleware `validate` (ZodError → `BadRequest`).
- Formato guardado: `5491136620274` (SIN `+`, = JID del bot). Formato mostrado: `+54 9 11 3662-0274`.
- `normalizarWhatsapp` debe ser **idempotente**: `normalizarWhatsapp('5491136620274') === '5491136620274'` (así el input del bot no cambia).
- Frontend: este Next está modificado; para cambios de UI no triviales leer `node_modules/next/dist/docs/`. (Acá los cambios son React plano: state + `<Input>`, sin APIs de Next nuevas.)
- Antes de mergear: backend `npx tsc --noEmit` + tests; frontend `pnpm build` + `pnpm lint`.
- Integración: backend rama feature → merge a `main` + push. Frontend rama feature → merge a `master` local (no se pushea).

---

### Task 1: `normalizarWhatsapp` (backend util, TDD)

**Files:**
- Create: `backend/src/utils/whatsapp.ts`
- Test: `backend/tests/unit/whatsapp.test.ts`

**Interfaces:**
- Produces: `normalizarWhatsapp(raw: string): string | null` — devuelve el canónico `549` + 10 dígitos, o `null` si no resuelve.

- [ ] **Step 1: Test que falla.** Crear `backend/tests/unit/whatsapp.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { normalizarWhatsapp } from '../../src/utils/whatsapp.js';

describe('normalizarWhatsapp', () => {
  it('local de 10 dígitos → 549 + local', () => {
    expect(normalizarWhatsapp('1136620274')).toBe('5491136620274');
  });
  it('con espacios y guiones', () => {
    expect(normalizarWhatsapp('11 3662-0274')).toBe('5491136620274');
  });
  it('ya canónico (549 + 10) es idempotente', () => {
    expect(normalizarWhatsapp('5491136620274')).toBe('5491136620274');
  });
  it('con + y 9', () => {
    expect(normalizarWhatsapp('+54 9 11 3662-0274')).toBe('5491136620274');
  });
  it('54 + local sin el 9', () => {
    expect(normalizarWhatsapp('+541136620274')).toBe('5491136620274');
  });
  it('con 0 troncal adelante', () => {
    expect(normalizarWhatsapp('01136620274')).toBe('5491136620274');
  });
  it('con prefijo internacional 00', () => {
    expect(normalizarWhatsapp('005491136620274')).toBe('5491136620274');
  });
  it('rechaza basura / muy corto / vacío', () => {
    expect(normalizarWhatsapp('123')).toBeNull();
    expect(normalizarWhatsapp('')).toBeNull();
    expect(normalizarWhatsapp('hola')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr → FALLA.** `cd backend && npx vitest run tests/unit/whatsapp.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar.** Crear `backend/src/utils/whatsapp.ts`:
```typescript
/**
 * Normaliza un whatsapp argentino al JID del bot: "549" + 10 dígitos locales (área + número).
 * Devuelve null si no se puede resolver. Ignora +, espacios, guiones, paréntesis.
 * Idempotente: normalizarWhatsapp('5491136620274') === '5491136620274'.
 */
export function normalizarWhatsapp(raw: string): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2); // salida internacional
  if (d.startsWith('0')) d = d.slice(1);  // 0 troncal
  if (d.length === 13 && d.startsWith('549')) return d;        // ya canónico
  if (d.length === 12 && d.startsWith('54')) return '549' + d.slice(2); // 54 + local (sin 9)
  if (d.length === 10) return '549' + d;                       // local pelado
  return null;
}
```

- [ ] **Step 4: Correr → PASA.** `npx vitest run tests/unit/whatsapp.test.ts` → todos verdes.
- [ ] **Step 5: tsc.** `npx tsc --noEmit` → 0 errores.
- [ ] **Step 6: Commit.**
```bash
git add src/utils/whatsapp.ts tests/unit/whatsapp.test.ts
git commit -m "feat(whatsapp): util normalizarWhatsapp (local -> JID canonico del bot)"
```

---

### Task 2: Aplicar normalización en los validadores (backend, TDD)

**Files:**
- Create: `backend/src/validators/whatsapp.field.ts`
- Modify: `backend/src/validators/reserva.schema.ts`, `backend/src/validators/turnoFijo.schema.ts`, `backend/src/validators/cliente.schema.ts`
- Test: `backend/tests/unit/whatsapp-schemas.test.ts`

**Interfaces:**
- Consumes: `normalizarWhatsapp` (Task 1).
- Produces: `whatsappCanonico` (Zod, requerido) y `whatsappCanonicoOpcional` (Zod, opcional) desde `validators/whatsapp.field.ts`. Ambos transforman a `5491136620274` o tiran ZodError con mensaje claro.

- [ ] **Step 1: Test que falla.** Crear `backend/tests/unit/whatsapp-schemas.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createReservaSchema } from '../../src/validators/reserva.schema.js';
import { crearTurnoFijoSchema } from '../../src/validators/turnoFijo.schema.js';
import { upsertClienteSchema } from '../../src/validators/cliente.schema.js';

const baseReserva = { canchaId: 'c1', nombreCliente: 'Naro', fecha: '2026-06-24', horaInicio: '20:00' };

describe('validadores: whatsapp se guarda canónico', () => {
  it('createReservaSchema normaliza el whatsapp', () => {
    const r = createReservaSchema.parse({ body: { ...baseReserva, whatsapp: '+541136620274' }, query: {}, params: {} });
    expect(r.body.whatsapp).toBe('5491136620274');
  });
  it('createReservaSchema rechaza whatsapp inválido', () => {
    expect(() => createReservaSchema.parse({ body: { ...baseReserva, whatsapp: '123' }, query: {}, params: {} })).toThrow();
  });
  it('crearTurnoFijoSchema normaliza cuando viene', () => {
    const r = crearTurnoFijoSchema.parse({ body: { canchaId: 'c1', clienteNombre: 'Naro', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 12000 }, query: {}, params: {} });
    expect(r.body.whatsapp).toBe('5491136620274');
  });
  it('crearTurnoFijoSchema deja pasar sin whatsapp (opcional)', () => {
    const r = crearTurnoFijoSchema.parse({ body: { canchaId: 'c1', clienteNombre: 'Naro', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 12000 }, query: {}, params: {} });
    expect(r.body.whatsapp).toBeUndefined();
  });
  it('upsertClienteSchema normaliza el whatsapp', () => {
    const r = upsertClienteSchema.parse({ body: { whatsapp: '+54 9 11 3662-0274', nombre: 'Naro' }, query: {}, params: {} });
    expect(r.body.whatsapp).toBe('5491136620274');
  });
});
```

- [ ] **Step 2: Correr → FALLA.** `npx vitest run tests/unit/whatsapp-schemas.test.ts` → FAIL (hoy no normaliza; `whatsapp.field.ts` no existe).

- [ ] **Step 3: Crear los campos Zod reutilizables.** Crear `backend/src/validators/whatsapp.field.ts`:
```typescript
import { z } from 'zod';
import { normalizarWhatsapp } from '../utils/whatsapp.js';

const MSG = 'Número inválido. Ingresá los 10 dígitos del celular (ej: 11 3662 0274)';

// Requerido: valida que resuelva y transforma a canónico.
export const whatsappCanonico = z
  .string()
  .refine((s) => normalizarWhatsapp(s) !== null, { message: MSG })
  .transform((s) => normalizarWhatsapp(s) as string);

// Opcional: si viene vacío/undefined queda undefined; si viene con valor, normaliza.
export const whatsappCanonicoOpcional = z
  .string()
  .optional()
  .transform((s) => (s == null || s.trim() === '' ? undefined : s))
  .refine((s) => s === undefined || normalizarWhatsapp(s) !== null, { message: MSG })
  .transform((s) => (s === undefined ? undefined : (normalizarWhatsapp(s) as string)));
```

- [ ] **Step 4: Wire en reserva.schema.ts.** En `backend/src/validators/reserva.schema.ts`, agregar el import arriba (después de `import { z } from 'zod';`):
```typescript
import { whatsappCanonico } from './whatsapp.field.js';
```
y en `createReservaSchema.body` reemplazar la línea `whatsapp: z.string().min(5),` por:
```typescript
    whatsapp: whatsappCanonico,
```
(No tocar `listReservaSchema` ni `misReservasSchema`: son lookups, se dejan como están.)

- [ ] **Step 5: Wire en turnoFijo.schema.ts.** En `backend/src/validators/turnoFijo.schema.ts`, agregar import:
```typescript
import { whatsappCanonicoOpcional } from './whatsapp.field.js';
```
y en `crearTurnoFijoSchema.body` reemplazar `whatsapp: z.string().optional(),` por:
```typescript
    whatsapp: whatsappCanonicoOpcional,
```
(No tocar `liberarFijoSchema`: su match ya es tolerante.)

- [ ] **Step 6: Wire en cliente.schema.ts.** En `backend/src/validators/cliente.schema.ts`, agregar import:
```typescript
import { whatsappCanonico } from './whatsapp.field.js';
```
y en `upsertClienteSchema.body` reemplazar `whatsapp: z.string().min(5),` por:
```typescript
    whatsapp: whatsappCanonico,
```
(No tocar `buscarClienteSchema` ni `editarClienteSchema`.)

- [ ] **Step 7: Correr → PASA.** `npx vitest run tests/unit/whatsapp-schemas.test.ts` → verdes.

- [ ] **Step 8: tsc.** `npx tsc --noEmit` → 0 errores.

- [ ] **Step 9: Regresión de integración (requiere Docker Desktop).** `npx vitest run tests/integration/reserva.routes.test.ts tests/integration/liberar-fijo.test.ts tests/integration/fijos-bloqueos.test.ts` → PASS. Si alguna assertion comparaba un whatsapp con `+` literal contra el valor guardado, ahora se guarda sin `+`: ajustar esa assertion al canónico (`5491...`). NO cambiar la lógica, solo el valor esperado del test. Si Docker no está disponible, dejar este paso pendiente y avisarlo (los unit de Steps 1/7 ya cubren la transformación).

- [ ] **Step 10: Commit.**
```bash
git add src/validators/whatsapp.field.ts src/validators/reserva.schema.ts src/validators/turnoFijo.schema.ts src/validators/cliente.schema.ts tests/unit/whatsapp-schemas.test.ts
git commit -m "feat(validators): normalizar whatsapp al crear reserva/fijo/cliente"
```

---

### Task 3: `aCanonico` + `previewWhatsapp` (frontend util, TDD)

**Files:**
- Create: `frontend/src/lib/whatsapp.ts`
- Test: `frontend/src/lib/whatsapp.test.ts`

**Interfaces:**
- Produces: `aCanonico(raw: string): string | null` (espejo del backend) y `previewWhatsapp(raw: string): string | null` (devuelve `+54 9 11 3662-0274` o `null`).

- [ ] **Step 1: Test que falla.** Crear `frontend/src/lib/whatsapp.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { aCanonico, previewWhatsapp } from './whatsapp';

describe('aCanonico', () => {
  it('local 10 dígitos', () => { expect(aCanonico('1136620274')).toBe('5491136620274'); });
  it('54 sin 9', () => { expect(aCanonico('+541136620274')).toBe('5491136620274'); });
  it('idempotente', () => { expect(aCanonico('5491136620274')).toBe('5491136620274'); });
  it('inválido → null', () => { expect(aCanonico('123')).toBeNull(); });
});

describe('previewWhatsapp', () => {
  it('muestra el formato lindo', () => { expect(previewWhatsapp('1136620274')).toBe('+54 9 11 3662-0274'); });
  it('inválido → null', () => { expect(previewWhatsapp('123')).toBeNull(); });
});
```

- [ ] **Step 2: Correr → FALLA.** `cd frontend && pnpm vitest run src/lib/whatsapp.test.ts` → FAIL.

- [ ] **Step 3: Implementar.** Crear `frontend/src/lib/whatsapp.ts`:
```typescript
// Espejo de backend/src/utils/whatsapp.ts. Mantener en sync.
export function aCanonico(raw: string): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 13 && d.startsWith('549')) return d;
  if (d.length === 12 && d.startsWith('54')) return '549' + d.slice(2);
  if (d.length === 10) return '549' + d;
  return null;
}

// "5491136620274" → "+54 9 11 3662-0274". null si el input no resuelve.
export function previewWhatsapp(raw: string): string | null {
  const c = aCanonico(raw);
  if (!c) return null;
  const local = c.slice(3); // 10 dígitos: área(2) + número(8)
  return `+54 9 ${local.slice(0, 2)} ${local.slice(2, 6)}-${local.slice(6)}`;
}
```

- [ ] **Step 4: Correr → PASA.** `pnpm vitest run src/lib/whatsapp.test.ts` → verdes.
- [ ] **Step 5: Commit.**
```bash
git add src/lib/whatsapp.ts src/lib/whatsapp.test.ts
git commit -m "feat(whatsapp): aCanonico + previewWhatsapp (frontend)"
```

---

### Task 4: Preview en vivo + validación en los 3 diálogos (frontend)

**Files:**
- Modify: `frontend/src/lib/validators.ts`
- Modify: `frontend/src/components/reservas/nueva-reserva-dialog.tsx`
- Modify: `frontend/src/components/fijos/turno-fijo-dialog.tsx`
- Modify: `frontend/src/components/clientes/cliente-dialog.tsx`

**Interfaces:**
- Consumes: `aCanonico`, `previewWhatsapp` (Task 3).

- [ ] **Step 1: Validadores del front usan `aCanonico`.** En `frontend/src/lib/validators.ts`, agregar import arriba (después de `import { z } from 'zod';`):
```typescript
import { aCanonico } from './whatsapp';
```
En `nuevaReservaSchema`, reemplazar `whatsapp: z.string().min(5, 'Ingresá el WhatsApp'),` por:
```typescript
  whatsapp: z.string().refine((s) => aCanonico(s) !== null, 'WhatsApp inválido (ej: 11 3662 0274)'),
```
En `turnoFijoSchema`, reemplazar `whatsapp: z.string().optional(),` por:
```typescript
  whatsapp: z.string().optional().refine((s) => !s || s.trim() === '' || aCanonico(s) !== null, 'WhatsApp inválido (ej: 11 3662 0274)'),
```

- [ ] **Step 2: Preview en nueva-reserva-dialog.** En `frontend/src/components/reservas/nueva-reserva-dialog.tsx`, agregar import:
```typescript
import { previewWhatsapp } from '@/lib/whatsapp';
```
Reemplazar el bloque del input de WhatsApp (las líneas con `<Label htmlFor="nueva-whatsapp">` y su `<Input id="nueva-whatsapp" ...>`) por:
```tsx
              <Label htmlFor="nueva-whatsapp">WhatsApp</Label>
              <Input id="nueva-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
              {whatsapp.trim() !== '' && (
                previewWhatsapp(whatsapp)
                  ? <p className="text-xs text-muted-foreground">Se guardará como: {previewWhatsapp(whatsapp)}</p>
                  : <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>
              )}
```

- [ ] **Step 3: Preview en turno-fijo-dialog.** En `frontend/src/components/fijos/turno-fijo-dialog.tsx`, agregar import:
```typescript
import { previewWhatsapp } from '@/lib/whatsapp';
```
Reemplazar el bloque del input WhatsApp:
```tsx
          <div className="space-y-1">
            <Label htmlFor="tf-whatsapp">WhatsApp</Label>
            <Input id="tf-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+5491150000000" />
          </div>
```
por:
```tsx
          <div className="space-y-1">
            <Label htmlFor="tf-whatsapp">WhatsApp</Label>
            <Input id="tf-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
            {whatsapp.trim() !== '' && (
              previewWhatsapp(whatsapp)
                ? <p className="text-xs text-muted-foreground">Se guardará como: {previewWhatsapp(whatsapp)}</p>
                : <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>
            )}
          </div>
```

- [ ] **Step 4: Preview + validación en cliente-dialog.** En `frontend/src/components/clientes/cliente-dialog.tsx`, agregar import:
```typescript
import { previewWhatsapp, aCanonico } from '@/lib/whatsapp';
```
Reemplazar la línea de validación inline (`if (nombre.trim().length < 1 || whatsapp.trim().length < 5) { toast.error('Completá nombre y WhatsApp'); return; }`) por:
```typescript
    if (nombre.trim().length < 1) { toast.error('Completá el nombre'); return; }
    if (aCanonico(whatsapp) === null) { toast.error('WhatsApp inválido (ej: 11 3662 0274)'); return; }
```
Reemplazar la línea completa del input (actualmente en una sola línea):
```tsx
          <div className="space-y-1"><Label htmlFor="ncl-wa">WhatsApp</Label><Input id="ncl-wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+54911..." /></div>
```
por:
```tsx
          <div className="space-y-1">
            <Label htmlFor="ncl-wa">WhatsApp</Label>
            <Input id="ncl-wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
            {whatsapp.trim() !== '' && (
              previewWhatsapp(whatsapp)
                ? <p className="text-xs text-muted-foreground">Se guardará como: {previewWhatsapp(whatsapp)}</p>
                : <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>
            )}
          </div>
```

- [ ] **Step 5: Verificar.** `cd frontend && pnpm vitest run src/lib/whatsapp.test.ts src/lib/validators.test.ts` → PASS. Luego `pnpm build && pnpm lint` → sin errores. (Si `validators.test.ts` valida el viejo `min(5)` del whatsapp, actualizar ese caso al nuevo mensaje/regla.)

- [ ] **Step 6: Commit.**
```bash
git add src/lib/validators.ts src/components/reservas/nueva-reserva-dialog.tsx src/components/fijos/turno-fijo-dialog.tsx src/components/clientes/cliente-dialog.tsx
git commit -m "feat(panel): preview en vivo y validacion de whatsapp en reserva/fijo/cliente"
```

---

### Cierre

- [ ] **Backend:** `cd backend && npx tsc --noEmit` ok → **superpowers:finishing-a-development-branch** → merge a `main` + push. Deploy VM lo hace el usuario (ver memoria backend-deploy-vm).
- [ ] **Frontend:** `cd frontend && pnpm build && pnpm lint` ok → **superpowers:finishing-a-development-branch** → merge a `master` local (no se pushea).

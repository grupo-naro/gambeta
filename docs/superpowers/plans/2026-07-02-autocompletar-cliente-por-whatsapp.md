# Autocompletar cliente por WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al crear una reserva o un turno fijo desde el panel, tipear el WhatsApp primero y autocompletar el nombre si el cliente ya existe; y que crear un turno fijo también registre al cliente en Clientes (como ya hace la reserva).

**Architecture:** Frontend-only para el autocompletado: una server action `buscarClientePorWhatsapp` canonicaliza el número y consulta el endpoint existente `GET /clientes/buscar`; un hook cliente `useClienteAutocomplete` (debounce + guard anti-carrera) rellena el nombre en ambos diálogos. Backend: `turnoFijo.service.crear` hace upsert del cliente.

**Tech Stack:** Backend Node/Express 5/TS/Prisma 7, Vitest+Supertest+Testcontainers (necesita Docker). Frontend Next 16 (custom — ver `frontend/AGENTS.md`), Tailwind v4, pnpm, BFF (`apiFetch` server-only + `'use server'` actions).

## Global Constraints

- Dos repos, dos ramas: backend `canchitas-backend` rama `feat/autocompletar-cliente` (base `main`); frontend `frontend` rama `feat/autocompletar-cliente` (base `master`).
- WhatsApp se guarda **canónico** (`549…` sin `+`); `input.whatsapp` en el fijo ya viene canónico por `whatsappCanonico` del schema.
- El nombre queda **editable** tras autocompletar; el autocompletado NO bloquea el submit ni valida contra la base.
- Frontend: NO leer training data de Next; consultar `node_modules/next/dist/docs/` ante dudas de API (ver `AGENTS.md`). Clases Tailwind estáticas (nada de concatenar clases dinámicas).
- Backend tests de integración requieren Docker corriendo (Testcontainers).

---

## REPO BACKEND (`canchitas-backend`, rama `feat/autocompletar-cliente` desde `main`)

### Task 1: Turno fijo registra el cliente (upsert)

**Files:**
- Modify: `backend/src/services/turnoFijo.service.ts` (dentro de `crear`, tras `prisma.turnoFijo.create`)
- Test: `backend/tests/integration/turno-fijo-cliente.test.ts` (nuevo)

**Interfaces:**
- Consumes: `turnoFijo.service.crear(input: { canchaId; clienteNombre; whatsapp?; diaSemana; horaInicio; horaFin })` (existente); ruta `POST /turnos-fijos` (auth JWT admin); helpers de test `setupTestDb/teardownTestDb/resetTables/getPrisma` (`tests/helpers/db.js`) y `signAdminToken` (`src/services/auth.service.js`).
- Produces: efecto secundario — un `Cliente` con el whatsapp canónico del fijo.

- [ ] **Step 1: Write the failing test**

Crear `backend/tests/integration/turno-fijo-cliente.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000, jugadores: 5 } })).id; });

const crearFijo = (whatsapp: string, clienteNombre = 'Fijo Uno') =>
  supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`)
    .send({ canchaId, clienteNombre, whatsapp, diaSemana: 3, horaInicio: '20:00', horaFin: '21:00' });

describe('turno fijo registra cliente', () => {
  it('crea el cliente cuando el whatsapp es nuevo', async () => {
    const r = await crearFijo('+5491150000010', 'Fijo Uno');
    expect(r.status).toBe(201);
    const clientes = await getPrisma().cliente.findMany({ where: { whatsapp: '5491150000010' } });
    expect(clientes).toHaveLength(1);
    expect(clientes[0].nombre).toBe('Fijo Uno');
  });

  it('no duplica ni pisa el nombre si el cliente ya existe', async () => {
    await getPrisma().cliente.create({ data: { nombre: 'Existente', whatsapp: '5491150000011' } });
    const r = await crearFijo('+5491150000011', 'Otro Nombre');
    expect(r.status).toBe(201);
    const clientes = await getPrisma().cliente.findMany({ where: { whatsapp: '5491150000011' } });
    expect(clientes).toHaveLength(1);
    expect(clientes[0].nombre).toBe('Existente');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/integration/turno-fijo-cliente.test.ts`
Expected: FAIL — el primer test da `clientes` con longitud 0 (el fijo no crea cliente todavía).

- [ ] **Step 3: Implement the upsert in `crear`**

En `backend/src/services/turnoFijo.service.ts`, dentro de `crear`, justo después de `const creado = await prisma.turnoFijo.create({ data: input });`, insertar:

```ts
    if (input.whatsapp) {
      await prisma.cliente.upsert({
        where: { whatsapp: input.whatsapp },
        create: { whatsapp: input.whatsapp, nombre: input.clienteNombre, nombreConfirmado: true },
        update: {},
      });
    }
```

(Queda antes de `sheetsSync.marcarSemanaSucia();` y del `return creado;`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/turno-fijo-cliente.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/turnoFijo.service.ts backend/tests/integration/turno-fijo-cliente.test.ts
git commit -m "feat: turno fijo registra el cliente en Clientes (upsert)"
```

---

## REPO FRONTEND (`frontend`, rama `feat/autocompletar-cliente` desde `master`)

> Sin backend nuevo: usa el `GET /clientes/buscar` ya deployado. El hook y la action se comparten entre los dos diálogos (DRY).

### Task 2: Acción de búsqueda + hook de autocompletado

**Files:**
- Modify: `frontend/src/lib/clientes-actions.ts` (agregar `buscarClientePorWhatsapp` + import `aCanonico`)
- Create: `frontend/src/lib/use-cliente-autocomplete.ts` (hook cliente)

**Interfaces:**
- Consumes: `apiFetch` (server-only) ya importado en `clientes-actions.ts`; `aCanonico(raw: string): string | null` de `@/lib/whatsapp`.
- Produces:
  - `buscarClientePorWhatsapp(whatsapp: string): Promise<{ nombre: string } | null>` (server action)
  - `useClienteAutocomplete(whatsapp: string, onFound: (nombre: string) => void): boolean` (hook cliente; devuelve `encontrado`)

- [ ] **Step 1: Add the server action**

En `frontend/src/lib/clientes-actions.ts`, agregar el import de `aCanonico` (junto a los imports existentes) y la función al final del archivo. `clientes-actions.ts` ya tiene `'use server'` arriba y ya importa `apiFetch`.

```ts
import { aCanonico } from '@/lib/whatsapp';
```

```ts
export async function buscarClientePorWhatsapp(whatsapp: string): Promise<{ nombre: string } | null> {
  const canon = aCanonico(whatsapp);
  if (!canon) return null;
  try {
    const c = await apiFetch<{ nombre: string } | null>(`/clientes/buscar?whatsapp=${encodeURIComponent(canon)}`);
    return c ? { nombre: c.nombre } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Create the hook**

Crear `frontend/src/lib/use-cliente-autocomplete.ts`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { buscarClientePorWhatsapp } from '@/lib/clientes-actions';
import { aCanonico } from '@/lib/whatsapp';

/**
 * Busca (con debounce) el cliente por WhatsApp y, si existe, llama onFound(nombre).
 * Devuelve `encontrado` para mostrar un cartelito. `onFound` debe ser un setState estable.
 */
export function useClienteAutocomplete(whatsapp: string, onFound: (nombre: string) => void): boolean {
  const [encontrado, setEncontrado] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    const canon = aCanonico(whatsapp);
    if (!canon) {
      setEncontrado(false);
      return;
    }
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      const c = await buscarClientePorWhatsapp(whatsapp);
      if (reqRef.current !== id) return; // llegó una búsqueda más nueva
      if (c) {
        onFound(c.nombre);
        setEncontrado(true);
      } else {
        setEncontrado(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [whatsapp, onFound]);

  return encontrado;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: sin errores nuevos (los setters `setNombre`/`setClienteNombre` de `useState` son estables, así que pasarlos como `onFound` no genera warnings de deps).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/clientes-actions.ts frontend/src/lib/use-cliente-autocomplete.ts
git commit -m "feat: action buscarClientePorWhatsapp + hook useClienteAutocomplete"
```

---

### Task 3: Autocompletar en Nueva reserva

**Files:**
- Modify: `frontend/src/components/reservas/nueva-reserva-dialog.tsx`

**Interfaces:**
- Consumes: `useClienteAutocomplete` (Task 2). Estado existente: `nombreCliente`/`setNombre`, `whatsapp`/`setWhatsapp`.
- Produces: diálogo con WhatsApp primero y nombre autocompletado.

- [ ] **Step 1: Import the hook**

En `frontend/src/components/reservas/nueva-reserva-dialog.tsx`, agregar junto a los imports:

```ts
import { useClienteAutocomplete } from '@/lib/use-cliente-autocomplete';
```

- [ ] **Step 2: Wire the hook**

Justo después de la declaración `const [whatsapp, setWhatsapp] = useState('');` (línea ~20), agregar:

```ts
  const clienteEncontrado = useClienteAutocomplete(whatsapp, setNombre);
```

- [ ] **Step 3: Reorder fields (WhatsApp primero) + cartelito**

Reemplazar el bloque del grid Cliente/WhatsApp (líneas ~100-114) por este, con **WhatsApp primero** y el cartelito "Cliente existente" bajo el nombre:

```tsx
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="nueva-whatsapp">WhatsApp</Label>
              <Input id="nueva-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="11 3662 0274" />
              {whatsapp.trim() !== '' && (
                previewWhatsapp(whatsapp)
                  ? <p className="text-xs text-muted-foreground">Se guardará como: {previewWhatsapp(whatsapp)}</p>
                  : <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="nueva-cliente">Cliente</Label>
              <Input id="nueva-cliente" value={nombreCliente} onChange={(e) => setNombre(e.target.value)} />
              {clienteEncontrado && <p className="text-xs text-emerald-600">Cliente existente</p>}
            </div>
          </div>
```

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm build`
Expected: compila sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/reservas/nueva-reserva-dialog.tsx
git commit -m "feat: autocompletar cliente por WhatsApp en Nueva reserva"
```

---

### Task 4: Autocompletar en Nuevo turno fijo

**Files:**
- Modify: `frontend/src/components/fijos/turno-fijo-dialog.tsx`

**Interfaces:**
- Consumes: `useClienteAutocomplete` (Task 2). Estado existente: `clienteNombre`/`setClienteNombre`, `whatsapp`/`setWhatsapp`.
- Produces: diálogo con WhatsApp antes del nombre y nombre autocompletado.

- [ ] **Step 1: Import the hook**

En `frontend/src/components/fijos/turno-fijo-dialog.tsx`, agregar junto a los imports:

```ts
import { useClienteAutocomplete } from '@/lib/use-cliente-autocomplete';
```

- [ ] **Step 2: Wire the hook**

Justo después de `const [whatsapp, setWhatsapp] = useState('');` (línea ~31), agregar:

```ts
  const clienteEncontrado = useClienteAutocomplete(whatsapp, setClienteNombre);
```

- [ ] **Step 3: Reorder fields (WhatsApp antes de Cliente) + cartelito**

Reemplazar los dos bloques Cliente y WhatsApp (el bloque `tf-cliente` seguido del bloque `tf-whatsapp`, líneas ~90-102) por este, con **WhatsApp primero** y el cartelito bajo el nombre:

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
          <div className="space-y-1">
            <Label htmlFor="tf-cliente">Cliente</Label>
            <Input id="tf-cliente" value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} placeholder="Nombre del cliente" />
            {clienteEncontrado && <p className="text-xs text-emerald-600">Cliente existente</p>}
          </div>
```

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm build`
Expected: compila sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/fijos/turno-fijo-dialog.tsx
git commit -m "feat: autocompletar cliente por WhatsApp en Nuevo turno fijo"
```

---

## Cierre por repo

- **Backend:** `finishing-a-development-branch` → merge `feat/autocompletar-cliente` a `main` + push. Deploy en VM (`git fetch && git reset --hard origin/main`).
- **Frontend:** `finishing-a-development-branch` → merge `feat/autocompletar-cliente` a `master` + push → Vercel.

## Self-Review

- **Cobertura del spec:**
  - "WhatsApp primero + autocompletar nombre" → Tasks 3 (reserva) y 4 (fijo).
  - "action buscarClientePorWhatsapp con aCanonico" → Task 2 Step 1.
  - "debounce ~400ms + guard anti-carrera" → Task 2 Step 2 (hook con `reqRef`).
  - "reset del flag al limpiar" → el hook resetea `encontrado` cuando `aCanonico` es inválido/vacío (al limpiar el input el `useEffect` corre con whatsapp vacío → `setEncontrado(false)`).
  - "fijo registra cliente (upsert, no pisa)" → Task 1.
  - "reserva sin cambios" → no hay task de reserva backend. ✓
  - Tests de integración (nuevo/existente) → Task 1 Steps 1-4.
- **Placeholders:** ninguno; todo el código está completo.
- **Consistencia de tipos:** `buscarClientePorWhatsapp` firma idéntica en Task 2 y en el hook; `useClienteAutocomplete(whatsapp, onFound)` usado con `setNombre` (reserva) y `setClienteNombre` (fijo), ambos setters estables de `useState`.

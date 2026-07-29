# Canchas: tipo = deporte + tamaño con Fútbol 6 y "Otro" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en el panel el "Tipo" de cancha sea el deporte (Fútbol/Vóley/Básquet/Pádel/Tenis/Otro) y el "Tamaño" incluya Fútbol 6 y "Otro" (jugadores 0), sin tocar el bot.

**Architecture:** Frontend: un módulo catálogo compartido (listas + labels) consumido por el diálogo, la tabla y los validadores del cliente. Backend: ampliar el validador de `jugadores` a `{0,5,6,7,9,11}` (divisible sigue solo fútbol) + tests. El bot y el endpoint de disponibilidad quedan intactos.

**Tech Stack:** Frontend Next 16 (custom — ver `frontend/AGENTS.md`), Tailwind v4, Zod, pnpm. Backend Node/Express 5/TS, Zod 4, Vitest+Supertest+Testcontainers (necesita Docker).

## Global Constraints

- **Alcance SOLO panel.** No tocar `n8n`/bot ni `src/validators/disponibilidad.schema.ts` (queda `[5,7,9,11]`).
- Set de tamaños válidos, consistente frontend↔backend: **cancha simple** `{0,5,6,7,9,11}`; **cancha divisible** (entera/partes) `{5,6,7,9,11}` (sin 0).
- `jugadores === 0` = "Otro" (sin tamaño de fútbol). Slugs de tipo: `futbol/voley/basquet/padel/tenis/otro`.
- Frontend: NO usar training data de Next; consultar `node_modules/next/dist/docs/` ante dudas. Clases Tailwind estáticas.
- Dos repos, dos ramas: frontend `feat/canchas-deportes` (base `master`); backend `feat/canchas-deportes` (base `main`).

---

## REPO FRONTEND (`frontend`, rama `feat/canchas-deportes` desde `master`)

### Task 1: Catálogo de canchas + validadores del cliente

**Files:**
- Create: `frontend/src/lib/canchas-catalogo.ts`
- Modify: `frontend/src/lib/validators.ts:22` (el `jugadoresField` compartido)

**Interfaces:**
- Produces:
  - `TIPOS: readonly { value: string; label: string }[]`
  - `TAMANOS_FUTBOL: readonly number[]` (= `[5,6,7,9,11]`)
  - `OTRO_TAMANO: 0`
  - `tipoLabel(value: string): string`
  - `tamanoLabel(jugadores: number): string`

- [ ] **Step 1: Crear el catálogo**

Crear `frontend/src/lib/canchas-catalogo.ts`:

```ts
export const TIPOS = [
  { value: 'futbol', label: 'Fútbol' },
  { value: 'voley', label: 'Vóley' },
  { value: 'basquet', label: 'Básquet' },
  { value: 'padel', label: 'Pádel' },
  { value: 'tenis', label: 'Tenis' },
  { value: 'otro', label: 'Otro' },
] as const;

/** Tamaños de fútbol (cancha simple y divisible). */
export const TAMANOS_FUTBOL = [5, 6, 7, 9, 11] as const;

/** Centinela de "Otro" tamaño (canchas que no son de fútbol). */
export const OTRO_TAMANO = 0;

export function tipoLabel(value: string): string {
  return TIPOS.find((t) => t.value === value)?.label ?? value;
}

export function tamanoLabel(jugadores: number): string {
  return jugadores === OTRO_TAMANO ? 'Otro' : `Fútbol ${jugadores}`;
}
```

- [ ] **Step 2: Separar los validadores del cliente**

En `frontend/src/lib/validators.ts`, reemplazar la línea 22:

```ts
const jugadoresField = z.coerce.number().int().refine((n) => [5, 7, 9, 11].includes(n), 'Tamaño inválido');
```

por dos campos:

```ts
const jugadoresFutbolField = z.coerce.number().int().refine((n) => [5, 6, 7, 9, 11].includes(n), 'Tamaño inválido');
const jugadoresField = z.coerce.number().int().refine((n) => [0, 5, 6, 7, 9, 11].includes(n), 'Tamaño inválido');
```

Luego, en `canchaDivisibleSchema`, cambiar `jugadoresEntera: jugadoresField` y `jugadoresParte: jugadoresField` por `jugadoresFutbolField` (ambos). `canchaSchema.jugadores` queda con `jugadoresField` (sin cambio de nombre, ahora acepta 0 y 6).

- [ ] **Step 3: Typecheck**

Run (desde `frontend/`): `pnpm exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/canchas-catalogo.ts frontend/src/lib/validators.ts
git commit -m "feat(canchas): catálogo de deportes/tamaños + validadores (fútbol 6 y Otro)"
```

---

### Task 2: Diálogo y tabla de canchas usan el catálogo

**Files:**
- Modify: `frontend/src/components/canchas/cancha-dialog.tsx`
- Modify: `frontend/src/components/canchas/canchas-table.tsx`

**Interfaces:**
- Consumes: `TIPOS`, `TAMANOS_FUTBOL`, `OTRO_TAMANO`, `tipoLabel`, `tamanoLabel` de `@/lib/canchas-catalogo` (Task 1).

- [ ] **Step 1: Diálogo — importar catálogo y borrar constantes locales**

En `frontend/src/components/canchas/cancha-dialog.tsx`:
- Agregar import: `import { TIPOS, TAMANOS_FUTBOL, OTRO_TAMANO } from '@/lib/canchas-catalogo';`
- **Borrar** las constantes locales `const TIPOS = [...]` (líneas 12-17) y `const TAMANOS = [5, 7, 9, 11];` (línea 18).
- En `tipoFor`, cambiar el default de cancha nueva de `'futbol5'` a `'futbol'`:
  ```ts
  function tipoFor(cancha: Cancha | null) {
    if (!cancha) return 'futbol';
    return TIPOS.some((t) => t.value === cancha.tipo) ? cancha.tipo : 'otro';
  }
  ```

- [ ] **Step 2: Diálogo — selects de tamaño**

En el mismo archivo:
- Los dos selects del form divisible (`c-jug-entera` y `c-jug-parte`): cambiar `{TAMANOS.map(...)}` por `{TAMANOS_FUTBOL.map((n) => <option key={n} value={n}>Fútbol {n}</option>)}`.
- El select simple `c-jugadores` (Tamaño): agregar la opción "Otro" al final:
  ```tsx
  <select id="c-jugadores" value={jugadores} onChange={(e) => setJugadores(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
    {TAMANOS_FUTBOL.map((n) => <option key={n} value={n}>Fútbol {n}</option>)}
    <option value={OTRO_TAMANO}>Otro</option>
  </select>
  ```
- El select de Tipo (`c-subtipo`) ya mapea `TIPOS` (`value`/`label`) — funciona igual con el catálogo importado, sin cambios de JSX.

- [ ] **Step 3: Tabla — usar labels del catálogo**

En `frontend/src/components/canchas/canchas-table.tsx`:
- Agregar import: `import { tipoLabel, tamanoLabel } from '@/lib/canchas-catalogo';`
- Fila desktop: `<TableCell className="text-neutral-600">{c.tipo}</TableCell>` → `{tipoLabel(c.tipo)}`; y `<TableCell className="text-neutral-600">Fútbol {c.jugadores}</TableCell>` → `{tamanoLabel(c.jugadores)}`.
- Card mobile: `<span className="block"><span className="text-xs text-neutral-500">Tipo</span> {c.tipo}</span>` → `{tipoLabel(c.tipo)}`; y `... Tamaño</span> Fútbol {c.jugadores}` → `{tamanoLabel(c.jugadores)}`.
- Hoja (Sheet): `<p ...>Fútbol {seleccion.jugadores} · ...` → `{tamanoLabel(seleccion.jugadores)} · ...`.

- [ ] **Step 4: Typecheck + build**

Run (desde `frontend/`): `pnpm exec tsc --noEmit && pnpm build`
Expected: compila sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/canchas/cancha-dialog.tsx frontend/src/components/canchas/canchas-table.tsx
git commit -m "feat(canchas): diálogo y tabla usan catálogo (deportes + Fútbol 6 + Otro)"
```

---

## REPO BACKEND (`canchitas-backend`, rama `feat/canchas-deportes` desde `main`)

### Task 3: Validador acepta jugadores 0 y 6 (divisible solo fútbol) + tests

**Files:**
- Modify: `backend/src/validators/cancha.schema.ts:4-13`
- Test: `backend/tests/integration/cancha.routes.test.ts:85-107` (actualizar/agregar en el describe `POST /canchas — jugadores`)

**Interfaces:**
- Consumes: rutas `POST /canchas` (auth JWT admin), helpers `setupTestDb/teardownTestDb/resetTables` y `signAdminToken` (ya usados en el archivo de test).

- [ ] **Step 1: Actualizar/agregar los tests (RED)**

En `backend/tests/integration/cancha.routes.test.ts`, dentro del `describe('POST /canchas — jugadores', ...)`, **reemplazar** el test `rechaza jugadores=6 con 400` por estos tres tests:

```ts
  it('acepta jugadores=6 (fútbol 6)', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C6', tipo: 'futbol', precioHora: 1000, jugadores: 6 });
    expect(res.status).toBe(201);
    expect(res.body.jugadores).toBe(6);
  });

  it('acepta jugadores=0 (Otro / no fútbol)', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'Padel 1', tipo: 'padel', precioHora: 1000, jugadores: 0 });
    expect(res.status).toBe(201);
    expect(res.body.jugadores).toBe(0);
  });

  it('rechaza jugadores=8 con 400', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C8', tipo: 'otro', precioHora: 1000, jugadores: 8 });
    expect(res.status).toBe(400);
  });
```

(Dejar intactos los tests `crea una cancha con jugadores=7` y `rechaza la creacion sin jugadores con 400`.)

- [ ] **Step 2: Run tests to verify RED**

Run (desde `backend/`): `npx vitest run tests/integration/cancha.routes.test.ts`
Expected: FAIL — `acepta jugadores=6` da 400 (validador actual rechaza 6) y `acepta jugadores=0` da 400. `rechaza jugadores=8` pasa.

- [ ] **Step 3: Ampliar el validador**

En `backend/src/validators/cancha.schema.ts`, reemplazar la línea 4:

```ts
const jugadores = z.union([z.literal(5), z.literal(7), z.literal(9), z.literal(11)]);
```

por:

```ts
const jugadoresFutbol = z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(9), z.literal(11)]);
const jugadores = z.union([z.literal(0), z.literal(5), z.literal(6), z.literal(7), z.literal(9), z.literal(11)]);
```

Y en `crearDivisibleSchema`, cambiar `jugadoresEntera: jugadores` y `jugadoresParte: jugadores` por `jugadoresFutbol` (ambos). `createCanchaSchema` y `updateCanchaSchema` siguen usando `jugadores` (sin cambios en esas líneas).

- [ ] **Step 4: Run tests to verify GREEN**

Run (desde `backend/`): `npx vitest run tests/integration/cancha.routes.test.ts`
Expected: PASS (todo el archivo, incluidos destacada/precioHoraPico/jugadores).

- [ ] **Step 5: Commit**

```bash
git add backend/src/validators/cancha.schema.ts backend/tests/integration/cancha.routes.test.ts
git commit -m "feat(canchas): validador acepta jugadores 0 y 6 (divisible solo fútbol)"
```

---

## Cierre por repo

- **Frontend:** `finishing-a-development-branch` → merge `feat/canchas-deportes` a `master` + push → Vercel.
- **Backend:** `finishing-a-development-branch` → merge `feat/canchas-deportes` a `main` + push → deploy VM (`git reset --hard origin/main`).

## Self-Review

- **Cobertura del spec:**
  - Catálogo (TIPOS deportes, TAMANOS_FUTBOL, OTRO_TAMANO, labels) → Task 1 Step 1.
  - Validadores del cliente (simple `{0,5,6,7,9,11}`, divisible `{5,6,7,9,11}`) → Task 1 Step 2.
  - Diálogo: tipo=deportes, tamaño con Fútbol 6 + Otro, divisible solo fútbol, default `'futbol'` → Task 2 Steps 1-2.
  - Tabla/hoja: `tamanoLabel`/`tipoLabel` en los 3+2 usos → Task 2 Step 3.
  - Backend validador `{0,5,6,7,9,11}` + divisible `{5,6,7,9,11}` → Task 3 Step 3.
  - Test que hay que actualizar (`rechaza jugadores=6`) → Task 3 Step 1.
  - disponibilidad.schema sin cambios → no hay task que lo toque. ✓
- **Placeholders:** ninguno.
- **Consistencia de tipos:** `tamanoLabel`/`tipoLabel`/`TAMANOS_FUTBOL`/`OTRO_TAMANO` con los mismos nombres en Task 1 (definición) y Task 2 (uso). Set de tamaños idéntico frontend (Task 1/2) y backend (Task 3).

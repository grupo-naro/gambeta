# Cancha destacada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marcar canchas como "destacadas" (premium) con un campo booleano administrable desde el panel, para que el bot auto-asigne canchas comunes y ofrezca las destacadas como upgrade.

**Architecture:** Campo `destacada Boolean @default(false)` en `Cancha`, validado/persistido en crear y editar, y expuesto por `GET /canchas` (escalar de Prisma). El panel agrega un toggle y un badge. El endpoint `/disponibilidad/por-tamano` NO cambia: el bot (fuera de este plan) ya hace `GET /canchas?activa=true` y enriquece las canchas libres por id.

**Tech Stack:** Backend Node+Express 5+TS, Prisma 7 (cliente vía `../db/client.js`), PostgreSQL, Zod 4, Vitest+Supertest+Testcontainers (necesita Docker Desktop). Frontend Next 16 + React 19 + Tailwind 4 + Base UI + pnpm + Vitest.

**Ramas:** backend `feat/destacada-backend` (`c:/Users/Lautaro/Desktop/ortigoza/backend`), frontend `feat/destacada-panel` (`c:/Users/Lautaro/Desktop/ortigoza/frontend`). El bot (workflow n8n `I8yiX4g1rGh5Hb2U`) se hace aparte con n8n MCP tras el deploy del backend.

---

## Parte A — Backend (rama `feat/destacada-backend`)

### Task A0: Crear la rama

- [ ] **Step 1: Crear la rama desde main**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/backend`):
```bash
git checkout main && git pull && git checkout -b feat/destacada-backend
```
Expected: `Switched to a new branch 'feat/destacada-backend'`

---

### Task A1: Campo `destacada` en `Cancha` + migración

**Files:**
- Modify: `backend/prisma/schema.prisma` (model Cancha)
- Create: `backend/prisma/migrations/<timestamp>_add_destacada_cancha/migration.sql` (lo genera Prisma)

- [ ] **Step 1: Agregar el campo al schema**

En `backend/prisma/schema.prisma`, dentro de `model Cancha`, agregar `destacada` justo debajo de `jugadores`:

```prisma
  jugadores   Int                 @default(5)
  destacada   Boolean             @default(false)
  precioHora  Decimal             @db.Decimal(10, 2)
```

- [ ] **Step 2: Generar la migración (requiere Docker Desktop corriendo)**

Run:
```bash
npx prisma migrate dev --name add_destacada_cancha
```
Expected: crea `prisma/migrations/<timestamp>_add_destacada_cancha/migration.sql` con `ALTER TABLE "Cancha" ADD COLUMN "destacada" BOOLEAN NOT NULL DEFAULT false;` y regenera el cliente.

- [ ] **Step 3: Verificar que compila**

Run:
```bash
npx tsc --noEmit
```
Expected: sin errores (el tipo `Cancha` generado ahora incluye `destacada: boolean`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(canchas): add destacada field to Cancha with migration"
```

---

### Task A2: Validación + persistencia de `destacada` (TDD)

**Files:**
- Modify: `backend/src/validators/cancha.schema.ts`
- Modify: `backend/src/services/cancha.service.ts`
- Test: `backend/tests/integration/cancha.routes.test.ts`

- [ ] **Step 1: Escribir el test que falla**

En `backend/tests/integration/cancha.routes.test.ts` ya existe el patrón de auth admin (helper que crea AdminUser + login y un `auth(...)` que setea el Bearer; se usa para los endpoints `authJwt`). Reutilizá ese mismo patrón. Agregá este describe al final del archivo:

```ts
describe('Cancha destacada', () => {
  it('POST /canchas con destacada:true lo persiste y GET lo devuelve', async () => {
    const token = await adminToken();
    const res = await supertest(app).post('/canchas').set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Techada', tipo: 'futbol5', precioHora: 1500, jugadores: 5, destacada: true });
    expect(res.status).toBe(201);
    expect(res.body.destacada).toBe(true);
    const list = await supertest(app).get('/canchas').set('x-api-key', 'svc');
    expect(list.body.find((c: any) => c.id === res.body.id).destacada).toBe(true);
  });

  it('POST /canchas sin destacada -> default false', async () => {
    const token = await adminToken();
    const res = await supertest(app).post('/canchas').set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Comun', tipo: 'futbol5', precioHora: 1000, jugadores: 5 });
    expect(res.status).toBe(201);
    expect(res.body.destacada).toBe(false);
  });

  it('PATCH /canchas/:id con destacada:true lo actualiza', async () => {
    const token = await adminToken();
    const created = await supertest(app).post('/canchas').set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'X', tipo: 'futbol5', precioHora: 1000, jugadores: 5 });
    const res = await supertest(app).patch(`/canchas/${created.body.id}`).set('Authorization', `Bearer ${token}`)
      .send({ destacada: true });
    expect(res.status).toBe(200);
    expect(res.body.destacada).toBe(true);
  });
});
```

NOTA: si el helper de auth en el archivo se llama distinto a `adminToken()`, usá el que exista (mirá los describes ya presentes que pegan a endpoints `authJwt`). El `GET /canchas` es `authAny` → se puede con `x-api-key: 'svc'` (la key de test).

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
npx vitest run tests/integration/cancha.routes.test.ts -t "destacada"
```
Expected: FAIL — `res.body.destacada` es `undefined` (el schema descarta el campo y el service no lo persiste).

- [ ] **Step 3: Agregar `destacada` a los schemas**

En `backend/src/validators/cancha.schema.ts`, agregar `destacada` a `createCanchaSchema` y `updateCanchaSchema` (NO a `crearDivisibleSchema`). El bloque queda así (mantené el resto igual, incluido el `jugadores` ya presente):

```ts
export const createCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1), tipo: z.string().min(1), precioHora: z.number().positive(), jugadores, destacada: z.boolean().optional().default(false) }),
  query: empty, params: empty,
});
export const updateCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1).optional(), tipo: z.string().min(1).optional(), precioHora: z.number().positive().optional(), jugadores: jugadores.optional(), destacada: z.boolean().optional() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 4: Persistir `destacada` en el service**

En `backend/src/services/cancha.service.ts`, ampliar los tipos de `create` y `update` para incluir `destacada` (el cuerpo ya hace spread de `input`, así que el valor viaja al `create`/`update` de Prisma):

```ts
  create: async (input: { nombre: string; tipo: string; precioHora: number; jugadores: number; destacada?: boolean }) =>
    prisma.$transaction(async (tx) => {
      const cancha = await tx.cancha.create({ data: input });
      const sector = await tx.sector.create({ data: { nombre: cancha.nombre } });
      await tx.canchaSector.create({ data: { canchaId: cancha.id, sectorId: sector.id } });
      return cancha;
    }),
  update: async (id: string, input: Partial<{ nombre: string; tipo: string; precioHora: number; jugadores: number; destacada: boolean }>) => {
    await canchaService.get(id);
    return canchaRepo.update(id, input);
  },
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run:
```bash
npx vitest run tests/integration/cancha.routes.test.ts -t "destacada"
```
Expected: PASS (las 3 aserciones).

- [ ] **Step 6: Commit**

```bash
git add src/validators/cancha.schema.ts src/services/cancha.service.ts tests/integration/cancha.routes.test.ts
git commit -m "feat(canchas): validate and persist destacada on create/update"
```

---

### Task A3: Suite completa backend verde

- [ ] **Step 1: Correr toda la suite (necesita Docker)**

Run:
```bash
npx vitest run && npx tsc --noEmit
```
Expected: todo verde. El campo tiene `@default(false)`, así que los tests que crean canchas sin `destacada` (vía HTTP o Prisma) no rompen.

- [ ] **Step 2: Si algo falla por el nuevo campo, arreglarlo y commit**

```bash
git add -A
git commit -m "test(canchas): fix fixtures for destacada field"
```
(Omitir si no hubo cambios.)

---

## Parte B — Frontend (rama `feat/destacada-panel`)

### Task B0: Crear la rama

- [ ] **Step 1: Crear la rama desde master**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/frontend`):
```bash
git checkout master && git checkout -b feat/destacada-panel
```
Expected: `Switched to a new branch 'feat/destacada-panel'`

---

### Task B1: Tipo + schema `destacada` (TDD)

**Files:**
- Modify: `frontend/src/lib/types.ts:3` (interface Cancha)
- Modify: `frontend/src/lib/validators.ts` (canchaSchema)
- Test: `frontend/src/lib/validators.test.ts`

- [ ] **Step 1: Escribir el test que falla**

En `frontend/src/lib/validators.test.ts`, agregar:

```ts
describe('canchaSchema con destacada', () => {
  it('acepta destacada=true', () => {
    const r = canchaSchema.safeParse({ nombre: 'Techada', tipo: 'futbol5', precioHora: '1500', jugadores: '5', destacada: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.destacada).toBe(true);
  });
  it('default destacada=false cuando se omite', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol5', precioHora: '1000', jugadores: '5' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.destacada).toBe(false);
  });
});
```

(`canchaSchema` ya está importado al tope del archivo por los tests existentes.)

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
pnpm vitest run src/lib/validators.test.ts -t "destacada"
```
Expected: FAIL — `r.data.destacada` es `undefined` (el schema no tiene el campo).

- [ ] **Step 3: Agregar `destacada` al schema**

En `frontend/src/lib/validators.ts`, agregar el campo a `canchaSchema` (debajo de `jugadores`):

```ts
export const canchaSchema = z.object({
  nombre: z.string().min(1, 'Ingresá el nombre'),
  tipo: z.string().min(1, 'Elegí el tipo'),
  precioHora: z.coerce.number().positive('El precio debe ser mayor a 0'),
  jugadores: jugadoresField,
  destacada: z.boolean().default(false),
});
```

(Se usa `z.boolean()` y NO `z.coerce.boolean()`: el valor viene de un checkbox como booleano real; `coerce.boolean` convertiría cualquier string no vacío en `true`.)

- [ ] **Step 4: Agregar `destacada` al tipo `Cancha`**

En `frontend/src/lib/types.ts`, línea 3:

```ts
export interface Cancha { id: string; nombre: string; tipo: string; jugadores: number; destacada: boolean; precioHora: number; activa: boolean; grupoId: string | null; esEntera: boolean }
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run:
```bash
pnpm vitest run src/lib/validators.test.ts -t "destacada"
```
Expected: PASS (las 2 aserciones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/validators.ts src/lib/validators.test.ts
git commit -m "feat(canchas): add destacada to Cancha type and canchaSchema"
```

---

### Task B2: Server action pasa `destacada`

**Files:**
- Modify: `frontend/src/lib/canchas-actions.ts:13` (type CanchaInput)

- [ ] **Step 1: Ampliar el tipo de input**

En `frontend/src/lib/canchas-actions.ts`:

```ts
type CanchaInput = { nombre: string; tipo: string; precioHora: number; jugadores: number; destacada: boolean };
```

(Los cuerpos de `crearCancha`/`editarCancha` ya reenvían el `input` completo, así que `destacada` viaja solo. Todos los exports siguen siendo `async function` — no introducir arrow consts en este módulo `'use server'`.)

- [ ] **Step 2: Verificar tipos**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: sin errores (o sólo en `cancha-dialog.tsx`, que se arregla en B3).

- [ ] **Step 3: Commit**

```bash
git add src/lib/canchas-actions.ts
git commit -m "feat(canchas): server action forwards destacada"
```

---

### Task B3: Toggle "Cancha destacada" en el dialog

**Files:**
- Modify: `frontend/src/components/canchas/cancha-dialog.tsx`

- [ ] **Step 1: Agregar estado, reset y checkbox; pasar `destacada` al schema**

En `frontend/src/components/canchas/cancha-dialog.tsx`:

(a) Agregar el estado junto a los demás (después de `const [jugadores, setJugadores] = ...`):
```tsx
  const [destacada, setDestacada] = useState(cancha?.destacada ?? false);
```

(b) En `handleOpenChange`, dentro del `if (nextOpen) {`, agregar el reset (después de `setJugadores(...)`):
```tsx
      setDestacada(cancha?.destacada ?? false);
```

(c) En `submit`, en la rama simple, pasar `destacada` al parse:
```tsx
    const parsed = canchaSchema.safeParse({ nombre, tipo, precioHora: precio, jugadores, destacada });
```

(d) En el JSX del form simple (la rama `: (` que renderiza tipo/jugadores/precio), agregar el checkbox después del bloque de "Precio por hora":
```tsx
              <div className="space-y-1"><Label htmlFor="c-precio">Precio por hora</Label>
                <Input id="c-precio" type="number" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="12000" />
              </div>
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input type="checkbox" checked={destacada} onChange={(e) => setDestacada(e.target.checked)} className="h-4 w-4" />
                Cancha destacada (se ofrece como upgrade)
              </label>
```

- [ ] **Step 2: Verificar tipos**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/canchas/cancha-dialog.tsx
git commit -m "feat(canchas): destacada toggle in cancha dialog"
```

---

### Task B4: Badge "Destacada" en la tabla

**Files:**
- Modify: `frontend/src/components/canchas/canchas-table.tsx`

- [ ] **Step 1: Mostrar el badge en la celda de nombre**

En `frontend/src/components/canchas/canchas-table.tsx`, dentro de la celda de nombre (el `<span>` que ya muestra el badge "Divisible" y "parte"), agregar un badge "Destacada" cuando `c.destacada`. Justo después del bloque del badge "Divisible" (`{c.esEntera && c.grupoId && (...)}`), agregar:

```tsx
                        {c.destacada && (
                          <Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">Destacada</Badge>
                        )}
```

(El componente `Badge` ya está importado en este archivo.)

- [ ] **Step 2: Verificar tipos + build**

Run:
```bash
pnpm exec tsc --noEmit && pnpm build
```
Expected: build OK (`✓ Compiled successfully`).

- [ ] **Step 3: Commit**

```bash
git add src/components/canchas/canchas-table.tsx
git commit -m "feat(canchas): show Destacada badge in canchas table"
```

---

### Task B5: Verificación frontend completa

- [ ] **Step 1: Lint + tsc + tests + build**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build
```
Expected: todo verde. `pnpm build` es obligatorio (atrapa errores de boundary RSC que tsc/lint/vitest no ven).

---

## Parte C — Cierre

### Task C1: Finalizar las ramas

- [ ] **Step 1: Backend — finishing-a-development-branch**

Anunciar "I'm using the finishing-a-development-branch skill to complete this work." en el repo backend (rama `feat/destacada-backend`): verificar tests verdes, presentar opciones, merge a `main` + push. **Verificar el deploy** después: el auto-deploy del runner NO es confiable (en la feature anterior dio 404); confirmar con
`docker exec canchitas-backend node -e "require('http').get('http://localhost:3000/canchas',r=>{console.log(r.statusCode);process.exit(0)})"`
o redeployar manual (`cd /opt/canchitas/canchitas-backend && git fetch origin && git reset --hard origin/main && docker compose -f docker-compose.vm.yml up -d --build`). La migración `destacada` corre sola con `migrate deploy` al arrancar el contenedor.

- [ ] **Step 2: Frontend — finishing-a-development-branch**

Idem en el repo frontend (rama `feat/destacada-panel`): merge a `master`. (El repo no tiene remote → el merge queda local.)

### Task C2: Bot (n8n) — fuera de este plan, se hace con n8n MCP tras el deploy

En el Cerebro del workflow `I8yiX4g1rGh5Hb2U`, rama reservar/consultar_disponibilidad, reescribir el paso "elegiste hora → canchas libres":
- Construir `byId` desde el `GET /canchas?activa=true` que la rama ya hace; enriquecer las libres del slot (`sl.canchas`) con `destacada`, `precioHora`, `esEntera`, `grupoId`.
- `destacadas = libres.filter(byId destacada)`, `comunes = resto`. `pickComun`: ordenar comunes suelta(`!grupoId`)→parte(`grupoId&&!esEntera`)→entera(`esEntera`), tomar la primera.
- Si hay comunes y ≥1 destacada → ofrecer upgrade (nombre destacada + `precioHora`), guardar ctx `{…, comunId, comunNombre, opciones:[destacada, {id:comunId, nombre:'comun'}]}`. Reusar `matchC` para resolver la elección; normalizar acentos ("común"→"comun") para que "una común" matchee la opción sintética; "si/dale" sin especificar → común.
- Si solo destacadas → ofrecerla con precio; "si/dale" → confirmar esa.
- Si solo comunes → proponer directo la común auto-asignada (sin listar).
- El cierre (`confirmar` → `POST /reservas`) no cambia.

---

## Self-Review

**Spec coverage:**
- Campo `destacada Boolean @default(false)` + migración → Task A1 ✓
- Validación en create/update (NO divisible) → Task A2 Step 3 ✓
- Service persiste destacada → Task A2 Step 4 ✓
- `GET /canchas` devuelve destacada → escalar de Prisma, verificado en test A2 Step 1 ✓
- Endpoint por-tamano sin cambios → no hay tarea que lo toque ✓
- Tests backend (crear/editar/default) → Task A2 ✓
- Frontend tipo + schema + action + toggle + badge + unit → B1–B4 ✓
- Bot upsell → Task C2 (fuera de Superpowers, documentado) ✓

**Placeholder scan:** Sin TBD/TODO. Único punto "según exista": el nombre del helper de auth en cancha.routes.test.ts (instrucción explícita de usar el que ya está), no es un placeholder de implementación.

**Type consistency:** `destacada` boolean en todos lados. Backend: zod `z.boolean().optional().default(false)` (create) / `.optional()` (update); service `destacada?: boolean`. Frontend: `z.boolean().default(false)`, `Cancha.destacada: boolean`, `CanchaInput.destacada: boolean`, estado `useState(cancha?.destacada ?? false)`. `crearDivisibleSchema` y la rama divisible del dialog NO tocan destacada (consistente con el spec).

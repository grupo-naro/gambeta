# Nombre real del cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guardar el nombre REAL del cliente: el bot lo pide una vez (a todos), se marca `nombreConfirmado`, y no se pisa con el nombre del contacto. La seña sigue por contacto.

**Architecture:** Backend: columna `Cliente.nombreConfirmado` + endpoint `GET /clientes/buscar?whatsapp` + `POST /reservas` que respeta el nombre confirmado. Frontend: `crearReserva` manda `nombreConfirmado:true`. El bot (n8n) se ajusta después del deploy (documentado en el spec, fuera de este plan de código).

**Tech Stack:** Node, Express, Prisma 7, Zod, Vitest + Supertest + Testcontainers (Docker). Frontend Next 16 + pnpm.

**Spec:** `docs/superpowers/specs/2026-06-16-nombre-real-cliente-design.md`

**Gotchas:** los tests corren `npx prisma migrate deploy` contra el contenedor → la migración debe existir como archivo. Tras editar el schema, correr `npx prisma generate` para que los tipos incluyan `nombreConfirmado`. Imports `.js`. `GET /clientes/buscar` se registra ANTES de `GET /:id`.

> Ramas: backend `feat/nombre-real-cliente` (desde `main`); frontend `feat/nombre-real-cliente-panel` (desde `master`).

---

# BACKEND — rama `feat/nombre-real-cliente`

> `cd backend && git checkout main && git pull && git checkout -b feat/nombre-real-cliente`. Requiere Docker para los tests.

### Task 1: Migración `Cliente.nombreConfirmado`

**Files:**
- Modify: `prisma/schema.prisma` (modelo `Cliente`)
- Create: `prisma/migrations/20260616170000_add_nombre_confirmado_cliente/migration.sql`

- [ ] **Step 1: Editar el schema.** En `prisma/schema.prisma`, en `model Cliente`, agregar la línea (debajo de `esContacto`):
```prisma
  nombreConfirmado Boolean   @default(false)
```

- [ ] **Step 2: Crear el archivo de migración.** Crear `prisma/migrations/20260616170000_add_nombre_confirmado_cliente/migration.sql` con:
```sql
-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "nombreConfirmado" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Regenerar el cliente Prisma.**
Run: `cd backend && npx prisma generate`
Expected: regenera `src/generated/prisma` con `nombreConfirmado` en el tipo `Cliente`. (0 errores.)

- [ ] **Step 4: Commit**
```bash
git add prisma/schema.prisma prisma/migrations/20260616170000_add_nombre_confirmado_cliente/migration.sql
git commit -m "feat(cliente): columna nombreConfirmado"
```

---

### Task 2: `GET /clientes/buscar?whatsapp` (TDD)

**Files:**
- Modify: `src/validators/cliente.schema.ts`, `src/services/cliente.service.ts`, `src/routes/cliente.routes.ts`
- Test: `tests/integration/cliente-nombre.test.ts` (crear)

- [ ] **Step 1: Test que falla.** Crear `tests/integration/cliente-nombre.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('GET /clientes/buscar', () => {
  it('devuelve el cliente por whatsapp con nombreConfirmado', async () => {
    await getPrisma().cliente.create({ data: { whatsapp: '+5491150000000', nombre: 'Daniel', nombreConfirmado: true } });
    const r = await supertest(app).get('/clientes/buscar?whatsapp=' + encodeURIComponent('+5491150000000')).set('x-api-key', 'svc');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nombre: 'Daniel', nombreConfirmado: true });
    expect(typeof r.body.id).toBe('string');
  });
  it('devuelve null si no existe', async () => {
    const r = await supertest(app).get('/clientes/buscar?whatsapp=%2B5491150009999').set('x-api-key', 'svc');
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
  });
  it('400 si falta whatsapp', async () => {
    const r = await supertest(app).get('/clientes/buscar').set('x-api-key', 'svc');
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Correr → FALLA.** `cd backend && npx vitest run tests/integration/cliente-nombre.test.ts` → FAIL (ruta inexistente / 404).

- [ ] **Step 3: Implementar.**

En `src/validators/cliente.schema.ts`, agregar al final (antes no hay default export):
```typescript
export const buscarClienteSchema = z.object({
  body: z.unknown(),
  query: z.object({ whatsapp: z.string().min(1) }),
  params: empty,
});
```

En `src/services/cliente.service.ts`, agregar al objeto `clienteService`:
```typescript
  buscarPorWhatsapp: async (whatsapp: string) => {
    const c = await clienteRepo.findByWhatsapp(whatsapp);
    return c ? { id: c.id, nombre: c.nombre, nombreConfirmado: c.nombreConfirmado } : null;
  },
```

En `src/routes/cliente.routes.ts`, importar el schema y la ruta **antes** de `GET /:id`:
```typescript
import { upsertClienteSchema, buscarClienteSchema } from '../validators/cliente.schema.js';
```
y agregar (entre `GET '/'` y `GET '/:id'`):
```typescript
clienteRoutes.get('/buscar', authAny, validate(buscarClienteSchema), async (req, res, next) => {
  try { res.json(await clienteService.buscarPorWhatsapp(String((req as any).valid.query.whatsapp))); } catch (e) { next(e); }
});
```

- [ ] **Step 4: Correr → PASA.** `npx vitest run tests/integration/cliente-nombre.test.ts` → 3 passing.

- [ ] **Step 5: Commit**
```bash
git add src/validators/cliente.schema.ts src/services/cliente.service.ts src/routes/cliente.routes.ts tests/integration/cliente-nombre.test.ts
git commit -m "feat(cliente): GET /clientes/buscar por whatsapp"
```

---

### Task 3: `POST /reservas` respeta el nombre confirmado (TDD)

**Files:**
- Modify: `src/validators/reserva.schema.ts` (`createReservaSchema.body`), `src/services/reserva.service.ts` (`CreateReservaInput` + `crear` upsert)
- Test: `tests/integration/cliente-nombre.test.ts` (agregar casos)

- [ ] **Step 1: Agregar tests que fallan.** Agregar al final de `tests/integration/cliente-nombre.test.ts`:
```typescript
describe('POST /reservas — nombreConfirmado', () => {
  async function cancha() {
    return (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id;
  }
  const fechaFutura = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const reservar = (canchaId: string, over: Record<string, unknown>) =>
    supertest(app).post('/reservas').set('x-api-key', 'svc').send({
      canchaId, whatsapp: '+5491150000001', nombreCliente: 'X', esContacto: true,
      fecha: fechaFutura(), horaInicio: '18:00', ...over,
    });

  it('crea el cliente con nombreConfirmado=true cuando se envía', async () => {
    const c = await cancha();
    const r = await reservar(c, { nombreCliente: 'Daniel', nombreConfirmado: true });
    expect(r.status).toBe(201);
    const b = await supertest(app).get('/clientes/buscar?whatsapp=%2B5491150000001').set('x-api-key', 'svc');
    expect(b.body).toMatchObject({ nombre: 'Daniel', nombreConfirmado: true });
  });

  it('NO pisa un nombre confirmado con uno sin confirmar', async () => {
    const c = await cancha();
    await reservar(c, { nombreCliente: 'Daniel', nombreConfirmado: true, horaInicio: '18:00' });
    await reservar(c, { nombreCliente: 'Publicidad Naro', nombreConfirmado: false, horaInicio: '19:00' });
    const b = await supertest(app).get('/clientes/buscar?whatsapp=%2B5491150000001').set('x-api-key', 'svc');
    expect(b.body).toMatchObject({ nombre: 'Daniel', nombreConfirmado: true });
  });
});
```

- [ ] **Step 2: Correr → FALLA.** `npx vitest run tests/integration/cliente-nombre.test.ts` → los 2 nuevos fallan (hoy el nombre se pisa / no hay nombreConfirmado).

- [ ] **Step 3: Implementar.**

En `src/validators/reserva.schema.ts`, dentro de `createReservaSchema.body`, agregar el campo (junto a los otros, antes de `notas`):
```typescript
    nombreConfirmado: z.boolean().default(false),
```

En `src/services/reserva.service.ts`, en `interface CreateReservaInput` agregar:
```typescript
  nombreConfirmado?: boolean;
```
y reemplazar el upsert del cliente dentro de `crear` (el bloque `const cliente = await tx.cliente.upsert({...})`) por:
```typescript
      const existente = await tx.cliente.findUnique({ where: { whatsapp: input.whatsapp } });
      const conservarNombre = !!(existente?.nombreConfirmado && !input.nombreConfirmado);
      const cliente = await tx.cliente.upsert({
        where: { whatsapp: input.whatsapp },
        create: {
          whatsapp: input.whatsapp,
          nombre: input.nombreCliente,
          esContacto: input.esContacto,
          nombreConfirmado: input.nombreConfirmado ?? false,
          primeraReserva: new Date(),
          totalReservas: 1,
        },
        update: {
          nombre: conservarNombre ? existente!.nombre : input.nombreCliente,
          esContacto: input.esContacto,
          nombreConfirmado: input.nombreConfirmado ? true : undefined,
          totalReservas: { increment: 1 },
        },
      });
```
(El `route` ya pasa `(req).valid.body` completo a `reservaService.crear`, así que `nombreConfirmado` llega solo al estar en el schema.)

- [ ] **Step 4: Correr → PASA.** `npx vitest run tests/integration/cliente-nombre.test.ts` → 5 passing.

- [ ] **Step 5: Regresión.** `npx vitest run tests/integration/reserva.routes.test.ts tests/integration/cliente.routes.test.ts` → PASS (el upsert sigue funcionando, default nombreConfirmado=false no rompe nada).

- [ ] **Step 6: Commit**
```bash
git add src/validators/reserva.schema.ts src/services/reserva.service.ts tests/integration/cliente-nombre.test.ts
git commit -m "feat(reservas): respetar nombre confirmado del cliente en el upsert"
```

### Cierre backend
- [ ] **Step 7:** `cd backend && npx tsc --noEmit` → 0 errores.
- [ ] **Step 8:** Anunciar e invocar **superpowers:finishing-a-development-branch** → merge a `main` + push. Luego deploy VM (lo hace el usuario): `git fetch && reset --hard origin/main && up -d --build && migrate deploy`.

---

# FRONTEND — rama `feat/nombre-real-cliente-panel`

> `cd frontend && git checkout master && git checkout -b feat/nombre-real-cliente-panel`.

### Task 4: `crearReserva` manda `nombreConfirmado: true`

**Files:**
- Modify: `src/lib/reservas-actions.ts` (`crearReserva`)

- [ ] **Step 1: Editar.** En `src/lib/reservas-actions.ts`, en `crearReserva`, el body del POST hoy es `{ ...input, esContacto: false }`. Cambiarlo a:
```typescript
  return run(() => apiFetch('/reservas', { method: 'POST', body: JSON.stringify({ ...input, esContacto: false, nombreConfirmado: true }) }));
```
(El nombre lo tipea la recepción → es real → confirmado.)

- [ ] **Step 2: Verificar + build.** `cd frontend && pnpm exec tsc --noEmit && pnpm lint && pnpm build` → OK.

- [ ] **Step 3: Commit + cerrar.**
```bash
git add src/lib/reservas-actions.ts
git commit -m "feat(reservas): marcar nombreConfirmado al crear desde el panel"
```
Luego **superpowers:finishing-a-development-branch** → merge a `master` local.

---

## Bot (n8n — NO es parte de este plan de código; se aplica con n8n MCP tras el deploy del backend)
En el nodo `Cerebro`, rama `confirmar`: mantener `findContacts` solo para `esContacto` (seña); para el nombre, `GET /clientes/buscar?whatsapp=<number>` → si `nombreConfirmado` reusar `clienteDb.nombre` (no preguntar), si no preguntar "¿A nombre de quién…?" (esperaNombre) y al responder `POST /reservas` con `nombreConfirmado:true`. Dejar de usar el nombre del contacto/pushName como nombre de reserva. (Degradación: si `/clientes/buscar` falla, tratar como no confirmado y preguntar.)

## Notas
- Aditivo: `nombreConfirmado` default false; el bot viejo sigue funcionando hasta que se actualice (post-deploy).
- La seña no cambia (sigue por `esContacto`).

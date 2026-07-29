# Clientes: editar WhatsApp + eliminar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder editar el WhatsApp de un cliente (con control de duplicado) y eliminar clientes (bloqueado si tienen reservas), desde la sección Clientes.

**Architecture:** Backend: `editar` acepta `whatsapp` (chequeo de duplicado) y nuevo `eliminar` + `DELETE /clientes/:id`. Frontend: la hoja del cliente suma input WhatsApp + botón Eliminar con confirmación. Dos repos: backend (rama off `main`) y frontend (rama off `master`).

**Tech Stack:** Backend Node/Express/Prisma/Vitest+Testcontainers; Frontend Next 16. pnpm/npm.

## Global Constraints

- Backend: imports CON `.js`. Errores: `Conflict` (409) / `NotFound` (404) de `utils/errors`.
- Eliminar **bloqueado si el cliente tiene reservas** (409). Editar whatsapp duplicado → 409.
- Frontend: sin `.js`; `useConfirm()` API = `confirm({ title, description?, confirmLabel?, destructive? }): Promise<boolean>`.
- Verificación: backend `npx tsc --noEmit && npx vitest run` (Docker); frontend `pnpm lint && pnpm build`.

---

## File Structure

- `backend/src/validators/cliente.schema.ts` (Modify): `whatsapp` en `editarClienteSchema`.
- `backend/src/services/cliente.service.ts` (Modify): `editar` con whatsapp + `eliminar`.
- `backend/src/repositories/cliente.repo.ts` (Modify): `update` con whatsapp + `delete`.
- `backend/src/routes/cliente.routes.ts` (Modify): `DELETE /:id`.
- `backend/tests/integration/cliente.routes.test.ts` (Create): tests.
- `frontend/src/lib/clientes-actions.ts` (Modify): `editarWhatsappCliente` + `eliminarCliente`.
- `frontend/src/components/clientes/clientes-table.tsx` (Modify): input WhatsApp + botón Eliminar.

---

### Task 1: Backend — editar whatsapp + eliminar (TDD)  [repo: backend, rama `feat/clientes-crud` off `main`]

**Files:**
- Modify: `backend/src/validators/cliente.schema.ts`, `backend/src/services/cliente.service.ts`, `backend/src/repositories/cliente.repo.ts`, `backend/src/routes/cliente.routes.ts`
- Test: `backend/tests/integration/cliente.routes.test.ts`

**Interfaces:**
- Produces: `PATCH /clientes/:id` acepta `whatsapp?`; `DELETE /clientes/:id`; `clienteService.eliminar(id)`.

- [ ] **Step 1: Escribir el test (debe fallar)**

Crear `backend/tests/integration/cliente.routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000, jugadores: 5 } })).id; });

const crearCliente = (whatsapp: string, nombre = 'Juan') =>
  supertest(app).post('/clientes').set('x-api-key', 'svc').send({ whatsapp, nombre });

describe('PATCH /clientes/:id (whatsapp)', () => {
  it('edita el whatsapp del cliente', async () => {
    const c = (await crearCliente('+5491150000001')).body;
    const r = await supertest(app).patch(`/clientes/${c.id}`).set('authorization', `Bearer ${token}`).send({ whatsapp: '1136620274' });
    expect(r.status).toBe(200);
    const updated = await getPrisma().cliente.findUnique({ where: { id: c.id } });
    expect(updated?.whatsapp).not.toBe('+5491150000001');
  });

  it('rechaza whatsapp duplicado con 409', async () => {
    const a = (await crearCliente('+5491150000001', 'A')).body;
    await crearCliente('+5491150000002', 'B');
    const r = await supertest(app).patch(`/clientes/${a.id}`).set('authorization', `Bearer ${token}`).send({ whatsapp: '+5491150000002' });
    expect(r.status).toBe(409);
  });
});

describe('DELETE /clientes/:id', () => {
  it('elimina un cliente sin reservas', async () => {
    const c = (await crearCliente('+5491150000003')).body;
    const r = await supertest(app).delete(`/clientes/${c.id}`).set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(await getPrisma().cliente.count({ where: { id: c.id } })).toBe(0);
  });

  it('bloquea eliminar si el cliente tiene reservas (409)', async () => {
    const fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId, whatsapp: '+5491150000004', nombreCliente: 'Con Reserva', esContacto: true, fecha, horaInicio: '18:00' });
    const c = (await getPrisma().cliente.findMany())[0]; // único cliente tras el reset
    const r = await supertest(app).delete(`/clientes/${c.id}`).set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(409);
    expect(await getPrisma().cliente.count({ where: { id: c.id } })).toBe(1);
  });
});
```

- [ ] **Step 2: Correr el test → falla**

Run: `cd backend && npx vitest run tests/integration/cliente.routes.test.ts`
Expected: FAIL — PATCH ignora whatsapp / no existe DELETE (404).

- [ ] **Step 3: Schema — `whatsapp` opcional en editar**

En `backend/src/validators/cliente.schema.ts`, cambiar `editarClienteSchema` body:
```ts
  body: z.object({ nombre: z.string().min(1).optional(), confiable: z.boolean().optional() }),
```
por:
```ts
  body: z.object({ nombre: z.string().min(1).optional(), confiable: z.boolean().optional(), whatsapp: whatsappCanonico.optional() }),
```
(`whatsappCanonico` ya está importado en ese archivo.)

- [ ] **Step 4: Repo — `update` con whatsapp + `delete`**

En `backend/src/repositories/cliente.repo.ts`, cambiar:
```ts
  update: (id: string, data: { nombre?: string; confiable?: boolean; nombreConfirmado?: boolean }) =>
    prisma.cliente.update({ where: { id }, data }),
```
por:
```ts
  update: (id: string, data: { nombre?: string; confiable?: boolean; nombreConfirmado?: boolean; whatsapp?: string }) =>
    prisma.cliente.update({ where: { id }, data }),
  delete: (id: string) => prisma.cliente.delete({ where: { id } }),
```

- [ ] **Step 5: Service — `editar` con whatsapp + `eliminar`**

En `backend/src/services/cliente.service.ts`:
1. Cambiar el import de errores:
```ts
import { NotFound } from '../utils/errors.js';
```
por:
```ts
import { NotFound, Conflict } from '../utils/errors.js';
```
2. Reemplazar el método `editar` por:
```ts
  editar: async (id: string, data: { nombre?: string; confiable?: boolean; whatsapp?: string }) => {
    const c = await clienteRepo.findById(id);
    if (!c) throw NotFound('Cliente', id);
    const patch: { nombre?: string; confiable?: boolean; nombreConfirmado?: boolean; whatsapp?: string } = {};
    if (data.nombre !== undefined) { patch.nombre = data.nombre; patch.nombreConfirmado = true; }
    if (data.confiable !== undefined) patch.confiable = data.confiable;
    if (data.whatsapp !== undefined) {
      const otro = await clienteRepo.findByWhatsapp(data.whatsapp);
      if (otro && otro.id !== id) throw Conflict('Ya existe un cliente con ese WhatsApp');
      patch.whatsapp = data.whatsapp;
    }
    return clienteRepo.update(id, patch);
  },
```
3. Agregar (después de `editar`) el método `eliminar`:
```ts
  eliminar: async (id: string) => {
    const c = await clienteRepo.findById(id);
    if (!c) throw NotFound('Cliente', id);
    if (c.reservas.length > 0) throw Conflict('No se puede eliminar: el cliente tiene reservas');
    await clienteRepo.delete(id);
    return { ok: true };
  },
```

- [ ] **Step 6: Ruta — `DELETE /:id`**

En `backend/src/routes/cliente.routes.ts`, agregar después de la ruta `patch('/:id', ...)`:
```ts
clienteRoutes.delete('/:id', authJwt, async (req, res, next) => {
  try { res.json(await clienteService.eliminar(String(req.params.id))); } catch (e) { next(e); }
});
```

- [ ] **Step 7: Correr el test → pasa**

Run: `cd backend && npx vitest run tests/integration/cliente.routes.test.ts`
Expected: PASS (4/4).

- [ ] **Step 8: Typecheck + suite**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: tsc sin errores; suite verde (la falla pre-existente de `sena.test.ts` por fecha hardcodeada `2026-06-15` es ajena).

- [ ] **Step 9: Commit**

```bash
cd backend && git add src/validators/cliente.schema.ts src/services/cliente.service.ts src/repositories/cliente.repo.ts src/routes/cliente.routes.ts tests/integration/cliente.routes.test.ts
git commit -m "feat(clientes): editar whatsapp (con control de duplicado) + eliminar (bloqueado si tiene reservas)"
```

---

### Task 2: Frontend — WhatsApp editable + eliminar en la hoja  [repo: frontend, rama `feat/clientes-crud` off `master`]

**Files:**
- Modify: `frontend/src/lib/clientes-actions.ts`, `frontend/src/components/clientes/clientes-table.tsx`

**Interfaces:**
- Consumes: `PATCH /clientes/:id` (whatsapp) + `DELETE /clientes/:id` (Task 1); `useConfirm()`; `previewWhatsapp`.

- [ ] **Step 1: Acciones nuevas**

En `frontend/src/lib/clientes-actions.ts`, agregar (después de `editarNombreCliente`):
```ts
export async function editarWhatsappCliente(id: string, whatsapp: string): Promise<Result> {
  return run(() => apiFetch(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify({ whatsapp }) }));
}
export async function eliminarCliente(id: string): Promise<Result> {
  return run(() => apiFetch(`/clientes/${id}`, { method: 'DELETE' }));
}
```

- [ ] **Step 2: Imports + estado en la tabla**

En `frontend/src/components/clientes/clientes-table.tsx`:
1. Ampliar el import de acciones:
```tsx
import { editarConfianza, editarNombreCliente, editarWhatsappCliente, eliminarCliente } from '@/lib/clientes-actions';
```
2. Agregar imports:
```tsx
import { previewWhatsapp } from '@/lib/whatsapp';
import { useConfirm } from '@/components/ui/confirm';
```
3. Dentro del componente, agregar el hook y el estado (junto a los `useState`/`abrir`):
```tsx
  const confirm = useConfirm();
  const [whatsapp, setWhatsapp] = useState('');
```
4. En `abrir(c)`, setear también el whatsapp:
```tsx
  function abrir(c: Cliente) { setSeleccion(c); setNombre(c.nombre); setWhatsapp(c.whatsapp); }
```

- [ ] **Step 3: Campo WhatsApp editable en la hoja**

En el `<SheetContent>`, **después** del `div` del campo Nombre (el que tiene `htmlFor="cl-nombre"`), insertar:
```tsx
            <div className="space-y-1">
              <label htmlFor="cl-whatsapp" className="text-xs text-neutral-600">WhatsApp</label>
              <div className="flex gap-2">
                <Input id="cl-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
                <Button variant="outline" disabled={pending || !previewWhatsapp(whatsapp) || previewWhatsapp(whatsapp) === seleccion.whatsapp} onClick={() => act(() => editarWhatsappCliente(seleccion.id, whatsapp.trim()), 'WhatsApp actualizado')}>Guardar</Button>
              </div>
              {whatsapp.trim() !== '' && !previewWhatsapp(whatsapp) && <p className="text-xs text-destructive">Número inválido. Ingresá los 10 dígitos (ej: 11 3662 0274).</p>}
            </div>
```

- [ ] **Step 4: Botón Eliminar (con confirmación)**

Al final del `<SheetContent>` (después del botón de confianza y su nota), insertar:
```tsx
            <Button
              variant="destructive"
              className="h-11 w-full"
              disabled={pending}
              onClick={async () => {
                if (await confirm({ title: 'Eliminar cliente', description: `Vas a eliminar a ${seleccion.nombre}. No se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
                  act(() => eliminarCliente(seleccion.id), 'Cliente eliminado', true);
                }
              }}
            >
              Eliminar cliente
            </Button>
```
(`act(..., true)` cierra la hoja al éxito; si el backend bloquea por reservas, `act` muestra el error en un toast.)

- [ ] **Step 5: Verificar build + lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/lib/clientes-actions.ts src/components/clientes/clientes-table.tsx
git commit -m "feat(clientes): editar WhatsApp y eliminar cliente desde la hoja"
```

---

## Self-review (hecho)

- **Cobertura del spec:** editar whatsapp + duplicado 409 (T1 s3-5) ✓; eliminar bloqueado si reservas (T1 s5-6) ✓; DELETE route (T1 s6) ✓; tests 4 casos (T1 s1) ✓; acciones front (T2 s1) ✓; input whatsapp + preview (T2 s3) ✓; botón eliminar + useConfirm (T2 s4) ✓.
- **Sin placeholders.** Código before/after completo.
- **Consistencia:** `clienteService.eliminar`, `clienteRepo.delete`, `editarWhatsappCliente`/`eliminarCliente`, `confirm({title,description,confirmLabel,destructive})` (API real).

## Cierre

Por repo, **superpowers:finishing-a-development-branch**:
- **Backend:** merge `feat/clientes-crud` → `main` + push → deploy VM (con IPv4 ya funciona; o el runner auto-deploya).
- **Frontend:** merge `feat/clientes-crud` → `master` + push → Vercel.
- **Revisión visual + e2e:** editar WhatsApp de un cliente (y probar duplicado → error); eliminar un cliente sin reservas (OK) y uno con reservas (bloqueado). Requiere ambos deployados.

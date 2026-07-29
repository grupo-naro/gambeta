# Cobro al reservar desde el panel (seña / total / nada) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al crear una reserva desde el panel, poder elegir el cobro (Nada / Seña / Total) y que el sistema lo registre, reflejándose en el chip de pago.

**Architecture:** Backend: `POST /reservas` acepta `cobroInicial` + `medioCobro` y, si es staff (JWT), registra un cobro con `cobroService.crear` (seña vía `senaService.montoParaPrecio`, o total = precio). Frontend: el diálogo Nueva reserva agrega los selectores y los manda. Dos repos: backend (rama off `main`) y frontend (rama off `master`).

**Tech Stack:** Backend Node/Express/Prisma/Vitest+Testcontainers; Frontend Next 16/Tailwind. pnpm/npm.

## Global Constraints

- Solo aplica a reservas creadas por **staff (JWT)**; el **bot (x-api-key) NO cobra** aunque mande `cobroInicial`.
- Backend: imports CON `.js`. Frontend: sin `.js`, clases Tailwind estáticas.
- Reusar `cobroService.crear(reservaId, { monto, medio }, registradoPorId)` (registra cobro + recalcula saldo + marca hoja).
- Defaults: schema backend `cobroInicial='ninguno'`, `medioCobro='EFECTIVO'`; frontend arranca en `cobro='sena'`, `medioCobro='EFECTIVO'`.
- Verificación: backend `npx tsc --noEmit && npx vitest run` (Testcontainers → Docker); frontend `pnpm lint && pnpm build`.

---

## File Structure

- `backend/src/validators/reserva.schema.ts` (Modify): `cobroInicial` + `medioCobro` en `createReservaSchema`.
- `backend/src/routes/reserva.routes.ts` (Modify): registrar cobro tras crear (staff).
- `backend/tests/integration/reserva.routes.test.ts` (Modify): tests del cobro inicial.
- `frontend/src/lib/reservas-actions.ts` (Modify): `crearReserva` pasa los campos.
- `frontend/src/components/reservas/nueva-reserva-dialog.tsx` (Modify): selectores Cobro + Medio.

---

### Task 1: Backend — cobro inicial en `POST /reservas` (TDD)  [repo: backend, rama `feat/cobro-al-reservar` off `main`]

**Files:**
- Modify: `backend/src/validators/reserva.schema.ts`
- Modify: `backend/src/routes/reserva.routes.ts`
- Test: `backend/tests/integration/reserva.routes.test.ts`

**Interfaces:**
- Consumes: `senaService.montoParaPrecio(precio): Promise<number>`, `cobroService.crear(reservaId, {monto, medio}, registradoPorId)`, `reservaService.crear(body, {porStaff})`.
- Produces: body de `POST /reservas` acepta `cobroInicial: 'ninguno'|'sena'|'total'` y `medioCobro: 'EFECTIVO'|'TRANSFERENCIA'`.

- [ ] **Step 1: Escribir los tests (deben fallar)**

En `backend/tests/integration/reserva.routes.test.ts`, agregar dentro del `describe('POST /reservas', ...)` (después del test de staff→CONFIRMADA):

```ts
  it('staff (JWT) con cobroInicial=total -> registra cobro por el precio completo', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const res = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body({ cobroInicial: 'total', medioCobro: 'EFECTIVO' }));
    expect(res.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: res.body.id } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBe(Number(res.body.monto)); // precio completo
  });

  it('staff (JWT) con cobroInicial=sena -> registra un cobro parcial (>0 y < precio)', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const res = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body({ cobroInicial: 'sena' }));
    expect(res.status).toBe(201);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: res.body.id } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBeGreaterThan(0);
    expect(Number(cobros[0].monto)).toBeLessThanOrEqual(Number(res.body.monto));
  });

  it('sin cobroInicial -> no registra cobro', async () => {
    const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
    const res = await supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send(body());
    expect(res.status).toBe(201);
    expect(await getPrisma().cobro.count({ where: { reservaId: res.body.id } })).toBe(0);
  });

  it('bot (x-api-key) con cobroInicial=total -> NO registra cobro (solo staff)', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ cobroInicial: 'total' }));
    expect(res.status).toBe(201);
    expect(await getPrisma().cobro.count({ where: { reservaId: res.body.id } })).toBe(0);
  });
```

- [ ] **Step 2: Correr los tests → fallan**

Run: `cd backend && npx vitest run tests/integration/reserva.routes.test.ts`
Expected: los 4 nuevos FALLAN (el body aún no acepta `cobroInicial`; no se registra cobro).

- [ ] **Step 3: Agregar los campos al schema**

En `backend/src/validators/reserva.schema.ts`, dentro del `body` de `createReservaSchema`, agregar (después de `notas: z.string().optional(),`):
```ts
    cobroInicial: z.enum(['ninguno', 'sena', 'total']).default('ninguno'),
    medioCobro: z.enum(['EFECTIVO', 'TRANSFERENCIA']).default('EFECTIVO'),
```

- [ ] **Step 4: Importar `senaService` en la ruta**

En `backend/src/routes/reserva.routes.ts`, agregar junto a los imports de services:
```ts
import { senaService } from '../services/sena.service.js';
```

- [ ] **Step 5: Registrar el cobro tras crear (solo staff)**

En `backend/src/routes/reserva.routes.ts`, reemplazar el cuerpo del handler `POST /reservas`:
```ts
    const porStaff = req.principal?.kind === 'admin';
    const r = await reservaService.crear((req as any).valid.body, { porStaff });
    await auditService.log(req, { accion: 'CREAR', entidad: 'Reserva', entidadId: r.id, descripcion: 'Creó una reserva' });
    res.status(201).json(r);
```
por:
```ts
    const body = (req as any).valid.body;
    const porStaff = req.principal?.kind === 'admin';
    const r = await reservaService.crear(body, { porStaff });
    if (porStaff && body.cobroInicial !== 'ninguno') {
      const precio = Number(r.monto);
      const monto = body.cobroInicial === 'total' ? precio : await senaService.montoParaPrecio(precio);
      const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : null;
      if (monto > 0) await cobroService.crear(r.id, { monto, medio: body.medioCobro }, adminId);
    }
    await auditService.log(req, { accion: 'CREAR', entidad: 'Reserva', entidadId: r.id, descripcion: 'Creó una reserva' });
    res.status(201).json(r);
```

- [ ] **Step 6: Correr los tests → pasan**

Run: `cd backend && npx vitest run tests/integration/reserva.routes.test.ts`
Expected: PASS (todos, incluidos los 4 nuevos).

- [ ] **Step 7: Typecheck + suite completa**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: tsc sin errores; suite verde (las 3 fallas pre-existentes de `sena.test.ts` por Docker/contención, si aparecen, son ajenas).

- [ ] **Step 8: Commit**

```bash
cd backend && git add src/validators/reserva.schema.ts src/routes/reserva.routes.ts tests/integration/reserva.routes.test.ts
git commit -m "feat(reservas): cobro inicial (sena/total) al crear desde el panel (staff)"
```

---

### Task 2: Frontend — selectores Cobro + Medio en Nueva reserva  [repo: frontend, rama `feat/cobro-al-reservar` off `master`]

**Files:**
- Modify: `frontend/src/lib/reservas-actions.ts`
- Modify: `frontend/src/components/reservas/nueva-reserva-dialog.tsx`

**Interfaces:**
- Consumes: el endpoint `POST /reservas` con `cobroInicial` + `medioCobro` (Task 1).
- Produces: `crearReserva(input)` con `cobroInicial: 'ninguno'|'sena'|'total'` y `medioCobro: 'EFECTIVO'|'TRANSFERENCIA'`.

- [ ] **Step 1: `crearReserva` pasa los campos**

En `frontend/src/lib/reservas-actions.ts`, reemplazar:
```ts
export async function crearReserva(input: { canchaId: string; whatsapp: string; nombreCliente: string; fecha: string; horaInicio: string }): Promise<Result> {
  return run(() => apiFetch('/reservas', { method: 'POST', body: JSON.stringify({ ...input, esContacto: false, nombreConfirmado: true }) }));
}
```
por:
```ts
export async function crearReserva(input: { canchaId: string; whatsapp: string; nombreCliente: string; fecha: string; horaInicio: string; cobroInicial: 'ninguno' | 'sena' | 'total'; medioCobro: 'EFECTIVO' | 'TRANSFERENCIA' }): Promise<Result> {
  return run(() => apiFetch('/reservas', { method: 'POST', body: JSON.stringify({ ...input, esContacto: false, nombreConfirmado: true }) }));
}
```

- [ ] **Step 2: Estado en el diálogo**

En `frontend/src/components/reservas/nueva-reserva-dialog.tsx`, agregar los estados junto a los demás `useState` (después de `const [whatsapp, setWhatsapp] = useState('');`):
```tsx
  const [cobro, setCobro] = useState<'ninguno' | 'sena' | 'total'>('sena');
  const [medioCobro, setMedioCobro] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');
```
Y en `resetForm()`, agregar (antes de `setSlots([]);`):
```tsx
    setCobro('sena');
    setMedioCobro('EFECTIVO');
```

- [ ] **Step 3: Pasar los campos en submit**

En `submit()`, reemplazar:
```tsx
      const r = await crearReserva({ canchaId, whatsapp, nombreCliente, fecha, horaInicio });
```
por:
```tsx
      const r = await crearReserva({ canchaId, whatsapp, nombreCliente, fecha, horaInicio, cobroInicial: cobro, medioCobro });
```

- [ ] **Step 4: Selectores Cobro + Medio en el form**

En el mismo archivo, insertar este bloque **después** del `div` con la grilla Cliente/WhatsApp (el `<div className="grid grid-cols-2 gap-3">…</div>` que cierra antes de `</div>` del contenedor `space-y-3`), como último hijo del contenedor `<div className="space-y-3">`:
```tsx
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="nueva-cobro">Cobro</Label>
              <select id="nueva-cobro" value={cobro} onChange={(e) => setCobro(e.target.value as 'ninguno' | 'sena' | 'total')} className="w-full rounded-md border px-2 py-1.5">
                <option value="ninguno">Nada</option>
                <option value="sena">Seña</option>
                <option value="total">Total</option>
              </select>
            </div>
            {cobro !== 'ninguno' && (
              <div className="space-y-1">
                <Label htmlFor="nueva-medio">Medio</Label>
                <select id="nueva-medio" value={medioCobro} onChange={(e) => setMedioCobro(e.target.value as 'EFECTIVO' | 'TRANSFERENCIA')} className="w-full rounded-md border px-2 py-1.5">
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                </select>
              </div>
            )}
          </div>
```

- [ ] **Step 5: Verificar build + lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/lib/reservas-actions.ts src/components/reservas/nueva-reserva-dialog.tsx
git commit -m "feat(reservas): elegir cobro (nada/sena/total) + medio al crear reserva en el panel"
```

---

## Self-review (hecho)

- **Cobertura del spec:** schema `cobroInicial`+`medioCobro` (T1 s3) ✓; registro de cobro staff seña/total (T1 s5) ✓; bot no cobra (`porStaff` guard + test) ✓; default schema `ninguno` (T1 s3) ✓; frontend selectores + default `sena`/`EFECTIVO` (T2 s2,s4) ✓; `crearReserva` pasa campos (T2 s1,s3) ✓; tests (T1 s1) ✓.
- **Sin placeholders.** Código before/after completo.
- **Consistencia:** `cobroInicial`/`medioCobro` con los mismos literales en backend y frontend; `cobroService.crear`/`senaService.montoParaPrecio` con las firmas reales.

## Cierre

Tras cada tarea, **superpowers:finishing-a-development-branch** en su repo:
- **Backend:** merge `feat/cobro-al-reservar` → `main` + push (deploy VM; ojo IPv6/runner → puede requerir deploy manual: `git fetch && git reset --hard origin/main && docker compose ... up -d --build`).
- **Frontend:** merge `feat/cobro-al-reservar` → `master` + push → Vercel.
- **Revisión visual + punta a punta:** crear una reserva con Seña → chip "Debe $resto"; con Total → "Pagado"; con Nada → "Debe $total". Requiere **ambos** deployados.

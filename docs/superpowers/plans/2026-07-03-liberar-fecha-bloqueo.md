# Liberar fecha de bloqueo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder liberar una fecha puntual de un bloqueo recurrente (ej. el profe falta un lunes) para que esa cancha vuelva a estar disponible/reservable ese día, sin borrar el bloqueo recurrente.

**Architecture:** Espejo exacto del "Liberar fecha" de turnos fijos: nueva tabla `BloqueoExcepcion` (bloqueoId+fecha), y todos los read-paths que aplican un bloqueo (ocupación/disponibilidad, agenda, hoja espejo, calendario del panel) saltan el bloqueo si hay excepción para esa fecha. A diferencia de fijos, un bloqueo NO se materializa en reserva, así que NO hay reserva que cancelar.

**Tech Stack:** Backend Node/Express 5 + TS + Prisma 7 + Zod 4 + Vitest/Supertest/Testcontainers (necesita Docker). Frontend Next 16 + Tailwind v4 + pnpm + Vitest.

## Global Constraints

- Backend repo `canchitas-backend`, rama de trabajo `feat/liberar-bloqueo` desde `main` (NO master). Frontend repo `frontend`, rama `feat/liberar-bloqueo` desde `master`.
- Fecha siempre como `new Date(fecha + 'T00:00:00.000Z')` al persistir/consultar `@db.Date` (consistente con todo el sistema).
- Rutas de bloqueos: `authJwt` + `requireRole('ADMIN')` (igual que POST/DELETE existentes).
- Migración a mano: el auto-deploy NO corre `prisma migrate deploy`. La migración debe existir para que los tests (testcontainers) la apliquen, y hay que correrla a mano en la VM al deployar.
- Alcance: solo bloqueos **recurrentes** ("Liberar fecha" no aparece en puntuales). Solo panel, sin bot.
- **NO pushear** hasta que el usuario lo indique: mergear local a `main`/`master` y dejar listo para push.

---

### Task 1: Modelo `BloqueoExcepcion` + migración

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_bloqueo_excepcion/migration.sql` (generado por prisma)

**Interfaces:**
- Produces: modelo Prisma `BloqueoExcepcion { id, bloqueoId, bloqueo, fecha }` y relación `Bloqueo.excepciones BloqueoExcepcion[]`.

- [ ] **Step 1: Agregar el modelo y la relación en `prisma/schema.prisma`**

Agregar el modelo nuevo (junto a `TurnoFijoExcepcion`):

```prisma
model BloqueoExcepcion {
  id        String   @id @default(cuid())
  bloqueoId String
  bloqueo   Bloqueo  @relation(fields: [bloqueoId], references: [id], onDelete: Cascade)
  fecha     DateTime @db.Date

  @@unique([bloqueoId, fecha])
}
```

Y en `model Bloqueo`, agregar la relación inversa (después de la línea `cancha  Cancha  @relation(...)`):

```prisma
  excepciones BloqueoExcepcion[]
```

- [ ] **Step 2: Generar la migración**

Run: `npx prisma migrate dev --name add_bloqueo_excepcion`
(Si no hay DB de dev conectada, usar `npx prisma migrate dev --name add_bloqueo_excepcion --create-only` y luego verificar el SQL.)

Expected: se crea `prisma/migrations/<ts>_add_bloqueo_excepcion/migration.sql` con contenido equivalente a:

```sql
CREATE TABLE "BloqueoExcepcion" (
    "id" TEXT NOT NULL,
    "bloqueoId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    CONSTRAINT "BloqueoExcepcion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BloqueoExcepcion_bloqueoId_fecha_key" ON "BloqueoExcepcion"("bloqueoId", "fecha");
ALTER TABLE "BloqueoExcepcion" ADD CONSTRAINT "BloqueoExcepcion_bloqueoId_fkey" FOREIGN KEY ("bloqueoId") REFERENCES "Bloqueo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerar el client y verificar build**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(bloqueos): modelo BloqueoExcepcion + migracion"
```

---

### Task 2: Servicio + validador + rutas + read-path de ocupación (disponibilidad)

**Files:**
- Modify: `src/services/bloqueo.service.ts`
- Modify: `src/validators/bloqueo.schema.ts`
- Modify: `src/routes/bloqueo.routes.ts`
- Modify: `src/services/ocupacion.service.ts:42-45`
- Test: `tests/integration/liberar-bloqueo.test.ts`

**Interfaces:**
- Consumes: modelo `BloqueoExcepcion` (Task 1).
- Produces:
  - `bloqueoService.agregarExcepcion(id: string, fecha: string): Promise<BloqueoExcepcion>`
  - `bloqueoService.quitarExcepcion(id: string, fecha: string): Promise<{ ok: true }>`
  - `bloqueoService.list` ahora incluye `excepciones`
  - Rutas `POST /bloqueos/:id/excepciones` (body `{ fecha }`) y `DELETE /bloqueos/:id/excepciones/:fecha`
  - `excepcionBloqueoSchema` en el validador

- [ ] **Step 1: Escribir el test de integración (falla)**

Crear `tests/integration/liberar-bloqueo.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol', precioHora: 12000, jugadores: 5 } })).id;
});

const disp = (fecha: string) => supertest(app).get(`/disponibilidad?canchaId=${canchaId}&fecha=${fecha}`).set('x-api-key', 'svc');
const libre = (r: any, hora: string) => (r.body.slots || []).some((s: any) => s.horaInicio === hora);

// 2026-07-06 = LUNES (diaSemana 1). 2026-07-13 = lunes siguiente.
describe('liberar una fecha de un bloqueo recurrente la vuelve reservable ese día', () => {
  it('excepción libera el slot solo en la fecha liberada', async () => {
    const b = await getPrisma().bloqueo.create({ data: { canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' } });

    // sanity: el lunes 18:00 está bloqueado
    expect(libre(await disp('2026-07-06'), '18:00')).toBe(false);

    // liberar ese lunes
    const lib = await supertest(app).post(`/bloqueos/${b.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: '2026-07-06' });
    expect(lib.status).toBeLessThan(400);

    // ese lunes quedó libre; el lunes siguiente sigue bloqueado
    expect(libre(await disp('2026-07-06'), '18:00')).toBe(true);
    expect(libre(await disp('2026-07-13'), '18:00')).toBe(false);
  });

  it('POST es idempotente y DELETE re-bloquea la fecha', async () => {
    const b = await getPrisma().bloqueo.create({ data: { canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' } });
    await supertest(app).post(`/bloqueos/${b.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: '2026-07-06' });
    await supertest(app).post(`/bloqueos/${b.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: '2026-07-06' });
    expect(await getPrisma().bloqueoExcepcion.count({ where: { bloqueoId: b.id } })).toBe(1);

    const del = await supertest(app).delete(`/bloqueos/${b.id}/excepciones/2026-07-06`).set('authorization', `Bearer ${token}`);
    expect(del.status).toBeLessThan(400);
    expect(libre(await disp('2026-07-06'), '18:00')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/integration/liberar-bloqueo.test.ts`
Expected: FAIL (rutas 404 / método inexistente).

- [ ] **Step 3: Agregar el validador en `src/validators/bloqueo.schema.ts`**

Al final del archivo:

```typescript
export const excepcionBloqueoSchema = z.object({
  body: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 4: Agregar los métodos al servicio en `src/services/bloqueo.service.ts`**

Cambiar `list` para incluir excepciones:

```typescript
  list: (canchaId?: string) =>
    prisma.bloqueo.findMany({ where: canchaId ? { canchaId } : {}, include: { cancha: { select: { nombre: true } }, excepciones: true }, orderBy: { creadoEn: 'desc' } }),
```

Agregar dentro del objeto `bloqueoService` (después de `eliminar`):

```typescript
  async agregarExcepcion(id: string, fecha: string) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    const creado = await prisma.bloqueoExcepcion.upsert({
      where: { bloqueoId_fecha: { bloqueoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') } },
      create: { bloqueoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') }, update: {},
    });
    sheetsSync.marcarSemanaSucia();
    return creado;
  },
  async quitarExcepcion(id: string, fecha: string) {
    await prisma.bloqueoExcepcion.deleteMany({ where: { bloqueoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') } });
    sheetsSync.marcarSemanaSucia();
    return { ok: true };
  },
```

(NO hace falta cancelar reservas: los bloqueos no se materializan.)

- [ ] **Step 5: Agregar las rutas en `src/routes/bloqueo.routes.ts`**

Importar el schema nuevo:

```typescript
import { crearBloqueoSchema, idBloqueoParamSchema, excepcionBloqueoSchema } from '../validators/bloqueo.schema.js';
```

Agregar antes del cierre del archivo:

```typescript
bloqueoRoutes.post('/:id/excepciones', authJwt, requireRole('ADMIN'), validate(excepcionBloqueoSchema), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const body = (req as any).valid.body;
    const result = await bloqueoService.agregarExcepcion(id, body.fecha);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Bloqueo', entidadId: id, descripcion: 'Liberó la fecha ' + body.fecha + ' de un bloqueo' });
    res.status(201).json(result);
  } catch (e) { next(e); }
});
bloqueoRoutes.delete('/:id/excepciones/:fecha', authJwt, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await bloqueoService.quitarExcepcion(id, String(req.params.fecha));
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Bloqueo', entidadId: id, descripcion: 'Reactivó la fecha ' + req.params.fecha + ' de un bloqueo' });
    res.json(result);
  } catch (e) { next(e); }
});
```

- [ ] **Step 6: Aplicar la excepción en el read-path de ocupación (`src/services/ocupacion.service.ts:42-45`)**

Reemplazar el bloque de bloqueos de `rangosPlantilla`:

```typescript
    const bloqueos = await prisma.bloqueo.findMany({
      where: { canchaId: { in: canchas }, activo: true, OR: [{ recurrente: true, diaSemana: dia }, { recurrente: false, fecha: fechaDate }] },
      include: { excepciones: { where: { fecha: fechaDate } } },
    });
    for (const b of bloqueos) if (b.excepciones.length === 0) out.push({ ini: fromHHMM(b.horaInicio), fin: fromHHMM(b.horaFin), tipo: 'bloqueo' });
```

- [ ] **Step 7: Correr el test para verificar que pasa**

Run: `npx vitest run tests/integration/liberar-bloqueo.test.ts`
Expected: PASS (2/2).

- [ ] **Step 8: Correr regresión de bloqueos/disponibilidad**

Run: `npx vitest run tests/integration/ --reporter=dot`
Expected: sin regresiones.

- [ ] **Step 9: Commit**

```bash
git add src/services/bloqueo.service.ts src/validators/bloqueo.schema.ts src/routes/bloqueo.routes.ts src/services/ocupacion.service.ts tests/integration/liberar-bloqueo.test.ts
git commit -m "feat(bloqueos): agregar/quitar excepcion + liberar disponibilidad"
```

---

### Task 3: Read-paths de agenda y hoja espejo

**Files:**
- Modify: `src/services/agenda.service.ts:43-51`
- Modify: `src/services/sheets/expandir.ts:8-12,52-54`
- Modify: `src/services/sheets/sheetsData.ts:75-80`
- Test: `tests/integration/liberar-bloqueo.test.ts` (agregar caso agenda)

**Interfaces:**
- Consumes: `bloqueoService.agregarExcepcion` y modelo (Tasks 1-2).

- [ ] **Step 1: Agregar el caso de agenda al test (falla)**

En `tests/integration/liberar-bloqueo.test.ts`, agregar dentro del `describe`:

```typescript
  it('la agenda del día liberado no incluye el bloqueo', async () => {
    const b = await getPrisma().bloqueo.create({ data: { canchaId, motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' } });
    await supertest(app).post(`/bloqueos/${b.id}/excepciones`).set('authorization', `Bearer ${token}`).send({ fecha: '2026-07-06' });
    const ag = await supertest(app).get('/agenda?fecha=2026-07-06').set('x-api-key', 'svc');
    expect(ag.status).toBe(200);
    expect((ag.body.bloqueos || []).some((x: any) => x.id === b.id)).toBe(false);
  });
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/integration/liberar-bloqueo.test.ts -t "agenda del día liberado"`
Expected: FAIL (el bloqueo aparece).

- [ ] **Step 3: Aplicar la excepción en `src/services/agenda.service.ts:43-51`**

Reemplazar la query y el map de bloqueos:

```typescript
    const bloqueosRaw = await prisma.bloqueo.findMany({
      where: { activo: true, OR: [{ recurrente: true, diaSemana: dia }, { recurrente: false, fecha: fechaDate }] },
      include: { cancha: true, excepciones: { where: { fecha: fechaDate } } },
    });
    const bloqueos = bloqueosRaw.filter((b) => b.excepciones.length === 0).map((b) => ({
      id: b.id, canchaId: b.canchaId, motivo: b.motivo, recurrente: b.recurrente,
      diaSemana: b.diaSemana, fecha: b.fecha, horaInicio: b.horaInicio, horaFin: b.horaFin,
      nota: b.nota, cancha: { nombre: b.cancha.nombre },
    }));
```

- [ ] **Step 4: Agregar `excepciones` a la hoja espejo**

En `src/services/sheets/expandir.ts`, agregar el campo a `BloqueoInput` (líneas 8-12):

```typescript
export interface BloqueoInput {
  canchaId: string; motivo: 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO';
  recurrente: boolean; diaSemana: number | null; fecha: string | null;
  horaInicio: string; horaFin: string; nota: string | null; excepciones: string[];
}
```

Y saltar la fecha liberada en el loop de bloqueos (línea 53):

```typescript
    for (const b of input.bloqueos) {
      const aplica = b.recurrente ? b.diaSemana === dow : b.fecha === fecha;
      if (!aplica || b.excepciones.includes(fecha)) continue;
```

En `src/services/sheets/sheetsData.ts:75-80`, traer excepciones:

```typescript
  const bloqueosDb = await prisma.bloqueo.findMany({ where: { activo: true }, include: { excepciones: true } });
  const bloqueos: BloqueoInput[] = bloqueosDb.map((b) => ({
    canchaId: b.canchaId, motivo: b.motivo, recurrente: b.recurrente, diaSemana: b.diaSemana,
    fecha: b.fecha ? b.fecha.toISOString().slice(0, 10) : null,
    horaInicio: b.horaInicio, horaFin: b.horaFin, nota: b.nota,
    excepciones: b.excepciones.map((e) => e.fecha.toISOString().slice(0, 10)),
  }));
```

- [ ] **Step 5: Verificar que pasa + build**

Run: `npx vitest run tests/integration/liberar-bloqueo.test.ts && npx tsc --noEmit`
Expected: PASS (3/3), sin errores de tipos.

- [ ] **Step 6: Commit**

```bash
git add src/services/agenda.service.ts src/services/sheets/expandir.ts src/services/sheets/sheetsData.ts tests/integration/liberar-bloqueo.test.ts
git commit -m "feat(bloqueos): respetar excepcion en agenda y hoja espejo"
```

---

### Task 4: Frontend — tipos, acciones, calendario y diálogo "Liberar fecha"

**Files:**
- Modify: `src/lib/types.ts:34-38`
- Modify: `src/lib/bloqueos-actions.ts`
- Modify: `src/lib/calendario.ts:104-106`
- Create: `src/components/bloqueos/excepcion-bloqueo-dialog.tsx`
- Modify: `src/components/bloqueos/bloqueos-table.tsx`
- Test: `src/lib/calendario.test.ts` (si existe patrón de test de `materializar`; si no, agregar mínimo)

**Interfaces:**
- Consumes: rutas backend `POST/DELETE /bloqueos/:id/excepciones`.
- Produces: `agregarExcepcionBloqueo(id, fecha)`, `quitarExcepcionBloqueo(id, fecha)`, componente `ExcepcionBloqueoDialog`.

- [ ] **Step 1: Agregar `excepciones` al tipo `Bloqueo` (`src/lib/types.ts:34-38`)**

```typescript
export interface Bloqueo {
  id: string; canchaId: string; motivo: MotivoBloqueo; recurrente: boolean;
  diaSemana: number | null; fecha: string | null; horaInicio: string; horaFin: string; nota: string | null;
  cancha?: { nombre: string }; excepciones?: { id: string; fecha: string }[];
}
```

- [ ] **Step 2: Agregar las server actions (`src/lib/bloqueos-actions.ts`)**

Al final del archivo:

```typescript
export async function agregarExcepcionBloqueo(id: string, fecha: string): Promise<Result> {
  return run(() => apiFetch(`/bloqueos/${id}/excepciones`, { method: 'POST', body: JSON.stringify({ fecha }) }));
}

export async function quitarExcepcionBloqueo(id: string, fecha: string): Promise<Result> {
  return run(() => apiFetch(`/bloqueos/${id}/excepciones/${fecha}`, { method: 'DELETE' }));
}
```

- [ ] **Step 3: Saltar el bloqueo liberado en `materializar` (`src/lib/calendario.ts:104-106`)**

Después de la línea `if (!aplica) continue;` del loop de bloqueos, agregar:

```typescript
      if (b.excepciones?.some((e) => e.fecha.slice(0, 10) === dia)) continue;
```

- [ ] **Step 4: Verificar tests de lib (regresión)**

Run: `pnpm vitest run src/lib/calendario.test.ts`
Expected: sin regresiones (si no existe el archivo, saltar este step).

- [ ] **Step 5: Crear el diálogo `src/components/bloqueos/excepcion-bloqueo-dialog.tsx`**

Espejo del de fijos, adaptado al tipo `Bloqueo`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Bloqueo } from '@/lib/types';
import { agregarExcepcionBloqueo, quitarExcepcionBloqueo } from '@/lib/bloqueos-actions';

export function ExcepcionBloqueoDialog({
  open,
  onOpenChange,
  bloqueo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bloqueo: Bloqueo | null;
}) {
  const [fecha, setFecha] = useState('');
  const [excs, setExcs] = useState<{ id: string; fecha: string }[]>(bloqueo?.excepciones ?? []);
  const [pending, start] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) { setFecha(''); setExcs(bloqueo?.excepciones ?? []); }
    onOpenChange(nextOpen);
  }

  function liberar() {
    if (!bloqueo || !fecha) { toast.error('Ingresá una fecha'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { toast.error('Fecha inválida'); return; }
    start(async () => {
      const r = await agregarExcepcionBloqueo(bloqueo.id, fecha);
      if (r.ok) {
        toast.success('Fecha liberada');
        setExcs((p) => (p.some((e) => e.fecha.slice(0, 10) === fecha) ? p : [...p, { id: fecha, fecha }]));
        setFecha('');
      } else toast.error(r.error);
    });
  }

  function quitar(fechaExc: string) {
    if (!bloqueo) return;
    const fechaStr = fechaExc.slice(0, 10);
    start(async () => {
      const r = await quitarExcepcionBloqueo(bloqueo.id, fechaStr);
      if (r.ok) {
        toast.success('Excepción removida');
        setExcs((p) => p.filter((e) => e.fecha.slice(0, 10) !== fechaStr));
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Liberar fecha — {bloqueo?.cancha?.nombre ?? 'Bloqueo'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="exc-bloqueo-fecha">Fecha a liberar</Label>
            <Input id="exc-bloqueo-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <Button onClick={liberar} disabled={pending} variant="outline" className="w-full">
            {pending ? 'Guardando…' : 'Liberar esa fecha'}
          </Button>
          {excs.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-neutral-600">Fechas liberadas</p>
              <ul className="space-y-1">
                {excs.map((exc) => (
                  <li key={exc.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                    <span>{exc.fecha.slice(0, 10)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => quitar(exc.fecha)}
                      className="h-6 px-2 text-xs text-red-600 hover:text-red-700"
                    >
                      Quitar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Conectar el botón "Liberar fecha" en `src/components/bloqueos/bloqueos-table.tsx`**

Agregar import (junto a `BloqueoDialog`):

```tsx
import { ExcepcionBloqueoDialog } from './excepcion-bloqueo-dialog';
```

Agregar estado (después de `const [seleccion, setSeleccion] = useState<Bloqueo | null>(null);`):

```tsx
  const [excepcionOpen, setExcepcionOpen] = useState(false);
  const [bloqueoExc, setBloqueoExc] = useState<Bloqueo | null>(null);
  function abrirExcepcion(b: Bloqueo) { setSeleccion(null); setBloqueoExc(b); setExcepcionOpen(true); }
```

En el `SheetContent`, antes del botón "Eliminar", agregar el botón solo para recurrentes:

```tsx
            {seleccion.recurrente && (
              <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => abrirExcepcion(seleccion)}>Liberar fecha</Button>
            )}
```

Y montar el diálogo antes de `<BloqueoDialog ... />`:

```tsx
      <ExcepcionBloqueoDialog key={bloqueoExc?.id ?? 'none'} open={excepcionOpen} onOpenChange={setExcepcionOpen} bloqueo={bloqueoExc} />
```

- [ ] **Step 7: Build del frontend**

Run: `pnpm build`
Expected: build OK (ojo con server actions que rompen `next build`; estas acciones siguen el patrón existente de `bloqueos-actions.ts`, que ya compila).

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/bloqueos-actions.ts src/lib/calendario.ts src/components/bloqueos/excepcion-bloqueo-dialog.tsx src/components/bloqueos/bloqueos-table.tsx
git commit -m "feat(bloqueos): boton Liberar fecha en panel"
```

---

## Self-Review

- **Spec coverage:** modelo (T1), servicio+rutas+validador (T2), ocupación/disponibilidad (T2), agenda+hoja (T3), calendario+tipos+acciones+UI (T4). Todo el spec cubierto. Sin `cancelarReservaMaterializada` (correcto: bloqueos no se materializan).
- **Placeholder scan:** sin placeholders; todo el código está escrito.
- **Type consistency:** `agregarExcepcion(id, fecha)`/`quitarExcepcion(id, fecha)` backend; `agregarExcepcionBloqueo`/`quitarExcepcionBloqueo` frontend; `BloqueoInput.excepciones: string[]`; `Bloqueo.excepciones?: {id,fecha}[]`. El upsert usa `bloqueoId_fecha` (nombre del índice único compuesto que Prisma genera desde `@@unique([bloqueoId, fecha])`). Coherente entre tasks.

## Integración (post-tasks)
- Backend: merge `feat/liberar-bloqueo` → `main` local. **No push** hasta OK del usuario. Al deployar: correr `npx prisma migrate deploy` a mano en la VM.
- Frontend: merge `feat/liberar-bloqueo` → `master` local. **No push** hasta OK del usuario (deploy Vercel).

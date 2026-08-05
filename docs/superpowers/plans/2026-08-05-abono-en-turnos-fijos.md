# Abono en turnos fijos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un turno fijo pueda tener un abono — un período y un monto que el cliente paga una vez — y que sus turnos salgan $0, con aviso en recepción cuando el abono venció.

**Architecture:** Tres campos opcionales en `TurnoFijo` y uno en `Cobro`. El período **no controla nada**: el fijo genera turnos y ocupa la cancha igual que hoy, vencido o no. Lo único que hace es encender un aviso en la pantalla Hoy y en la lista de fijos.

**Tech Stack:** Express 5, Prisma 7, TypeScript ESM, PostgreSQL 16, vitest + Testcontainers (backend, gestor **npm**). Next.js 16, Tailwind v4, vitest (panel, gestor **pnpm**).

**Spec:** `docs/superpowers/specs/2026-08-05-abono-en-turnos-fijos-design.md`

## Global Constraints

- **Todo en español**: código, comentarios, copy, nombres. No traducir `cancha`, `seña`, `turno`, `fijo`, `abono`, `bloqueo`.
- **Los tres campos del abono son opcionales y van juntos**: o están los tres o ninguno. Un fijo sin ellos se comporta **exactamente como hoy**. Ninguna fila existente se migra.
- **El período NO es una compuerta.** Vencido el abono, el fijo sigue generando turnos en $0 y sigue ocupando la cancha. **No toques `ocupacion.service.rangosPlantilla` ni `frontend/src/lib/calendario.ts`.** Si te encontrás filtrando por fecha ahí, pará: estás implementando un diseño anterior que se descartó.
- **El aviso es el único control que existe.** Vencido el abono no se bloquea nada ni se genera deuda: si nadie mira el aviso, el cliente juega gratis. Por eso va con color de alerta y tamaño legible, **no como texto secundario gris**.
- **Ningún cálculo de plata en el browser.** El backend manda los montos.
- **Errores** con las factorías de `src/utils/errors.ts`, nunca `throw new Error`.
- **Socios está apagado** (`SOCIOS_HABILITADO = false`). No lo reactives ni lo uses: el abono es un mecanismo aparte que reusa el par `monto: 0` + `montoLista`, no la rama de socio.
- **ENTORNO:** la máquina del usuario se congeló dos veces por carga. **No levantes servidores de desarrollo ni navegadores.** Docker sí hace falta para los tests de integración del backend. `npm test` / `pnpm test` / `build` / `lint` una vez cada uno por tarea.
- **Baselines**: backend `444 pasan / 3 fallan` (`analytics` ×2, `disponibilidad-tamano` ×1, preexistentes y ajenos) más 21 omitidos por el flag de socios. Panel: `118 pasan / 2 fallan` (`validators`, ajenos), lint `4 problems (3 errors, 1 warning)`, sale con código 1 aun en baseline.

## Estructura de archivos

| Archivo | Qué cambia |
|---|---|
| `backend/prisma/schema.prisma` | 3 campos en `TurnoFijo`, 1 en `Cobro`, `precio` marcado obsoleto. **Una** migración. |
| `backend/src/validators/turnoFijo.schema.ts` | Campos del abono, los tres juntos, con `desde <= hasta`. |
| `backend/src/services/turnoFijo.service.ts` | `crear` guarda el abono y emite el `Cobro`; `materializar` cobra 0 si hay abono. |
| `backend/src/services/agenda.service.ts` | Expone `abonoHasta` en los ítems que vienen de un fijo. |
| `frontend/src/lib/types.ts` | Tipos del abono. |
| `frontend/src/components/fijos/turno-fijo-dialog.tsx` | Campos del abono en el alta. |
| `frontend/src/components/hoy/turno-card.tsx` | Aviso de abono vencido. |
| `frontend/src/components/fijos/turnos-fijos-table.tsx` | Marca los vencidos. |

---

### Task 1: Esquema, migración y validador

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/validators/turnoFijo.schema.ts`
- Test: `backend/tests/unit/turno-fijo-crear.test.ts`

**Interfaces:**
- Produces: `TurnoFijo` con `vigenciaDesde?`, `vigenciaHasta?`, `montoAbono?`; `Cobro` con `turnoFijoId?`. El body de `POST /turnos-fijos` acepta además `vigenciaDesde`, `vigenciaHasta`, `montoAbono` y `medioAbono`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/unit/turno-fijo-crear.test.ts` (leelo antes: reusá su patrón y su import de `crearTurnoFijoSchema`):

```ts
describe('abono en el alta de un turno fijo', () => {
  const base = { canchaId: 'c1', clienteNombre: 'Ana', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00' };
  const parse = (extra: Record<string, unknown>) =>
    crearTurnoFijoSchema.parse({ body: { ...base, ...extra }, query: {}, params: {} });

  it('sin abono sigue siendo válido (los fijos de hoy no se rompen)', () => {
    expect(() => parse({})).not.toThrow();
  });

  it('con los cuatro campos del abono es válido', () => {
    const r = parse({ vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    expect(r.body.montoAbono).toBe(120000);
  });

  it('el abono incompleto se rechaza', () => {
    expect(() => parse({ vigenciaDesde: '2026-08-01' })).toThrow();
    expect(() => parse({ montoAbono: 120000, medioAbono: 'EFECTIVO' })).toThrow();
    // Sin medio no se sabe cómo registrar el cobro.
    expect(() => parse({ vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000 })).toThrow();
  });

  it('rechaza un período invertido', () => {
    expect(() => parse({ vigenciaDesde: '2026-08-31', vigenciaHasta: '2026-08-01', montoAbono: 120000, medioAbono: 'EFECTIVO' })).toThrow();
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run tests/unit/turno-fijo-crear.test.ts
```

Esperado: FAIL — el schema todavía no conoce esos campos y los descarta o los rechaza.

- [ ] **Step 3: Ampliar el esquema de Prisma**

En `backend/prisma/schema.prisma`, dentro de `model TurnoFijo`:

```prisma
  /// OBSOLETO: no lo usa nadie para cobrar. `materializar` toma el precio de la cancha.
  /// Se conserva porque la lista del panel todavía lo muestra. Para el abono existe `montoAbono`.
  precio        Decimal?             @db.Decimal(10, 2)
  /// Abono: período pagado y su monto. Los tres van juntos o ninguno. Si están, los turnos
  /// de este fijo se materializan en $0. El período NO corta la generación: vencido, el fijo
  /// sigue generando turnos y solo se enciende un aviso en el panel.
  vigenciaDesde DateTime?            @db.Date
  vigenciaHasta DateTime?            @db.Date
  montoAbono    Decimal?             @db.Decimal(10, 2)
  cobros        Cobro[]
```

Y dentro de `model Cobro`, junto a `suscripcionId`:

```prisma
  turnoFijoId     String?
  turnoFijo       TurnoFijo?   @relation(fields: [turnoFijoId], references: [id], onDelete: Restrict)
```

Agregar también `@@index([turnoFijoId])` a `Cobro`, junto a los índices que ya tiene.

- [ ] **Step 4: Crear la migración**

```bash
npx prisma migrate dev --name abono_turno_fijo
npx prisma generate
```

Esperado: una sola migración. **Los cuatro campos son nullable**, así que no pide default ni toca filas existentes. Si Prisma pide un default o avisa de pérdida de datos, algo quedó mal declarado: pará y revisá.

- [ ] **Step 5: Ampliar el validador**

En `backend/src/validators/turnoFijo.schema.ts`, dentro del `body` de `crearTurnoFijoSchema`:

```ts
    vigenciaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    vigenciaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    montoAbono: z.coerce.number().positive().optional(),
    medioAbono: z.enum(['EFECTIVO', 'TRANSFERENCIA']).optional(),
```

Y sumar dos `.refine` **después** del que ya valida `horaInicio < horaFin`:

```ts
  .refine((b) => {
    // Los cuatro van juntos: sin período no hay qué cobrar, y sin medio no se sabe cómo registrarlo.
    const puestos = [b.vigenciaDesde, b.vigenciaHasta, b.montoAbono, b.medioAbono].filter((v) => v != null).length;
    return puestos === 0 || puestos === 4;
  }, { message: 'El abono necesita desde, hasta, monto y medio de pago', path: ['montoAbono'] })
  .refine((b) => !b.vigenciaDesde || !b.vigenciaHasta || b.vigenciaDesde <= b.vigenciaHasta,
    { message: 'El período del abono está invertido', path: ['vigenciaHasta'] })
```

- [ ] **Step 6: Correr y confirmar que pasa**

```bash
npx vitest run tests/unit/turno-fijo-crear.test.ts
npm run typecheck
```

Esperado: los 4 casos nuevos pasan y los que ya existían siguen pasando; typecheck limpio.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/src/validators backend/tests
git commit -m "feat(fijos): campos de abono en el esquema y el validador"
```

---

### Task 2: El alta cobra el abono y los turnos salen en $0

**Files:**
- Modify: `backend/src/services/turnoFijo.service.ts`
- Modify: `backend/src/routes/turnoFijo.routes.ts` (pasar los campos nuevos al servicio)
- Test: `backend/tests/integration/abono-fijo.test.ts` (nuevo)

**Interfaces:**
- Consumes: los campos de la Task 1; `cobroRepo.create({ turnoFijoId, reservaId, suscripcionId, monto, medio, origen, registradoPorId }, tx)`.
- Produces: `turnoFijoService.crear` acepta `vigenciaDesde`, `vigenciaHasta`, `montoAbono`, `medioAbono` y un `adminId`; `materializar` cobra 0 cuando el fijo tiene abono.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/integration/abono-fijo.test.ts`. Leé antes `tests/integration/materializar-fijo.test.ts` y reusá su forma de crear cancha, fijo y materializar.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

// 2026-08-05 es miércoles (diaSemana 3).
const MIERCOLES = '2026-08-05';

const crearCancha = () => getPrisma().cancha.create({ data: { nombre: 'Pádel 1', tipo: 'padel', precioHora: 30000 } });

function altaFijo(canchaId: string, abono?: { vigenciaDesde: string; vigenciaHasta: string; montoAbono: number; medioAbono: string }) {
  return supertest(app).post('/turnos-fijos').set('x-api-key', 'svc')
    .send({ canchaId, clienteNombre: 'Ana', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', ...abono });
}

describe('abono en turnos fijos', () => {
  it('el alta con abono registra el cobro en caja', async () => {
    const c = await crearCancha();
    const res = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    expect(res.status).toBe(201);

    const cobros = await getPrisma().cobro.findMany({ where: { turnoFijoId: res.body.id } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBe(120000);
    expect(cobros[0].origen).toBe('ABONO');
    expect(cobros[0].medio).toBe('EFECTIVO');
  });

  it('el alta sin abono no registra ningún cobro', async () => {
    const c = await crearCancha();
    const res = await altaFijo(c.id);
    expect(res.status).toBe(201);
    expect(await getPrisma().cobro.count({ where: { turnoFijoId: res.body.id } })).toBe(0);
  });

  it('un turno del fijo con abono se materializa en $0, con el precio real en montoLista', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const res = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    expect(res.status).toBe(201);
    expect(Number(res.body.monto)).toBe(0);
    expect(Number(res.body.montoLista)).toBe(30000);
  });

  it('con el abono VENCIDO el turno igual se materializa en $0 (el aviso es el único control)', async () => {
    const c = await crearCancha();
    // El período terminó en julio; el turno es de agosto.
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const res = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    expect(res.status).toBe(201);
    expect(Number(res.body.monto)).toBe(0);
  });

  it('REGRESIÓN: un fijo sin abono sigue cobrando el precio de la cancha', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id);
    const res = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    expect(res.status).toBe(201);
    expect(Number(res.body.monto)).toBe(30000);
  });
});
```

La ruta y el cuerpo están verificados: `POST /turnos-fijos/:id/materializar` con `{ fecha }`
(`src/routes/turnoFijo.routes.ts:34`). No hace falta que lo revises.

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run tests/integration/abono-fijo.test.ts
```

Esperado: FAIL. **Requiere Docker.**

- [ ] **Step 3: Que el alta guarde el abono y emita el cobro**

En `turnoFijo.service.crear`, ampliar el input y envolver en transacción para que el fijo y su cobro entren juntos:

```ts
  async crear(input: {
    canchaId: string; clienteNombre: string; whatsapp?: string; diaSemana: number; horaInicio: string; horaFin: string;
    vigenciaDesde?: string; vigenciaHasta?: string; montoAbono?: number; medioAbono?: 'EFECTIVO' | 'TRANSFERENCIA';
  }, adminId: string | null = null) {
    const choca = await ocupacionService.conflictoAlCrear(input.canchaId, { diaSemana: input.diaSemana }, fromHHMM(input.horaInicio), fromHHMM(input.horaFin));
    if (choca) throw Conflict('Ese horario ya está ocupado (otra reserva, fijo o bloqueo)');

    const { vigenciaDesde, vigenciaHasta, montoAbono, medioAbono, ...datosFijo } = input;
    const conAbono = montoAbono != null;

    const creado = await prisma.$transaction(async (tx) => {
      const fijo = await tx.turnoFijo.create({
        data: {
          ...datosFijo,
          vigenciaDesde: vigenciaDesde ? new Date(vigenciaDesde + 'T00:00:00.000Z') : null,
          vigenciaHasta: vigenciaHasta ? new Date(vigenciaHasta + 'T00:00:00.000Z') : null,
          montoAbono: montoAbono ?? null,
        },
      });
      // El abono se cobra una sola vez, al dar de alta. Sin esto la plata no aparece en caja:
      // los turnos salen 0 y el ingreso se perdería.
      if (conAbono) {
        await cobroRepo.create({
          turnoFijoId: fijo.id, reservaId: null, suscripcionId: null,
          monto: montoAbono, medio: medioAbono!, origen: 'ABONO', registradoPorId: adminId,
        }, tx);
      }
      return fijo;
    });

    if (input.whatsapp) {
      await prisma.cliente.upsert({
        where: { whatsapp: input.whatsapp },
        create: { whatsapp: input.whatsapp, nombre: input.clienteNombre, nombreConfirmado: true },
        update: {},
      });
    }
    sheetsSync.marcarSemanaSucia();
    return creado;
  },
```

Agregar el import de `cobroRepo`. **No hace falta tocar el repositorio**: `cobroRepo.create` recibe
un `Prisma.CobroUncheckedCreateInput`, así que acepta `turnoFijoId` automáticamente en cuanto el
esquema lo tenga (verificado en `src/repositories/cobro.repo.ts`).

En `turnoFijo.routes.ts`, pasar los campos nuevos y el `adminId` del principal. La ruta de alta ya
tiene el `req.principal`; usá el mismo criterio que la ruta de suscripciones para obtener el
`adminId` (es `null` cuando el llamador es un service key y no un admin).

- [ ] **Step 4: Que el turno se materialice en $0**

En `materializar`, después de calcular `precio` y antes de `resolverCondiciones`:

```ts
    // Con abono, el turno ya está pagado por el período: sale 0 y el precio real queda en
    // montoLista para que la caja pueda informar cuánto se bonificó. El período NO se compara
    // con la fecha: vencido, el turno igual sale 0 y el panel muestra el aviso de renovar.
    const conAbono = fijo.montoAbono != null;
```

Y al construir la reserva, reemplazar `monto` y `montoLista`:

```ts
        estado: cond.estado, esContacto: false,
        monto: conAbono ? 0 : cond.monto,
        montoLista: conAbono ? precio : cond.montoLista,
```

- [ ] **Step 5: Correr y confirmar que pasa**

```bash
npx vitest run tests/integration/abono-fijo.test.ts
npm run typecheck
npm test
```

Esperado: los 5 casos nuevos pasan; typecheck limpio; la suite **no sube de 3 fallos** (los preexistentes y ajenos).

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(fijos): el abono cobra al dar de alta y deja los turnos en cero"
```

---

### Task 3: El backend expone el dato del aviso

**Files:**
- Modify: `backend/src/services/agenda.service.ts`
- Modify: `backend/src/services/turnoFijo.service.ts` (el listado)

**Interfaces:**
- Produces: los ítems de `/agenda` que vienen de un fijo incluyen `abonoHasta: string | null` (formato `YYYY-MM-DD`); el listado de `/turnos-fijos` incluye `vigenciaDesde`, `vigenciaHasta` y `montoAbono`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/integration/abono-fijo.test.ts`:

```ts
describe('el backend expone el dato para el aviso', () => {
  it('el listado de fijos incluye el período y el monto del abono', async () => {
    const c = await crearCancha();
    await altaFijo(c.id, { vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    const res = await supertest(app).get('/turnos-fijos').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    const f = res.body[0];
    expect(f.vigenciaDesde).toBe('2026-08-01');
    expect(f.vigenciaHasta).toBe('2026-08-31');
    expect(Number(f.montoAbono)).toBe(120000);
  });

  it('la agenda informa hasta cuándo está paga la reserva de un fijo con abono', async () => {
    const c = await crearCancha();
    const fijo = await altaFijo(c.id, { vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-07-31', montoAbono: 120000, medioAbono: 'EFECTIVO' });
    await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('x-api-key', 'svc').send({ fecha: MIERCOLES });
    const res = await supertest(app).get(`/agenda?fecha=${MIERCOLES}`).set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    // El panel compara este dato con la fecha que está mirando para decidir si avisa.
    const item = res.body.reservas.find((r: any) => r.turnoFijoId === fijo.body.id);
    expect(item.abonoHasta).toBe('2026-07-31');
  });
});
```

La forma de la respuesta está verificada: `/agenda` devuelve `{ reservas, fijos, bloqueos }`
(`src/services/agenda.service.ts:55`). No hace falta que lo revises.

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run tests/integration/abono-fijo.test.ts
```

- [ ] **Step 3: Implementar**

En `turnoFijo.service` (el listado, cerca de la línea 99 donde ya se mapea `precio`), agregar los tres campos al objeto devuelto, convirtiendo las fechas a `YYYY-MM-DD`:

```ts
      vigenciaDesde: f.vigenciaDesde ? f.vigenciaDesde.toISOString().slice(0, 10) : null,
      vigenciaHasta: f.vigenciaHasta ? f.vigenciaHasta.toISOString().slice(0, 10) : null,
      montoAbono: f.montoAbono == null ? null : Number(f.montoAbono),
```

En `agenda.service`, incluir el fijo al traer las reservas (`include: { turnoFijo: { select: { vigenciaHasta: true } } }`) y mapear:

```ts
      // Hasta cuándo está pago el abono del fijo que originó esta reserva. El panel lo compara
      // con la fecha que muestra para decidir si avisa que hay que renovar.
      abonoHasta: r.turnoFijo?.vigenciaHasta ? r.turnoFijo.vigenciaHasta.toISOString().slice(0, 10) : null,
```

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npx vitest run tests/integration/abono-fijo.test.ts
npm run typecheck
npm test
```

Esperado: todo pasa; la suite no sube de 3 fallos.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(fijos): exponer el periodo del abono en la agenda y el listado"
```

---

### Task 4: El panel carga el abono y avisa cuando venció

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/components/fijos/turno-fijo-dialog.tsx`
- Modify: `frontend/src/components/fijos/turnos-fijos-table.tsx`
- Modify: `frontend/src/components/hoy/turno-card.tsx`
- Modify: `frontend/src/components/hoy/agenda-hoy.tsx` (pasar la fecha mostrada a la tarjeta)
- Modify: `frontend/src/lib/fijos-actions.ts` (reenviar los campos)

**Interfaces:**
- Consumes: `abonoHasta` en los ítems de la agenda; `vigenciaDesde` / `vigenciaHasta` / `montoAbono` en el listado de fijos (Task 3).

- [ ] **Step 1: Ampliar los tipos**

En `frontend/src/lib/types.ts`, sumar a `TurnoFijo`:

```ts
  vigenciaDesde?: string | null;
  vigenciaHasta?: string | null;
  montoAbono?: number | null;
```

Y a `Reserva` (o al tipo que use la agenda para sus reservas — **leelo antes**):

```ts
  /** Hasta cuándo está pago el abono del fijo que originó esta reserva. */
  abonoHasta?: string | null;
```

- [ ] **Step 2: Campos del abono en el alta**

En `turno-fijo-dialog.tsx`, agregar el estado y un bloque que solo aparece al activar el abono:

```tsx
  const [conAbono, setConAbono] = useState(false);
  const [vigenciaDesde, setVigenciaDesde] = useState('');
  const [vigenciaHasta, setVigenciaHasta] = useState('');
  const [montoAbono, setMontoAbono] = useState('');
  const [medioAbono, setMedioAbono] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');
```

El bloque de UI, con los cuatro campos y una aclaración de qué implica:

```tsx
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={conAbono} onChange={(e) => setConAbono(e.target.checked)} />
            Cobrar un abono por período
          </label>
          {conAbono && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                Los turnos de este fijo van a salir $0. El abono se registra como cobro al guardar.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="abono-desde">Desde</Label>
                  <input id="abono-desde" type="date" value={vigenciaDesde} onChange={(e) => setVigenciaDesde(e.target.value)} className="w-full rounded-md border px-2 py-1.5" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="abono-hasta">Hasta</Label>
                  <input id="abono-hasta" type="date" value={vigenciaHasta} onChange={(e) => setVigenciaHasta(e.target.value)} className="w-full rounded-md border px-2 py-1.5" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="abono-monto">Monto del abono</Label>
                  <Input id="abono-monto" type="number" min={1} value={montoAbono} onChange={(e) => setMontoAbono(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="abono-medio">Medio</Label>
                  <select id="abono-medio" value={medioAbono} onChange={(e) => setMedioAbono(e.target.value as 'EFECTIVO' | 'TRANSFERENCIA')} className="w-full rounded-md border px-2 py-1.5">
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="TRANSFERENCIA">Transferencia</option>
                  </select>
                </div>
              </div>
            </div>
          )}
```

Al enviar, incluir los cuatro campos **solo si `conAbono`**: mandarlos vacíos haría fallar el validador, que exige los cuatro o ninguno. Ampliar también el input de `crearFijo` en `fijos-actions.ts`.

- [ ] **Step 3: El aviso en la pantalla Hoy**

Es el único control que existe, así que va prominente. En `turno-card.tsx`, sumar la prop y el badge:

```tsx
export function TurnoCard({ reserva, canchas, fecha, onClick }: { reserva: Reserva; canchas: Cancha[]; fecha: string; onClick: () => void }) {
```

```tsx
  // Vencido = el abono terminó antes del día que se está mirando. Se compara contra la fecha
  // mostrada y no contra hoy, para que al revisar otro día el aviso siga siendo correcto.
  const abonoVencido = reserva.abonoHasta != null && reserva.abonoHasta < fecha;
```

Y dentro de la tarjeta, después del badge "Fijo":

```tsx
        {abonoVencido && (
          <span className="mt-1 ml-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">
            ABONO VENCIDO — RENOVAR
          </span>
        )}
```

En `agenda-hoy.tsx`, pasarle `fecha` a `<TurnoCard>` (el componente ya la recibe como prop).

- [ ] **Step 4: Marcar los vencidos en la lista de fijos**

En `turnos-fijos-table.tsx`, para cada fila con `vigenciaHasta` anterior a hoy, mostrar el mismo aviso. Usá `hoyAR()` de `@/lib/fecha`, que ya se usa en el panel para la fecha del negocio.

- [ ] **Step 5: Verificar**

```bash
pnpm test
pnpm build
pnpm lint
```

Esperado: tests en el baseline (`118 pasan / 2 fallan`, los de `validators`); build exitoso; lint en `4 problems (3 errors, 1 warning)`, ni uno más.

No levantes `pnpm dev`: el chequeo visual lo hace el humano.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(fijos): cargar el abono y avisar en recepcion cuando vencio"
```

---

## Cierre

Al terminar, un turno fijo puede tener un abono: se cobra al darlo de alta, sus turnos salen $0, y cuando el período vence el fijo **sigue funcionando igual** pero recepción ve un aviso rojo de renovar.

**Lo que deliberadamente NO hace**, y conviene tenerlo presente: vencido el abono no se bloquea nada ni se genera deuda. Si nadie mira el aviso, el cliente sigue jugando sin pagar. Es una decisión tomada a conciencia por el dueño del proyecto y está documentada en el spec.

**Renovar el abono queda fuera de alcance**: se carga un fijo nuevo con el período siguiente. Si en el uso real resulta molesto, es la primera mejora a agregar.

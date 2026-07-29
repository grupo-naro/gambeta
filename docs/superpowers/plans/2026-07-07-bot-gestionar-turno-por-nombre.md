# Bot — Cancelar un turno por nombre — Implementation Plan

> Dos tareas: **Task 1 backend** (endpoint, TDD, vía subagente SDD) y **Task 2 bot** (Prompt + Cerebro, aplicado directo por el controlador vía n8n MCP).

**Goal:** Que el bot pueda cancelar un turno identificándolo por nombre del titular + día (+ cancha/hora), no solo el del WhatsApp que escribe.

**Architecture:** Backend gana `GET /reservas/buscar` (accesible al bot). El Cerebro, en la rama `cancelar`, resuelve por nombre vía ese endpoint (con desambiguación existente). Frontend sin cambios.

## Global Constraints
- Backend: rama `feat/cancelar-por-nombre` desde `main`. Commit local, **NO push** salvo OK. Sin migración de DB.
- Bot: cambios en `I8yiX4g1rGh5Hb2U` (Prompt + Cerebro) vía `patchNodeField`. Backup por version history.
- Alcance: **cancelar** por nombre. Reprogramar/cambiar-cancha por nombre = fuera de alcance.
- `buscarPorNombre` en el bot va envuelto en try/catch → si el endpoint no existe aún (backend sin deployar), devuelve null (degradado, no rompe).

---

### Task 1 (BACKEND, subagente): endpoint `GET /reservas/buscar` (TDD)

**Files:**
- Modify: `src/validators/reserva.schema.ts`
- Modify: `src/services/reserva.service.ts`
- Modify: `src/routes/reserva.routes.ts`
- Test: `tests/integration/buscar-reserva.test.ts`

**Interfaces:**
- Produces: `GET /reservas/buscar?nombre=&fecha=&cancha?=&hora?=` (authAny) → `Array<{ id, cancha:{nombre}, fecha, horaInicio, estado, clienteNombre }>`.
- `reservaService.buscar({ nombre, fecha, cancha?, hora? })`.

- [ ] **Step 1: Rama**

`git checkout main && git checkout -b feat/cancelar-por-nombre`

- [ ] **Step 2: Test de integración (falla)**

Crear `tests/integration/buscar-reserva.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 2', tipo: 'futbol', precioHora: 12000, jugadores: 5 } })).id;
});

// 2026-07-08 (día fijo, futuro respecto a la data). Reserva 20:00 ART = 23:00Z.
async function reserva(nombre: string, iniUtc: string, estado: any = 'CONFIRMADA') {
  const cli = await getPrisma().cliente.create({ data: { whatsapp: '54911' + Math.floor(Math.random()*1e8), nombre } });
  const ini = new Date(iniUtc); const fin = new Date(ini.getTime() + 3600000);
  return getPrisma().reserva.create({ data: { canchaId, clienteId: cli.id, fechaInicio: ini, fechaFin: fin, estado, esContacto: false, monto: 12000 } });
}
const buscar = (q: string) => supertest(app).get('/reservas/buscar?' + q).set('x-api-key', 'svc');

describe('GET /reservas/buscar', () => {
  it('encuentra por nombre (parcial, sin acentos) + fecha', async () => {
    const r = await reserva('Julián Pérez', '2026-07-08T23:00:00.000Z');
    const res = await buscar('nombre=julian&fecha=2026-07-08');
    expect(res.status).toBe(200);
    expect(res.body.map((x: any) => x.id)).toContain(r.id);
    expect(res.body[0].clienteNombre).toBe('Julián Pérez');
    expect(res.body[0].horaInicio).toBe('20:00');
  });
  it('no devuelve canceladas ni de otro día', async () => {
    await reserva('Julián', '2026-07-08T23:00:00.000Z', 'CANCELADA');
    await reserva('Julián', '2026-07-09T23:00:00.000Z');
    const res = await buscar('nombre=julian&fecha=2026-07-08');
    expect(res.body.length).toBe(0);
  });
  it('filtra por cancha (número) y hora', async () => {
    await reserva('Julián', '2026-07-08T23:00:00.000Z');
    expect((await buscar('nombre=julian&fecha=2026-07-08&cancha=2')).body.length).toBe(1);
    expect((await buscar('nombre=julian&fecha=2026-07-08&cancha=5')).body.length).toBe(0);
    expect((await buscar('nombre=julian&fecha=2026-07-08&hora=20:00')).body.length).toBe(1);
    expect((await buscar('nombre=julian&fecha=2026-07-08&hora=21:00')).body.length).toBe(0);
  });
});
```

- [ ] **Step 3: Verificar que falla**

Run: `npx vitest run tests/integration/buscar-reserva.test.ts`
Expected: FAIL (ruta 404).

- [ ] **Step 4: Validador** (`src/validators/reserva.schema.ts`, al final, junto a los otros; `empty` ya existe en el archivo)

```typescript
export const buscarReservaSchema = z.object({
  body: z.unknown(),
  query: z.object({
    nombre: z.string().min(1),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cancha: z.string().optional(),
    hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  }),
  params: empty,
});
```

- [ ] **Step 5: Servicio** (`src/services/reserva.service.ts`, agregar método en el objeto `reservaService`, cerca de `misReservas`)

```typescript
  async buscar(input: { nombre: string; fecha: string; cancha?: string; hora?: string }) {
    const tz = getEnv().TZ_NEGOCIO;
    const { start, end } = dayWindowUtc(input.fecha, tz);
    const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const nq = norm(input.nombre);
    const cq = input.cancha ? norm(input.cancha) : null;
    const cnum = input.cancha ? ((input.cancha.match(/\d+/) || [])[0] || null) : null;
    const hhmm = (d: Date) => d.toLocaleTimeString('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const reservas = await prisma.reserva.findMany({
      where: { fechaInicio: { gte: start, lt: end }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] } },
      include: { cliente: true, cancha: true },
      orderBy: { fechaInicio: 'asc' },
    });
    return reservas
      .filter((r) => nq && norm(r.cliente.nombre).includes(nq))
      .filter((r) => {
        if (!cq) return true;
        const cn = norm(r.cancha.nombre);
        return cn.includes(cq) || cq.includes(cn) || (!!cnum && ((cn.match(/\d+/) || [])[0] === cnum));
      })
      .filter((r) => !input.hora || hhmm(r.fechaInicio) === input.hora)
      .map((r) => ({
        id: r.id,
        cancha: { nombre: r.cancha.nombre },
        fecha: r.fechaInicio.toLocaleDateString('en-CA', { timeZone: tz }),
        horaInicio: hhmm(r.fechaInicio),
        estado: r.estado,
        clienteNombre: r.cliente.nombre,
      }));
  },
```

- [ ] **Step 6: Ruta** (`src/routes/reserva.routes.ts`) — registrar ANTES de `/:id` (junto a `/mias`), e importar el schema.

Import: agregar `buscarReservaSchema` al import de `../validators/reserva.schema.js`.
Ruta (después de la de `/mias`):
```typescript
reservaRoutes.get('/buscar', authAny, validate(buscarReservaSchema), async (req, res, next) => {
  try {
    res.json(await reservaService.buscar((req as any).valid.query));
  } catch (e) { next(e); }
});
```

- [ ] **Step 7: Verificar que pasa + regresión + tsc**

Run: `npx vitest run tests/integration/buscar-reserva.test.ts` → PASS (3/3).
Run: `npx vitest run tests/integration/ --reporter=dot` → sin regresiones nuevas (4 preexistentes conocidas: sena x3, disponibilidad-tamano x1).
Run: `npx tsc --noEmit` → limpio.

- [ ] **Step 8: Commit** (NO push)

```bash
git add src/validators/reserva.schema.ts src/services/reserva.service.ts src/routes/reserva.routes.ts tests/integration/buscar-reserva.test.ts
git commit -m "feat(reservas): endpoint GET /reservas/buscar (por nombre + fecha)"
```

---

### Task 2 (BOT, directo por el controlador): Prompt + Cerebro

Aplicar con `n8n_update_partial_workflow` sobre `I8yiX4g1rGh5Hb2U` tras terminar Task 1.

- [ ] **Step 1: Patch Prompt — extraer `nombre`** (2 patches)

Patch A — responseSchema:
- find: `recurrente:{type:'boolean',nullable:true}},required:['intent']`
- replace: `recurrente:{type:'boolean',nullable:true},nombre:{type:'string',nullable:true}},required:['intent']`

Patch B — instrucción:
- find: `Para liberar_fijo extrae la fecha (hoy o el dia que mencione).`
- replace: `Para liberar_fijo extrae la fecha (hoy o el dia que mencione). Si el cliente menciona el nombre del titular de un turno (ej: a nombre de Julian, el turno de mi cuñado Julian, la de Julian), extrae ese nombre en el campo nombre.`

- [ ] **Step 2: Patch Cerebro — helper `buscarPorNombre`** (insertar antes de `let intent=gem.intent;`)

- find: `  let intent=gem.intent; let nombreProvisto=null;`
- replace:
```
  const buscarPorNombre=async(nombre,f,ca,ho)=>{ try{ const qs='nombre='+encodeURIComponent(nombre)+'&fecha='+encodeURIComponent(f)+(ca?('&cancha='+encodeURIComponent(ca)):'')+(ho?('&hora='+encodeURIComponent(ho)):''); const rs=await H.httpRequest({method:'GET',url:BACKEND+'/reservas/buscar?'+qs,headers:{'x-api-key':SVC},json:true}); if(!Array.isArray(rs)||!rs.length) return null; const lista=rs.map(r=>({id:r.id,fecha:r.fecha,hora:r.horaInicio,label:'la '+nomb((r.cancha&&r.cancha.nombre)||'cancha')+' el '+fechaLinda(r.fecha)+' a las '+r.horaInicio+' ('+(r.clienteNombre||nombre)+')'})); const r0=lista[0]; return {id:r0.id,label:r0.label,fecha:r0.fecha,hora:r0.hora,n:lista.length,lista}; }catch(e){ return null; } };
  let intent=gem.intent; let nombreProvisto=null;
```

- [ ] **Step 3: Patch Cerebro — forzar cancelar en el follow-up de fecha** (después del bloque `esperaReprog`)

- find: `if(ctx.esperaReprog && !gem.jugadores && intent!=='cancelar' && intent!=='humano' && intent!=='liberar_fijo' && intent!=='mis_reservas' && (gem.fecha||gem.hora)){ intent='reprogramar'; } else { delete ctx.esperaReprog; }`
- replace: (lo mismo) + ` if(ctx.buscarNombre && gem.fecha && intent!=='confirmar'){ intent='cancelar'; }`

(pega esa línea nueva justo después del `else { delete ctx.esperaReprog; }`)

- [ ] **Step 4: Patch Cerebro — rama `cancelar` por nombre** (2 patches)

Patch A — resolución:
- find: `else if(intent==='cancelar'){ const t=await resolverTurno();`
- replace: `else if(intent==='cancelar'){ const nb=gem.nombre||ctx.buscarNombre; const t=nb?(fecha?await buscarPorNombre(nb,fecha,cancha,hora):null):await resolverTurno();`

Patch B — mensaje "no encuentro" + pedir fecha:
- find: `if(!t){ reply='No encuentro un turno proximo tuyo para cancelar. Si reservaste hace rato, escribinos y un encargado te ayuda.'; }`
- replace: `if(nb&&!fecha){ reply='Para que dia es el turno de '+nb+'?'; store=Object.assign({},ctx,{buscarNombre:nb}); } else if(!t){ reply=nb?('No encuentro un turno a nombre de '+nb+' para esa fecha. Fijate que el nombre, la cancha y el dia esten bien.'):'No encuentro un turno proximo tuyo para cancelar. Si reservaste hace rato, escribinos y un encargado te ayuda.'; }`

- [ ] **Step 5: Validar + sintaxis**

`n8n_validate_workflow` → `valid: true`. `n8n_get_workflow` filtered `["Cerebro","Prompt"]` → AsyncFunction parse sin excepción; confirmar que aparece `buscarPorNombre`, el `nombre` en el schema, y la rama cancelar con `nb`.

- [ ] **Step 6: Confirmar activo** (`active: true`).

---

### Task 3 (DIFERIDA — con Evolution + backend deployado): smoke test
- [ ] "cancelá la de Julián, cancha 2, mañana" → encuentra y cancela (o pide desambiguar si hay varios).
- [ ] "cancelá la de Julián" (sin fecha) → "¿para qué día?"; responder la fecha → resuelve.
- [ ] Cancelar el propio turno (sin nombre) → sigue funcionando por WhatsApp.

## Self-Review
- **Cobertura del spec:** endpoint buscar (T1), extracción de nombre (T2 S1), buscarPorNombre + rama cancelar por nombre + follow-up de fecha (T2 S2-4). Cubierto. Reprogramar por nombre fuera de alcance (no se toca).
- **Placeholders:** ninguno.
- **Consistencia:** `buscarPorNombre` devuelve la misma forma `{id,label,fecha,hora,n,lista}` que `resolverTurno` → la desambiguación `pendiente:'cancelar'` y el `PATCH cancelar` de la rama funcionan sin cambios. `ctx.buscarNombre` se setea al pedir fecha y se fuerza `intent=cancelar` en el follow-up.
- **Degradación:** `buscarPorNombre` en try/catch → si el backend no está deployado, null → "no encuentro". Aceptado.
- **Riesgo:** abuso (cancelar ajeno) aceptado; falsos positivos de nombre → desambiguación n>1.

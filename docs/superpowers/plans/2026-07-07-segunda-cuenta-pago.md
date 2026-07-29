# Segunda cuenta de pago (alias/CBU secundario) — Implementation Plan

> Tres tareas en tres sistemas: **Task 1 backend** y **Task 2 frontend** (vía subagente SDD), **Task 3 bot** (directo por el controlador vía n8n MCP).

**Goal:** Registrar una segunda cuenta (alias/CBU/titular) y que el bot apruebe comprobantes pagados a la principal **o** a la secundaria.

**Tech Stack:** Backend Node/Express+TS+Prisma+Zod (Vitest/Testcontainers). Frontend Next 16 + Tailwind + pnpm. Bot n8n Code node.

## Global Constraints
- Backend: rama `feat/segunda-cuenta-pago` desde `main`, commit local, **NO push** salvo OK. Migración manual en la VM al deployar.
- Frontend: cambios en `master` local, **NO push** salvo OK.
- Bot: `I8yiX4g1rGh5Hb2U` vía patchNodeField (backup por version history). Depende de que el backend con `alias2/cbu2` esté deployado para leer la secundaria de `/config`.
- Se agrega UNA cuenta secundaria (no lista). Campos vacíos = no se usa.

---

### Task 1 (BACKEND, subagente): `alias2/cbu2/titular2` en config + migración (TDD)

**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_config_cuenta2/migration.sql`, `src/validators/config.schema.ts`, `tests/integration/config-cuenta2.test.ts`

- [ ] **Step 1: Rama** — `git checkout main && git checkout -b feat/segunda-cuenta-pago`

- [ ] **Step 2: Test de integración (falla)** — `tests/integration/config-cuenta2.test.ts`
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('config: cuenta de pago secundaria', () => {
  it('PATCH guarda alias2/cbu2/titular2 y GET los devuelve', async () => {
    const patch = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ alias2: 'complejo.alias2', cbu2: '0000003100010000000002', titular2: 'Otro Titular' });
    expect(patch.status).toBeLessThan(400);
    const get = await supertest(app).get('/config').set('authorization', `Bearer ${token}`);
    expect(get.body.alias2).toBe('complejo.alias2');
    expect(get.body.cbu2).toBe('0000003100010000000002');
    expect(get.body.titular2).toBe('Otro Titular');
  });
});
```
Run: `npx vitest run tests/integration/config-cuenta2.test.ts` → FAIL (campos no persisten / no existen).

- [ ] **Step 3: Modelo** — en `prisma/schema.prisma`, `model Configuracion`, después de `titular String @default("")`:
```prisma
  cbu2           String   @default("")
  alias2         String   @default("")
  titular2       String   @default("")
```

- [ ] **Step 4: Migración** — `npx prisma migrate dev --name config_cuenta2` (agrega 3 columnas). Verificar el `migration.sql` (3 `ADD COLUMN ... DEFAULT ''`).

- [ ] **Step 5: Validador** — en `src/validators/config.schema.ts`, dentro del `body`, junto a `cbu/alias/titular`, agregar:
```typescript
    cbu2: z.string().optional(),
    alias2: z.string().optional(),
    titular2: z.string().optional(),
```
(`configService.update` ya reenvía el patch a `configRepo.update`, así que no hace falta tocar el service.)

- [ ] **Step 6: Verificar** — `npx prisma generate && npx tsc --noEmit`; `npx vitest run tests/integration/config-cuenta2.test.ts` → PASS; `npx vitest run tests/integration/ --reporter=dot` → sin regresiones nuevas (4 preexistentes conocidas).

- [ ] **Step 7: Commit** (NO push)
```bash
git add prisma/schema.prisma prisma/migrations src/validators/config.schema.ts tests/integration/config-cuenta2.test.ts
git commit -m "feat(config): cuenta de pago secundaria (alias2/cbu2/titular2)"
```

---

### Task 2 (FRONTEND, subagente): campos de cuenta secundaria en Configuración

**Files:** `src/lib/types.ts`, `src/lib/validators.ts`, `src/components/config/config-form.tsx`

- [ ] **Step 1: `Config` type** (`src/lib/types.ts`) — junto a `cbu: string; alias: string; titular: string;` agregar:
```typescript
  alias2?: string; cbu2?: string; titular2?: string;
```

- [ ] **Step 2: `configSchema`** (`src/lib/validators.ts`) — junto a `cbu/alias/titular`, agregar:
```typescript
  alias2: z.string(),
  cbu2: z.string(),
  titular2: z.string(),
```

- [ ] **Step 3: `config-form.tsx`** — en el estado inicial `f`, junto a `cbu/alias/titular`, agregar (con default vacío por si el backend aún no los devuelve):
```typescript
    alias2: config.alias2 ?? '', cbu2: config.cbu2 ?? '', titular2: config.titular2 ?? '',
```
Y en la Card "Pagos / Seña", **después** del `<div>` del Titular, agregar el bloque de cuenta secundaria:
```tsx
          <div className="pt-2 border-t">
            <p className="mb-2 text-sm font-medium text-neutral-700">Cuenta secundaria (opcional)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label htmlFor="alias2">Alias</Label><Input id="alias2" value={f.alias2} onChange={(e) => set('alias2', e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="cbu2">CBU</Label><Input id="cbu2" value={f.cbu2} onChange={(e) => set('cbu2', e.target.value)} /></div>
            </div>
            <div className="mt-4 space-y-1"><Label htmlFor="tit2">Titular</Label><Input id="tit2" value={f.titular2} onChange={(e) => set('titular2', e.target.value)} /></div>
          </div>
```
(`guardarConfig` ya envía `parsed.data` completo por PATCH `/config`; no hace falta tocar `config-actions`.)

- [ ] **Step 4: Verificar** — `pnpm build` OK (compila + typecheck). Si existe test de `validators.test.ts` que arma un config completo, agregar `alias2:'',cbu2:'',titular2:''` a esos objetos para que sigan pasando.

- [ ] **Step 5: Commit** (NO push)
```bash
git add src/lib/types.ts src/lib/validators.ts src/components/config/config-form.tsx
git commit -m "feat(config): campos de cuenta de pago secundaria"
```

---

### Task 3 (BOT, directo): verificar comprobante contra ambas cuentas

Aplicar con `n8n_update_partial_workflow` (patchNodeField sobre `Cerebro`).

- [ ] **Step 1: Patch de la verificación** (rama del comprobante)
- find:
```
const aliasM=!!(ic.alias&&v.alias_destino&&(''+v.alias_destino).toLowerCase().split(' ').join('').includes((''+ic.alias).toLowerCase().split(' ').join('')));
    const cbuM=!!(ic.cbu&&v.cbu_destino&&dig(ic.cbu).length>=6&&dig(v.cbu_destino).includes(dig(ic.cbu).slice(-8)));
```
- replace:
```
let _cfg={}; try{ _cfg=await H.httpRequest({method:'GET',url:BACKEND+'/config',headers:{'x-api-key':SVC},json:true})||{}; }catch(e){}
    const normA=(s)=>(''+(s||'')).toLowerCase().split(' ').join('');
    const aliasesOk=[ic.alias,_cfg.alias,_cfg.alias2].map(normA).filter(x=>x.length>=3);
    const cbusOk=[ic.cbu,_cfg.cbu,_cfg.cbu2].map(x=>dig(x)).filter(x=>x.length>=6);
    const aliasM=!!(v.alias_destino && aliasesOk.some(a=>normA(v.alias_destino).includes(a)));
    const cbuM=!!(v.cbu_destino && cbusOk.some(c=>dig(v.cbu_destino).includes(c.slice(-8))));
```

- [ ] **Step 2: Validar + sintaxis** — `n8n_validate_workflow` → `valid:true`; traer Cerebro por API y AsyncFunction-check (sin excepción); confirmar que aparece `aliasesOk` y el GET `/config`. `active:true`.

---

### Task 4 (DIFERIDA — con Evolution + backend deployado): smoke test
- [ ] Cargar en Configuración una cuenta secundaria. Comprobante pagado a la **secundaria** → aprobado. A la **principal** → aprobado. A una cuenta **ajena** → "a revisar".

## Self-Review
- **Cobertura del spec:** modelo+migración+schema (T1), form+tipos+validador (T2), verificación contra ambas cuentas (T3). Cubierto.
- **Placeholders:** ninguno.
- **Consistencia:** `alias2/cbu2/titular2` en modelo, validador backend, type+schema+form frontend, y leídos por el bot desde `/config`. `configService.update`/`guardarConfig` reenvían el patch sin cambios.
- **Compat de deploy:** el frontend manda `alias2/cbu2/titular2`; si el backend viejo aún no los tiene en el schema, Zod los descarta (no rompe). El bot con config sin secundaria → set solo con la principal → comportamiento actual.
- **Riesgo:** match por `includes`/últimos-8 igual que hoy; `okMonto`+fecha acotan.

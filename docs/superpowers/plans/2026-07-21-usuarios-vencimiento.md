# Usuarios con vencimiento (demo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder crear usuarios del panel con una fecha de vencimiento (presets 1/2/7/30 días); al vencer no pueden entrar ni seguir una sesión, quedan bloqueados pero se pueden reactivar extendiendo la fecha.

**Architecture:** Se agrega `expiraEn DateTime?` a `AdminUser`. La creación recibe un preset `duracionDias` y calcula la fecha. El login rechaza a los vencidos (403 `USUARIO_VENCIDO`) y firma el token JWT con vencimiento acotado a `expiraEn`, así el token expira solo al llegar la fecha (validado por `jwt.verify` en cada request, sin consulta a la base). Un endpoint `PATCH /usuarios/:id/expiracion` extiende o quita el vencimiento.

**Tech Stack:** Node 22, Express, Prisma 7 + Postgres, Zod, vitest + supertest + testcontainers (backend); Next.js 16 + React 19, server actions, Zod (frontend).

## Global Constraints

- Presets de duración válidos: **1, 2, 7, 30** días. "Sin vencimiento" = `expiraEn = null`.
- El admin por defecto (`esDefault`) y los usuarios con `expiraEn = null` nunca vencen.
- Enforcement enfoque A: token acotado a `expiraEn` + rechazo en login. No hay chequeo contra la base por request.
- Formato de error del backend: `{ error: { code, message, details } }`. Vencido = status **403**, code **`USUARIO_VENCIDO`**.
- Las rutas de `/usuarios` ya exigen rol `ADMIN` (`usuarioRoutes.use(authJwt, requireRole('ADMIN'))`).
- Los tests de integración levantan Postgres con testcontainers y aplican `prisma migrate deploy`; la migración nueva debe existir en `backend/prisma/migrations/`.
- No tocar la carpeta `ortigoza/`.

---

## Task 1: Backend — campo `expiraEn`, repo, y creación con `duracionDias`

**Files:**
- Modify: `backend/prisma/schema.prisma` (modelo `AdminUser`)
- Create: `backend/prisma/migrations/<timestamp>_usuario_expiraen/migration.sql` (vía `prisma migrate dev`)
- Modify: `backend/src/repositories/adminUser.repo.ts`
- Modify: `backend/src/validators/usuario.schema.ts`
- Modify: `backend/src/services/usuario.service.ts`
- Test: `backend/tests/integration/usuarios.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces:
  - `adminUserRepo.create(data: { email: string; nombre: string; passwordHash: string; rol: 'ADMIN'|'RECEPCIONISTA'; expiraEn?: Date | null })` → incluye `expiraEn` en el `select`.
  - `adminUserRepo.list()` → cada fila incluye `expiraEn: Date | null`.
  - `usuarioService.crear(input: { email; nombre; password; rol; duracionDias?: 1|2|7|30 })`.

- [ ] **Step 1: Agregar el campo al schema**

En `backend/prisma/schema.prisma`, dentro de `model AdminUser`, agregar la línea `expiraEn` (después de `creadoEn`):
```prisma
  creadoEn     DateTime   @default(now())
  expiraEn     DateTime?
```

- [ ] **Step 2: Generar la migración**

Levantá un Postgres descartable y creá la migración (genera el archivo en `prisma/migrations/`):
```bash
docker run -d --name venc-pg -e POSTGRES_USER=canchitas -e POSTGRES_PASSWORD=canchitas -e POSTGRES_DB=canchitas -p 5601:5432 postgres:16-alpine
cd backend && DATABASE_URL=postgresql://canchitas:canchitas@localhost:5601/canchitas?schema=public npx prisma migrate dev --name usuario_expiraen
```
Expected: crea `prisma/migrations/<ts>_usuario_expiraen/migration.sql` con `ALTER TABLE "AdminUser" ADD COLUMN "expiraEn" TIMESTAMP(3);` y regenera el client. Dejá el contenedor `venc-pg` levantado para los próximos steps (se baja al final de la Task 2).

- [ ] **Step 3: Actualizar el repo**

Reemplazar el contenido de `backend/src/repositories/adminUser.repo.ts` por:
```ts
import { prisma } from '../db/prisma.js';

const publicSelect = { id: true, email: true, nombre: true, rol: true, esDefault: true, expiraEn: true } as const;

export const adminUserRepo = {
  findByEmail: (email: string) => prisma.adminUser.findUnique({ where: { email } }),
  findById: (id: string) => prisma.adminUser.findUnique({ where: { id } }),
  list: () => prisma.adminUser.findMany({ orderBy: { creadoEn: 'asc' }, select: publicSelect }),
  create: (data: { email: string; nombre: string; passwordHash: string; rol: 'ADMIN' | 'RECEPCIONISTA'; expiraEn?: Date | null }) =>
    prisma.adminUser.create({ data, select: publicSelect }),
  updateRol: (id: string, rol: 'ADMIN' | 'RECEPCIONISTA') =>
    prisma.adminUser.update({ where: { id }, data: { rol }, select: publicSelect }),
  updateExpiracion: (id: string, expiraEn: Date | null) =>
    prisma.adminUser.update({ where: { id }, data: { expiraEn }, select: publicSelect }),
  remove: (id: string) => prisma.adminUser.delete({ where: { id } }),
};
```

- [ ] **Step 4: Aceptar `duracionDias` en el schema de validación**

En `backend/src/validators/usuario.schema.ts`, agregar el preset y sumarlo al body de `crearUsuarioSchema`:
```ts
import { z } from 'zod';
const empty = z.looseObject({});
const rol = z.enum(['ADMIN', 'RECEPCIONISTA']);
const duracionDias = z.union([z.literal(1), z.literal(2), z.literal(7), z.literal(30)]);

export const crearUsuarioSchema = z.object({
  body: z.object({ email: z.string().email(), nombre: z.string().min(1), password: z.string().min(6), rol, duracionDias: duracionDias.optional() }),
  query: empty, params: empty,
});
export const cambiarRolSchema = z.object({
  body: z.object({ rol }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const idUsuarioParamSchema = z.object({
  body: z.unknown(), query: empty, params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 5: Calcular `expiraEn` en el service**

En `backend/src/services/usuario.service.ts`, reemplazar el método `crear` por:
```ts
  crear: async (input: { email: string; nombre: string; password: string; rol: 'ADMIN' | 'RECEPCIONISTA'; duracionDias?: 1 | 2 | 7 | 30 }) => {
    if (await adminUserRepo.findByEmail(input.email)) throw Conflict('Ya existe un usuario con ese email');
    const expiraEn = input.duracionDias ? new Date(Date.now() + input.duracionDias * 86_400_000) : null;
    try {
      return await adminUserRepo.create({ email: input.email, nombre: input.nombre, passwordHash: await hashPassword(input.password), rol: input.rol, expiraEn });
    } catch (e: any) {
      if (e?.code === 'P2002') throw Conflict('Ya existe un usuario con ese email');
      throw e;
    }
  },
```

- [ ] **Step 6: Escribir el test (falla primero)**

En `backend/tests/integration/usuarios.test.ts`, agregar dentro del `describe('/usuarios (ADMIN)', ...)`:
```ts
  it('crea con duracionDias y expone expiraEn en create y list', async () => {
    const admin = await seedDefaultAdmin();
    const c = await supertest(app).post('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`)
      .send({ email: 'temp@x.com', nombre: 'Temp', password: 'secreto', rol: 'RECEPCIONISTA', duracionDias: 2 });
    expect(c.status).toBe(201);
    expect(c.body.expiraEn).toBeTruthy();
    const dias = (new Date(c.body.expiraEn).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(1.9);
    expect(dias).toBeLessThan(2.1);

    const sinVenc = await supertest(app).post('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`)
      .send({ email: 'perma@x.com', nombre: 'Perma', password: 'secreto', rol: 'RECEPCIONISTA' });
    expect(sinVenc.status).toBe(201);
    expect(sinVenc.body.expiraEn).toBeNull();

    const list = await supertest(app).get('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`);
    expect(list.body.some((u: any) => u.email === 'temp@x.com' && u.expiraEn)).toBe(true);
  });
```

- [ ] **Step 7: Correr el test**

```bash
cd backend && npm test -- usuarios
```
Expected: el nuevo test pasa junto con los existentes de `usuarios.test.ts` (testcontainers aplica la migración nueva automáticamente).

- [ ] **Step 8: Commit**

```bash
git add backend/prisma backend/src/repositories/adminUser.repo.ts backend/src/validators/usuario.schema.ts backend/src/services/usuario.service.ts backend/tests/integration/usuarios.test.ts
git commit -m "feat(usuarios): campo expiraEn y creacion con duracionDias"
```

---

## Task 2: Backend — login corta usuarios vencidos y acota el token

**Files:**
- Modify: `backend/src/utils/errors.ts`
- Modify: `backend/src/services/auth.service.ts`
- Test: `backend/tests/integration/usuarios.test.ts`

**Interfaces:**
- Consumes: `adminUserRepo.findByEmail` (devuelve la fila completa, incluye `expiraEn`).
- Produces:
  - `UsuarioVencido(message?)` → `AppError` status 403, code `USUARIO_VENCIDO`.
  - `signAdminToken(claims, expiresInSeconds?: number)` — si se pasa `expiresInSeconds`, el token expira en esos segundos; si no, usa `JWT_EXPIRES_IN`.
  - `login()` lanza `UsuarioVencido` si el usuario está vencido; si no, firma el token acotado a `expiraEn`.

- [ ] **Step 1: Agregar el error `UsuarioVencido`**

En `backend/src/utils/errors.ts`, después de la línea de `Forbidden`, agregar:
```ts
export const UsuarioVencido = (message = 'Usuario vencido') => new AppError(403, 'USUARIO_VENCIDO', message);
```

- [ ] **Step 2: Escribir el test (falla primero)**

En `backend/tests/integration/usuarios.test.ts`, agregar un nuevo `describe` al final del archivo:
```ts
describe('login con vencimiento', () => {
  it('rechaza al usuario vencido con 403 USUARIO_VENCIDO', async () => {
    const { hashPassword } = await import('../../src/utils/password.js');
    await getPrisma().adminUser.create({ data: { email: 'venc@x.com', nombre: 'V', passwordHash: await hashPassword('secreto'), rol: 'RECEPCIONISTA', expiraEn: new Date(Date.now() - 1000) } });
    const r = await supertest(app).post('/auth/login').send({ email: 'venc@x.com', password: 'secreto' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('USUARIO_VENCIDO');
  });

  it('deja entrar al no vencido y acota el token a expiraEn', async () => {
    const { hashPassword } = await import('../../src/utils/password.js');
    const expiraEn = new Date(Date.now() + 2 * 86_400_000);
    await getPrisma().adminUser.create({ data: { email: 'ok@x.com', nombre: 'O', passwordHash: await hashPassword('secreto'), rol: 'RECEPCIONISTA', expiraEn } });
    const r = await supertest(app).post('/auth/login').send({ email: 'ok@x.com', password: 'secreto' });
    expect(r.status).toBe(200);
    const payload = JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64').toString());
    // exp (segundos) debe caer cerca de expiraEn, no a 12h del JWT_EXPIRES_IN de tests.
    expect(Math.abs(payload.exp * 1000 - expiraEn.getTime())).toBeLessThan(5000);
  });
});
```

- [ ] **Step 3: Correr el test (debe fallar)**

```bash
cd backend && npm test -- usuarios
```
Expected: los dos nuevos casos FALLAN (hoy el login ignora `expiraEn`: el vencido entra con 200 y el token dura 12h).

- [ ] **Step 4: Implementar en auth.service**

En `backend/src/services/auth.service.ts`:

a) Importar el error nuevo (sumarlo al import existente de errors):
```ts
import { Unauthorized, UsuarioVencido } from '../utils/errors.js';
```

b) Reemplazar `signAdminToken` por:
```ts
export function signAdminToken(claims: AdminClaims, expiresInSeconds?: number): string {
  const env = getEnv();
  const expiresIn = (expiresInSeconds ?? env.JWT_EXPIRES_IN) as jwt.SignOptions['expiresIn'];
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn });
}
```

c) Reemplazar `login` por:
```ts
export async function login(email: string, password: string) {
  const admin = await adminUserRepo.findByEmail(email);
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    throw Unauthorized('Credenciales inválidas');
  }
  if (admin.expiraEn && admin.expiraEn.getTime() <= Date.now()) {
    throw UsuarioVencido();
  }
  const expiresInSeconds = admin.expiraEn
    ? Math.max(1, Math.floor((admin.expiraEn.getTime() - Date.now()) / 1000))
    : undefined;
  const token = signAdminToken({ adminId: admin.id, email: admin.email, rol: admin.rol as Rol }, expiresInSeconds);
  return { token, admin: { id: admin.id, email: admin.email, nombre: admin.nombre, rol: admin.rol } };
}
```

- [ ] **Step 5: Correr el test (debe pasar)**

```bash
cd backend && npm test -- usuarios
```
Expected: todo `usuarios.test.ts` pasa. Luego bajá el contenedor de la Task 1: `docker rm -f venc-pg`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/errors.ts backend/src/services/auth.service.ts backend/tests/integration/usuarios.test.ts
git commit -m "feat(auth): login corta vencidos (403) y acota el token a expiraEn"
```

---

## Task 3: Backend — endpoint para extender/quitar vencimiento

**Files:**
- Modify: `backend/src/validators/usuario.schema.ts`
- Modify: `backend/src/services/usuario.service.ts`
- Modify: `backend/src/routes/usuario.routes.ts`
- Test: `backend/tests/integration/usuarios.test.ts`

**Interfaces:**
- Consumes: `adminUserRepo.updateExpiracion`, `adminUserRepo.findById`.
- Produces:
  - `usuarioService.cambiarExpiracion(id: string, duracionDias: 1|2|7|30|null)` → setea `expiraEn = ahora + días` (o `null`); rechaza `esDefault` con `Forbidden`.
  - Ruta `PATCH /usuarios/:id/expiracion`, body `{ duracionDias: 1|2|7|30|null }`.

- [ ] **Step 1: Agregar el schema de validación**

En `backend/src/validators/usuario.schema.ts`, agregar (usa el `duracionDias` ya definido en Task 1):
```ts
export const cambiarExpiracionSchema = z.object({
  body: z.object({ duracionDias: duracionDias.nullable() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
```

- [ ] **Step 2: Agregar el método al service**

En `backend/src/services/usuario.service.ts`, agregar dentro de `usuarioService` (después de `cambiarRol`):
```ts
  cambiarExpiracion: async (id: string, duracionDias: 1 | 2 | 7 | 30 | null) => {
    const u = await adminUserRepo.findById(id);
    if (!u) throw NotFound('Usuario', id);
    if (u.esDefault) throw Forbidden('No se puede vencer el administrador por defecto');
    const expiraEn = duracionDias ? new Date(Date.now() + duracionDias * 86_400_000) : null;
    return adminUserRepo.updateExpiracion(id, expiraEn);
  },
```

- [ ] **Step 3: Agregar la ruta**

En `backend/src/routes/usuario.routes.ts`:

a) Sumar `cambiarExpiracionSchema` al import de validators:
```ts
import { crearUsuarioSchema, cambiarRolSchema, idUsuarioParamSchema, cambiarExpiracionSchema } from '../validators/usuario.schema.js';
```

b) Agregar la ruta después de la de `/:id/rol`:
```ts
usuarioRoutes.patch('/:id/expiracion', validate(cambiarExpiracionSchema), async (req, res, next) => {
  try {
    const u = await usuarioService.cambiarExpiracion(String(req.params.id), (req as any).valid.body.duracionDias);
    await auditService.log(req, { accion: 'EDITAR', entidad: 'Usuario', entidadId: u.id, descripcion: 'Cambió el vencimiento de ' + u.email });
    res.json(u);
  } catch (e) { next(e); }
});
```

- [ ] **Step 4: Escribir el test (falla primero)**

En `backend/tests/integration/usuarios.test.ts`, dentro del `describe('/usuarios (ADMIN)', ...)`:
```ts
  it('extiende un vencido (lo reactiva) y no permite vencer al default', async () => {
    const admin = await seedDefaultAdmin();
    const v = await getPrisma().adminUser.create({ data: { email: 'reac@x.com', nombre: 'R', passwordHash: 'h', rol: 'RECEPCIONISTA', expiraEn: new Date(Date.now() - 1000) } });
    const ext = await supertest(app).patch(`/usuarios/${v.id}/expiracion`).set('authorization', `Bearer ${tok(admin.id)}`).send({ duracionDias: 7 });
    expect(ext.status).toBe(200);
    expect(new Date(ext.body.expiraEn).getTime()).toBeGreaterThan(Date.now());

    const quitar = await supertest(app).patch(`/usuarios/${v.id}/expiracion`).set('authorization', `Bearer ${tok(admin.id)}`).send({ duracionDias: null });
    expect(quitar.status).toBe(200);
    expect(quitar.body.expiraEn).toBeNull();

    const noDefault = await supertest(app).patch(`/usuarios/${admin.id}/expiracion`).set('authorization', `Bearer ${tok(admin.id)}`).send({ duracionDias: 2 });
    expect(noDefault.status).toBe(403);
  });
```

- [ ] **Step 5: Correr el test**

```bash
cd backend && npm test -- usuarios
```
Expected: todo `usuarios.test.ts` pasa.

- [ ] **Step 6: Commit**

```bash
git add backend/src/validators/usuario.schema.ts backend/src/services/usuario.service.ts backend/src/routes/usuario.routes.ts backend/tests/integration/usuarios.test.ts
git commit -m "feat(usuarios): endpoint PATCH /:id/expiracion para extender o quitar vencimiento"
```

---

## Task 4: Frontend — selector al crear, columna de vencimiento, extender y mensaje de login

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/validators.ts`
- Modify: `frontend/src/lib/usuarios-actions.ts`
- Modify: `frontend/src/lib/auth.ts`
- Modify: `frontend/src/components/usuarios/usuario-dialog.tsx`
- Modify: `frontend/src/components/usuarios/usuarios-table.tsx`

**Interfaces:**
- Consumes: endpoints del backend `POST /usuarios` (con `duracionDias`), `PATCH /usuarios/:id/expiracion`, y el error `USUARIO_VENCIDO` del login.
- Produces: UI para elegir/extender vencimiento y ver el estado.

- [ ] **Step 1: Tipo `Usuario` con `expiraEn`**

En `frontend/src/lib/types.ts`, reemplazar la interfaz `Usuario`:
```ts
export interface Usuario { id: string; email: string; nombre: string; rol: Rol; esDefault: boolean; expiraEn: string | null }
```

- [ ] **Step 2: Validador con `duracionDias`**

En `frontend/src/lib/validators.ts`, reemplazar `usuarioSchema`:
```ts
export const usuarioSchema = z.object({
  email: z.string().email('Email inválido'),
  nombre: z.string().min(1, 'Ingresá el nombre'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  rol: z.enum(['ADMIN', 'RECEPCIONISTA']),
  duracionDias: z.union([z.literal(1), z.literal(2), z.literal(7), z.literal(30)]).optional(),
});
```

- [ ] **Step 3: Server actions**

En `frontend/src/lib/usuarios-actions.ts`, reemplazar `crearUsuario` y agregar `cambiarExpiracionUsuario`:
```ts
export async function crearUsuario(input: { email: string; nombre: string; password: string; rol: Rol; duracionDias?: 1 | 2 | 7 | 30 }): Promise<Result> {
  return run(() => apiFetch('/usuarios', { method: 'POST', body: JSON.stringify(input) }));
}

export async function cambiarExpiracionUsuario(id: string, duracionDias: 1 | 2 | 7 | 30 | null): Promise<Result> {
  return run(() => apiFetch(`/usuarios/${id}/expiracion`, { method: 'PATCH', body: JSON.stringify({ duracionDias }) }));
}
```

- [ ] **Step 4: Mensaje "Usuario vencido" en el login**

En `frontend/src/lib/auth.ts`, reemplazar el bloque `if (!res.ok) return { error: 'Credenciales inválidas' };` por:
```ts
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.error?.code === 'USUARIO_VENCIDO') return { error: 'Usuario vencido' };
      return { error: 'Credenciales inválidas' };
    }
```

- [ ] **Step 5: Selector de vencimiento en el form de crear**

En `frontend/src/components/usuarios/usuario-dialog.tsx`:

a) Agregar estado (junto a los otros `useState`):
```tsx
  const [venc, setVenc] = useState('');
```

b) En `handleOpenChange`, resetear también `venc`:
```tsx
      setEmail(''); setNombre(''); setPassword(''); setRol('RECEPCIONISTA'); setVenc('');
```

c) En `submit`, incluir `duracionDias`:
```tsx
    const duracionDias = venc ? (Number(venc) as 1 | 2 | 7 | 30) : undefined;
    const parsed = usuarioSchema.safeParse({ email, nombre, password, rol, duracionDias });
```

d) Agregar el campo en el form, después del bloque del `Rol`:
```tsx
          <div className="space-y-1">
            <Label htmlFor="u-venc">Vencimiento</Label>
            <select id="u-venc" value={venc} onChange={(e) => setVenc(e.target.value)} className="w-full rounded-md border px-2 py-1.5">
              <option value="">Sin vencimiento</option>
              <option value="1">1 día</option>
              <option value="2">2 días</option>
              <option value="7">7 días</option>
              <option value="30">30 días</option>
            </select>
          </div>
```

- [ ] **Step 6: Columna de vencimiento + acción "Extender" en la tabla**

En `frontend/src/components/usuarios/usuarios-table.tsx`:

a) Sumar `cambiarExpiracionUsuario` al import de actions:
```tsx
import { cambiarRolUsuario, eliminarUsuario, cambiarExpiracionUsuario } from '@/lib/usuarios-actions';
```

b) Agregar helpers antes del `return` (junto a `rolBadge`):
```tsx
  const vencInfo = (u: Usuario) => {
    if (!u.expiraEn) return { vencido: false, label: '—' };
    const t = new Date(u.expiraEn).getTime();
    if (t <= Date.now()) return { vencido: true, label: 'Vencido' };
    return { vencido: false, label: 'Vence ' + new Date(u.expiraEn).toLocaleDateString('es-AR') };
  };
  const vencBadge = (u: Usuario) => {
    const v = vencInfo(u);
    if (v.vencido) return <Badge variant="secondary" className="bg-red-100 text-red-800 hover:bg-red-100">Vencido</Badge>;
    return <span className="text-sm text-neutral-600">{v.label}</span>;
  };
  const extender = (u: Usuario, dias: 1 | 2 | 7 | 30 | null) =>
    act(() => cambiarExpiracionUsuario(u.id, dias), dias ? 'Vencimiento actualizado' : 'Vencimiento quitado', true);
```

c) En la tabla desktop, agregar la columna. En el `<TableRow>` del header:
```tsx
                <TableRow><TableHead>Email</TableHead><TableHead>Nombre</TableHead><TableHead>Rol</TableHead><TableHead>Vencimiento</TableHead></TableRow>
```
y en cada fila, después de la celda del rol:
```tsx
                    <TableCell>{vencBadge(u)}</TableCell>
```

d) En las cards mobile, agregar el estado de vencimiento debajo del nombre. Reemplazar la línea del nombre mobile:
```tsx
                    <span className="mt-0.5 block text-sm text-neutral-600">{u.nombre}</span>
                    <span className="mt-0.5 block text-xs">{vencBadge(u)}</span>
```

e) En el `Sheet` de detalle, dentro del bloque `{!seleccion.esDefault && seleccion.email !== currentEmail ? (` — agregar los controles de extender antes del botón de eliminar (después del botón de cambiar rol):
```tsx
                <div className="rounded-md border p-2">
                  <p className="mb-2 text-sm text-neutral-600">Vencimiento: {vencInfo(seleccion).label}</p>
                  <div className="flex flex-wrap gap-2">
                    {([1, 2, 7, 30] as const).map((d) => (
                      <Button key={d} variant="outline" size="sm" disabled={pending} onClick={() => extender(seleccion, d)}>+{d}d</Button>
                    ))}
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => extender(seleccion, null)}>Sin vencimiento</Button>
                  </div>
                </div>
```

- [ ] **Step 7: Verificar typecheck + build del frontend**

```bash
cd frontend && npm run build
```
Expected: compila sin errores de tipos (usa el `turbopack.root` ya configurado).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/validators.ts frontend/src/lib/usuarios-actions.ts frontend/src/lib/auth.ts frontend/src/components/usuarios/usuario-dialog.tsx frontend/src/components/usuarios/usuarios-table.tsx
git commit -m "feat(usuarios): UI de vencimiento (crear, listar, extender) y mensaje de login vencido"
```

---

## Notas de cierre

- El token acotado a `expiraEn` hace que una sesión abierta se corte en el siguiente request pasada la fecha (sin consulta a la base). Si se *acorta* la fecha de un usuario ya logueado, su token actual sigue hasta su vencimiento original; al re-loguear toma la nueva (documentado en el spec, aceptado para la demo).
- La migración solo agrega una columna nullable: no afecta a usuarios existentes ni al admin por defecto.
- El seed de demo (`backend/src/seed-demo.ts`) no necesita cambios: el admin de demo queda sin vencimiento (`expiraEn = null`).

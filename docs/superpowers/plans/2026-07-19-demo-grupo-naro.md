# Demo "Grupo Naro" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la copia `proyecto-canchas` en una demo desplegable en un VPS bajo `canchas.gruponaro.com.ar`, con la marca "Grupo Naro" (sin "Canchitas Ortigoza"), datos ficticios y solo el panel web (bot de WhatsApp apagado).

**Architecture:** El navegador solo habla con el frontend (Next.js); el frontend habla con el backend por red interna vía `API_URL`. La demo despliega tres contenedores — `postgres`, `backend`, `frontend` — en una red docker; Traefik expone únicamente el frontend en el dominio público. El backend queda interno (sin subdominio `api.`).

**Tech Stack:** Next.js 16 (frontend), Node 22 + Prisma 7 + Postgres (backend), Docker Compose + Traefik, seed en TypeScript (tsx).

## Global Constraints

- No modificar la carpeta `ortigoza/` (es producción real). Todo el trabajo es dentro de `proyecto-canchas/`.
- Marca visible al usuario: **Grupo Naro**. Donde el diseño parte la marca en dos, usar `Grupo` / `NARO`; corrida, `Grupo Naro`.
- No renombrar identificadores internos (carpeta `canchitas-infra`, DB `canchitas`, servicios docker, variables). Solo texto visible.
- Bot de WhatsApp / Evolution / n8n: NO se despliegan.
- Teléfonos de clientes de demo: ficticios, prefijo de test `549110000####`.
- Dominio: `canchas.gruponaro.com.ar`.
- Frontend llama al backend solo server-side vía `process.env.API_URL`. El navegador nunca toca la API.

---

## Task 0: Inicializar git (opcional pero recomendado)

`proyecto-canchas` no es repo git; sin esto los pasos de "commit" no aplican. Si preferís no versionar, saltá esta tarea e ignorá los pasos de commit en el resto del plan.

**Files:**
- Create: `.gitignore` (si no existe uno útil en la raíz)

- [ ] **Step 1: Inicializar repo**

```bash
cd c:/Users/Lautaro/Desktop/proyecto-canchas
git init
```

- [ ] **Step 2: Crear .gitignore raíz**

```gitignore
node_modules/
.next/
dist/
.env
.env.*.local
*.tsbuildinfo
```

- [ ] **Step 3: Commit inicial**

```bash
git add -A
git commit -m "chore: init demo repo grupo naro"
```

---

## Task 1: Rebranding visible en el frontend

Reemplazar todos los textos "Canchitas Ortigoza" por "Grupo Naro" en la UI. No hay tests unitarios para copy; la verificación es por `grep` + build.

**Files:**
- Modify: `frontend/src/app/layout.tsx:19`
- Modify: `frontend/src/app/login/page.tsx:32,39,53`
- Modify: `frontend/src/components/app-shell.tsx:31-32,58`
- Modify: `frontend/src/components/mobile-nav.tsx:22`

**Interfaces:**
- Consumes: nada.
- Produces: UI con marca "Grupo Naro". Ninguna otra tarea depende de nombres nuevos.

- [ ] **Step 1: layout.tsx — título de la pestaña**

En `frontend/src/app/layout.tsx` línea 19, cambiar:
```tsx
  title: "Canchitas Ortigoza",
```
por:
```tsx
  title: "Grupo Naro",
```

- [ ] **Step 2: login/page.tsx — encabezado, placeholder y pie**

Línea 32:
```tsx
          <h1 className="text-xl font-semibold tracking-tight">Grupo Naro</h1>
```
Línea 39 (solo el placeholder):
```tsx
              <Input id="email" name="email" type="email" required autoComplete="email" placeholder="vos@gruponaro.com.ar" />
```
Línea 53:
```tsx
        <p className="mt-6 text-center text-xs text-neutral-500">Grupo Naro · Reservas</p>
```

- [ ] **Step 3: app-shell.tsx — header (dos líneas + versión corrida)**

Líneas 31-32 (mantener el mismo layout de dos líneas):
```tsx
            <div className="text-[16px] font-semibold tracking-tight text-neutral-900">Grupo</div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neutral-500">NARO</div>
```
Línea 58:
```tsx
            <Logo className="h-5 w-5 text-primary" /> Grupo Naro
```

- [ ] **Step 4: mobile-nav.tsx — nav mobile**

Línea 22:
```tsx
            Grupo <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neutral-500">NARO</span>
```

- [ ] **Step 5: Verificar que no queda texto visible de la marca vieja**

Run:
```bash
grep -rin "ortigo\|canchitas ortigoza" frontend/src
```
Expected: sin resultados (0 líneas).

- [ ] **Step 6: Verificar que el frontend compila**

Run:
```bash
cd frontend && npm run build
```
Expected: build exitoso (Compiled successfully / sin errores).

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat: rebrand UI a Grupo Naro"
```

---

## Task 2: Dockerfile del frontend

El frontend iba en Vercel; para el VPS necesita imagen propia. Usar salida `standalone` de Next para una imagen liviana.

**Files:**
- Modify: `frontend/next.config.ts`
- Create: `frontend/Dockerfile`
- Create: `frontend/.dockerignore`

**Interfaces:**
- Consumes: variable de entorno de runtime `API_URL` (ya usada por `frontend/src/lib/*`).
- Produces: imagen `grupo-naro-frontend:latest` que corre `node server.js` en el puerto 3000.

> **Contexto (bug pre-existente a corregir aquí):** hoy `next build` falla con
> "Next.js inferred your workspace root..." porque detecta un `package-lock.json`
> perdido en `C:\Users\Lautaro` y elige esa carpeta como raíz, arriba del proyecto.
> El fix es fijar `turbopack.root` al directorio del frontend en `next.config.ts`.
> Sin esto no compila ni local ni en Docker. Verificar el build en Step 4.

- [ ] **Step 1: Activar salida standalone + fijar turbopack.root en next.config.ts**

Reemplazar el contenido de `frontend/next.config.ts` por:
```ts
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Fija la raíz del workspace al dir del frontend. Sin esto, Next infiere
  // C:\Users\Lautaro (por un lockfile suelto) y el build falla.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
```

> Nota: en Docker el build corre en Linux dentro de `/app`, donde no existe el
> lockfile del home, pero fijar `root` es correcto en ambos entornos y además
> destraba el build local para poder verificar.

- [ ] **Step 2: Crear frontend/.dockerignore**

```
node_modules
.next
.env
.env.*.local
npm-debug.log
```

- [ ] **Step 3: Crear frontend/Dockerfile**

```dockerfile
# ─── Stage 1: Build ───────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json pnpm-lock.yaml* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY . .
RUN npm run build

# ─── Stage 2: Runtime (standalone) ────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 4: Verificar que la imagen se construye**

Run:
```bash
cd frontend && docker build -t grupo-naro-frontend:latest .
```
Expected: build termina sin error y crea la imagen.

- [ ] **Step 5: Commit**

```bash
git add frontend/next.config.ts frontend/Dockerfile frontend/.dockerignore
git commit -m "build: Dockerfile del frontend (standalone) para VPS"
```

---

## Task 3: Seed de datos de demo

Script aparte (`seed-demo.ts`) que NO reemplaza `seed.ts`, para no arriesgar producción. Puebla admin, canchas, clientes ficticios y reservas de la semana actual.

**Files:**
- Create: `backend/src/seed-demo.ts`
- Modify: `backend/package.json` (agregar script `seed:demo`)

**Interfaces:**
- Consumes: `prisma` (singleton en `backend/src/db/prisma.js`), `configRepo` (`backend/src/repositories/config.repo.js`), modelos Prisma `adminUser`, `cancha`, `horarioDisponible`, `sector`, `canchaSector`, `cliente`, `reserva`, `reservaSector`. Envs `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`.
- Produces: comando `npm run seed:demo` (dev) que deja la base poblada. Tarea 4 lo ejecuta en el deploy.

- [ ] **Step 1: Crear backend/src/seed-demo.ts**

```ts
import { prisma } from './db/prisma.js';
import bcrypt from 'bcrypt';

// Seed de DEMO. Poblá una base de demo, no producción.
// Idempotente por ids `demo-*`. Correr con: npm run seed:demo
async function main() {
  // 1) Admin de demo
  const email = process.env.ADMIN_SEED_EMAIL ?? 'admin@gruponaro.com.ar';
  const password = process.env.ADMIN_SEED_PASSWORD ?? 'demo1234';
  await prisma.adminUser.upsert({
    where: { email },
    create: { email, nombre: 'Admin', passwordHash: await bcrypt.hash(password, 10), rol: 'ADMIN', esDefault: true },
    update: { rol: 'ADMIN', esDefault: true },
  });

  // 2) Canchas (con su sector 1:1 y horarios 16-23 los 7 días)
  const canchasDef = [
    { id: 'demo-f5-1', nombre: 'Cancha 1', tipo: 'futbol5', precioHora: 14000 },
    { id: 'demo-f5-2', nombre: 'Cancha 2', tipo: 'futbol5', precioHora: 14000 },
    { id: 'demo-f7-1', nombre: 'Cancha 3', tipo: 'futbol7', precioHora: 20000 },
    { id: 'demo-padel-1', nombre: 'Pádel 1', tipo: 'padel', precioHora: 9000 },
  ];
  const sectorPorCancha = new Map<string, string>();
  for (const c of canchasDef) {
    const cancha = await prisma.cancha.upsert({
      where: { id: c.id },
      create: { id: c.id, nombre: c.nombre, tipo: c.tipo, precioHora: c.precioHora },
      update: {},
    });
    for (let dia = 0; dia <= 6; dia++) {
      const exists = await prisma.horarioDisponible.findFirst({ where: { canchaId: cancha.id, diaSemana: dia } });
      if (!exists) {
        await prisma.horarioDisponible.create({
          data: { canchaId: cancha.id, diaSemana: dia, horaInicio: '16:00', horaFin: '23:00' },
        });
      }
    }
    const conSector = await prisma.cancha.findUnique({ where: { id: cancha.id }, include: { sectores: true } });
    let sectorId = conSector?.sectores[0]?.sectorId;
    if (!sectorId) {
      const s = await prisma.sector.create({ data: { nombre: cancha.nombre } });
      await prisma.canchaSector.create({ data: { canchaId: cancha.id, sectorId: s.id } });
      sectorId = s.id;
    }
    sectorPorCancha.set(cancha.id, sectorId);
  }

  // 3) Clientes ficticios. En el schema el teléfono es `whatsapp` (String @unique)
  //    y `nombre` es obligatorio. No existe campo `telefono`.
  const nombres = ['Juan Pérez', 'Sofía Gómez', 'Martín Díaz', 'Lucía Fernández', 'Diego Romero',
    'Valentina Ruiz', 'Nicolás Torres', 'Camila Sosa', 'Federico Luna', 'Agustina Ríos'];
  const clientes: { id: string; nombre: string; whatsapp: string }[] = [];
  for (let i = 0; i < nombres.length; i++) {
    const whatsapp = `549110000${String(1000 + i)}`;
    const cli = await prisma.cliente.upsert({
      where: { whatsapp },
      create: { whatsapp, nombre: nombres[i] },
      update: { nombre: nombres[i] },
    });
    clientes.push({ id: cli.id, nombre: cli.nombre, whatsapp });
  }
  const precioPorCancha = new Map(canchasDef.map((c) => [c.id, c.precioHora]));

  // 4) Reservas repartidas en la semana actual (lunes..domingo)
  const hoy = new Date();
  const lunes = new Date(hoy);
  const offsetALunes = (hoy.getDay() + 6) % 7; // 0=lunes
  lunes.setDate(hoy.getDate() - offsetALunes);
  lunes.setHours(0, 0, 0, 0);

  const canchaIds = canchasDef.map((c) => c.id);
  const horas = [18, 19, 20, 21, 22];
  let idx = 0;
  for (let dia = 0; dia < 7; dia++) {
    const reservasDelDia = 2 + (dia % 3); // 2..4 por día
    for (let k = 0; k < reservasDelDia; k++) {
      const canchaId = canchaIds[idx % canchaIds.length];
      const hora = horas[(idx + k) % horas.length];
      const inicio = new Date(lunes);
      inicio.setDate(lunes.getDate() + dia);
      inicio.setHours(hora, 0, 0, 0);
      const fin = new Date(inicio);
      fin.setHours(hora + 1, 0, 0, 0);
      const cliente = clientes[idx % clientes.length];
      // EstadoReserva válidos: CONFIRMADA | ESPERANDO_SENA | CANCELADA | COMPLETADA.
      // Alternamos confirmadas y en espera de seña para poblar los filtros del panel.
      const estado = idx % 3 === 0 ? 'ESPERANDO_SENA' : 'CONFIRMADA';
      const monto = precioPorCancha.get(canchaId)!;
      const montoSena = estado === 'ESPERANDO_SENA' ? Math.round(monto / 2) : null;
      const reservaId = `demo-res-${dia}-${k}`;

      const existe = await prisma.reserva.findUnique({ where: { id: reservaId } });
      if (!existe) {
        await prisma.reserva.create({
          data: {
            id: reservaId,
            canchaId,
            clienteId: cliente.id,
            fechaInicio: inicio,
            fechaFin: fin,
            estado,
            esContacto: false,
            monto,
            montoSena,
          },
        });
        await prisma.reservaSector.create({
          data: {
            reservaId,
            sectorId: sectorPorCancha.get(canchaId)!,
            estado,
            fechaInicio: inicio,
            fechaFin: fin,
          },
        });
      }
      idx++;
    }
  }

  // 5) Config básica
  const { configRepo } = await import('./repositories/config.repo.js');
  const cfg = await configRepo.getOrCreate();
  if (!cfg.adminWhatsapp) await configRepo.update({ adminWhatsapp: '5491100001111' });

  console.log(`Seed demo completo: ${canchasDef.length} canchas, ${clientes.length} clientes, ~${idx} reservas`);
}

main().finally(() => prisma.$disconnect());
```

> **Nota de implementación (ya verificado contra `schema.prisma`):** el código de arriba
> usa los nombres reales del schema: `Cliente.whatsapp` (@unique, no existe `telefono`),
> `Cliente.nombre` obligatorio, `EstadoReserva` ∈ {CONFIRMADA, ESPERANDO_SENA, CANCELADA,
> COMPLETADA} (no existe `SENADA`), y `Reserva` requiere `esContacto` (Boolean) y `monto`
> (Decimal) además de `estado`/`fechaInicio`/`fechaFin`/`canchaId`/`clienteId`. No cambiar
> estos nombres por los del borrador anterior.

- [ ] **Step 2: Confirmar el schema antes de correr**

Run:
```bash
cd backend && grep -nE "enum EstadoReserva|whatsapp|esContacto|monto " prisma/schema.prisma
```
Expected: ver `EstadoReserva` con `CONFIRMADA`/`ESPERANDO_SENA`, `Cliente.whatsapp @unique`,
y `Reserva.esContacto`/`Reserva.monto`. Si algo difiere de la nota anterior, avisar antes de seguir.

- [ ] **Step 3: Agregar script en backend/package.json**

En `"scripts"`, agregar:
```json
    "seed:demo": "tsx src/seed-demo.ts",
```

- [ ] **Step 4: Correr el seed contra una base de prueba local y verificar**

Run (con un `DATABASE_URL` de prueba, no producción):
```bash
cd backend && npm run seed:demo
```
Expected: imprime "Seed demo completo: 4 canchas, 10 clientes, ~N reservas" sin errores. Correrlo dos veces no debe duplicar (idempotente).

- [ ] **Step 5: Commit**

```bash
git add backend/src/seed-demo.ts backend/package.json
git commit -m "feat: seed de datos de demo (Grupo Naro)"
```

---

## Task 4: Despliegue en VPS (compose + Traefik + docs)

Compose reducido con postgres + backend + frontend. Traefik expone solo el frontend en `canchas.gruponaro.com.ar`. Backend interno.

**Files:**
- Create: `deploy-demo/docker-compose.demo.yml`
- Create: `deploy-demo/.env.demo.example`
- Create: `deploy-demo/traefik-routes.demo.yml`
- Create: `deploy-demo/DEPLOY-DEMO.md`

**Interfaces:**
- Consumes: imagen del backend (`backend/Dockerfile`, Task existente) y del frontend (`frontend/Dockerfile`, Task 2). Script `seed:demo` (Task 3).
- Produces: stack desplegable con `docker compose -f deploy-demo/docker-compose.demo.yml up -d`.

- [ ] **Step 1: Crear deploy-demo/docker-compose.demo.yml**

```yaml
# Demo Grupo Naro: postgres + backend + frontend. Bot/Evolution/n8n NO se incluyen.
# Traefik (externo) enruta canchas.gruponaro.com.ar -> frontend. Backend queda interno.
services:
  postgres:
    image: postgres:16-alpine
    container_name: gruponaro-postgres
    environment:
      POSTGRES_USER: "${PG_USER}"
      POSTGRES_PASSWORD: "${PG_PASSWORD}"
      POSTGRES_DB: canchitas
    volumes:
      - gruponaro-pg:/var/lib/postgresql/data
    networks:
      - web
    restart: unless-stopped

  backend:
    build: ../backend
    image: gruponaro-backend:latest
    container_name: gruponaro-backend
    environment:
      DATABASE_URL: "postgresql://${PG_USER}:${PG_PASSWORD}@postgres:5432/canchitas?schema=public"
      JWT_SECRET: "${JWT_SECRET}"
      JWT_EXPIRES_IN: "365d"
      TZ_NEGOCIO: "America/Argentina/Buenos_Aires"
      ADMIN_SEED_EMAIL: "${ADMIN_SEED_EMAIL}"
      ADMIN_SEED_PASSWORD: "${ADMIN_SEED_PASSWORD}"
      PORT: "3000"
    depends_on:
      - postgres
    networks:
      - web
    restart: unless-stopped

  frontend:
    build: ../frontend
    image: gruponaro-frontend:latest
    container_name: gruponaro-frontend
    environment:
      API_URL: "http://backend:3000"
      PORT: "3000"
    depends_on:
      - backend
    networks:
      - web
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.gruponaro.rule=Host(`canchas.gruponaro.com.ar`)"
      - "traefik.http.routers.gruponaro.entrypoints=websecure"
      - "traefik.http.routers.gruponaro.tls.certresolver=letsencrypt"
      - "traefik.http.services.gruponaro.loadbalancer.server.port=3000"
    restart: unless-stopped

volumes:
  gruponaro-pg:

networks:
  web:
    external: true
```

> **Nota:** los nombres del entrypoint (`websecure`) y del certresolver (`letsencrypt`) deben coincidir con la config real del Traefik del VPS. Si el Traefik del VPS usa el archivo dinámico en vez de labels, usar el Step 3 en su lugar.

- [ ] **Step 2: Crear deploy-demo/.env.demo.example**

```dotenv
# Copiar a .env y completar. NO commitear el .env real.
PG_USER=gruponaro
PG_PASSWORD=cambiar-esto
JWT_SECRET=cambiar-esto-por-un-secreto-largo
ADMIN_SEED_EMAIL=admin@gruponaro.com.ar
ADMIN_SEED_PASSWORD=cambiar-esto
```

- [ ] **Step 3: Crear deploy-demo/traefik-routes.demo.yml (alternativa por archivo dinámico)**

```yaml
# Solo si el Traefik del VPS usa provider de archivo (no labels).
http:
  routers:
    gruponaro-frontend:
      rule: "Host(`canchas.gruponaro.com.ar`)"
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      service: gruponaro-frontend
  services:
    gruponaro-frontend:
      loadBalancer:
        servers:
          - url: "http://gruponaro-frontend:3000"
```

- [ ] **Step 4: Crear deploy-demo/DEPLOY-DEMO.md**

```markdown
# Deploy Demo — Grupo Naro

Panel web de demo en `canchas.gruponaro.com.ar`. Sin bot de WhatsApp.

## Requisitos en el VPS
- Docker + Docker Compose.
- Un Traefik ya corriendo con red externa `web`, entrypoint `websecure` y un certresolver
  `letsencrypt` (ajustar nombres en el compose/labels si difieren).
- DNS: `canchas.gruponaro.com.ar` apuntando (A/AAAA) a la IP del VPS.

## Pasos
1. Copiar la carpeta del proyecto al VPS (o `git clone`).
2. `cd deploy-demo && cp .env.demo.example .env` y completar valores.
3. Levantar el stack:
   ```bash
   docker compose -f docker-compose.demo.yml up -d --build
   ```
4. Correr migraciones + seed de demo (el backend ya corre `migrate deploy` al arrancar;
   el seed se corre a mano una vez):
   ```bash
   docker compose -f docker-compose.demo.yml exec backend node dist/seed-demo.js
   ```
   > Si `dist/seed-demo.js` no existe, verificar que el Dockerfile del backend compila `src/`
   > completo (incluye `seed-demo.ts`). Alternativa dev: correr `npm run seed:demo` apuntando
   > `DATABASE_URL` a la base del contenedor.
5. Abrir `https://canchas.gruponaro.com.ar`, verificar HTTPS y login con el admin de demo.

## Verificación
- Login muestra "Grupo Naro" y el candado HTTPS es válido.
- Entrar al panel: en ningún lado dice "Ortigoza".
- Calendario / Hoy / Caja / Clientes muestran datos ficticios.
```

- [ ] **Step 5: Verificar que el compose es válido**

Run:
```bash
cd deploy-demo && docker compose -f docker-compose.demo.yml config
```
Expected: imprime la config resuelta sin errores de sintaxis.

- [ ] **Step 6: Commit**

```bash
git add deploy-demo
git commit -m "chore: stack de deploy de la demo (compose + traefik + docs)"
```

---

## Notas de cierre

- El `seed-demo.js` compilado depende de que el Dockerfile del backend compile todo `src/`
  (hoy corre `tsc -p tsconfig.json`, así que sí lo incluye). Confirmar en Task 4 Step 4.
- El backend arranca con `npx prisma migrate deploy && node dist/index.js`, así que la base
  se migra sola al primer `up`.
- Si el Traefik del VPS difiere (nombres de entrypoint/certresolver/red), es el único lugar
  a ajustar; el resto del stack no cambia.

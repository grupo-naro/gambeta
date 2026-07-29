# Deploy del backend en la VM (Ubuntu + Docker)

Reusa el **Postgres existente** de la VM y la red **canchitas-network** (la misma de n8n/Evolution),
así n8n llega al backend por `http://backend:3000`.

Correr todo **en la VM**, dentro de la carpeta `backend/` del repo clonado.

## 1. Verificar prerequisitos del Postgres existente

```bash
# Credenciales del Postgres (para el .env)
docker exec postgres env | grep POSTGRES_

# Confirmar que postgres está en canchitas-network (debe listar canchitas-network)
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' postgres
```
Si el contenedor de Postgres NO se llama `postgres` o NO está en `canchitas-network`, avisá
(ajustamos el host/alias en `docker-compose.vm.yml`).

## 2. Crear la base `canchitas`

```bash
# Usar el POSTGRES_USER real del paso anterior
docker exec -it postgres psql -U <POSTGRES_USER> -c "CREATE DATABASE canchitas;"
```
La extensión `btree_gist` la habilita la migración automáticamente (el rol postgres es superuser).

## 3. Configurar el .env

```bash
cp .env.vm.example .env
# Editar .env: PG_USER y PG_PASSWORD = los del paso 1; definir JWT_SECRET (>=32 chars),
# SERVICE_API_KEY (la que usará n8n), ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD.
# Seña: completar SENA_CBU, SENA_ALIAS, SENA_TITULAR (y opcionalmente SENA_MODO=porcentaje|fijo,
#       SENA_PORCENTAJE, SENA_MONTO_FIJO). Default: 50% del precio del turno.
```

## 4. Build + levantar (corre migraciones en el arranque)

```bash
docker compose -f docker-compose.vm.yml up -d --build
docker compose -f docker-compose.vm.yml logs -f backend   # ver "migrate deploy" + arranque
```
El `CMD` ejecuta `prisma migrate deploy` y luego `node dist/index.js`.

## 5. Sembrar datos (admin + canchas + horarios) — una vez

```bash
docker compose -f docker-compose.vm.yml run --rm backend node dist/seed.js
```
Idempotente: se puede re-correr sin duplicar.

## 6. Verificar

```bash
# Desde el host de la VM (puerto publicado 3001):
curl -s http://localhost:3001/health        # -> {"ok":true}

# Desde n8n (red interna) — así lo va a llamar el workflow:
docker exec n8n node -e "fetch('http://backend:3000/health').then(r=>r.text()).then(console.log)"

# Login admin (usa ADMIN_SEED_*):
curl -s -X POST http://localhost:3001/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@canchitas.com","password":"<ADMIN_SEED_PASSWORD>"}'
```

## Notas
- En los nodos HTTP Request de n8n, la base del backend es **`http://backend:3000`** (red interna),
  con header `x-api-key: <SERVICE_API_KEY>` para los endpoints de servicio.
- Para actualizar el backend: `git pull` y repetir el paso 4 (`up -d --build`).

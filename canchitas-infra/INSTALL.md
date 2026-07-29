# Instalación completa en un VPS nuevo

Requisitos: VPS Linux con Docker + plugin compose, y un número de WhatsApp
dedicado para el bot (chip nuevo o número del complejo).

## 1. Configurar

```bash
git clone <este-repo> /opt/canchitas-infra && cd /opt/canchitas-infra

cp postgres/.env.example postgres/.env
cp redis/.env.example    redis/.env
cp evolution/.env.example evolution/.env
cp n8n/.env.example      n8n/.env
cp cliente.env.example   cliente.env
```

Editar cada `.env` y completar los `CHANGE_ME`:

- **postgres/.env** — password de la base (inventar uno fuerte).
- **redis/.env** — password de Redis.
- **evolution/.env** — `SERVER_URL` (IP/dominio del VPS), los passwords de
  Postgres y Redis en las URIs, y `AUTHENTICATION_API_KEY` (inventar).
- **n8n/.env** — dominio de n8n, password de Postgres, `N8N_ENCRYPTION_KEY`
  (inventar, min 32 chars — **guardarla**: sin ella no se recuperan las credenciales).
- **cliente.env** — datos del complejo (ver comentarios en el archivo).
  `EVOLUTION_API_KEY` = el mismo valor que `AUTHENTICATION_API_KEY` de evolution/.env.

## 2. Correr el bootstrap

```bash
./bootstrap.sh
```

Levanta todo, crea las bases, crea la instancia de WhatsApp en Evolution,
configura el webhook hacia n8n e importa los workflows.

## 3. Backend y frontend

```bash
git clone <repo-canchitas-backend> /opt/canchitas/canchitas-backend
cd /opt/canchitas/canchitas-backend
cp .env.example .env   # completar: mismos passwords de Postgres, SERVICE_API_KEY
                       # y ADMIN_SEED_* iguales a los de cliente.env,
                       # EVOLUTION_API_KEY/EVOLUTION_INSTANCE iguales a cliente.env
docker compose -f docker-compose.vm.yml up -d --build
```

Frontend: según el repo `canchitas-frontend` (hosting estático o el mismo VPS).

## 4. Credenciales en n8n

Entrar a `http://IP:5678`, crear el usuario owner, y en **Credentials** crear:

| Nombre exacto | Tipo | Valor |
|---------------|------|-------|
| `Canchitas Webhook Token` | Header Auth | header `x-webhook-token` = `WEBHOOK_TOKEN` de cliente.env |
| `Backend Canchitas (x-api-key)` | Header Auth | header `x-api-key` = `SERVICE_API_KEY` de cliente.env |
| `Redis Canchitas` | Redis | host `redis`, puerto 6379, password de redis/.env |
| `Gmail SMTP Canchitas` | SMTP | cuenta de Gmail con app password (para mails de error) |

Los nombres deben ser **exactos** porque los workflows los referencian así.

## 5. Activar workflows

En n8n activar: `Canchitas — Bot v2`, `Canchitas — Recordatorio 24h`,
`Canchitas — Timeout seña`, `Canchitas — Bot errores (email)`.
(Bot v1 y Echo quedan desactivados: son versiones viejas.)

## 6. Conectar WhatsApp

```bash
# pedir el QR (usar la AUTHENTICATION_API_KEY de evolution/.env)
curl -H "apikey: LA_API_KEY" http://localhost:8082/instance/connect/NOMBRE_INSTANCIA
```

Escanear el QR desde el teléfono del complejo (WhatsApp → Dispositivos vinculados).
Verificar con `/instance/fetchInstances` que `connectionStatus` sea `open`.

## 7. Prueba de fuego

Mandar un mensaje de WhatsApp al número del bot desde otro teléfono y
verificar que responde y que puede consultar disponibilidad (backend arriba).

## Pendientes conocidos

- **Backups**: configurar un cron de `pg_dump` de las 3 bases + volumen de
  Evolution. Sin esto, un disco roto = pérdida total.
- **TLS/dominio**: el Traefik incluido rutea solo HTTP; el TLS actualmente se
  resuelve con Cloudflare Tunnel / Tailscale Funnel según la instalación.

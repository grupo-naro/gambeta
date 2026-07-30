#!/usr/bin/env bash
# Bootstrap de la infra Gambeteando en un VPS nuevo.
# Idempotente: se puede correr varias veces sin romper nada.
set -euo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"

# ---------- 0. Chequeos ----------
command -v docker >/dev/null || { echo "ERROR: falta Docker. Instalalo y volvé a correr."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: falta el plugin docker compose."; exit 1; }

# ---------- 1. Archivos .env ----------
faltan=0
for f in postgres/.env redis/.env evolution/.env n8n/.env cliente.env; do
  if [[ ! -f "$f" ]]; then
    cp "${f%.env}".env.example "$f" 2>/dev/null || cp "$f.example" "$f"
    echo ">> Creado $f desde su .example — EDITALO (buscá los CHANGE_ME)."
    faltan=1
  fi
done
if grep -l 'CHANGE_ME' postgres/.env redis/.env evolution/.env n8n/.env cliente.env 2>/dev/null; then
  echo "ERROR: los archivos de arriba todavía tienen valores CHANGE_ME. Completalos y volvé a correr."
  exit 1
fi
[[ $faltan -eq 1 ]] && exit 1

# shellcheck disable=SC1091
source cliente.env

# ---------- 2. Red compartida ----------
docker network inspect canchitas-network >/dev/null 2>&1 || docker network create canchitas-network

# ---------- 3. Postgres (primero, todos dependen de él) ----------
docker compose -f postgres/docker-compose.yml --project-directory postgres up -d
echo -n "Esperando Postgres"
for _ in $(seq 1 30); do
  docker exec postgres pg_isready -q 2>/dev/null && break
  echo -n "."; sleep 2
done; echo " OK"

# Bases extra: evolution_db (Evolution) y canchitas (backend)
PG_USER=$(grep '^POSTGRES_USER=' postgres/.env | cut -d= -f2)
for db in evolution_db canchitas; do
  docker exec postgres psql -U "$PG_USER" -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || docker exec postgres psql -U "$PG_USER" -c "CREATE DATABASE $db"
done

# ---------- 4. Redis, Evolution, n8n, Traefik ----------
for svc in redis evolution n8n traefik; do
  docker compose -f "$svc/docker-compose.yml" --project-directory "$svc" up -d
done

echo -n "Esperando Evolution API"
for _ in $(seq 1 30); do
  curl -sf http://localhost:8082 >/dev/null 2>&1 && break
  echo -n "."; sleep 2
done; echo " OK"

# ---------- 5. Instancia de WhatsApp en Evolution ----------
EVO_GLOBAL_KEY=$(grep '^AUTHENTICATION_API_KEY=' evolution/.env | cut -d= -f2)
evo() { curl -sf -H "apikey: $EVO_GLOBAL_KEY" -H 'Content-Type: application/json' "$@"; }

if ! evo http://localhost:8082/instance/fetchInstances | grep -q "\"name\":\"$EVOLUTION_INSTANCE\""; then
  echo ">> Creando instancia $EVOLUTION_INSTANCE"
  evo -X POST http://localhost:8082/instance/create -d "{
    \"instanceName\": \"$EVOLUTION_INSTANCE\",
    \"integration\": \"WHATSAPP-BAILEYS\"
  }" >/dev/null
  evo -X POST "http://localhost:8082/settings/set/$EVOLUTION_INSTANCE" -d '{
    "rejectCall": true,
    "msgCall": "Numero automatico de reservas, escribi tu consulta por mensaje.",
    "groupsIgnore": true,
    "alwaysOnline": true,
    "readMessages": false,
    "readStatus": false,
    "syncFullHistory": false
  }' >/dev/null
fi

# Webhook Evolution -> n8n (mensajes entrantes al bot)
evo -X POST "http://localhost:8082/webhook/set/$EVOLUTION_INSTANCE" -d "{
  \"webhook\": {
    \"enabled\": true,
    \"url\": \"http://n8n:5678/webhook/wa-canchitas\",
    \"headers\": { \"Content-Type\": \"application/json\", \"x-webhook-token\": \"$WEBHOOK_TOKEN\" },
    \"events\": [\"MESSAGES_UPSERT\"],
    \"byEvents\": false,
    \"base64\": true
  }
}" >/dev/null
echo ">> Webhook configurado hacia n8n"

# ---------- 6. Workflows de n8n (render de placeholders + import) ----------
TMP=$(mktemp -d)
for wf in workflows/*.json; do
  sed -e "s|__NOMBRE_COMPLEJO__|$NOMBRE_COMPLEJO|g" \
      -e "s|__EVOLUTION_INSTANCE__|$EVOLUTION_INSTANCE|g" \
      -e "s|__EVOLUTION_API_KEY__|$EVOLUTION_API_KEY|g" \
      -e "s|__SERVICE_API_KEY__|$SERVICE_API_KEY|g" \
      -e "s|__GEMINI_API_KEY__|$GEMINI_API_KEY|g" \
      -e "s|__ADMIN_EMAIL__|$ADMIN_EMAIL|g" \
      -e "s|__ADMIN_PASSWORD__|$ADMIN_PASSWORD|g" \
      -e "s|__ADMIN_WHATSAPP__|$ADMIN_WHATSAPP|g" \
      -e "s|__ALERT_EMAIL__|$ALERT_EMAIL|g" \
      "$wf" > "$TMP/$(basename "$wf")"
done
docker cp "$TMP/." n8n:/tmp/wf-import/
docker exec n8n n8n import:workflow --separate --input=/tmp/wf-import/ >/dev/null
docker exec n8n rm -rf /tmp/wf-import
rm -rf "$TMP"
# El import deja los workflows desactivados: activarlos a mano desde la UI
# después de cargar las credenciales (ver INSTALL.md).
echo ">> Workflows importados en n8n (quedan DESACTIVADOS hasta cargar credenciales)"

echo
echo "=========================================================="
echo "Infra levantada. Pasos manuales restantes (ver INSTALL.md):"
echo "  1. Deployar el backend (repo canchitas-backend) y el frontend."
echo "  2. Entrar a n8n (puerto 5678), crear el usuario owner y cargar las credenciales."
echo "  3. Activar los workflows en n8n."
echo "  4. Conectar WhatsApp: GET /instance/connect/$EVOLUTION_INSTANCE y escanear el QR."
echo "=========================================================="

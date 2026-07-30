# canchitas-infra

Infraestructura del sistema de reservas Gambeteando (bot de WhatsApp + backend + panel).
Este repo permite instalar el stack completo en un VPS nuevo para un complejo nuevo.

El sistema completo son **3 repos**:

| Repo | Qué es |
|------|--------|
| `canchitas-infra` (este) | Docker composes, workflows de n8n, script de instalación |
| `canchitas-backend` | API de reservas (Node + Prisma + Postgres) |
| `canchitas-frontend` | Panel de administración |

## Servicios

| Servicio | Puerto | Rol |
|----------|--------|-----|
| Postgres 16 | 5432 (solo localhost) | Base de datos de todo: n8n (`canchitas_db`), Evolution (`evolution_db`), backend (`canchitas`) |
| Redis 7 | 6379 (solo localhost) | Estado de conversación del bot + cache de Evolution |
| Evolution API v2.3.7 | 8082 | Conexión con WhatsApp (Baileys) |
| n8n | 5678 | Workflows del bot (el "cerebro" está en `workflows/`) |
| Traefik v3.3 | 80 | Reverse proxy hacia el backend |
| Portainer (opcional) | 9000 | UI de administración de Docker |

Todos comparten la red Docker externa `canchitas-network`.

## Workflows del bot (n8n)

- **canchitas-bot-v2** — el bot principal: recibe mensajes por webhook de Evolution, entiende con Gemini, reserva contra el backend. (v1 y echo son versiones viejas/de prueba, se conservan por referencia.)
- **canchitas-recordatorio-24h** — recordatorio diario 10:00 de las reservas del día siguiente.
- **canchitas-timeout-se-a** — cada 5 min libera reservas cuya seña venció.
- **canchitas-bot-errores-email** — manda un mail cuando cualquier workflow falla.

Los JSON están **sanitizados**: los secretos y datos del complejo son placeholders
`__ASI__` que `bootstrap.sh` reemplaza con los valores de `cliente.env` al importar.

## Instalación en un complejo nuevo

Resumen (el paso a paso completo está en [INSTALL.md](INSTALL.md)):

```bash
git clone <este-repo> && cd canchitas-infra
cp cliente.env.example cliente.env        # y completar
# copiar y completar los .env de postgres/, redis/, evolution/, n8n/
./bootstrap.sh
```

Después del script quedan los pasos manuales: deploy del backend/frontend,
credenciales en n8n, activar workflows y escanear el QR de WhatsApp.

## Actualizar los workflows de este repo

Si se editan los workflows en un n8n vivo, re-exportarlos y re-sanitizarlos:

```bash
docker exec n8n n8n export:workflow --all --output=/tmp/wf/ --separate
docker cp n8n:/tmp/wf/ .
# renombrar por nombre, y reemplazar secretos por los placeholders __ASI__
# (¡revisar con grep que no quede ningún secreto antes de commitear!)
```

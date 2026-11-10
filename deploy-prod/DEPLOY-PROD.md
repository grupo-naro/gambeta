# Deploy de producción — gambeteandopadelyfutbol.ar

Stack self-contained en el VPS `167.86.82.175`: Traefik v3.3 (Let's Encrypt) + Postgres 16 +
backend + frontend + reservas. Compose: [`docker-compose.prod.yml`](docker-compose.prod.yml).

Despliegue **tipo Vercel**: cada `git push` a `main` reconstruye y reinicia el stack solo, vía
un runner self-hosted de GitHub Actions instalado en el VPS
([`.github/workflows/deploy-prod.yml`](../.github/workflows/deploy-prod.yml)).

```
push a main ──▶ GitHub ──▶ runner en el VPS ──▶ guarda imágenes actuales como :previous
                                              └▶ git reset --hard origin/main + build      (falla → nada cambia)
                                              └▶ pg_dump a /home/deploy/backups/           (falla → nada cambia)
                                              └▶ prisma migrate deploy (contenedor aparte) (falla → nada cambia)
                                              └▶ recrea contenedores
                                              └▶ health check 90 s                        (falla → rollback a :previous)
```

**Regla: si el deploy falla, el sitio queda andando con la versión anterior.**

Migraciones: automáticas, las corre el workflow **antes** de recrear los contenedores. El
backend arranca con `node dist/index.js` (override `command:` en el compose), no migra solo.
Backups: un `pg_dump -Fc` antes de cada deploy en `/home/deploy/backups/` (se guardan 10).
Seed: **manual** e idempotente — no corre en cada deploy.

---

## Puesta a punto (una sola vez)

### 1. Clonar el repo en el VPS

```bash
# como usuario deploy
git clone https://github.com/grupo-naro/gambeta.git /home/deploy/gambeta
cd /home/deploy/gambeta && git checkout main
```

(Si ya está clonado, alcanza con `git fetch && git checkout main`.)

### 2. Crear `deploy-prod/.env`

Tiene secretos y está gitignoreado, así que vive solo en el VPS. Variables (ver
`docker-compose.prod.yml` para la lista exacta):

```
PG_USER=…            PG_PASSWORD=…
ACME_EMAIL=nahuelguerra56b@gmail.com
JWT_SECRET=…         (≥32 chars)
SERVICE_API_KEY=…    BUFFET_API_KEY=…
MP_CLIENT_ID=…       MP_CLIENT_SECRET=…       MP_ENCRYPTION_KEY=…   MP_WEBHOOK_SECRET=…
RESERVAS_PUBLIC_URL=https://reserva.gambeteandopadelyfutbol.ar
BACKEND_PUBLIC_URL=https://api.gambeteandopadelyfutbol.ar
PANEL_PUBLIC_URL=https://panel.gambeteandopadelyfutbol.ar
ADMIN_SEED_EMAIL=admin@gruponaro.com.ar
ADMIN_SEED_PASSWORD=…
```

`chmod 600 deploy-prod/.env`.

### 3. DNS (Cloudflare)

3 registros **A** → `167.86.82.175`, en **"DNS only" (nube gris)**, no proxeados:
`api`, `panel`, `reserva`. Proxeado rompe la emisión del cert (challenge TLS-ALPN-01).

### 4. Instalar el runner self-hosted

En GitHub: **repo → Settings → Actions → Runners → New self-hosted runner (Linux x64)**.
Copiar el token que muestra y, en el VPS como `deploy`:

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
# usar la versión que sugiere la página de GitHub
curl -o runner.tar.gz -L https://github.com/actions/runner/releases/download/v2.319.1/actions-runner-linux-x64-2.319.1.tar.gz
tar xzf runner.tar.gz
./config.sh --url https://github.com/grupo-naro/gambeta \
            --token <TOKEN_DE_GITHUB> \
            --labels gambeta-prod \
            --name gambeta-prod-vps --unattended
sudo ./svc.sh install deploy    # corre como usuario deploy (ya está en el grupo docker)
sudo ./svc.sh start
sudo ./svc.sh status
```

La label `gambeta-prod` es la que matchea el `runs-on` del workflow.

### 5. Primer deploy (manual)

```bash
cd /home/deploy/gambeta/deploy-prod
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f traefik   # mirar emisión de certs
```

### 6. Seed inicial

```bash
docker compose -f docker-compose.prod.yml exec backend node dist/seed.js
```

Crea el admin (`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`) + canchas y horarios de ejemplo.
Idempotente. **Ojo:** `npm run seed` no funciona en el contenedor (usa `tsx`, que es devDep y
se excluye con `--omit=dev`).

### 7. Mercado Pago

Apuntar el webhook (evento **Pagos**) a `https://api.gambeteandopadelyfutbol.ar/webhooks/mercadopago`. Cada link de pago ya lleva esa URL, pero si el webhook se carga también en el panel de Mercado Pago tiene que ser exactamente esa: sin `/mercadopago` da 404.

Si un cliente dice que "Mercado Pago le da error", mirar el log del backend: cada pago que MP rechaza queda como `webhook MP: pago no aprobado` con su `statusDetail` (por ejemplo `cc_rejected_high_risk` es el antifraude de MP). Si el sitio no pudo generar el link, queda `[pago] no se pudo crear la preferencia`.

### 8. WhatsApp (avisos de seña confirmada y recordatorio)

El sistema manda WhatsApp **solo para avisar** (no recibe ni responde mensajes):

- Al **confirmarse la seña** (Mercado Pago aprobado, o transferencia aprobada desde el panel): "Confirmamos tu seña ✅…".
- **A las 18:00 del día anterior** al turno: "Te recordamos tu turno…". No se manda a reservas canceladas, que esperan seña, que salen de un turno fijo, ni a las hechas después de esa hora.

Se usa Evolution API (WhatsApp Web). Hace falta un número de WhatsApp dedicado al complejo. Mientras no se configure, todo lo demás funciona igual y los avisos quedan apagados (el backend lo avisa en el log al arrancar).

1. En `deploy-prod/.env` agregar (la clave la inventás vos, larga y al azar):
   ```
   EVOLUTION_API_KEY=<clave-larga-al-azar>
   EVOLUTION_INSTANCE=gambeteando
   ```
2. Crear la base de Evolution (una sola vez) y levantar el servicio:
   ```bash
   cd ~/gambeta/deploy-prod
   docker compose up -d postgres
   docker exec gambeta-prod-postgres psql -U "$PG_USER" -d gambeta -c 'CREATE DATABASE evolution;'
   docker compose --profile whatsapp up -d evolution
   ```
3. Conectar el número (escaneando un QR). El panel de Evolution **no está público**: solo escucha en el localhost del VPS. Desde tu PC abrí un túnel SSH y entrá a `http://localhost:8082/manager`:
   ```bash
   ssh -L 8082:127.0.0.1:8082 deploy@<ip-del-vps>
   ```
   Con la clave `EVOLUTION_API_KEY` creá una instancia llamada igual que `EVOLUTION_INSTANCE` (`gambeteando`) y escaneá el QR desde el WhatsApp del número del complejo (Dispositivos vinculados). **No configures webhooks ni chatbots en la instancia**: tiene que quedar solo para enviar.
4. Reiniciar el backend para que tome la clave: `docker compose up -d backend`. En el log debe decir `job de recordatorios iniciado`.
5. Probar: aprobar una seña de prueba y confirmar que llega el mensaje.

---

## Día a día

- **Deployar**: `git push` a `main`. Seguir el run en la pestaña **Actions** del repo.
- **Deploy manual / forzar**: Actions → *Deploy prod (self-hosted)* → **Run workflow**, o en el VPS:
  ```bash
  cd /home/deploy/gambeta && git fetch && git reset --hard origin/main
  cd deploy-prod && docker compose -f docker-compose.prod.yml build
  docker compose -f docker-compose.prod.yml run --rm --no-deps -T backend npx prisma migrate deploy
  docker compose -f docker-compose.prod.yml up -d --no-build --remove-orphans
  ```
  Ojo: el backend ya **no** migra al arrancar; un `up -d --build` a secas se saltea las
  migraciones. Mejor usar *Run workflow*, que además hace backup y rollback automático.
- **Logs**: `docker compose -f docker-compose.prod.yml logs -f <servicio>`
- **Rollback**: automático si la versión nueva no pasa el health check. A mano:
  `git revert` + push (o `git push --force origin <commit-bueno>:main`).
- **Migración nueva**: se aplica sola al deployar, antes de recrear los contenedores.

### Si falla una migración

El run queda en rojo y el sitio sigue con la versión anterior, pero la migración queda
registrada como fallida en `_prisma_migrations` y **todo deploy siguiente va a fallar**
(P3009) hasta destrabarla:

1. Leer el error en el log del run (o en `_prisma_migrations.logs`).
2. Confirmar que no quedó aplicada a medias (Postgres corre el script de la migración en una
   transacción implícita salvo que tenga `BEGIN/COMMIT` propios, pero verificarlo igual).
3. Marcarla como revertida:
   ```bash
   cd /home/deploy/gambeta/deploy-prod
   docker compose -f docker-compose.prod.yml run --rm --no-deps -T backend \
     npx prisma migrate resolve --rolled-back <nombre_de_la_migracion>
   ```
4. Corregir la migración en el repo (si nunca se aplicó en ningún lado, se puede editar) y pushear.

### Restaurar un backup

```bash
docker exec -i gambeta-prod-postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d gambeta --clean --if-exists' \
  < /home/deploy/backups/pre-deploy-<fecha>-<commit>.dump
```

## Notas

- `up -d --build` reconstruye las 3 imágenes en cada deploy; el cache de capas de Docker hace
  que las que no cambiaron sean rápidas. Si molesta, se puede filtrar por `paths:` en el
  workflow más adelante.
- `reservas/` se volvió deployable en Docker con `output: "standalone"` en `next.config.ts` +
  `reservas/Dockerfile`. En este stack va al VPS, no a Vercel.
- El `.env` sobrevive a `git reset --hard` (está gitignoreado; `reset` no toca archivos
  ignorados ni untracked).

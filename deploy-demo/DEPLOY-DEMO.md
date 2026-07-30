# Deploy Demo — Gambeteando

Panel web de demo en `canchas.gruponaro.com.ar`. Stack **autocontenido**: trae su propio
Traefik con HTTPS (Let's Encrypt), Postgres, backend y frontend. Sin bot de WhatsApp.

## Requisitos en el VPS
- Docker + Docker Compose (plugin `docker compose`).
- Puertos **80** y **443** abiertos y libres (Traefik los usa; no debe haber otro Traefik/nginx
  ocupándolos).
- DNS: `canchas.gruponaro.com.ar` con un registro **A** apuntando a la IP pública del VPS.
  Let's Encrypt no emite el certificado hasta que el DNS resuelva a este servidor.

## Pasos
1. Copiar la carpeta del proyecto al VPS (o `git clone`).
2. Configurar variables:
   ```bash
   cd deploy-demo && cp .env.demo.example .env
   # editar .env: JWT_SECRET (>=32 chars), ACME_EMAIL, PG_PASSWORD, ADMIN_SEED_PASSWORD...
   ```
3. Levantar el stack (compila las imágenes de backend y frontend la primera vez):
   ```bash
   docker compose -f docker-compose.demo.yml up -d --build
   ```
   El backend corre `prisma migrate deploy` solo al arrancar, así que la base queda migrada.
4. Cargar los datos de demo (una vez):
   ```bash
   docker compose -f docker-compose.demo.yml exec backend node dist/seed-demo.js
   ```
5. Esperar ~1 min a que Traefik emita el certificado y abrir `https://canchas.gruponaro.com.ar`.

## Verificación
- Login muestra "Gambeteando" y el candado HTTPS es válido.
- Entrar al panel con el admin de demo (`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`): en ningún
  lado dice "Ortigoza".
- Calendario / Hoy / Caja / Clientes muestran datos ficticios.

## Notas
- El navegador solo habla con el frontend; el frontend llega al backend por la red interna
  (`http://backend:3000`). Backend y Postgres no están expuestos al público.
- Si el certificado no se emite, revisá que el DNS ya resuelva a este VPS y que el puerto 443
  esté accesible desde internet, y mirá `docker compose -f docker-compose.demo.yml logs traefik`.

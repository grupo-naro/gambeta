# Demo "Grupo Naro" — Diseño

**Fecha:** 2026-07-19
**Objetivo:** Preparar una versión demo del sistema de reservas de canchas para mostrar a
potenciales clientes, sin referencias a "Canchitas Ortigoza" y sin datos reales. La marca
visible pasa a ser **Grupo Naro**. Se despliega en un VPS propio bajo `canchas.gruponaro.com.ar`.

## Decisiones tomadas

- **Base:** carpeta `proyecto-canchas`. No se toca `ortigoza` (producción real).
- **Alcance del rename:** solo textos visibles al usuario. Identificadores internos
  (carpeta `canchitas-infra`, base de datos `canchitas`, proyectos docker, variables) quedan
  igual — nadie los ve y cambiarlos agrega riesgo sin beneficio para una demo.
- **Bot de WhatsApp:** apagado. La demo es solo el panel web. Evolution / n8n / bot no se despliegan.
- **Datos:** seed ficticio (canchas, reservas de la semana, clientes inventados). Nada real.
- **Despliegue:** VPS con Docker (frontend + backend + postgres). Dominio `canchas.gruponaro.com.ar`.

## 1. Rebranding visible

Reemplazar `Canchitas Ortigoza` → `Grupo Naro` en el frontend. Donde el diseño parte la marca
en dos líneas, se usa `Grupo` / `NARO`; donde va corrida, `Grupo Naro`. El resultado dice
"Grupo Naro" en todos los puntos.

| Archivo | Línea | Actual | Nuevo |
|---|---|---|---|
| `frontend/src/app/layout.tsx` | 19 | `title: "Canchitas Ortigoza"` | `title: "Grupo Naro"` |
| `frontend/src/app/login/page.tsx` | 32 | `<h1>Canchitas Ortigoza</h1>` | `<h1>Grupo Naro</h1>` |
| `frontend/src/app/login/page.tsx` | 39 | placeholder `vos@canchitas.com` | `vos@gruponaro.com.ar` |
| `frontend/src/app/login/page.tsx` | 53 | `Canchitas Ortigoza · Reservas` | `Grupo Naro · Reservas` |
| `frontend/src/components/app-shell.tsx` | 31-32 | `Canchitas` / `Ortigoza` | `Grupo` / `NARO` |
| `frontend/src/components/app-shell.tsx` | 58 | `Canchitas` | `Grupo Naro` |
| `frontend/src/components/mobile-nav.tsx` | 22 | `Canchitas` + `Ortigoza` | `Grupo` + `NARO` |

Verificación: `grep -rin "ortigo\|canchitas ortigoza" frontend/src` no debe devolver textos visibles.

## 2. Datos internos — sin cambios

Se documenta explícitamente que quedan como están (no es olvido): `canchitas-infra/`, DB
`canchitas`, `ADMIN_SEED_EMAIL`, nombres de servicios docker. No aparecen en la UI.

## 3. Seed de demo

Nuevo script `backend/src/seed-demo.ts` (no reemplaza `seed.ts`; es aparte para no arriesgar
producción). Genera:

- **Admin demo:** email desde env `ADMIN_SEED_EMAIL` (ej. `admin@gruponaro.com.ar`), password desde env.
- **Canchas:** 3–4 (fútbol 5, fútbol 7, pádel), con horarios 16:00–23:00 los 7 días.
- **Clientes:** ~10 ficticios, nombres inventados + teléfonos falsos con prefijo de test
  (ej. `549110000xxxx`), claramente no reales.
- **Reservas:** ~15–20 repartidas en la semana actual (algunas señadas, algunas pagadas,
  algún turno fijo) para que calendario, caja y "hoy" se vean poblados.
- **Config:** precios y seña por defecto; `adminWhatsapp` con número de test.

Idempotente y **destinado solo a base de demo** (incluye un guard/aviso para no correrse sobre prod).

## 4. Despliegue en VPS

- Compose reducido: `frontend`, `backend`, `postgres` (reusar `backend/docker-compose.vm.yml`
  como base, quitando/omitendo servicios del bot).
- Traefik: host `canchas.gruponaro.com.ar` (frontend) y, si aplica, `api.canchas.gruponaro.com.ar`
  o path `/api` (backend). Un único lugar de configuración del dominio.
- Variables de entorno de demo en un `.env` de ejemplo dedicado.
- `DEPLOY-DEMO.md`: pasos concretos (clonar/copiar, setear `.env`, `docker compose up`, correr
  `seed-demo`, verificar HTTPS).

## Fuera de alcance (YAGNI)

- Bot de WhatsApp / Evolution / n8n.
- Rename de identificadores internos.
- Cambios de diseño más allá del texto de marca.
- CI/CD; el deploy de demo es manual.

## Criterios de éxito

1. En `canchas.gruponaro.com.ar` se ve el login con "Grupo Naro" y HTTPS válido.
2. Login con admin de demo entra al panel; en ningún lado aparece "Ortigoza".
3. Calendario / hoy / caja / clientes muestran datos ficticios coherentes.
4. `ortigoza/` no fue modificada.

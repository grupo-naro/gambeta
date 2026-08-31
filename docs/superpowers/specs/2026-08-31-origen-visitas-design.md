# Origen de visitas al sitio de reservas

**Fecha:** 2026-08-31
**Estado:** diseño aprobado, pendiente de plan de implementación

## Objetivo

Saber por dónde llega la gente al sitio público de reservas: el link que manda el bot de
WhatsApp, cada uno de los QR impresos en el complejo, las redes y la landing. La pregunta
que se quiere contestar es **cuánta gente entra por cada canal**, no cuánta termina
reservando.

La atribución de la reserva se guarda igual, porque cuesta dos columnas y ese histórico no
se recupera después, pero no se muestra en el panel en esta versión.

## Decisiones

| Decisión | Alternativas descartadas |
|---|---|
| Tabla propia en Postgres + pantalla en el panel admin | Umami/Plausible/GA4: los datos quedarían fuera de la DB y el admin tendría que entrar a otra web |
| Etiqueta libre en el link + tipo fijo que la agrupa | Enum cerrado (todos los QR en la misma bolsa); CRUD de campañas (una pantalla más); UTMs (links largos e ilegibles) |
| Una fila por sesión, con visitante de largo plazo | Contador agregado por día (pierde hora, referer y únicos, y no se recupera) |
| Links de entrada `/r/<etiqueta>` | `?o=<etiqueta>`: ensucia la URL que después la gente comparte |
| El registro lo dispara el navegador, no el servidor | Middleware o registro en el redirect: **WhatsApp hace un fetch de la página para armar la previsualización del link**, e inflaría justo el canal que más se quiere medir |
| El bloque va en `/dashboard` | Página propia en el menú: se puede mudar después si el dato resulta útil |

## Modelo de datos

### Cookies (sitio de reservas, first-party, sin datos personales)

| Cookie | Vida | Para qué |
|---|---|---|
| `gb_vid` | 1 año | Id de visitante. Permite contar personas distintas. |
| `gb_sid` | 30 min, se renueva con actividad | Id de sesión. **Una sesión es una visita**: el que recarga tres veces cuenta una. |
| `gb_org` | 30 días | Origen. Valor `<etiqueta>.<epochMs>`. |

Todas `httpOnly`, `sameSite=lax`, `secure` en producción. No se guarda IP ni user-agent.

`gb_org` se lee de dos formas distintas, y esa diferencia es deliberada:

- **Para contar la visita:** la etiqueta vale sólo si la cookie se escribió hace menos de
  5 minutos, o sea en esta llegada. Si no, la visita es `DIRECTO`. Sin esta regla, alguien
  que entró una vez por el QR y después escribe la URL a mano seguiría contando como QR
  durante un mes.
- **Para atribuir la reserva:** la etiqueta vale siempre dentro de los 30 días
  (*last-touch*).

### Prisma

```prisma
/// Canal por el que llegó la visita. La etiqueta del link es libre (`qr-entrada`, `ig-bio`);
/// el tipo la agrupa para que el panel muestre un resumen estable aunque los QR cambien.
enum TipoOrigen {
  WHATSAPP
  QR
  REDES
  LANDING
  DIRECTO
  OTRO
}

model Visita {
  id           String     @id @default(cuid())
  /// Etiqueta cruda del link, tal como vino en /r/<etiqueta>. `null` en la visita directa.
  etiqueta     String?
  tipo         TipoOrigen
  /// Una fila por sesión. `@unique` hace idempotente el registro: si el navegador manda el
  /// beacon dos veces (remount, doble pestaña), la segunda no duplica.
  sesionId     String     @unique
  visitanteId  String
  referer      String?
  creadoEn     DateTime   @default(now()) @db.Timestamptz(3)

  @@index([creadoEn])
  @@index([tipo, creadoEn])
  @@index([etiqueta, creadoEn])
}
```

En `Reserva`, dos columnas nullable con el mismo criterio que ya usa `metodoSena` — sin
default, porque las reservas que carga el panel y las anteriores a este cambio no vinieron
de ningún link y `null` es la lectura honesta:

```prisma
  origenEtiqueta String?
  origenTipo     TipoOrigen?
```

Migración: `npx prisma migrate dev --name add_visita_origen`.

### Clasificación de etiquetas

En `visita.service.ts`, mirando el **primer segmento** de la etiqueta — lo que va antes del
primer guion. Así `whatsapp`, `whatsapp-bot` y `wsp-bot` caen todas en el mismo tipo, y no
hace falta que cada etiqueta lleve guion:

| Primer segmento | Tipo |
|---|---|
| `whatsapp`, `wsp` | `WHATSAPP` |
| `qr` | `QR` |
| `ig`, `fb`, `tt`, `yt`, `redes` | `REDES` |
| `landing`, `web` | `LANDING` |
| (sin etiqueta) | `DIRECTO` |
| cualquier otro | `OTRO` |

**Etiquetas iniciales: `landing`, `ig-bio`, `whatsapp`.** Los QR quedan soportados por el
tipo `QR` pero todavía no se imprime ninguno: el día que se impriman, `qr-entrada` funciona
sin tocar código ni base. Eso es exactamente lo que compra este diseño.

## Backend

Respetando el layering del proyecto (`routes → services → repositories → prisma`):

| Archivo | Qué hace |
|---|---|
| `repositories/visita.repo.ts` | El único `INSERT`. Idempotente por `sesionId` (`createMany` con `skipDuplicates`). |
| `services/visita.service.ts` | Clasifica la etiqueta en `TipoOrigen` y llama al repo. Exporta el clasificador para que `reserva.service.ts` lo use al completar `origenTipo`. |
| `validators/visita.schema.ts` | zod: `etiqueta` opcional `^[a-z0-9-]{1,40}$`, `sesionId` y `visitanteId` strings acotados, `referer` opcional máx. 500. |
| `routes/visita.routes.ts` | `POST /visitas` con `authAny` — lo llama el server de `reservas/` con `x-api-key`. Sin `auditService.log`: no es una acción de admin. |
| `services/analytics.service.ts` | Se le suma `origenes(desde, hasta)`. |
| `routes/analytics.routes.ts` | `GET /analytics/origenes`, que hereda `authJwt + requireRole('ADMIN')` del router y usa el helper `rango(req)` que ya existe. Los `COUNT` crudos pasan por `serializeBigInt`. |

`reserva.service.ts` acepta un `origenEtiqueta` opcional al crear y completa `origenTipo` con
el clasificador.

### Contratos

```
POST /visitas
  body: { etiqueta?: string | null, sesionId: string, visitanteId: string, referer?: string | null }
  204 No Content, idempotente

GET /analytics/origenes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  { total, unicos,
    porTipo:     [{ tipo, visitas, unicos }],
    porEtiqueta: [{ etiqueta, tipo, visitas, unicos }] }
```

`unicos` es `COUNT(DISTINCT "visitanteId")`. El `generalLimiter` global ya cubre el flood
sobre `POST /visitas`.

## Sitio de reservas

| Archivo | Qué hace |
|---|---|
| `src/lib/origen.ts` | Nombres de cookie y lógica pura de lectura (incluida la regla de los 5 minutos). Aislado para poder testearlo. |
| `src/app/r/[etiqueta]/route.ts` | `GET`. Valida `^[a-z0-9-]{1,40}$`, setea `gb_org`, responde **302 a `/`**. No escribe en la base. Etiqueta inválida: redirige igual, sin cookie. |
| `src/app/api/visita/route.ts` | `POST`, el único que escribe. Si `gb_sid` está vigente, le renueva los 30 min y devuelve 204 sin registrar. Si no, genera `sesionId`, asegura `gb_vid`, resuelve la etiqueta con la regla de frescura y llama a `POST /visitas` vía `apiReservas`. |
| `src/components/registro-visita.tsx` | Cliente. Un `useEffect` que dispara el `fetch` una vez con `document.referrer` y renderiza `null`. Falla en silencio: nunca puede romper una reserva. |
| `src/app/page.tsx` | Monta `<RegistroVisita />`. Ya es `force-dynamic`. |
| `src/lib/actions.ts` | `crearReserva` lee `gb_org` y agrega `origenEtiqueta` al body del `POST /reservas`. |

El redirect de `/reservar` en `next.config.ts` es un match exacto, así que `/r/*` no lo toca.

Por qué la previsualización de WhatsApp no ensucia los números: pide `/r/<etiqueta>`, recibe
un 302 y un `Set-Cookie` que descarta, sigue hasta `/`, y ahí no ejecuta JavaScript. El
beacon nunca corre y no se registra ninguna visita.

## Panel

En `frontend/src/app/(panel)/dashboard/page.tsx`, dentro del `Promise.all` que ya existe,
envuelto en el `safe()` que ya existe, con el `PeriodoSelector` que ya existe:

- Dos `MetricCard`: **Visitas del período** y **Visitantes únicos**.
- `components/dashboard/origenes-chart.tsx` — barras por tipo (recharts, como `HorariosChart`).
- `components/dashboard/origenes-tabla.tsx` — detalle por etiqueta: etiqueta, tipo, visitas, únicos.
- Tipos nuevos en `src/lib/types.ts`.

La columna "cuántos reservaron" no va en esta versión. El dato se guarda desde el día uno;
mostrarlo es un cambio chico y posterior.

## Tests

Con TDD: primero el test, después el código.

- `backend/tests/unit/visita.service.test.ts` — el clasificador de etiquetas, caso por caso,
  incluido el `null` → `DIRECTO` y el desconocido → `OTRO`. No necesita Docker.
- `backend/tests/integration/visita.test.ts` — `POST /visitas` idempotente por `sesionId`;
  `GET /analytics/origenes` agrega bien por tipo y por etiqueta, cuenta únicos, y respeta el
  rango de fechas.
- `backend/tests/helpers/db.ts` — sumar `Visita` a `resetTables()`, si no las integraciones
  se ensucian entre archivos.
- `reservas/` hoy no tiene setup de tests. Se le copia la config de vitest del `frontend/`
  para cubrir `src/lib/origen.ts`, que es donde vive la regla de los 5 minutos.

## Fuera de alcance

- Mostrar conversión visita → reserva en el panel (el dato se guarda, no se muestra).
- CRUD de campañas y generación de QR desde el panel.
- Analytics de terceros.
- Página propia de estadísticas en el menú.

## Notas operativas

- El sitio de reservas se despliega en Vercel y el backend en el VPS. `POST /visitas` es
  server-a-server con `SERVICE_API_KEY`, que ya está configurada: no hay variables nuevas.
- La cuenta de visitas arranca en cero el día del deploy. No hay histórico previo.
- Los links a usar desde el día uno:
  - `https://reserva.gambeteandopadelyfutbol.ar/r/whatsapp` — el que manda el bot en el primer mensaje
  - `https://reserva.gambeteandopadelyfutbol.ar/r/ig-bio` — bio de Instagram
  - `https://reserva.gambeteandopadelyfutbol.ar/r/landing` — botón de la landing
- Cuando se impriman QR, la etiqueta hay que fijarla **antes** de mandar a imprimir:
  reimprimir un QR es lo único caro de este diseño.

# Landing pública de reservas (Gambeteando) — Diseño

**Fecha:** 2026-07-31
**Estado:** Aprobado

## Objetivo

Rehacer la página principal de `reservas/` (`/`) como **embudo hacia la reserva online**.

El cliente ya tiene una landing (fuera de este repo) con la estructura correcta pero tres
problemas concretos que este rediseño corrige:

1. Su CTA principal dice **"PRÓXIMAMENTE RESERVÁ ONLINE"**. El sistema de reservas ya está
   construido y funcionando en `/reservar`: el CTA pasa a ser un link vivo.
2. Los cuatro servicios (Pádel, Fútbol, Torneos, Bar Urban Food) son **cuatro cards idénticas**.
   Ninguna manda, y dos de ellas no son reservables.
3. Las **redes sociales están a media página**, inmediatamente después de los CTAs, compitiendo
   por el click con la reserva.

Además, la landing actual de este repo (`reservas/src/app/page.tsx`, 16 líneas en `bg-emerald-50`)
**no comparte identidad visual con el flujo de reserva al que lleva**, que es oscuro con acento
lima.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Objetivo | Embudo a la reserva online | Todo lo demás es soporte. |
| Hero | **Estático**, sin disponibilidad real | Carga instantánea, cero acoplamiento al backend, no se cae si la API se cae. `/` sigue prerenderizada. |
| Fotos | No hay | Diseño tipográfico: color, escala y logo. |
| Datos de contacto | Constante en el código (`src/lib/negocio.ts`) | Datos estables; evita 5 variables de entorno que se olvidan en un entorno nuevo. |
| Estructura | Hero → valor → cierre | Estructura de conversión conocida, sin subordinar la marca ni tocar código que funciona. |

Enfoques descartados:

- **Utilitario** (CTA arriba de todo, sin secciones de valor): subordina la marca a la conversión
  cuando la marca es el argumento de venta de un predio deportivo.
- **Hero = selector de deporte** (dos tarjetas que entran a `/reservar` con el deporte elegido):
  ahorra un tap pero exige agregar `useSearchParams` a `pantalla-reserva.tsx`, es decir meter
  riesgo en el flujo de reserva que hoy anda. Se puede sumar más adelante sin rehacer nada.

## Contexto (estado actual)

- **`reservas/` es el sitio público**, desplegado en Vercel. `src/lib/api.ts` habla con el backend
  server-side con `x-api-key`; esa clave nunca llega al browser.
- **El flujo de reserva ya define la identidad visual.** `src/components/pantalla-reserva.tsx` usa:
  `bg-neutral-950` (fondo), `bg-neutral-900` + `border-neutral-800` (cards), `text-lime-400`
  (acento de texto), `bg-lime-500` + `text-black` (botones). La landing hereda exactamente esto.
- **`src/app/reservar/page.tsx`** ya es `bg-neutral-950 text-neutral-100`.
- **El logo existe**: `reservas/public/logo.png`, PNG RGBA (con transparencia), 1695×1877, ~500 KB.
- **`getGrilla(deporte, fecha)`** existe en `src/lib/actions.ts` — se decidió deliberadamente
  **no** usarlo en la landing (ver tabla de decisiones).
- **`deporte` es `useState` local** en `pantalla-reserva.tsx:21`, sin `useSearchParams`. Por eso
  preseleccionar deporte desde la landing sería una modificación del flujo de reserva.
- **`reservas/` no tiene setup de tests** (documentado en `CLAUDE.md`).
- **Next.js 16**: leer la guía correspondiente en `node_modules/next/dist/docs/` antes de escribir
  código específico de Next (ver `reservas/AGENTS.md`).

### Dos defectos preexistentes que este trabajo corrige

1. **La tipografía no está aplicada.** `src/app/globals.css:25` declara
   `body { font-family: Arial, Helvetica, sans-serif; }`, que pisa las variables Geist que
   `layout.tsx` carga. Hoy el sitio entero renderiza en Arial.
2. **La landing no matchea el flujo de reserva** (`emerald-50` claro contra `neutral-950` oscuro).

## Estructura de la página

### 1. Hero — pantalla completa, fondo `neutral-950`

- Logo vía `next/image`.
- Titular con tratamiento bicolor, palabras resaltadas en lima:
  "MÁS QUE UN **PREDIO**, UNA EXPERIENCIA **DEPORTIVA**".
- Bajada: canchas de pádel y fútbol en General Rodríguez, torneos y Bar Urban Food.
- CTA primario **"Reservar ahora"** → `/reservar` (`bg-lime-500 text-black`).
- CTA secundario **"Consultas por WhatsApp"** → `wa.me` (outline).
- Micro-línea de confianza: "Reservá online en menos de un minuto." Reemplaza al
  "PRÓXIMAMENTE" muerto de la landing actual.

### 2. Servicios — con jerarquía, no cuatro cajas iguales

Título: "Todo lo que vas a encontrar" (conservado de la landing actual).

- **Dos cards grandes — Pádel y Fútbol.** Es lo reservable. Cada una linkea a `/reservar`.
- **Dos cards chicas — Torneos y Bar Urban Food.** Es el diferencial, no es reservable online.
  Torneos deriva a WhatsApp; Bar Urban Food es informativa, sin CTA.

### 3. Cómo reservar — sección nueva

Tres pasos: *Elegí deporte y día → Elegí horario → Confirmá con la seña*.

No existe en la landing actual. El freno para reservar online en un predio es no saber qué pasa
después, sobre todo con una seña de por medio. Cierra repitiendo el CTA a `/reservar`.

### 4. Ubicación y horarios

- Dirección + botón "Cómo llegar" → Google Maps.
- Horarios: lunes a lunes, 9 a 24 hs.
- Contacto por WhatsApp.

Van abajo, como cierre, en vez de competir con el botón de reserva.

### 5. Footer

Logo chico, Instagram y TikTok, línea "GAMBETEANDO · Pádel y Fútbol". **Las redes bajan acá a
propósito** (ver problema 3 del Objetivo).

## Arquitectura

```
src/lib/negocio.ts                        (nuevo)     datos del predio, fuente única
src/app/page.tsx                          (reescrito) compone las 5 secciones
src/components/landing/hero.tsx           (nuevo)
src/components/landing/servicios.tsx      (nuevo)
src/components/landing/como-reservar.tsx  (nuevo)
src/components/landing/ubicacion.tsx      (nuevo)
src/components/landing/footer.tsx         (nuevo)
src/app/globals.css                       (editado)   corrige el override de Arial
src/app/layout.tsx                        (editado)   suma la fuente display
```

Subcarpeta `landing/` porque el panel admin ya agrupa por dominio (`src/components/<dominio>/`),
y cinco archivos sueltos ensuciarían el `src/components/` plano de `reservas/`.

**Todos son server components. Ninguno lleva `'use client'`.** Es markup estático con links; la
barra sticky de mobile es CSS puro (`sticky` + `md:hidden`). La landing no envía JS propio, que es
la contrapartida de haberla dejado estática.

### `src/lib/negocio.ts`

Objeto exportado con: WhatsApp (número y URL `wa.me` derivada), Instagram, TikTok, dirección,
link de Google Maps, horarios y nombre del negocio. Cada sección importa lo que necesita.

**Los valores reales están pendientes** (ver Abiertos). Hasta que lleguen van como placeholder
explícito y evidente en la UI, **nunca inventados** — un número de WhatsApp o un handle de
Instagram falsos son peores que un hueco visible.

## Sistema visual

Heredado de `pantalla-reserva.tsx`, no inventado:

| Rol | Token |
|---|---|
| Fondo | `bg-neutral-950` |
| Cards | `bg-neutral-900` + `border-neutral-800` |
| Texto | `text-neutral-100` / `text-neutral-400` (secundario) |
| Acento de texto | `text-lime-400` |
| Botón primario | `bg-lime-500` + `text-black` |

Resultado: la landing y el flujo de reserva se leen como el mismo producto, que hoy no pasa.

**Tipografía.** Se corrige el override de Arial en `globals.css` y se carga **Anton** vía
`next/font/google` (variable `--font-display`), aplicada **solo a titulares**; Geist queda para el
cuerpo. Anton es la condensada pesada de Google Fonts más cercana al look de referencia, que Geist
no alcanza. Un solo peso (400) y solo subset `latin`, para no inflar el LCP.

**Logo.** `next/image` con `priority` y `width`/`height` explícitos, para que Next lo sirva
redimensionado en WebP/AVIF. Servido crudo serían ~500 KB en el LCP.

**Responsive.** Mobile-first, una columna; la grilla de servicios pasa a dos columnas en `sm`.
Barra sticky con "Reservar" solo en mobile (`md:hidden`) — en desktop el CTA del hero queda visible.

## Manejo de errores

La página es estática y sin fetch: no hay estados de carga, error ni vacío que manejar. El único
riesgo de runtime sería un dato faltante en `negocio.ts`, cubierto por tipado y placeholders.

## Verificación

`reservas/` no tiene setup de tests y **no se va a crear uno para esto**: son componentes de
presentación sin lógica, donde un test de render afirmaría poco y costaría mantenimiento. La
verificación es:

1. `pnpm build` — pasa.
2. **`/` sigue apareciendo como `○` (estática)** en el output del build. Es la decisión central del
   diseño; se chequea, no se asume.
3. `pnpm lint` — **sin errores nuevos**. Baseline actual de `reservas/`: **1 error preexistente**
   (`react-hooks/set-state-in-effect` en `pantalla-reserva.tsx:36`), ajeno a este trabajo y fuera
   de alcance. El criterio es que el conteo no suba de 1, no que dé cero.
4. Revisión visual en mobile y desktop, incluida la barra sticky.

## Abiertos

Datos reales pendientes del cliente, hasta entonces placeholder visible en `negocio.ts`:

- Número de WhatsApp
- URL de Instagram y de TikTok
- Dirección exacta y link de Google Maps

## Fuera de alcance

- Preseleccionar deporte desde la landing (exigiría tocar `pantalla-reserva.tsx`).
- Mostrar disponibilidad real en la landing.
- Fotos del predio.
- Cambios en el flujo `/reservar`.

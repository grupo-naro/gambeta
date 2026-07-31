# Landing pública de reservas (Gambeteando) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la página principal de `reservas/` por una landing estática que funcione como embudo hacia `/reservar`.

**Architecture:** Cinco secciones server-component compuestas por `src/app/page.tsx`, sin `'use client'` y sin fetch: la página queda prerenderizada. Los datos del predio viven en una constante única (`src/lib/negocio.ts`). El sistema visual se hereda de `src/components/pantalla-reserva.tsx` (oscuro + lima) para que la landing y el flujo de reserva se lean como el mismo producto.

**Tech Stack:** Next.js 16.2.12 (App Router), React server components, Tailwind CSS v4, `next/font/google`, `next/image`, TypeScript. Gestor de paquetes: **pnpm**.

**Spec:** `docs/superpowers/specs/2026-07-31-landing-reservas-design.md`

## Global Constraints

- **Idioma:** todo el código, comentarios, copy y nombres de variables en **español**. No traducir `cancha`, `seña`, `turno`, `predio`.
- **Next.js 16 no es el Next que conocés.** Antes de escribir código específico de Next, leer la guía correspondiente en `reservas/node_modules/next/dist/docs/`. Ver `reservas/AGENTS.md`.
- **Ningún componente de la landing lleva `'use client'`.** Es markup estático con links; la barra de CTA mobile es CSS puro. Si algo parece necesitar cliente, es señal de que se está saliendo del diseño.
- **`/` debe seguir prerenderizada.** En la salida de `pnpm build` tiene que aparecer como `○` (Static). Es la decisión central del spec: se chequea en cada tarea, no se asume.
- **Nunca inventar datos de contacto.** WhatsApp, Instagram, TikTok y el link de Maps están **pendientes del cliente**. Van como string vacío en `negocio.ts` y la UI degrada de forma visible y prolija. Un número falso en producción es peor que un hueco.
- **Baseline de lint:** `reservas/` tiene **1 error preexistente** (`react-hooks/set-state-in-effect` en `src/components/pantalla-reserva.tsx:36`), ajeno a este trabajo y fuera de alcance. El criterio es que el conteo **no suba de 1**, no que dé cero.
- **Paleta (heredada, no inventar tonos):** fondo `neutral-950`; cards `neutral-900` con borde `neutral-800`; texto `neutral-100`, secundario `neutral-400`; acento de texto `lime-400`; botón primario `bg-lime-500` + `text-black`.
- **Comandos:** siempre desde `reservas/`. `pnpm build`, `pnpm lint`, `pnpm dev`.

## Restricción de contraste del logo (leer antes de la Task 3)

`public/logo.png` es RGBA 1695×1877 con fondo transparente. El isotipo (jugador, pelota, paleta) es verde y se ve bien sobre oscuro, **pero el wordmark "GAMBETEANDO" y la bajada "PÁDEL Y FÚTBOL" son gris carbón oscuro**. Sobre `neutral-950` prácticamente desaparecen.

Por eso el logo va montado sobre una **tarjeta blanca redondeada**, que es exactamente lo que hace la landing actual del cliente. No es decoración: es lo que hace legible la marca. No poner el PNG suelto sobre el fondo negro.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/negocio.ts` (nuevo) | Datos del predio + helpers de URL. Fuente única. |
| `src/app/globals.css` (modificar) | Corrige el override de Arial; registra el token `--font-display`. |
| `src/app/layout.tsx` (modificar) | Carga Anton; metadata de la landing. |
| `src/components/landing/boton-reservar.tsx` (nuevo) | CTA primario a `/reservar`. 3 consumidores. |
| `src/components/landing/boton-whatsapp.tsx` (nuevo) | CTA de WhatsApp con degradación si falta el número. 3 consumidores. |
| `src/components/landing/hero.tsx` (nuevo) | Sección 1. |
| `src/components/landing/servicios.tsx` (nuevo) | Sección 2. |
| `src/components/landing/como-reservar.tsx` (nuevo) | Sección 3. |
| `src/components/landing/ubicacion.tsx` (nuevo) | Sección 4. |
| `src/components/landing/pie.tsx` (nuevo) | Sección 5 + barra CTA mobile. |
| `src/app/page.tsx` (reescribir) | Compone las secciones. |

**Nota sobre `boton-whatsapp.tsx`:** el spec listaba 5 componentes; este es un sexto, agregado a propósito. El manejo del número ausente aparece en hero, servicios y ubicación; centralizarlo evita repetir la misma condición tres veces y que se olvide en una.

## Nota sobre verificación

`reservas/` **no tiene setup de tests** y el spec decidió no crear uno: estas son piezas de presentación sin lógica, donde un test de render afirmaría poco y costaría mantenimiento. Por eso las tareas **no siguen el ciclo test-first**. El ciclo de cada tarea es:

1. `pnpm build` — pasa, y `/` figura como `○`.
2. `pnpm lint` — no sube de 1 error.
3. Chequeo visual en `pnpm dev` (mobile 375px y desktop).
4. Commit.

La única pieza con lógica real es `whatsappUrl()` en la Task 1, y ahí sí hay una verificación explícita de comportamiento.

---

### Task 1: Datos del predio (`negocio.ts`)

**Files:**
- Create: `reservas/src/lib/negocio.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `negocio` — objeto (sin `as const`) con `nombre`, `rubro`, `whatsapp.numero`, `whatsapp.mensaje`, `direccion.{calle,localidad,provincia,mapsUrl}`, `horarios.resumen`, `redes.{instagram,tiktok}`.
  - `whatsappUrl(mensaje?: string): string | null` — `null` si `negocio.whatsapp.numero` está vacío.
  - `direccionCompleta(): string` — partes no vacías unidas por `", "`.

- [ ] **Step 1: Crear el archivo**

```ts
// Datos del predio. Fuente única para toda la landing.
//
// Los campos vacíos están PENDIENTES del cliente. Se dejan vacíos a propósito:
// la UI degrada de forma visible cuando faltan. NO inventar números ni handles.

// Sin `as const` a propósito: con él, los campos pendientes se tiparían como el
// literal '' y TypeScript estrecharía los ternarios de la UI a `never`. Acá
// queremos `string`, porque estos valores van a cambiar.
export const negocio = {
  nombre: 'Gambeteando',
  rubro: 'Pádel y Fútbol',

  whatsapp: {
    /** PENDIENTE. Formato internacional, sin "+" ni espacios. Ej: '5492371234567'. */
    numero: '',
    mensaje: '¡Hola! Quiero hacer una consulta sobre las canchas.',
  },

  direccion: {
    /** PENDIENTE: calle y altura. */
    calle: '',
    localidad: 'General Rodríguez',
    provincia: 'Buenos Aires',
    /** PENDIENTE: link de Google Maps. */
    mapsUrl: '',
  },

  horarios: {
    resumen: 'Lunes a lunes, de 9 a 24 hs',
  },

  redes: {
    /** PENDIENTE: URL completa del perfil. */
    instagram: '',
    /** PENDIENTE: URL completa del perfil. */
    tiktok: '',
  },
};

/**
 * URL de wa.me con el mensaje precargado.
 * Devuelve `null` si todavía no se cargó el número, para que la UI muestre
 * un estado honesto en vez de un link roto.
 */
export function whatsappUrl(mensaje?: string): string | null {
  if (!negocio.whatsapp.numero) return null;
  const texto = encodeURIComponent(mensaje ?? negocio.whatsapp.mensaje);
  return `https://wa.me/${negocio.whatsapp.numero}?text=${texto}`;
}

/** Dirección en una línea, sin comas colgando cuando falta la calle. */
export function direccionCompleta(): string {
  return [negocio.direccion.calle, negocio.direccion.localidad, negocio.direccion.provincia]
    .filter(Boolean)
    .join(', ');
}
```

- [ ] **Step 2: Verificar tipos**

`reservas/` **no tiene `tsx` instalado** (sus deps son next, react, tailwind, typescript y eslint), así que no se puede ejecutar el módulo suelto. La verificación acá es de tipos:

```bash
pnpm exec tsc --noEmit
```

Esperado: sin errores.

El **comportamiento** de los dos helpers se verifica de forma observable más adelante, sin tooling extra:
- `whatsappUrl()` devolviendo `null` → el botón de WhatsApp aparece atenuado y no clickeable (Task 4, Step 4).
- `direccionCompleta()` filtrando la calle vacía → la dirección se lee `General Rodríguez, Buenos Aires`, **sin coma inicial** (Task 7, Step 4).

- [ ] **Step 3: Verificar que compila**

```bash
pnpm build
```

Esperado: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add reservas/src/lib/negocio.ts
git commit -m "feat(reservas): datos del predio en una constante unica"
```

---

### Task 2: Tipografía y base oscura

Corrige el defecto preexistente que hace que todo el sitio renderice en Arial, y suma la display para titulares.

**Files:**
- Modify: `reservas/src/app/globals.css`
- Modify: `reservas/src/app/layout.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: utilidad Tailwind `font-display` (Anton) disponible en todo el sitio; `body` con Geist aplicado de verdad; fondo base oscuro.

- [ ] **Step 1: Reescribir `globals.css`**

Reemplazar el contenido completo por:

```css
@import "tailwindcss";

/* El sitio público es oscuro de punta a punta: /reservar ya fija bg-neutral-950.
   La base también, para que no aparezcan franjas blancas detrás del contenido. */
:root {
  --background: #0a0a0a;
  --foreground: #ededed;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-display: var(--font-anton);
}

body {
  background: var(--background);
  color: var(--foreground);
  /* Antes acá había `Arial, Helvetica, sans-serif`, que pisaba las variables
     de next/font y hacía que el sitio entero renderizara en Arial. */
  font-family: var(--font-sans), system-ui, sans-serif;
}
```

Dos cambios respecto del original: se elimina el bloque `@media (prefers-color-scheme: dark)` (la base ya es oscura siempre) y se corrige el `font-family` del `body`.

- [ ] **Step 2: Reescribir `layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono, Anton } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Anton no es una fuente variable: `weight` es obligatorio y solo existe el 400.
const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gambeteando — Reservá tu cancha",
  description:
    "Canchas de pádel y fútbol en General Rodríguez. Reservá online en minutos, sin llamados.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Verificar build y lint**

```bash
pnpm build
pnpm lint
```

Esperado: build exitoso; lint con **1** error (el preexistente de `pantalla-reserva.tsx`), ni uno más.

- [ ] **Step 4: Verificar visualmente que la fuente cambió**

```bash
pnpm dev
```

Abrir `http://localhost:3000/reservar`. El texto ya **no** debe verse en Arial (Geist tiene la `a` de doble piso y terminaciones más rectas). En DevTools, `getComputedStyle(document.body).fontFamily` debe contener `Geist`, no `Arial`.

- [ ] **Step 5: Commit**

```bash
git add reservas/src/app/globals.css reservas/src/app/layout.tsx
git commit -m "fix(reservas): aplicar Geist y sumar Anton para titulares

El body declaraba Arial y pisaba las variables de next/font, con lo que
el sitio entero renderizaba en Arial."
```

---

### Task 3: Botones de CTA reutilizables

Los dos CTAs de la landing viven acá. Cada uno aparece en tres secciones: centralizarlos evita
repetir las clases tres veces y que el estilo se desincronice.

**Files:**
- Create: `reservas/src/components/landing/boton-reservar.tsx`
- Create: `reservas/src/components/landing/boton-whatsapp.tsx`

**Interfaces:**
- Consumes: `whatsappUrl` de `@/lib/negocio` (Task 1).
- Produces:
  - `BotonReservar({ children?: React.ReactNode; tamano?: 'normal' | 'ancho'; className?: string })` — server component, siempre linkea a `/reservar`.
  - `BotonWhatsapp({ mensaje?: string; children?: React.ReactNode; tamano?: 'normal' | 'chico'; className?: string })` — server component. Si `whatsappUrl()` da `null`, renderiza un `<span>` no interactivo con el mismo aspecto atenuado en vez de un `<a>` roto.

- [ ] **Step 1: Crear `boton-reservar.tsx`**

```tsx
import Link from 'next/link';

const BASE =
  'inline-flex items-center justify-center rounded-full bg-lime-500 font-bold text-black transition hover:bg-lime-400';

// Mismo criterio que en BotonWhatsapp: el tamaño va por prop, no por className.
const TAMANOS = {
  normal: 'px-8 py-3 text-base',
  ancho: 'w-full px-6 py-3 text-base',
};

/** CTA primario de la landing. Único lugar donde vive el estilo del botón lima. */
export function BotonReservar({
  children = 'Reservar ahora',
  tamano = 'normal',
  className = '',
}: {
  children?: React.ReactNode;
  tamano?: keyof typeof TAMANOS;
  className?: string;
}) {
  return (
    <Link href="/reservar" className={`${BASE} ${TAMANOS[tamano]} ${className}`}>
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Crear `boton-whatsapp.tsx`**

```tsx
import { whatsappUrl } from '@/lib/negocio';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full border-2 font-semibold transition';

// El tamaño va por prop y no por className: en Tailwind el orden de las clases
// en el atributo no decide quién gana, decide el orden en la hoja generada.
// Pasar `px-5` "encima" de `px-6` no funcionaría de forma confiable.
const TAMANOS = {
  normal: 'px-6 py-3 text-base',
  chico: 'px-5 py-2 text-sm',
};

/**
 * CTA de WhatsApp. Mientras no esté cargado el número en `negocio.ts`,
 * se muestra atenuado y sin link, en vez de un `wa.me/` roto.
 */
export function BotonWhatsapp({
  mensaje,
  children = 'Consultas por WhatsApp',
  tamano = 'normal',
  className = '',
}: {
  mensaje?: string;
  children?: React.ReactNode;
  tamano?: keyof typeof TAMANOS;
  className?: string;
}) {
  const url = whatsappUrl(mensaje);
  const clases = `${BASE} ${TAMANOS[tamano]} ${className}`;

  if (!url) {
    return (
      <span
        className={`${clases} cursor-not-allowed border-neutral-700 text-neutral-500`}
        title="Falta cargar el número de WhatsApp en negocio.ts"
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${clases} border-neutral-600 text-neutral-100 hover:border-lime-500 hover:text-lime-400`}
    >
      {children}
    </a>
  );
}
```

- [ ] **Step 3: Verificar build y lint**

```bash
pnpm build
pnpm lint
```

Esperado: build exitoso; lint sigue en 1 error.

- [ ] **Step 4: Commit**

```bash
git add reservas/src/components/landing/boton-reservar.tsx reservas/src/components/landing/boton-whatsapp.tsx
git commit -m "feat(reservas): botones de CTA reutilizables de la landing"
```

---

### Task 4: Hero + reescritura de `page.tsx`

Primera tarea con resultado visible en el browser.

**Files:**
- Create: `reservas/src/components/landing/hero.tsx`
- Modify: `reservas/src/app/page.tsx` (reescritura completa; hoy son 16 líneas en `bg-emerald-50`)

**Interfaces:**
- Consumes: `negocio` (Task 1), `BotonWhatsapp` (Task 3).
- Produces: `Hero()` — server component sin props.

- [ ] **Step 1: Crear `hero.tsx`**

Releer antes la sección "Restricción de contraste del logo": el logo va sobre tarjeta blanca, no suelto sobre el negro.

```tsx
import Image from 'next/image';
import { negocio } from '@/lib/negocio';
import { BotonReservar } from './boton-reservar';
import { BotonWhatsapp } from './boton-whatsapp';

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center gap-8 overflow-hidden px-6 py-16 text-center">
      {/* Halo lima detrás del contenido. Puro CSS, sin imagen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[70vh] bg-[radial-gradient(65%_55%_at_50%_0%,rgba(163,230,53,0.18),transparent)]"
      />

      {/* Tarjeta blanca: el wordmark del logo es gris oscuro y sobre negro no se lee. */}
      <div className="relative rounded-3xl bg-white p-5 shadow-2xl shadow-lime-500/10 sm:p-7">
        <Image
          src="/logo.png"
          alt={`${negocio.nombre} — ${negocio.rubro}`}
          width={1695}
          height={1877}
          priority
          sizes="(min-width: 640px) 260px, 190px"
          className="h-auto w-[190px] sm:w-[260px]"
        />
      </div>

      <h1 className="relative max-w-4xl font-display text-4xl uppercase leading-[0.92] tracking-tight sm:text-6xl lg:text-7xl">
        Más que un <span className="text-lime-400">predio</span>,
        <br />
        una experiencia <span className="text-lime-400">deportiva</span>
      </h1>

      <p className="relative max-w-xl text-base text-neutral-400 sm:text-lg">
        Canchas de pádel y fútbol en {negocio.direccion.localidad}. Torneos, encuentros
        deportivos y Bar Urban Food.
      </p>

      <div className="relative flex w-full max-w-md flex-col gap-3 sm:w-auto sm:flex-row">
        <BotonReservar />
        <BotonWhatsapp />
      </div>

      <p className="relative text-sm text-neutral-500">
        Reservá online en menos de un minuto.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Reescribir `page.tsx`**

```tsx
import { Hero } from '@/components/landing/hero';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-neutral-950 text-neutral-100">
      <Hero />
    </main>
  );
}
```

- [ ] **Step 3: Verificar build, que `/` siga estática, y lint**

```bash
pnpm build
pnpm lint
```

Esperado: build exitoso. En la tabla de rutas, `/` debe aparecer con `○` (Static). Si aparece `ƒ` (Dynamic), algo introdujo un fetch o una API dinámica: revisar antes de seguir. Lint sigue en 1 error.

- [ ] **Step 4: Chequeo visual**

```bash
pnpm dev
```

En `http://localhost:3000`, a 375 px de ancho y en desktop, confirmar:
- El wordmark "GAMBETEANDO" se lee (tarjeta blanca).
- El titular usa Anton (condensada pesada), no Geist.
- "Reservar ahora" lleva a `/reservar`.
- El botón de WhatsApp está atenuado y **no** es clickeable (esperado hasta que llegue el número).

- [ ] **Step 5: Commit**

```bash
git add reservas/src/components/landing/hero.tsx reservas/src/app/page.tsx
git commit -m "feat(reservas): hero de la landing con CTA a la reserva online"
```

---

### Task 5: Servicios con jerarquía

Dos cards grandes (reservable) + dos chicas (diferencial). Es el arreglo del problema de las cuatro cards idénticas.

**Files:**
- Create: `reservas/src/components/landing/servicios.tsx`
- Modify: `reservas/src/app/page.tsx`

**Interfaces:**
- Consumes: `BotonWhatsapp` (Task 3).
- Produces: `Servicios()` — server component sin props.

- [ ] **Step 1: Crear `servicios.tsx`**

```tsx
import Link from 'next/link';
import { BotonWhatsapp } from './boton-whatsapp';

/** Lo reservable online: manda la jerarquía. */
const PRINCIPALES = [
  {
    titulo: 'Pádel',
    texto: 'Canchas modernas, para todos los niveles. Elegí día y horario y jugá.',
    emoji: '🎾',
  },
  {
    titulo: 'Fútbol',
    texto: 'Espacios para todas las edades. Armá el partido y reservá en un minuto.',
    emoji: '⚽',
  },
] as const;

export function Servicios() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-20">
      <h2 className="text-center font-display text-3xl uppercase tracking-tight sm:text-5xl">
        Todo lo que vas a <span className="text-lime-400">encontrar</span>
      </h2>

      {/* Principales: grandes, cada una entra a la reserva. */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {PRINCIPALES.map((s) => (
          <Link
            key={s.titulo}
            href="/reservar"
            className="group rounded-3xl border border-neutral-800 bg-neutral-900 p-7 transition hover:border-lime-500"
          >
            <span className="text-4xl" aria-hidden>
              {s.emoji}
            </span>
            <h3 className="mt-4 font-display text-2xl uppercase tracking-tight text-lime-400">
              {s.titulo}
            </h3>
            <p className="mt-2 text-sm text-neutral-400">{s.texto}</p>
            <span className="mt-5 inline-block text-sm font-semibold text-neutral-100 group-hover:text-lime-400">
              Reservar →
            </span>
          </Link>
        ))}
      </div>

      {/* Secundarios: más chicos, no son reservables online. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
          <span className="text-2xl" aria-hidden>
            🏆
          </span>
          <h3 className="mt-3 text-lg font-bold text-neutral-100">Torneos</h3>
          <p className="mt-1 text-sm text-neutral-400">
            Competencia, diversión y comunidad. Consultá fechas y cupos.
          </p>
          <BotonWhatsapp
            mensaje="¡Hola! Quiero información sobre los torneos."
            tamano="chico"
            className="mt-4"
          >
            Consultar torneos
          </BotonWhatsapp>
        </div>

        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
          <span className="text-2xl" aria-hidden>
            🍔
          </span>
          <h3 className="mt-3 text-lg font-bold text-neutral-100">Bar Urban Food</h3>
          <p className="mt-1 text-sm text-neutral-400">
            Buena comida y el mejor ambiente, antes o después de jugar.
          </p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Sumarla a `page.tsx`**

```tsx
import { Hero } from '@/components/landing/hero';
import { Servicios } from '@/components/landing/servicios';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-neutral-950 text-neutral-100">
      <Hero />
      <Servicios />
    </main>
  );
}
```

- [ ] **Step 3: Verificar**

```bash
pnpm build
pnpm lint
```

Esperado: build exitoso, `/` sigue como `○`, lint en 1 error.

- [ ] **Step 4: Chequeo visual**

A 375 px las cuatro cards van apiladas; desde `sm` quedan 2×2. Las dos de arriba deben verse claramente más grandes y con más presencia que las dos de abajo — si se ven parejas, la jerarquía no está funcionando y hay que corregirla antes de commitear.

- [ ] **Step 5: Commit**

```bash
git add reservas/src/components/landing/servicios.tsx reservas/src/app/page.tsx
git commit -m "feat(reservas): servicios con jerarquia entre reservable y diferencial"
```

---

### Task 6: Cómo reservar

Sección nueva, no existe en la landing del cliente. Desarma el freno de "no sé qué pasa después", sobre todo con la seña.

**Files:**
- Create: `reservas/src/components/landing/como-reservar.tsx`
- Modify: `reservas/src/app/page.tsx`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: `ComoReservar()` — server component sin props.

- [ ] **Step 1: Crear `como-reservar.tsx`**

```tsx
import { BotonReservar } from './boton-reservar';

const PASOS = [
  {
    n: '1',
    titulo: 'Elegí deporte y día',
    texto: 'Pádel o fútbol, y la fecha que estás buscando.',
  },
  {
    n: '2',
    titulo: 'Elegí el horario',
    texto: 'Vas a ver solo los turnos que están realmente libres.',
  },
  {
    n: '3',
    titulo: 'Confirmá con la seña',
    texto: 'Pagás la seña online y el turno te queda reservado.',
  },
] as const;

export function ComoReservar() {
  return (
    <section className="border-y border-neutral-800 bg-neutral-900/40">
      <div className="mx-auto w-full max-w-5xl px-6 py-20">
        <h2 className="text-center font-display text-3xl uppercase tracking-tight sm:text-5xl">
          Reservar es <span className="text-lime-400">así de simple</span>
        </h2>

        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {PASOS.map((p) => (
            <li key={p.n} className="text-center sm:text-left">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-lime-500 font-display text-xl text-black">
                {p.n}
              </span>
              <h3 className="mt-4 text-lg font-bold text-neutral-100">{p.titulo}</h3>
              <p className="mt-1 text-sm text-neutral-400">{p.texto}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 text-center">
          <BotonReservar />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Sumarla a `page.tsx`**

```tsx
import { Hero } from '@/components/landing/hero';
import { Servicios } from '@/components/landing/servicios';
import { ComoReservar } from '@/components/landing/como-reservar';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-neutral-950 text-neutral-100">
      <Hero />
      <Servicios />
      <ComoReservar />
    </main>
  );
}
```

- [ ] **Step 3: Verificar**

```bash
pnpm build
pnpm lint
```

Esperado: build exitoso, `/` sigue como `○`, lint en 1 error.

- [ ] **Step 4: Commit**

```bash
git add reservas/src/components/landing/como-reservar.tsx reservas/src/app/page.tsx
git commit -m "feat(reservas): seccion como reservar en tres pasos"
```

---

### Task 7: Ubicación y horarios

**Files:**
- Create: `reservas/src/components/landing/ubicacion.tsx`
- Modify: `reservas/src/app/page.tsx`

**Interfaces:**
- Consumes: `negocio`, `direccionCompleta` (Task 1); `BotonWhatsapp` (Task 3).
- Produces: `Ubicacion()` — server component sin props.

- [ ] **Step 1: Crear `ubicacion.tsx`**

```tsx
import { negocio, direccionCompleta } from '@/lib/negocio';
import { BotonWhatsapp } from './boton-whatsapp';

export function Ubicacion() {
  const { mapsUrl } = negocio.direccion;

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-20">
      <h2 className="text-center font-display text-3xl uppercase tracking-tight sm:text-5xl">
        Dónde y <span className="text-lime-400">cuándo</span>
      </h2>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-lime-400">
            Ubicación
          </h3>
          <p className="mt-2 text-sm text-neutral-300">{direccionCompleta()}</p>
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm font-semibold text-neutral-100 hover:text-lime-400"
            >
              Cómo llegar →
            </a>
          ) : (
            <span
              className="mt-4 inline-block text-sm text-neutral-600"
              title="Falta cargar mapsUrl en negocio.ts"
            >
              Cómo llegar →
            </span>
          )}
        </div>

        <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-lime-400">
            Horarios
          </h3>
          <p className="mt-2 text-sm text-neutral-300">{negocio.horarios.resumen}</p>
        </div>

        <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-lime-400">
            Contacto
          </h3>
          <p className="mt-2 text-sm text-neutral-300">
            Consultas y reservas por WhatsApp.
          </p>
          <BotonWhatsapp tamano="chico" className="mt-4">
            Escribinos
          </BotonWhatsapp>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Sumarla a `page.tsx`**

Agregar `import { Ubicacion } from '@/components/landing/ubicacion';` y `<Ubicacion />` después de `<ComoReservar />`.

- [ ] **Step 3: Verificar**

```bash
pnpm build
pnpm lint
```

Esperado: build exitoso, `/` sigue como `○`, lint en 1 error.

- [ ] **Step 4: Chequeo visual**

La dirección debe leerse `General Rodríguez, Buenos Aires` sin coma inicial (la calle está vacía). "Cómo llegar" debe verse atenuado y no clickeable.

- [ ] **Step 5: Commit**

```bash
git add reservas/src/components/landing/ubicacion.tsx reservas/src/app/page.tsx
git commit -m "feat(reservas): seccion de ubicacion, horarios y contacto"
```

---

### Task 8: Pie, redes y barra CTA de mobile

Cierra la landing. Las redes van acá a propósito: en la landing del cliente están a media página y se llevan clicks que deberían ir a la reserva.

**Desvío del spec:** el spec dice "barra sticky"; la implementación usa `fixed`. Con `sticky` la barra solo aparecería al llegar al final de su contenedor, y lo que se busca es que el CTA esté visible durante todo el scroll en mobile. `fixed` es lo que cumple la intención.

**Files:**
- Create: `reservas/src/components/landing/pie.tsx`
- Modify: `reservas/src/app/page.tsx`

**Interfaces:**
- Consumes: `negocio` (Task 1).
- Produces: `Pie()` y `BarraReservaMobile()` — ambos server components sin props, exportados del mismo archivo (la barra es parte del cierre de página y no tiene otro consumidor).

- [ ] **Step 1: Crear `pie.tsx`**

```tsx
import Image from 'next/image';
import { negocio } from '@/lib/negocio';
import { BotonReservar } from './boton-reservar';

const REDES = [
  { nombre: 'Instagram', url: negocio.redes.instagram },
  { nombre: 'TikTok', url: negocio.redes.tiktok },
] as const;

export function Pie() {
  return (
    /* pb-28 en mobile deja aire para que la barra fija no tape el contenido. */
    <footer className="border-t border-neutral-800 px-6 pb-28 pt-12 text-center md:pb-12">
      {/* Misma razón que en el hero: el wordmark es gris oscuro y necesita fondo claro. */}
      <div className="mx-auto mb-8 w-fit rounded-2xl bg-white p-3">
        <Image
          src="/logo.png"
          alt={negocio.nombre}
          width={1695}
          height={1877}
          sizes="110px"
          className="h-auto w-[110px]"
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {REDES.map((r) =>
          r.url ? (
            <a
              key={r.nombre}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-neutral-700 px-5 py-2 text-sm font-semibold text-neutral-100 transition hover:border-lime-500 hover:text-lime-400"
            >
              {r.nombre}
            </a>
          ) : (
            <span
              key={r.nombre}
              className="rounded-full border border-neutral-800 px-5 py-2 text-sm text-neutral-600"
              title={`Falta cargar la URL de ${r.nombre} en negocio.ts`}
            >
              {r.nombre}
            </span>
          ),
        )}
      </div>

      <p className="mt-8 text-xs uppercase tracking-[0.2em] text-neutral-500">
        {negocio.nombre} · {negocio.rubro}
      </p>
    </footer>
  );
}

/** Barra fija de reserva. Solo mobile: en desktop el CTA del hero queda visible. */
export function BarraReservaMobile() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-800 bg-neutral-950/95 p-3 backdrop-blur md:hidden">
      <BotonReservar tamano="ancho" />
    </div>
  );
}
```

- [ ] **Step 2: Completar `page.tsx`**

Versión final completa:

```tsx
import { Hero } from '@/components/landing/hero';
import { Servicios } from '@/components/landing/servicios';
import { ComoReservar } from '@/components/landing/como-reservar';
import { Ubicacion } from '@/components/landing/ubicacion';
import { Pie, BarraReservaMobile } from '@/components/landing/pie';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-neutral-950 text-neutral-100">
      <Hero />
      <Servicios />
      <ComoReservar />
      <Ubicacion />
      <Pie />
      <BarraReservaMobile />
    </main>
  );
}
```

- [ ] **Step 3: Verificar build, ruta estática y lint**

```bash
pnpm build
pnpm lint
```

Esperado: build exitoso; en la tabla de rutas `/` con `○` (Static); lint en **1** error.

- [ ] **Step 4: Chequeo visual final**

Con `pnpm dev`, a 375 px:
- La barra "Reservar ahora" queda fija abajo y **no tapa** el texto del pie.
- Instagram y TikTok se ven atenuados y no son clickeables.
- Scroll completo sin desbordes horizontales.

En desktop (≥768 px):
- La barra fija **no** aparece.
- El hero ocupa el alto de la pantalla.

- [ ] **Step 5: Commit**

```bash
git add reservas/src/components/landing/pie.tsx reservas/src/app/page.tsx
git commit -m "feat(reservas): pie con redes y barra de reserva fija en mobile"
```

---

## Cierre: datos pendientes del cliente

La landing queda funcional pero con cuatro huecos **visibles a propósito**. Cuando lleguen los datos, se completan en `reservas/src/lib/negocio.ts` y **no hace falta tocar ningún componente** — todos degradan solos:

| Campo | Formato |
|---|---|
| `whatsapp.numero` | Internacional, sin `+` ni espacios. Ej: `5492371234567` |
| `direccion.calle` | Calle y altura |
| `direccion.mapsUrl` | URL completa de Google Maps |
| `redes.instagram` / `redes.tiktok` | URL completa del perfil |

Después de cargarlos: `pnpm build` y verificar que los CTAs de WhatsApp, "Cómo llegar" e Instagram/TikTok ahora sí son clickeables.

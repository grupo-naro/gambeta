# Accesibilidad: texto más grande + más contraste — Design

**Fecha:** 2026-06-30
**Estado:** Aprobado
**Componente:** frontend (panel Next 16, Tailwind v4). Deploy por Vercel (no depende de la VM).

## Problema

El panel lo va a usar **gente grande**, y hoy el texto es chico y con poco contraste en lo secundario:
- No hay un `font-size` base seteado → usa el 16px del navegador; y la app se apoya mucho en texto chico (`text-sm` ×104, `text-xs` ×66 = 12–14px).
- El texto secundario usa grises muy claros (sobre todo `text-neutral-400`, y `text-neutral-500`), difíciles de leer.

Objetivo: **agrandar todo el texto ~+12% y mejorar el contraste del texto secundario**, con un cambio global y de bajo riesgo. Tamaño **fijo** (sin toggle, decisión tomada).

## Enfoque

Aprovechar que la tipografía **y el spacing** están casi todos en `rem`: subir el tamaño base del root escala toda la app proporcionalmente desde un solo lugar.

### 1. Tamaño base (el cambio principal)
En `src/app/globals.css`, dentro de `@layer base`, en la regla `html`, agregar:
```css
html { font-size: 112.5%; } /* 16px -> 18px; escala todo lo rem-based */
```
(Se suma al `@apply font-sans` existente.) Esto agranda proporcionalmente todo el texto `rem` (text-xs/sm/base/lg/…) y el spacing `rem`.

### 2. Textos en px fijo (no escalan con lo anterior)
Los ~11 usos de `text-[Npx]` (micro-labels: "Ortigoza" 10px, chips 10–11px, el 9px) no escalan con el root. Subirlos un escalón para que acompañen:
- `text-[9px]` → `text-[11px]`
- `text-[10px]` → `text-[12px]`
- `text-[11px]` → `text-[12px]`
- `text-[15px]` → `text-[16px]`
(Son clases estáticas; buscar/reemplazar los literales exactos en los archivos que los usan.)

### 3. Contraste del texto secundario (accesibilidad AA)
Oscurecer **un escalón** los grises más claros **usados como color de TEXTO** (no tocar bordes/anillos/detalles decorativos):
- `text-neutral-400` → `text-neutral-500`
- `text-neutral-500` → `text-neutral-600`
Reemplazo mecánico y global de esos dos literales **solo cuando son `text-…`** (no `border-neutral-400`, `bg-neutral-400`, etc.). Apunta a mejorar la relación de contraste hacia AA en texto secundario.

### 4. Foco visible (menor)
Ya existe `* { @apply border-border outline-ring/50; }`. Reforzar el foco visible para teclado subiendo el grosor/opacidad del anillo (ej. `outline-ring/70` + `outline-offset`), sin romper el look. Cambio chico en `globals.css`.

## Alcance / riesgo
- **Global:** afecta login + todo el panel. Un bump de +12% es seguro; a lo sumo reflows menores.
- **Mobile:** recepción usa celular → verificar que el texto más grande no desborde en pantallas chicas (el layout ya es responsive; revisar Hoy, tablas, calendario).
- **No** se toca lógica, datos ni componentes de negocio — es puramente presentación (CSS + clases de texto).

## Testing / verificación
- `pnpm lint` + `pnpm build` sin errores.
- **Revisión visual** (la clave, al ser un cambio de UI): login, Vista Hoy (chips/cards), Reservas (tabla), Calendario (grilla semanal — la más densa), Configuración. Confirmar: texto legible y más grande, sin desbordes ni cortes, contraste ok en texto secundario.
- (No hay tests unitarios de estilo; el smoke visual es la verificación.)

## Fuera de alcance
- Toggle A/A+ que elige el usuario (descartado).
- Dark mode / rediseño de paleta (sub-proyecto C del programa UX, aparte).
- Rediseño de layout/jerarquía.

## Integración
Frontend → rama feature → merge a `master` local → **push a GitHub → Vercel deploya** (esto sí funciona; el problema IPv6 es solo de la VM/GitHub del backend). Se ve en `admin.canchitaortigoza.com.ar`.

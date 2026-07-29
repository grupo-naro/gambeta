# Carga y errores consistentes — Design

**Fecha:** 2026-06-15
**Estado:** Aprobado
**Programa:** Mejora integral de UX del panel. Sub-proyecto **B**, pieza **B2** (de B1 confirmaciones ✅; B3 microcopy y B4 onboarding — pendientes; ver [[programa-ux-panel]]).

## Objetivo

Que ninguna pantalla del panel quede en blanco mientras carga, ni caiga en la pantalla de error cruda de Next si el backend falla. Dos cosas: (1) un skeleton de carga **uniforme** en todas las rutas, y (2) un **error boundary** propio con "Reintentar", en español llano.

## Contexto (estado actual)

- App Router (Next 16). Rutas bajo `src/app/(panel)/`: dashboard, hoy, reservas, calendario, caja, canchas, turnos-fijos, bloqueos, configuracion, usuarios, actividad.
- Tienen `loading.tsx`: `reservas` y `canchas` (composiciones simples de `Skeleton`, genéricas) y `hoy` (a medida, con header + tarjetas — está bien).
- **Faltan** `loading.tsx`: calendario, caja, turnos-fijos, bloqueos, configuracion, usuarios, actividad, dashboard (8).
- **No hay** `error.tsx` en ningún nivel → un throw en un Server Component (ej. backend caído / 500) muestra la pantalla de error por defecto de Next.
- `Skeleton` ya existe: `@/components/ui/skeleton` (`<div className="animate-pulse rounded-md bg-muted" />`).

## Decisiones (confirmadas)

- **Carga:** un único `src/app/(panel)/loading.tsx` por defecto. Next usa el `loading.tsx` más cercano, así que uno a nivel `(panel)` cubre automáticamente toda ruta hija que no tenga el suyo. Skeleton con forma de "página de lista" (título + acción + bloque de tabla), que es la forma de casi todas las pantallas.
- Se **mantiene** `hoy/loading.tsx` (a medida, ya está bueno → override del default).
- Se **eliminan** `reservas/loading.tsx` y `canchas/loading.tsx` (genéricos) para que usen el default → más consistencia y menos archivos.
- **Errores:** un único `src/app/(panel)/error.tsx` (client component) con `reset()`. Cubre cualquier pantalla del panel.
- `global-error.tsx` (errores del layout raíz): **fuera de alcance** (YAGNI).

## Alcance

### `src/app/(panel)/loading.tsx` (nuevo)

Server component (sin `'use client'`). Skeleton de página de lista, mobile-first, usando `Skeleton`:
- Fila superior: un bloque de título (~`h-8 w-40`) y, a la derecha, un bloque de botón (~`h-9 w-32`).
- Un bloque alto que simula la tabla/lista (~`h-72 w-full rounded-lg`).
- Espaciado consistente con las páginas (`space-y-5` / contenedor similar al de las páginas).
- Sin texto; solo formas con `animate-pulse`.

### `src/app/(panel)/error.tsx` (nuevo)

Client component (`'use client'`), firma estándar de Next: `{ error: Error & { digest?: string }; reset: () => void }`.
- Tarjeta centrada, on-brand (mismos tokens que el resto: `Card`/`Button` o markup equivalente).
- Copy en criollo: título "Se nos complicó cargar esto" + texto "Hubo un problema al traer la información. Probá de nuevo en un momento."
- Botón primario **"Reintentar"** → llama `reset()`.
- Link/боtón secundario **"Volver al inicio"** → navega a `/hoy` (usar `<a href="/hoy">` o `Link`).
- NO mostrar el `error.message` crudo al usuario (puede traer detalles técnicos). Opcional: `console.error(error)` en un `useEffect` para debug.

### Limpieza

- Eliminar `src/app/(panel)/reservas/loading.tsx`.
- Eliminar `src/app/(panel)/canchas/loading.tsx`.
- (Quedan cubiertos por el default; verificar que al navegar a esas rutas se ve el skeleton del default.)

## Componentes y responsabilidades

- `(panel)/loading.tsx` — un único skeleton por defecto para todo el panel. Una responsabilidad: placeholder de carga uniforme.
- `(panel)/error.tsx` — un único error boundary del panel con reintentar.
- Sin componentes nuevos en `components/ui` (se reusa `Skeleton`, y `Card`/`Button` si conviene).

## Manejo de errores / bordes

- El `error.tsx` de `(panel)` captura errores de render de cualquier page/segmento hijo del panel. NO captura errores del propio `(panel)/layout.tsx` (eso lo haría un boundary superior) — fuera de alcance, el layout solo hace `getSession()` y ya redirige a `/login` ante `ApiAuthError`.
- `reset()` reintenta el render del segmento (vuelve a ejecutar el Server Component) — suficiente para un backend que volvió.
- El skeleton default aplica a navegaciones a rutas que tardan; `hoy` mantiene el suyo.

## Pruebas

- Solo frontend, UI → **`pnpm build` y `pnpm lint` obligatorios** (atrapan errores RSC, exports, tipos). El `error.tsx` debe ser client; `loading.tsx` server.
- QA manual: (a) navegar entre pantallas y ver el skeleton uniforme; (b) cortar el backend (o forzar un 500) y ver el error boundary con "Reintentar"; al volver el backend, "Reintentar" carga bien. (c) confirmar que reservas/canchas siguen mostrando skeleton (el del default).
- Sin tests unitarios (no hay lógica pura nueva).

## Despliegue / compat

- Solo frontend. Rama `feat/carga-errores-panel` → merge a `master` local (sin push salvo indicación).
- Aditivo salvo el borrado de 2 `loading.tsx` (reemplazados por el default).

## Fuera de alcance (YAGNI)

- `global-error.tsx` (errores del layout/root).
- Skeletons a medida por ruta (se usa uno por defecto).
- Reintentos automáticos / detección de "backend caído" con polling.
- B3 (microcopy general) y B4 (onboarding).

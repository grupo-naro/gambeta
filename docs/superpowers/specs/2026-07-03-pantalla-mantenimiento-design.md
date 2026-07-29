# Pantalla de "mantenimiento" ante error de servidor — Design

**Fecha:** 2026-07-03
**Estado:** Aprobado
**Alcance:** solo frontend (`frontend`). Un repo. Se deja commiteado SIN pushear (consistente con lo acumulado).

## Problema

Cuando el backend está caído, el panel muestra la pantalla genérica de Next: *"This page couldn't load. A server error occurred. Reload to try again."*. Se quiere un mensaje amable de mantenimiento.

**Causa raíz:** `(panel)/layout.tsx` hace `getSession()` (llamada al backend). Si el backend está caído, lanza un error (no `ApiAuthError`) **en el layout**. El `(panel)/error.tsx` NO puede atrapar errores de su propio layout (el layout lo envuelve), así que el error burbujea a la raíz. Como **no existe `global-error.tsx`**, Next muestra su pantalla por defecto.

## Diseño

Mensaje único de mantenimiento en **ambos** boundaries:
> 🛠️ **Estamos en mantenimiento**
> En unas horas el sistema va a estar disponible. Probá de nuevo en un rato.
> [Reintentar]

### 1. Nuevo `src/app/global-error.tsx` (el fix principal)
`global-error` atrapa los errores de la raíz/layout (el caso "backend caído") y **reemplaza el root layout**, por lo que debe renderizar su propio `<html>` y `<body>`. Como el CSS global se importa en el root layout que se está bypasseando, se usan **estilos inline** (no depender de Tailwind acá). `'use client'`.

```tsx
'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f5f5f5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ maxWidth: 380, width: '100%', background: '#fff', border: '1px solid #e5e5e5', borderRadius: 16, padding: 24, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
          <div style={{ fontSize: 40 }} aria-hidden>🛠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '12px 0 8px', color: '#171717' }}>Estamos en mantenimiento</h1>
          <p style={{ fontSize: 14, color: '#525252', margin: 0 }}>En unas horas el sistema va a estar disponible. Probá de nuevo en un rato.</p>
          <button onClick={() => reset()} style={{ marginTop: 20, width: '100%', height: 44, borderRadius: 10, border: 'none', background: '#171717', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
```

### 2. Actualizar `src/app/(panel)/error.tsx` (error de página puntual)
Cambiar el copy al mismo mensaje de mantenimiento, manteniendo la estructura/estilos actuales (Tailwind + `Button`, que acá SÍ están disponibles porque renderiza dentro del layout con el CSS). Concretamente:
- `<h1>`: `Se nos complicó cargar esto` → `Estamos en mantenimiento`.
- `<p>`: `Hubo un problema al traer la información. Probá de nuevo en un momento.` → `En unas horas el sistema va a estar disponible. Probá de nuevo en un rato.`
- Se mantienen el botón **Reintentar** (`reset()`) y el link **Volver al inicio** (`/hoy`), y el `useEffect(() => console.error(error))`.

## Verificación
- `pnpm exec tsc --noEmit && pnpm build` (compila; `global-error` es válido).
- Manual (producción): con el backend caído, recargar el panel → debe verse el cartel de mantenimiento en vez de la pantalla de Next. (En `next dev` no se ve `global-error`; probar con build/prod o en Vercel.)

## Fuera de alcance
- Detectar el tipo de error (500 vs bug de código): ambos boundaries muestran el mismo mensaje (decisión del usuario).
- Página de mantenimiento programada/manual (esto es solo el fallback ante error).
- Cambiar el manejo de `ApiAuthError` (sigue redirigiendo a `/login`).

## Integración
Frontend → `master`. **Commitear SIN pushear** (se apila sobre lo acumulado). Un repo.

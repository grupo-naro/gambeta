# Canchas: tipo = deporte + tamaño con Fútbol 6 y "Otro" — Design

**Fecha:** 2026-07-02
**Estado:** Aprobado
**Alcance:** SOLO panel (el bot/n8n y el endpoint de disponibilidad quedan sin cambios).
**Componentes:** frontend (diálogo + tabla + catálogo) + backend (validador + tests).

## Problema

Hoy en el form de canchas:
- **Tipo** = `futbol5 / futbol7 / futbol11 / otro` (string en `cancha.tipo`).
- **Tamaño** = `jugadores` Int (5/7/9/11), etiquetado "Fútbol N".

El complejo tiene canchas de varios deportes. Se quiere que **Tipo** sea el **deporte** y que **Tamaño** incluya **Fútbol 6** y **"Otro"** (para canchas que no son de fútbol).

## Decisiones (con el usuario)

- **Tipo (deporte):** `Fútbol · Vóley · Básquet · Pádel · Tenis · Otro` (valores slug: `futbol/voley/basquet/padel/tenis/otro`).
- **Tamaño:** lista de fútbol pasa a `5, 6, 7, 9, 11`; se agrega **"Otro"** que se guarda como **`jugadores = 0`** (centinela "sin tamaño de fútbol").
  - Canchas de otros deportes → tipo = ese deporte + tamaño = Otro (jugadores 0). Quedan **invisibles para la búsqueda por tamaño del bot** (correcto) y se usan desde el panel eligiéndolas por nombre.
- **Divisible (entera + partes):** sigue siendo solo fútbol → tamaños `{5,6,7,9,11}`, **sin** "Otro".
- **Bot / disponibilidad:** sin cambios (una cancha de fútbol 6 no será buscable por el bot hasta el alcance "también bot").
- **Canchas viejas:** no se migran; se cargan de cero en la instalación.

## Frontend

### `src/lib/canchas-catalogo.ts` (nuevo, para no repetir listas/labels)

```ts
export const TIPOS = [
  { value: 'futbol', label: 'Fútbol' },
  { value: 'voley', label: 'Vóley' },
  { value: 'basquet', label: 'Básquet' },
  { value: 'padel', label: 'Pádel' },
  { value: 'tenis', label: 'Tenis' },
  { value: 'otro', label: 'Otro' },
] as const;

/** Tamaños de fútbol (para cancha simple y divisible). */
export const TAMANOS_FUTBOL = [5, 6, 7, 9, 11] as const;

/** Centinela de "Otro" tamaño (canchas que no son de fútbol). */
export const OTRO_TAMANO = 0;

export function tipoLabel(value: string): string {
  return TIPOS.find((t) => t.value === value)?.label ?? value;
}

export function tamanoLabel(jugadores: number): string {
  return jugadores === OTRO_TAMANO ? 'Otro' : `Fútbol ${jugadores}`;
}
```

### `src/components/canchas/cancha-dialog.tsx`
- Importar `TIPOS`, `TAMANOS_FUTBOL`, `OTRO_TAMANO` del catálogo; **borrar** las constantes locales `TIPOS` y `TAMANOS`.
- `tipoFor(cancha)`: para cancha nueva default `'futbol'` (antes `'futbol5'`); para existente, si `cancha.tipo` está en `TIPOS` lo usa, si no `'otro'` (lógica actual).
- **Select "Tipo"** (form simple): opciones = `TIPOS` (deportes).
- **Select "Tamaño (jugadores)"** (form simple): opciones = `TAMANOS_FUTBOL` labeled `Fútbol N` **más** una opción `<option value={0}>Otro</option>`.
- **Selects divisible** (`jugadoresEntera`, `jugadoresParte`): usan `TAMANOS_FUTBOL` (sin "Otro").
- El estado `jugadores` sigue siendo string y se parsea igual; `OTRO_TAMANO` viaja como `0`.

### `src/components/canchas/canchas-table.tsx`
- Importar `tipoLabel`, `tamanoLabel` del catálogo.
- Reemplazar los 3 usos de `Fútbol {c.jugadores}` (fila desktop, card mobile, hoja) por `{tamanoLabel(c.jugadores)}` / `{tamanoLabel(seleccion.jugadores)}`.
- Reemplazar `{c.tipo}` (2 usos) por `{tipoLabel(c.tipo)}` para mostrar el label lindo.

### `src/lib/validators.ts` (el diálogo parsea con estos schemas ANTES de enviar)
- Hoy `jugadoresField = z.coerce.number().int().refine((n) => [5,7,9,11].includes(n), 'Tamaño inválido')`, usado por `canchaSchema` **y** `canchaDivisibleSchema`. Separar en dos:
  ```ts
  const jugadoresFutbolField = z.coerce.number().int().refine((n) => [5, 6, 7, 9, 11].includes(n), 'Tamaño inválido');
  const jugadoresField = z.coerce.number().int().refine((n) => [0, 5, 6, 7, 9, 11].includes(n), 'Tamaño inválido');
  ```
- `canchaSchema.jugadores` → `jugadoresField` (acepta 0 y 6).
- `canchaDivisibleSchema.jugadoresEntera` / `jugadoresParte` → `jugadoresFutbolField` (5/6/7/9/11, sin 0).

## Backend

### `src/validators/cancha.schema.ts`
- Nuevo union de fútbol y ampliar el de simple:
  ```ts
  const jugadoresFutbol = z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(9), z.literal(11)]);
  const jugadores = z.union([z.literal(0), z.literal(5), z.literal(6), z.literal(7), z.literal(9), z.literal(11)]);
  ```
- `crearDivisibleSchema`: `jugadoresEntera` y `jugadoresParte` usan **`jugadoresFutbol`** (no permiten 0).
- `createCanchaSchema` / `updateCanchaSchema`: siguen usando **`jugadores`** (ahora acepta 0 y 6).

### `src/validators/disponibilidad.schema.ts`
- **Sin cambios** (queda `[5, 7, 9, 11]`).

### Tests — `tests/integration/cancha.routes.test.ts`
- **Actualizar** el test existente `rechaza jugadores=6 con 400` → ahora **acepta** `jugadores=6` (esperar 201, `res.body.jugadores === 6`). Renombrar acorde (ej. `acepta jugadores=6 (fútbol 6)`).
- **Agregar:** crea cancha con `jugadores=0` (Otro) → 201, `res.body.jugadores === 0`.
- **Agregar:** `rechaza jugadores=8 con 400` (valor fuera del set sigue inválido).

## Fuera de alcance
- Bot / n8n y endpoint de disponibilidad.
- Migrar/renombrar canchas existentes (incluye el `seed.ts` con `tipo:'futbol5'`, dev-only).
- Un campo de "tamaño libre" para otros deportes (se usa `jugadores=0` = "Otro").

## Integración
Frontend → `master` + push → Vercel. Backend → `main` + push → deploy VM. Dos repos. El cambio es independiente entre sí salvo que ambos definen el set de tamaños válidos (frontend restringe la UI, backend valida) — deben quedar consistentes: `{0,5,6,7,9,11}`.

# Input de hora simple (24h, tipeo libre) en fijos y bloqueos — Design

**Fecha:** 2026-06-30
**Estado:** Aprobado
**Componente:** frontend (panel). Backend **sin cambios** (sigue recibiendo `HH:MM`).

## Problema

Al crear un **turno fijo** o un **bloqueo**, los campos de hora inicio/fin son `<Input type="time">` (nativo), que en el navegador pide **AM/PM + minutos** y es incómodo (sobre todo para gente grande). El complejo piensa en 24h (`16`, `18`, `21`).

Objetivo: reemplazar esos inputs por un **campo de texto** donde se tipea la hora libremente y se **normaliza a `HH:MM`** (24h), permitiendo atajos y medias horas.

## Comportamiento

Un input de texto (placeholder `21:00`). Al **salir del campo (onBlur)** se normaliza:
- `21` → `21:00`
- `22` → `22:00`
- `9` → `09:00`
- `21:30` → `21:30` (permite medias horas / cualquier minuto)
- `9:5` → `09:05`
- inválido (`25`, `9:70`, `abc`, vacío) → no normaliza; queda como está y lo frena la validación al guardar.

Sin AM/PM, sin obligar minutos.

## Diseño técnico

### Helper `normalizeHora` (unit-testeable) — `src/lib/hora.ts`
```
normalizeHora(raw: string): string | null
```
- `const s = raw.trim()`.
- `^\d{1,2}$` → hora `H`, minuto `0`; válida si `0 ≤ H ≤ 23` → `${pad2(H)}:00`.
- `^(\d{1,2}):(\d{1,2})$` → `H:M`; válida si `0 ≤ H ≤ 23` y `0 ≤ M ≤ 59` → `${pad2(H)}:${pad2(M)}`.
- Cualquier otra cosa (incl. vacío) → `null`.
- `pad2(n)` = 2 dígitos con cero a la izquierda. Devuelve SIEMPRE hora de 2 dígitos (necesario: el schema del backend exige `([01]\d|2[0-3]):[0-5]\d`, o sea hora de 2 dígitos).

### Componente `HoraInput` — `src/components/ui/hora-input.tsx`
Input de texto controlado, reutilizable (4 usos). Props: `{ id?: string; value: string; onChange: (v: string) => void; placeholder?: string }`.
- Muestra `value` tal cual mientras se tipea (no pelea con el usuario).
- `onBlur`: si `normalizeHora(value)` devuelve algo, llama `onChange(normalizado)`; si `null`, no toca (deja lo tipeado).
- Usa el mismo `<Input>` de `@/components/ui/input` (mismo estilo). `inputMode="numeric"` para que en mobile salga teclado numérico (igual acepta `:`).

### Diálogos (reemplazo)
En `src/components/fijos/turno-fijo-dialog.tsx` y `src/components/bloqueos/bloqueo-dialog.tsx`:
- Reemplazar los 2 `<Input type="time" ...>` (inicio y fin) por `<HoraInput ... />`.
- **Red de seguridad en el submit:** antes de validar/enviar, normalizar ambos con `normalizeHora` (por si el usuario tipeó `9` y apretó Enter sin salir del campo). Si alguno da `null`, mostrar error ("Hora inválida, usá formato 24h, ej: 21:00") y no enviar. Si dan valor, usar el normalizado en el payload.
- Se mantiene la validación existente (`turnoFijoSchema`/schema de bloqueo: formato `HH:MM` + inicio < fin). Con la normalización previa, `9` ya llega como `09:00` y pasa.

## Testing
- **Unit** de `normalizeHora` (`src/lib/hora.test.ts`, Vitest, sin dependencias):
  - `'21'`→`'21:00'`, `'9'`→`'09:00'`, `'21:30'`→`'21:30'`, `'9:5'`→`'09:05'`, `'00'`→`'00:00'`, `'23'`→`'23:00'`.
  - inválidos → `null`: `'24'`, `'25'`, `'9:60'`, `'9:70'`, `''`, `'  '`, `'abc'`, `'21:'`, `':30'`, `'-1'`.
- `pnpm lint` + `pnpm build`.
- **Revisión visual:** abrir "Nuevo turno fijo" y "Nuevo bloqueo" → tipear `21`, salir → `21:00`; tipear `21:30` → queda; tipear `25` → error al guardar. Confirmar que guardar sigue funcionando (crea el fijo/bloqueo con la hora correcta).

## Fuera de alcance
- Cambios en el backend (sigue `HH:MM`).
- Turno que **termina a medianoche** (`00:00` como fin): sigue sin ser representable (la validación pide fin > inicio; `00:00` < cualquier hora). Es una limitación pre-existente del backend, no de este input.
- El input de hora en otros lugares (reprogramar por el bot, etc.) — este cambio es solo el alta de fijos/bloqueos del panel.

## Integración
Frontend → rama feature → merge a `master` + push → Vercel. Se ve en `admin.canchitaortigoza.com.ar`.

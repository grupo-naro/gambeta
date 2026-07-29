# Vista "Hoy": cancha con color + filtro por cancha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En `/hoy`, mostrar cada turno con "Cancha N" coloreada por cancha (mismo color que el calendario) y agregar un filtro por cancha; sin tocar el backend.

**Architecture:** Un helper puro `nombreCancha` + reuso de `colorDeCancha` (ya existente). Las cards (reserva/fijo/bloqueo) reciben `canchas` y pintan la cancha como chip de color. `AgendaHoy` agrega estado de filtro client-side y una fila de chips.

**Tech Stack:** Next 16, React 19, Tailwind 4, Vitest (unit, sin Docker), pnpm.

## Global Constraints

- Solo frontend (`c:\Users\Lautaro\Desktop\ortigoza\frontend`). Sin cambios de backend ni deploy.
- Reusar `colorDeCancha(canchaId, canchas)` de `@/lib/calendario` (devuelve `{bg,text,border,dot}` de una PALETA estática de 10 colores). NO crear otra paleta.
- Clases Tailwind estáticas (la PALETA ya está safelisted; no construir clases dinámicas por string).
- Imports del frontend SIN extensión `.js`.
- Etiqueta de cancha: si el nombre es solo dígitos/barras (`/^[\d/]+$/`) → "Cancha "+nombre; si no (ej. "TECHADA") → tal cual.
- Verificación por tarea: `pnpm build` y `pnpm lint` sin errores. Merge a `master` local (no se pushea).

---

### Task 1: Helper `nombreCancha` (TDD)

**Files:**
- Modify: `frontend/src/lib/calendario.ts` (agregar export `nombreCancha`, junto a `colorDeCancha`)
- Test: `frontend/src/lib/calendario.test.ts` (agregar casos)

**Interfaces:**
- Produces: `nombreCancha(nombre?: string | null): string`.

- [ ] **Step 1: Test que falla.** En `frontend/src/lib/calendario.test.ts`, agregar el import si falta (`nombreCancha` al import existente de `@/lib/calendario` o `./calendario`) y un bloque:
```typescript
describe('nombreCancha', () => {
  it('prefija "Cancha" a nombres numericos', () => {
    expect(nombreCancha('2')).toBe('Cancha 2');
    expect(nombreCancha('10')).toBe('Cancha 10');
  });
  it('prefija a nombres con barra (divisibles)', () => {
    expect(nombreCancha('4/1')).toBe('Cancha 4/1');
  });
  it('deja los nombres propios tal cual', () => {
    expect(nombreCancha('TECHADA')).toBe('TECHADA');
  });
  it('vacio/undefined -> "Cancha"', () => {
    expect(nombreCancha('')).toBe('Cancha');
    expect(nombreCancha(undefined)).toBe('Cancha');
  });
});
```
> El import en ese archivo de test: verificá cómo importa hoy (`import { ... } from './calendario'`) y agregá `nombreCancha` a esa lista.

- [ ] **Step 2: Correr → FALLA.** `cd frontend && pnpm vitest run src/lib/calendario.test.ts` → FAIL (`nombreCancha` no existe).

- [ ] **Step 3: Implementar.** En `frontend/src/lib/calendario.ts`, agregar después de `colorDeCancha` (después de su `}`):
```typescript
/** "2" -> "Cancha 2"; "4/1" -> "Cancha 4/1"; "TECHADA" -> "TECHADA"; vacio -> "Cancha". */
export function nombreCancha(nombre?: string | null): string {
  const n = (nombre ?? '').trim();
  if (!n) return 'Cancha';
  return /^[\d/]+$/.test(n) ? 'Cancha ' + n : n;
}
```

- [ ] **Step 4: Correr → PASA.** `pnpm vitest run src/lib/calendario.test.ts` → todos verdes.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/calendario.ts src/lib/calendario.test.ts
git commit -m "feat(hoy): helper nombreCancha (prefijo Cancha N)"
```

---

### Task 2: Cards muestran la cancha como chip de color

**Files:**
- Modify: `frontend/src/components/hoy/turno-card.tsx`
- Modify: `frontend/src/components/hoy/fijo-card.tsx`
- Modify: `frontend/src/components/hoy/bloqueo-card.tsx`
- Modify: `frontend/src/components/hoy/agenda-hoy.tsx` (pasar `canchas` a las 3 cards)

**Interfaces:**
- Consumes: `colorDeCancha`, `nombreCancha` (`@/lib/calendario`); `Cancha` (`@/lib/types`).
- Produces: `TurnoCard`, `FijoCard` ahora reciben prop `canchas: Cancha[]`. (`BloqueoCard` también.)

- [ ] **Step 1: TurnoCard.** Reemplazar TODO `frontend/src/components/hoy/turno-card.tsx` por:
```tsx
'use client';
import { useState } from 'react';
import type { Reserva, Cancha } from '@/lib/types';
import { fmtHora } from '@/lib/fecha';
import { colorDeCancha, nombreCancha } from '@/lib/calendario';
import { PagoChip } from './pago-chip';
import { cn } from '@/lib/utils';

export function TurnoCard({ reserva, canchas, onClick }: { reserva: Reserva; canchas: Cancha[]; onClick: () => void }) {
  const [ahora] = useState(() => Date.now());
  const pasado = new Date(reserva.fechaFin).getTime() < ahora;
  const col = colorDeCancha(reserva.canchaId, canchas);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left transition active:scale-[0.99] min-h-[64px]',
        pasado && 'opacity-60',
      )}
    >
      <span className="w-14 shrink-0 text-center">
        <span className="block text-lg font-semibold leading-none tabular-nums">{fmtHora(reserva.fechaInicio)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{reserva.cliente?.nombre ?? '—'}</span>
        <span className={cn('mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium', col.bg, col.text)}>{nombreCancha(reserva.cancha?.nombre)}</span>
      </span>
      <PagoChip reserva={reserva} />
    </button>
  );
}
```

- [ ] **Step 2: FijoCard.** Reemplazar TODO `frontend/src/components/hoy/fijo-card.tsx` por:
```tsx
import { CalendarClock } from 'lucide-react';
import type { FijoAgenda, Cancha } from '@/lib/types';
import { colorDeCancha, nombreCancha } from '@/lib/calendario';
import { cn } from '@/lib/utils';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function FijoCard({ fijo, canchas, onClick }: { fijo: FijoAgenda; canchas: Cancha[]; onClick: () => void }) {
  const col = colorDeCancha(fijo.canchaId, canchas);
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left transition hover:bg-neutral-50">
      <CalendarClock className="h-5 w-5 flex-none text-sky-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fijo.horaInicio}–{fijo.horaFin}</p>
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-neutral-500">
          <span className={cn('inline-block rounded px-1.5 py-0.5 font-medium', col.bg, col.text)}>{nombreCancha(fijo.cancha.nombre)}</span>
          Fijo · {fijo.clienteNombre}
        </p>
      </div>
      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Fijo · {money(fijo.precio)}</span>
    </button>
  );
}
```

- [ ] **Step 3: BloqueoCard.** Reemplazar TODO `frontend/src/components/hoy/bloqueo-card.tsx` por:
```tsx
import { Ban } from 'lucide-react';
import type { Bloqueo, Cancha } from '@/lib/types';
import { etiquetaMotivo, colorDeCancha, nombreCancha } from '@/lib/calendario';
import { cn } from '@/lib/utils';

export function BloqueoCard({ bloqueo, canchas }: { bloqueo: Bloqueo; canchas: Cancha[] }) {
  const col = colorDeCancha(bloqueo.canchaId, canchas);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed bg-neutral-50 px-4 py-3">
      <Ban className="h-5 w-5 flex-none text-neutral-400" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-neutral-700">
          {bloqueo.horaInicio}–{bloqueo.horaFin}
          <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-medium', col.bg, col.text)}>{nombreCancha(bloqueo.cancha?.nombre)}</span>
        </p>
        <p className="truncate text-xs text-neutral-500">
          {etiquetaMotivo(bloqueo.motivo)}{bloqueo.nota ? ` · ${bloqueo.nota}` : ''}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: AgendaHoy pasa `canchas` a las cards.** En `frontend/src/components/hoy/agenda-hoy.tsx`, reemplazar las 3 líneas de render de las cards:
```tsx
          {reservas.map((r) => <TurnoCard key={r.id} reserva={r} onClick={() => abrir(r)} />)}
          {agenda.fijos.map((f) => <FijoCard key={f.turnoFijoId} fijo={f} onClick={() => { if (!pending) cobrarFijo(f.turnoFijoId); }} />)}
          {agenda.bloqueos.map((b) => <BloqueoCard key={b.id} bloqueo={b} />)}
```
por:
```tsx
          {reservas.map((r) => <TurnoCard key={r.id} reserva={r} canchas={canchas} onClick={() => abrir(r)} />)}
          {agenda.fijos.map((f) => <FijoCard key={f.turnoFijoId} fijo={f} canchas={canchas} onClick={() => { if (!pending) cobrarFijo(f.turnoFijoId); }} />)}
          {agenda.bloqueos.map((b) => <BloqueoCard key={b.id} bloqueo={b} canchas={canchas} />)}
```

- [ ] **Step 5: Verificar.** `pnpm build` y `pnpm lint` → sin errores. (Si lint marca `react-hooks` u otro, ajustar; las clases de color son estáticas de la PALETA.)

- [ ] **Step 6: Commit.**
```bash
git add src/components/hoy/turno-card.tsx src/components/hoy/fijo-card.tsx src/components/hoy/bloqueo-card.tsx src/components/hoy/agenda-hoy.tsx
git commit -m "feat(hoy): cancha como chip de color en cards (reserva/fijo/bloqueo)"
```

---

### Task 3: Filtro por cancha en la vista Hoy

**Files:**
- Modify: `frontend/src/components/hoy/agenda-hoy.tsx`

**Interfaces:**
- Consumes: `colorDeCancha`, `nombreCancha` (`@/lib/calendario`).

- [ ] **Step 1: Imports.** En `frontend/src/components/hoy/agenda-hoy.tsx`, agregar al import existente de `@/lib/calendario` (o crear el import si no hay): `import { colorDeCancha, nombreCancha } from '@/lib/calendario';` y `cn` si falta: `import { cn } from '@/lib/utils';`.

- [ ] **Step 2: Estado + filtrado.** Reemplazar:
```tsx
  const [pending, start] = useTransition();

  const reservas = agenda.reservas.filter((r) => r.estado !== 'CANCELADA');
  const vacio = reservas.length === 0 && agenda.fijos.length === 0 && agenda.bloqueos.length === 0;
```
por:
```tsx
  const [pending, start] = useTransition();
  const [canchaFiltro, setCanchaFiltro] = useState<string | null>(null);

  const coincide = (canchaId: string) => !canchaFiltro || canchaId === canchaFiltro;
  const reservas = agenda.reservas.filter((r) => r.estado !== 'CANCELADA' && coincide(r.canchaId));
  const fijos = agenda.fijos.filter((f) => coincide(f.canchaId));
  const bloqueos = agenda.bloqueos.filter((b) => coincide(b.canchaId));
  const canchasOrden = [...canchas].sort((a, b) => a.id.localeCompare(b.id));
  const vacio = reservas.length === 0 && fijos.length === 0 && bloqueos.length === 0;
```

- [ ] **Step 3: Fila de chips de filtro.** En el JSX, justo DESPUÉS del cierre del `</header>` y ANTES del `{vacio ? (`, insertar:
```tsx
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setCanchaFiltro(null)}
          className={cn('shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap', canchaFiltro === null ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700')}
        >
          Todas
        </button>
        {canchasOrden.map((c) => {
          const col = colorDeCancha(c.id, canchas);
          const activa = canchaFiltro === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCanchaFiltro(c.id)}
              className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm whitespace-nowrap', activa ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700')}
            >
              <span className={cn('inline-block h-2 w-2 rounded-full', col.dot)} />
              {nombreCancha(c.nombre)}
            </button>
          );
        })}
      </div>
```

- [ ] **Step 4: Render desde las listas filtradas + estado vacío contextual.** Reemplazar el bloque:
```tsx
      {vacio ? (
        <div className="rounded-xl border border-dashed bg-white py-12 text-center">
          <CalendarDays className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm text-neutral-500">No hay turnos para este día.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reservas.map((r) => <TurnoCard key={r.id} reserva={r} canchas={canchas} onClick={() => abrir(r)} />)}
          {agenda.fijos.map((f) => <FijoCard key={f.turnoFijoId} fijo={f} canchas={canchas} onClick={() => { if (!pending) cobrarFijo(f.turnoFijoId); }} />)}
          {agenda.bloqueos.map((b) => <BloqueoCard key={b.id} bloqueo={b} canchas={canchas} />)}
        </div>
      )}
```
por:
```tsx
      {vacio ? (
        <div className="rounded-xl border border-dashed bg-white py-12 text-center">
          <CalendarDays className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm text-neutral-500">{canchaFiltro ? 'No hay turnos en esa cancha para este día.' : 'No hay turnos para este día.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reservas.map((r) => <TurnoCard key={r.id} reserva={r} canchas={canchas} onClick={() => abrir(r)} />)}
          {fijos.map((f) => <FijoCard key={f.turnoFijoId} fijo={f} canchas={canchas} onClick={() => { if (!pending) cobrarFijo(f.turnoFijoId); }} />)}
          {bloqueos.map((b) => <BloqueoCard key={b.id} bloqueo={b} canchas={canchas} />)}
        </div>
      )}
```
> Nota: ahora se mapea sobre `fijos`/`bloqueos` (filtrados), no `agenda.fijos`/`agenda.bloqueos`.

- [ ] **Step 5: Verificar.** `pnpm build` y `pnpm lint` → sin errores. Revisión visual: la fila de chips filtra la lista; "Todas" muestra todo; con una cancha sin turnos ese día aparece el mensaje contextual.

- [ ] **Step 6: Commit.**
```bash
git add src/components/hoy/agenda-hoy.tsx
git commit -m "feat(hoy): filtro por cancha en la agenda del dia"
```

- [ ] **Step 7: Cierre.** `pnpm build` + `pnpm lint` ok → **superpowers:finishing-a-development-branch** → merge a `master` local (no se pushea).

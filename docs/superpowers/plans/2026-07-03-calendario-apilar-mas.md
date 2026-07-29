# Calendario: apilar reservas por fila + "+N más" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en el calendario, cuando una hora/día tiene muchas reservas, se apilen legibles (una por fila: Cancha · Cliente) con un "+N más" que abre una hoja con todas, en vez de amontonarse ilegibles.

**Architecture:** Un helper puro `dividirCelda(eventos, max)` (visibles/ocultos) en `lib/calendario.ts`, y el componente `calendario-semana.tsx` que apila vertical, cap 3 + "+N más" en escritorio (hoja con todas), y apila todas en mobile.

**Tech Stack:** Frontend Next 16 (custom — ver `frontend/AGENTS.md`), Tailwind v4, Vitest, pnpm. Un repo (`frontend`).

## Global Constraints

- **🚫 NO PUSHEAR.** Commit + merge a `master` EN LOCAL, sin `git push` (se apila sobre commits sin pushear). Ningún paso ejecuta `git push`.
- Tope de eventos visibles por celda de escritorio = **3** (`dividirCelda(evs, 3)`): ≤3 muestra todos; 4+ muestra 2 + "+N más". Mobile muestra todas.
- `EventoBtn` una sola línea `Cancha · Cliente`, manteniendo colores (`col.bg/text/border`, `ESTILO_TIPO.fijo.cal` lima / `ESTILO_TIPO.bloqueo.cal` naranja), borde punteado para no-reservas, `opacity-60` + "(seña)" en `ESPERANDO_SENA`, y `title` completo.
- NO usar training data de Next; clases Tailwind estáticas.
- Rama: `feat/calendario-apilar` (base `master`). Cierre = merge local sin push.

---

## REPO FRONTEND (`frontend`, rama `feat/calendario-apilar` desde `master`)

### Task 1: Helper `dividirCelda` + test

**Files:**
- Modify: `frontend/src/lib/calendario.ts`
- Test: `frontend/src/lib/calendario.test.ts` (ya existe; agregar un describe)

**Interfaces:**
- Produces: `dividirCelda<T>(eventos: T[], max: number): { visibles: T[]; ocultos: T[] }`.

- [ ] **Step 1: Escribir el test (RED)**

En `frontend/src/lib/calendario.test.ts`, agregar (importando `dividirCelda` del módulo — sumalo al import existente de `./calendario`):

```ts
describe('dividirCelda', () => {
  it('muestra todos si no supera el max', () => {
    expect(dividirCelda(['a', 'b', 'c'], 3)).toEqual({ visibles: ['a', 'b', 'c'], ocultos: [] });
  });
  it('deja lugar al boton cuando supera el max', () => {
    expect(dividirCelda(['a', 'b', 'c', 'd'], 3)).toEqual({ visibles: ['a', 'b'], ocultos: ['c', 'd'] });
  });
  it('maneja lista vacia', () => {
    expect(dividirCelda([], 3)).toEqual({ visibles: [], ocultos: [] });
  });
});
```

(Si el archivo no importa `describe/it/expect` explícitamente, seguí el patrón que ya usa — mirá las primeras líneas del test.)

- [ ] **Step 2: Run test to verify RED**

Run (desde `frontend/`): `pnpm exec vitest run src/lib/calendario.test.ts`
Expected: FAIL — `dividirCelda is not a function` / no exportada.

- [ ] **Step 3: Implementar el helper**

En `frontend/src/lib/calendario.ts`, agregar (al final, o junto a los otros helpers):

```ts
/** Parte los eventos de una celda en visibles + ocultos, dejando lugar al botón "+N más". */
export function dividirCelda<T>(eventos: T[], max: number): { visibles: T[]; ocultos: T[] } {
  if (eventos.length <= max) return { visibles: eventos, ocultos: [] };
  return { visibles: eventos.slice(0, max - 1), ocultos: eventos.slice(max - 1) };
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run (desde `frontend/`): `pnpm exec vitest run src/lib/calendario.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (NO push)**

```bash
git add frontend/src/lib/calendario.ts frontend/src/lib/calendario.test.ts
git commit -m "feat(calendario): helper dividirCelda (visibles/ocultos)"
```
NO ejecutar `git push`.

---

### Task 2: Apilar + "+N más" en `calendario-semana.tsx`

**Files:**
- Modify: `frontend/src/components/calendario/calendario-semana.tsx`

**Interfaces:**
- Consumes: `dividirCelda` (Task 1); helpers ya existentes `colorDeCancha`, `ESTILO_TIPO`, `etiquetaMotivo`, tipo `EventoCal`.

- [ ] **Step 1: Import de `dividirCelda`**

En el import desde `@/lib/calendario` (línea 7), agregar `dividirCelda` a la lista.

- [ ] **Step 2: `EventoBtn` a una sola línea**

Reemplazar la función `EventoBtn` (líneas ~14-35) por:

```tsx
function EventoBtn({ ev, canchas, onEvento }: { ev: EventoCal; canchas: Cancha[]; onEvento: (ev: EventoCal) => void }) {
  const col = colorDeCancha(ev.canchaId, canchas);
  const esReserva = ev.tipo === 'reserva';
  const esperando = ev.estado === 'ESPERANDO_SENA';
  const tag = ev.tipo === 'fijo' ? 'Fijo' : ev.tipo === 'bloqueo' ? etiquetaMotivo(ev.motivo!) : '';
  const clasesColor =
    ev.tipo === 'fijo' ? ESTILO_TIPO.fijo.cal
    : ev.tipo === 'bloqueo' ? ESTILO_TIPO.bloqueo.cal
    : `${col.bg} ${col.text} ${col.border}`;
  const cuerpo = `${ev.titulo}${ev.subtitulo ? ' · ' + ev.subtitulo : ''}`;
  return (
    <button
      onClick={() => onEvento(ev)}
      className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[12px] leading-tight ${clasesColor} ${esReserva ? '' : 'border-dashed'} ${esperando ? 'opacity-60' : ''}`}
      title={`${cuerpo}${tag ? ' · ' + tag : ''}${esperando ? ' (seña)' : ''}`}
    >
      {tag && <span className="font-semibold uppercase tracking-wide opacity-70">{tag}: </span>}
      {cuerpo}{esperando ? ' (seña)' : ''}
    </button>
  );
}
```

- [ ] **Step 3: Estado + `onMas` + helper de título en `CalendarioSemana`**

Dentro de `CalendarioSemana`, junto a los otros `useState` (~línea 44-46), agregar:

```tsx
  const [selCelda, setSelCelda] = useState<{ fecha: string; hora: number; eventos: EventoCal[] } | null>(null);
  const onMas = (fecha: string, hora: number, eventos: EventoCal[]) => setSelCelda({ fecha, hora, eventos });
  const tituloCelda = (fecha: string, hora: number) => {
    const idx = dias.indexOf(fecha);
    const lbl = idx >= 0 ? `${DIAS_LBL[idx]} ${Number(fecha.slice(8, 10))}` : fecha;
    return `${lbl} · ${String(hora).padStart(2, '0')}:00`;
  };
```

- [ ] **Step 4: Pasar `onMas` a `FilaHora` (escritorio)**

En el `.map` de horas de escritorio (~línea 98-100), pasar la prop:

```tsx
          {horas.map((h) => (
            <FilaHora key={h} h={h} dias={dias} porCelda={porCelda} canchas={canchas} onEvento={onEvento} onMas={onMas} />
          ))}
```

- [ ] **Step 5: Mobile — apilar todas (flex-col)**

En la celda de eventos de mobile (~línea 131), cambiar `className="flex flex-1 flex-wrap gap-1 p-1"` por `className="flex flex-1 flex-col gap-1 p-1"`. (El resto del `.map` de eventos queda igual — muestra todas.)

- [ ] **Step 6: Hoja "+N más"**

Agregar, junto a los otros `Sheet` (antes del `<ReprogramarDialog .../>`, ~línea 170), la hoja:

```tsx
      {/* Hoja "+N más": todas las reservas de una hora/día */}
      <Sheet open={!!selCelda} onOpenChange={(o) => { if (!o) setSelCelda(null); }}>
        {selCelda && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{tituloCelda(selCelda.fecha, selCelda.hora)}</SheetTitle>
              <p className="text-sm text-neutral-600">{selCelda.eventos.length} reservas</p>
            </SheetHeader>
            <div className="flex flex-col gap-1">
              {selCelda.eventos.map((ev) => (
                <EventoBtn key={ev.key} ev={ev} canchas={canchas} onEvento={(e) => { setSelCelda(null); onEvento(e); }} />
              ))}
            </div>
          </SheetContent>
        )}
      </Sheet>
```

- [ ] **Step 7: `FilaHora` — apilar + cap + "+N más"**

Reemplazar la función `FilaHora` (líneas ~180-202) por:

```tsx
function FilaHora({
  h, dias, porCelda, canchas, onEvento, onMas,
}: {
  h: number; dias: string[]; porCelda: Map<string, EventoCal[]>; canchas: Cancha[]; onEvento: (ev: EventoCal) => void; onMas: (fecha: string, hora: number, eventos: EventoCal[]) => void;
}) {
  return (
    <>
      <div className="border-b border-r bg-neutral-50 p-2 text-right text-xs text-neutral-500">{String(h).padStart(2, '0')}:00</div>
      {dias.map((d) => {
        const evs = porCelda.get(`${d}|${h}`) ?? [];
        const { visibles, ocultos } = dividirCelda(evs, 3);
        return (
          <div key={d} className="min-h-11 border-b border-r p-1">
            <div className="flex flex-col gap-0.5">
              {visibles.map((ev) => (
                <EventoBtn key={ev.key} ev={ev} canchas={canchas} onEvento={onEvento} />
              ))}
              {ocultos.length > 0 && (
                <button
                  onClick={() => onMas(d, h, evs)}
                  className="rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-neutral-500 hover:bg-neutral-100"
                >
                  + {ocultos.length} más
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 8: Typecheck + build**

Run (desde `frontend/`): `pnpm exec tsc --noEmit && pnpm build`
Expected: compila sin errores.

- [ ] **Step 9: Commit (NO push)**

```bash
git add frontend/src/components/calendario/calendario-semana.tsx
git commit -m "feat(calendario): apilar reservas por fila + \"+N más\" (celdas legibles)"
```
NO ejecutar `git push`.

---

## Cierre (SIN PUSH)

- Merge `feat/calendario-apilar` → `master` EN LOCAL, sin push. Queda apilado sobre lo que ya está sin pushear (para que el usuario pushee todo junto → Vercel).

## Self-Review

- **Cobertura del spec:**
  - `EventoBtn` una línea → Task 2 Step 2.
  - Helper `dividirCelda` + test → Task 1.
  - Escritorio apila + cap 3 + "+N más" → Task 2 Steps 4, 7.
  - Mobile apila todas → Task 2 Step 5.
  - Hoja "+N más" con todas, clickeables → Task 2 Steps 3, 6.
  - Sin backend → sin task. ✓
- **Placeholders:** ninguno.
- **Consistencia de tipos:** `dividirCelda<T>` genérico usado con `EventoCal[]` en `FilaHora`; `onMas(fecha, hora, eventos)` misma firma en el estado (Step 3), la prop de `FilaHora` (Steps 4, 7) y la llamada; `EventoBtn` misma firma en los 3 usos (visibles, mobile, hoja).
- **NO PUSH:** ningún step pushea; cierre = merge local. ✓

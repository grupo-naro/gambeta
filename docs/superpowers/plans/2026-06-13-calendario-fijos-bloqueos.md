# Calendario: turnos fijos y bloqueos/torneos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en el calendario semanal, además de las reservas, los turnos fijos y los bloqueos (torneos, mantenimiento, etc.), coloreados por cancha, distinguidos con borde punteado + etiqueta.

**Architecture:** Sólo frontend. Un helper puro `materializar()` proyecta las plantillas recurrentes (`/turnos-fijos`, `/bloqueos`) sobre los días de la semana. `CalendarioSemana` arma una lista unificada `EventoCal` (reservas + fijos + bloqueos), la indexa por `(fecha, hora)` y la renderiza. La página suma los dos fetch. No se toca el backend.

**Tech Stack:** Next 16 + React 19 + Tailwind 4 + Base UI + pnpm + Vitest.

**Rama:** `feat/calendario-fijos` (`c:/Users/Lautaro/Desktop/ortigoza/frontend`).

**Tipos ya existentes** (`src/lib/types.ts`): `TurnoFijo { id, canchaId, clienteNombre, whatsapp, diaSemana, horaInicio, horaFin, precio, activo, cancha?{nombre}, excepciones?[{id,fecha}] }`, `Bloqueo { id, canchaId, motivo, recurrente, diaSemana|null, fecha|null, horaInicio, horaFin, nota|null, cancha?{nombre} }`, `MotivoBloqueo`, `EstadoReserva`. `Reserva.cancha` es `Pick<Cancha,'id'|'nombre'>`.

---

### Task T0: Crear la rama

- [ ] **Step 1**

Run (desde `c:/Users/Lautaro/Desktop/ortigoza/frontend`):
```bash
git checkout master && git checkout -b feat/calendario-fijos
```

---

### Task T1: `EventoCal` + `materializar()` + `etiquetaMotivo()` (TDD)

**Files:**
- Modify: `frontend/src/lib/calendario.ts`
- Test: `frontend/src/lib/calendario.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `frontend/src/lib/calendario.test.ts` (el archivo ya importa de `./calendario` y tiene `semanaDe`):

```ts
import { materializar, etiquetaMotivo } from './calendario';

describe('etiquetaMotivo', () => {
  it('mapea los motivos a etiquetas cortas', () => {
    expect(etiquetaMotivo('TORNEO')).toBe('Torneo');
    expect(etiquetaMotivo('ENTRENAMIENTO')).toBe('Entren.');
    expect(etiquetaMotivo('MANTENIMIENTO')).toBe('Mantenim.');
    expect(etiquetaMotivo('OTRO')).toBe('Otro');
  });
});

describe('materializar', () => {
  const { dias } = semanaDe('2026-06-08'); // lunes..domingo
  const diaCon = (wd: number) => dias.find((d) => new Date(d + 'T12:00:00Z').getUTCDay() === wd)!;
  const fijoBase: any = { id: 'f1', canchaId: 'c1', clienteNombre: 'Juan', whatsapp: null, horaInicio: '18:00', horaFin: '20:00', precio: 1000, activo: true, cancha: { nombre: 'C1' } };

  it('un fijo aparece en su weekday y se expande a las horas cubiertas (18-20 → 18 y 19)', () => {
    const wed = diaCon(3);
    const ev = materializar(dias, [{ ...fijoBase, diaSemana: 3 }], []);
    const delDia = ev.filter((e) => e.fecha === wed);
    expect(delDia).toHaveLength(2);
    expect(delDia.map((e) => e.horaNum).sort((a, b) => a - b)).toEqual([18, 19]);
    expect(delDia[0].tipo).toBe('fijo');
    expect(delDia[0].subtitulo).toBe('Juan');
    expect(delDia[0].canchaId).toBe('c1');
  });

  it('una excepción en esa fecha excluye el fijo', () => {
    const wed = diaCon(3);
    const ev = materializar(dias, [{ ...fijoBase, diaSemana: 3, excepciones: [{ id: 'x', fecha: wed }] }], []);
    expect(ev.filter((e) => e.fecha === wed)).toHaveLength(0);
  });

  it('un fijo inactivo se excluye', () => {
    const ev = materializar(dias, [{ ...fijoBase, diaSemana: 3, activo: false }], []);
    expect(ev).toHaveLength(0);
  });

  it('un bloqueo puntual aparece sólo en su fecha', () => {
    const mar = diaCon(2);
    const b: any = { id: 'b1', canchaId: 'c1', motivo: 'TORNEO', recurrente: false, diaSemana: null, fecha: mar, horaInicio: '19:00', horaFin: '21:00', nota: null, cancha: { nombre: 'C1' } };
    const ev = materializar(dias, [], [b]);
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.fecha === mar)).toBe(true);
    expect(ev[0].tipo).toBe('bloqueo');
    expect(ev[0].motivo).toBe('TORNEO');
    expect(ev[0].subtitulo).toBe('Torneo');
  });

  it('un bloqueo recurrente aparece por diaSemana', () => {
    const vie = diaCon(5);
    const b: any = { id: 'b2', canchaId: 'c1', motivo: 'MANTENIMIENTO', recurrente: true, diaSemana: 5, fecha: null, horaInicio: '16:00', horaFin: '17:00', nota: 'pintura', cancha: { nombre: 'C1' } };
    const ev = materializar(dias, [], [b]);
    expect(ev).toHaveLength(1);
    expect(ev[0].fecha).toBe(vie);
    expect(ev[0].subtitulo).toBe('Mantenim. · pintura');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run:
```bash
pnpm vitest run src/lib/calendario.test.ts -t "materializar"
```
Expected: FAIL — `materializar`/`etiquetaMotivo` no están exportados.

- [ ] **Step 3: Implementar en `calendario.ts`**

Agregar al final de `frontend/src/lib/calendario.ts` (y el import de tipos arriba). Al tope del archivo, agregar:

```ts
import type { TurnoFijo, Bloqueo, MotivoBloqueo, EstadoReserva } from './types';
```

Al final del archivo:

```ts
export interface EventoCal {
  key: string;
  tipo: 'reserva' | 'fijo' | 'bloqueo';
  fecha: string;
  horaNum: number;
  canchaId: string;
  titulo: string;     // nombre de la cancha
  subtitulo: string;  // cliente (reserva/fijo) o motivo (+nota) (bloqueo)
  estado?: EstadoReserva;
  motivo?: MotivoBloqueo;
  refId: string;      // id de la reserva / fijo / bloqueo
}

const MOTIVO_LBL: Record<MotivoBloqueo, string> = {
  TORNEO: 'Torneo', ENTRENAMIENTO: 'Entren.', MANTENIMIENTO: 'Mantenim.', OTRO: 'Otro',
};
export function etiquetaMotivo(m: MotivoBloqueo): string {
  return MOTIVO_LBL[m] ?? 'Bloqueo';
}

function weekdayDe(dia: string): number {
  return new Date(dia + 'T12:00:00Z').getUTCDay(); // 0 = domingo
}
const hNum = (hhmm: string) => Number(hhmm.slice(0, 2));

export function materializar(dias: string[], fijos: TurnoFijo[], bloqueos: Bloqueo[]): EventoCal[] {
  const out: EventoCal[] = [];
  for (const dia of dias) {
    const wd = weekdayDe(dia);
    for (const f of fijos) {
      if (!f.activo || f.diaSemana !== wd) continue;
      if (f.excepciones?.some((e) => e.fecha === dia)) continue;
      for (let h = hNum(f.horaInicio); h < hNum(f.horaFin); h++) {
        out.push({ key: `f${f.id}@${dia}-${h}`, tipo: 'fijo', fecha: dia, horaNum: h, canchaId: f.canchaId, titulo: f.cancha?.nombre ?? '', subtitulo: f.clienteNombre, refId: f.id });
      }
    }
    for (const b of bloqueos) {
      const aplica = b.recurrente ? b.diaSemana === wd : b.fecha === dia;
      if (!aplica) continue;
      const sub = b.nota ? `${etiquetaMotivo(b.motivo)} · ${b.nota}` : etiquetaMotivo(b.motivo);
      for (let h = hNum(b.horaInicio); h < hNum(b.horaFin); h++) {
        out.push({ key: `b${b.id}@${dia}-${h}`, tipo: 'bloqueo', fecha: dia, horaNum: h, canchaId: b.canchaId, titulo: b.cancha?.nombre ?? '', subtitulo: sub, motivo: b.motivo, refId: b.id });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run:
```bash
pnpm vitest run src/lib/calendario.test.ts
```
Expected: PASS (los nuevos + los existentes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendario.ts src/lib/calendario.test.ts
git commit -m "feat(calendario): EventoCal + materializar (fijos/bloqueos) helpers"
```

---

### Task T2: `CalendarioSemana` muestra reservas + fijos + bloqueos

**Files:**
- Modify (rewrite): `frontend/src/components/calendario/calendario-semana.tsx`

- [ ] **Step 1: Reemplazar el componente completo**

Reemplazar TODO `frontend/src/components/calendario/calendario-semana.tsx` por:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Reserva, Cancha, TurnoFijo, Bloqueo } from '@/lib/types';
import { colorDeCancha, ubicarEnTz, horasDelDia, materializar, etiquetaMotivo, type EventoCal } from '@/lib/calendario';
import { ReprogramarDialog } from '@/components/reservas/reprogramar-dialog';
import { cancelarReserva, aprobarSena, rechazarSena } from '@/lib/reservas-actions';

const DIAS_LBL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const money = (n: number | null | undefined) => '$' + Number(n || 0).toLocaleString('es-AR');

export function CalendarioSemana({
  reservas, fijos, bloqueos, canchas, dias, horaApertura, horaCierre, hoy,
}: {
  reservas: Reserva[]; fijos: TurnoFijo[]; bloqueos: Bloqueo[]; canchas: Cancha[]; dias: string[];
  horaApertura: string; horaCierre: string; hoy: string;
}) {
  const router = useRouter();
  const [selReserva, setSelReserva] = useState<Reserva | null>(null);
  const [selInfo, setSelInfo] = useState<EventoCal | null>(null);
  const [reprogId, setReprogId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const horas = horasDelDia(horaApertura, horaCierre);
  const reservasById = new Map(reservas.map((r) => [r.id, r]));

  // Lista unificada de eventos (reservas no canceladas + fijos/bloqueos materializados)
  const eventos: EventoCal[] = [];
  for (const r of reservas) {
    if (r.estado === 'CANCELADA') continue;
    const { fecha, horaNum } = ubicarEnTz(r.fechaInicio);
    eventos.push({ key: `r${r.id}`, tipo: 'reserva', fecha, horaNum, canchaId: r.cancha?.id ?? '', titulo: r.cancha?.nombre ?? '', subtitulo: r.cliente?.nombre ?? '', estado: r.estado, refId: r.id });
  }
  eventos.push(...materializar(dias, fijos, bloqueos));

  const porCelda = new Map<string, EventoCal[]>();
  for (const ev of eventos) {
    const k = `${ev.fecha}|${ev.horaNum}`;
    const arr = porCelda.get(k) ?? [];
    arr.push(ev);
    porCelda.set(k, arr);
  }

  function onEvento(ev: EventoCal) {
    if (ev.tipo === 'reserva') { const r = reservasById.get(ev.refId); if (r) setSelReserva(r); }
    else setSelInfo(ev);
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMsg); setSelReserva(null); router.refresh(); }
      else toast.error(r.error ?? 'Error');
    });
  }

  return (
    <div className="space-y-3">
      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3 text-sm">
        {[...canchas].sort((a, b) => a.id.localeCompare(b.id)).map((c) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm ${colorDeCancha(c.id, canchas).dot}`} />
            {c.nombre}
          </span>
        ))}
        <span className="text-neutral-400">— borde punteado = fijo/torneo</span>
      </div>

      {/* Grilla */}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <div className="grid min-w-[760px]" style={{ gridTemplateColumns: '64px repeat(7, 1fr)' }}>
          <div className="border-b border-r bg-neutral-50 p-2" />
          {dias.map((d, i) => (
            <div key={d} className={`border-b border-r p-2 text-center text-xs font-medium ${d === hoy ? 'bg-primary/10 text-primary' : 'bg-neutral-50 text-neutral-600'}`}>
              {DIAS_LBL[i]} {Number(d.slice(8, 10))}
            </div>
          ))}
          {horas.map((h) => (
            <FilaHora key={h} h={h} dias={dias} porCelda={porCelda} canchas={canchas} onEvento={onEvento} />
          ))}
        </div>
      </div>

      {/* Dialog reserva (con acciones) */}
      <Dialog open={!!selReserva} onOpenChange={(o) => { if (!o) setSelReserva(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reserva</DialogTitle></DialogHeader>
          {selReserva && (
            <div className="space-y-2 text-sm">
              <p><span className="text-neutral-500">Cancha:</span> {selReserva.cancha?.nombre}</p>
              <p><span className="text-neutral-500">Cliente:</span> {selReserva.cliente?.nombre} ({selReserva.cliente?.whatsapp})</p>
              <p><span className="text-neutral-500">Cuándo:</span> {new Date(selReserva.fechaInicio).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</p>
              <p><span className="text-neutral-500">Estado:</span> {selReserva.estado}</p>
              <p><span className="text-neutral-500">Monto:</span> {money(selReserva.monto)}{selReserva.montoSena != null ? ` · seña ${money(selReserva.montoSena)}` : ''}</p>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {selReserva?.estado === 'ESPERANDO_SENA' && (
              <>
                <Button variant="outline" disabled={pending} onClick={() => act(() => aprobarSena(selReserva.id), 'Seña aprobada')}>Aprobar seña</Button>
                <Button variant="outline" disabled={pending} onClick={() => act(() => rechazarSena(selReserva.id), 'Seña rechazada')}>Rechazar seña</Button>
              </>
            )}
            {selReserva && selReserva.estado !== 'CANCELADA' && selReserva.estado !== 'COMPLETADA' && (
              <>
                <Button variant="outline" disabled={pending} onClick={() => { setReprogId(selReserva.id); }}>Reprogramar</Button>
                <Button variant="destructive" disabled={pending} onClick={() => act(() => cancelarReserva(selReserva.id), 'Reserva cancelada')}>Cancelar</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog fijo/bloqueo (solo lectura) */}
      <Dialog open={!!selInfo} onOpenChange={(o) => { if (!o) setSelInfo(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selInfo?.tipo === 'fijo' ? 'Turno fijo' : 'Bloqueo'}</DialogTitle></DialogHeader>
          {selInfo && (
            <div className="space-y-2 text-sm">
              <p><span className="text-neutral-500">Cancha:</span> {selInfo.titulo}</p>
              <p><span className="text-neutral-500">{selInfo.tipo === 'fijo' ? 'Cliente' : 'Motivo'}:</span> {selInfo.subtitulo}</p>
              <p><span className="text-neutral-500">Hora:</span> {String(selInfo.horaNum).padStart(2, '0')}:00</p>
            </div>
          )}
          <DialogFooter>
            {selInfo?.tipo === 'fijo'
              ? <Link href="/turnos-fijos" className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50">Editar en Turnos fijos</Link>
              : <Link href="/bloqueos" className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50">Editar en Bloqueos</Link>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReprogramarDialog
        id={reprogId}
        open={!!reprogId}
        onOpenChange={(o) => { if (!o) { setReprogId(null); setSelReserva(null); router.refresh(); } }}
      />
    </div>
  );
}

function FilaHora({
  h, dias, porCelda, canchas, onEvento,
}: {
  h: number; dias: string[]; porCelda: Map<string, EventoCal[]>; canchas: Cancha[]; onEvento: (ev: EventoCal) => void;
}) {
  return (
    <>
      <div className="border-b border-r bg-neutral-50 p-2 text-right text-xs text-neutral-400">{String(h).padStart(2, '0')}:00</div>
      {dias.map((d) => {
        const evs = porCelda.get(`${d}|${h}`) ?? [];
        return (
          <div key={d} className="min-h-[44px] border-b border-r p-1">
            <div className="flex flex-wrap gap-1">
              {evs.map((ev) => {
                const col = colorDeCancha(ev.canchaId, canchas);
                const esReserva = ev.tipo === 'reserva';
                const esperando = ev.estado === 'ESPERANDO_SENA';
                const tag = ev.tipo === 'fijo' ? 'Fijo' : ev.tipo === 'bloqueo' ? etiquetaMotivo(ev.motivo!) : '';
                return (
                  <button
                    key={ev.key}
                    onClick={() => onEvento(ev)}
                    className={`flex-1 truncate rounded border px-1.5 py-1 text-left text-[11px] leading-tight ${col.bg} ${col.text} ${col.border} ${esReserva ? '' : 'border-dashed'} ${esperando ? 'opacity-60' : ''}`}
                    title={`${ev.titulo}${tag ? ' · ' + tag : ''}`}
                  >
                    {tag && <span className="block truncate text-[9px] font-semibold uppercase tracking-wide opacity-70">{tag}</span>}
                    <span className="block truncate font-medium">{ev.titulo}</span>
                    <span className="block truncate">{ev.subtitulo}{esperando ? ' (seña)' : ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: error sólo en `calendario/page.tsx` (todavía no pasa `fijos`/`bloqueos`) → se arregla en T3. Sin otros errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/calendario/calendario-semana.tsx
git commit -m "feat(calendario): render fijos y bloqueos (borde punteado + etiqueta, dialog solo lectura)"
```

---

### Task T3: La página `/calendario` fetchea fijos y bloqueos

**Files:**
- Modify: `frontend/src/app/(panel)/calendario/page.tsx`

- [ ] **Step 1: Agregar imports de tipos**

En `frontend/src/app/(panel)/calendario/page.tsx`, ampliar el import de tipos:

```tsx
import type { Reserva, Cancha, Config, TurnoFijo, Bloqueo } from '@/lib/types';
```

- [ ] **Step 2: Agregar los dos fetch al Promise.all**

Reemplazar el bloque del `Promise.all` por:

```tsx
  const [reservas, canchas, config, fijos, bloqueos] = await Promise.all([
    apiFetch<Reserva[]>(`/reservas?desde=${lunes}&hasta=${domingo}`),
    apiFetch<Cancha[]>('/canchas'),
    apiFetch<Config>('/config'),
    apiFetch<TurnoFijo[]>('/turnos-fijos'),
    apiFetch<Bloqueo[]>('/bloqueos'),
  ]);
```

- [ ] **Step 3: Pasar las props nuevas al componente**

Reemplazar el render de `<CalendarioSemana ... />` por:

```tsx
      <CalendarioSemana
        reservas={reservas}
        fijos={fijos}
        bloqueos={bloqueos}
        canchas={canchas}
        dias={dias}
        horaApertura={config.horaApertura}
        horaCierre={config.horaCierre}
        hoy={hoy}
      />
```

- [ ] **Step 4: Verificar tipos**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(panel)/calendario/page.tsx"
git commit -m "feat(calendario): fetch turnos fijos y bloqueos para la semana"
```

---

### Task T4: Verificación completa

- [ ] **Step 1: lint + tsc + tests + build**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build
```
Expected: todo verde. `pnpm build` obligatorio (boundary RSC). Las clases nuevas (`border-dashed`, `text-[9px]`, `uppercase`, `tracking-wide`) son estáticas → Tailwind las incluye.

---

### Task C1: Finalizar la rama

- [ ] **Step 1: finishing-a-development-branch**

Anunciar "I'm using the finishing-a-development-branch skill to complete this work." → tests verdes → merge a `master` (el repo no tiene remote → queda local).

**NOTA deploy:** esta feature **no toca backend**, pero **depende de que el backend con los endpoints `/turnos-fijos` y `/bloqueos` esté deployado en la VM** (forman parte de lo acumulado pendiente de deploy). Si el panel local apunta a un backend sin esos endpoints, los fetch fallarían — `apiFetch` tira `ApiError` y la página de Server Component mostraría error. Confirmar que el backend desplegado los expone (ya están en `main` desde la feature fijos/bloqueos).

---

## Self-Review

**Spec coverage:**
- Materialización en el front (fijos por diaSemana−excepciones, bloqueos recurrente/puntual, expansión multi-hora, weekday 0=domingo) → Task T1 ✓
- Mostrar todos los motivos de bloqueo con etiqueta → `etiquetaMotivo` + render tag (T1/T2) ✓
- Color por cancha (PALETA existente) para reservas/fijos/bloqueos → `colorDeCancha(ev.canchaId, canchas)` (T2) ✓
- Distinción: reserva borde sólido (ESPERANDO_SENA opacidad+"(seña)"), fijo/bloqueo `border-dashed` + etiqueta → T2 ✓
- Click: reserva→dialog acciones (resuelta por refId desde `reservasById`), fijo/bloqueo→dialog solo lectura + link a /turnos-fijos|/bloqueos → T2 ✓
- Nota en leyenda "borde punteado = fijo/torneo" → T2 ✓
- Página suma fetch `/turnos-fijos` y `/bloqueos` y los pasa → T3 ✓
- Unit tests del materializador (weekday, excepción, inactivo, puntual, recurrente, multi-hora) → T1 ✓
- CANCELADA filtradas en memoria (se mantiene) → T2 (`if (r.estado === 'CANCELADA') continue;`) ✓

**Placeholder scan:** Sin TBD/TODO. El único "verificá" es el error esperado de tsc en T2 Step 2 (intermedio, lo cierra T3) — no es un placeholder.

**Type consistency:** `EventoCal` (definido en T1) usado en T2 con los mismos campos (`tipo`,`fecha`,`horaNum`,`canchaId`,`titulo`,`subtitulo`,`estado?`,`motivo?`,`refId`,`key`). `materializar(dias,fijos,bloqueos)` y `etiquetaMotivo(m)` firmas idénticas entre T1 y su uso en T2. Props de `CalendarioSemana` (reservas, fijos, bloqueos, canchas, dias, horaApertura, horaCierre, hoy) coinciden entre T2 (definición) y T3 (uso). Reusa `ReprogramarDialog {id,open,onOpenChange}` y `reservas-actions` (firmas reales).

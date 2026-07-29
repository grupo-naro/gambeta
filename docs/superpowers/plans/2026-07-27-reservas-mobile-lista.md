# Reservas web — vista mobile (lista de horarios) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimizar la web de reservas en mobile: reemplazar la grilla ancha por una lista vertical de horarios (hora + DISPONIBLE/Ocupado + precio) con selector de mes/día. El desktop queda igual.

**Architecture:** El backend suma `precioHora` por cancha a `/disponibilidad/grilla`. El frontend renderiza dos vistas responsive con el mismo estado: desktop = grilla actual (`hidden md:*`), mobile = lista (`md:hidden`) con `SelectorFechaMobile` (pills de mes + fila de días) y auto-asignación de la cancha libre más barata por hora.

**Tech Stack:** Node 22, Express, Prisma 7 + Postgres, vitest + supertest + testcontainers (backend); Next.js 16 + React 19 + Tailwind v4 (app `reservas/`, pnpm).

## Global Constraints

- Solo cambia mobile (`< md`); el desktop (grilla) queda intacto.
- Mobile: una fila por hora; "DISPONIBLE" si alguna cancha del deporte está libre; auto-asigna la cancha libre **más barata** (ese precio se muestra y esa cancha se reserva). Hora sin ninguna libre → "Ocupado" (gris, no tocable).
- Meses en el selector mobile: **mes actual + siguiente**. Para el mes actual, los días arrancan en hoy.
- `precioHora` es `cancha.precioHora` (Decimal → number).
- `reservas/` usa **pnpm** (nunca `npm install`). Sin cambios de secretos (todo por server actions).
- Backend tests: testcontainers, `x-api-key: 'svc'`.
- No tocar `ortigoza/`.

---

## Task 1: Backend — `precioHora` en la grilla

**Files:**
- Modify: `backend/src/services/disponibilidad.service.ts` (método `grilla`)
- Test: `backend/tests/integration/disponibilidad-grilla.test.ts`

**Interfaces:**
- `grilla` devuelve `canchas: { id: string; nombre: string; precioHora: number }[]` (agrega `precioHora`).

- [ ] **Step 1: Incluir `precioHora` en el mapeo de canchas de `grilla`**

En `backend/src/services/disponibilidad.service.ts`, en `grilla`:

a) Ampliar el tipo de retorno y el acumulador `perCancha` para llevar `precioHora`:
```ts
  async grilla(deporte: 'futbol' | 'padel', fecha: string): Promise<{
    deporte: string; fecha: string;
    canchas: { id: string; nombre: string; precioHora: number }[];
    horas: string[];
    libres: Record<string, Record<string, boolean>>;
  }> {
    const todas = await canchaRepo.list(true);
    const canchas = todas.filter((c) =>
      deporte === 'futbol' ? c.tipo.toLowerCase().startsWith('futbol') : c.tipo.toLowerCase() === 'padel',
    );
    const perCancha: { id: string; nombre: string; precioHora: number; free: Set<string> }[] = [];
    const horasSet = new Set<string>();
    for (const c of canchas) {
      const { slots } = await this.listar(c.id, fecha);
      const futuros = slots.filter((s) => new Date(s.inicioUtc).getTime() > Date.now());
      const free = new Set(futuros.map((s) => s.horaInicio));
      perCancha.push({ id: c.id, nombre: c.nombre, precioHora: Number(c.precioHora), free });
      for (const h of free) horasSet.add(h);
    }
    const horas = [...horasSet].sort();
    const libres: Record<string, Record<string, boolean>> = {};
    for (const pc of perCancha) {
      libres[pc.id] = {};
      for (const h of horas) libres[pc.id][h] = pc.free.has(h);
    }
    return { deporte, fecha, canchas: perCancha.map((pc) => ({ id: pc.id, nombre: pc.nombre, precioHora: pc.precioHora })), horas, libres };
  },
```
(Es el mismo método de antes; solo se agrega `precioHora` al `perCancha` y al `map` final.)

- [ ] **Step 2: Escribir/actualizar el test (falla primero)**

En `backend/tests/integration/disponibilidad-grilla.test.ts`, en el caso "futbol: incluye solo canchas de futbol…", agregar una aserción del precio. Las canchas se siembran con `precioHora` 1000 (`Futbol 1`) y 2000 (`Futbol 2`). Agregar:
```ts
    expect(res.body.canchas.find((c: any) => c.nombre === 'Futbol 1').precioHora).toBe(1000);
    expect(res.body.canchas.find((c: any) => c.nombre === 'Futbol 2').precioHora).toBe(2000);
```
(Insertarlas junto a las aserciones existentes de ese `it`.)

- [ ] **Step 3: Correr los tests**

```bash
cd backend && npm test -- disponibilidad-grilla
```
Expected: primero falla la nueva aserción (hoy `canchas` no trae `precioHora`); tras el Step 1 pasan todos.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/disponibilidad.service.ts backend/tests/integration/disponibilidad-grilla.test.ts
git commit -m "feat(disponibilidad): la grilla incluye precioHora por cancha"
```

---

## Task 2: `SelectorFechaMobile` (pills de mes + fila de días)

**Files:**
- Create: `reservas/src/components/selector-fecha-mobile.tsx`

**Interfaces:**
- Produces: `SelectorFechaMobile({ value, onChange })` — `value` en `YYYY-MM-DD`; `onChange(fecha)` al elegir un día. Muestra mes actual + siguiente y una fila horizontal de días (desde hoy para el mes actual).

- [ ] **Step 1: Crear `reservas/src/components/selector-fecha-mobile.tsx`**

```tsx
'use client';
import { useState } from 'react';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIA_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (a: number, m0: number, d: number) => `${a}-${pad(m0 + 1)}-${pad(d)}`;
const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

export function SelectorFechaMobile({ value, onChange }: { value: string; onChange: (fecha: string) => void }) {
  const hoy = hoyISO();
  const [hy, hm] = hoy.split('-').map(Number);
  const base = new Date(hy, hm - 1, 1);
  const meses = [0, 1].map((k) => {
    const d = new Date(base.getFullYear(), base.getMonth() + k, 1);
    return { anio: d.getFullYear(), mes0: d.getMonth() };
  });
  const [vy, vm] = value.split('-').map(Number);
  const idxInicial = meses.findIndex((m) => m.anio === vy && m.mes0 === vm - 1);
  const [idx, setIdx] = useState(idxInicial >= 0 ? idxInicial : 0);
  const mes = meses[idx];

  const esMesActual = mes.anio === hy && mes.mes0 === hm - 1;
  const ultimo = new Date(mes.anio, mes.mes0 + 1, 0).getDate();
  const desde = esMesActual ? Number(hoy.split('-')[2]) : 1;
  const dias: number[] = [];
  for (let d = desde; d <= ultimo; d++) dias.push(d);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {meses.map((m, i) => (
          <button key={i} type="button" onClick={() => setIdx(i)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${idx === i ? 'bg-white text-black' : 'text-neutral-400'}`}>
            {MESES[m.mes0]}
          </button>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {dias.map((d) => {
          const fecha = iso(mes.anio, mes.mes0, d);
          const sel = fecha === value;
          const dow = DIA_SEM[new Date(mes.anio, mes.mes0, d).getDay()];
          return (
            <button key={d} type="button" onClick={() => onChange(fecha)}
              className={`flex min-w-[64px] flex-col items-center rounded-xl px-3 py-2 ${sel ? 'bg-lime-500 text-black' : 'bg-neutral-900 text-neutral-300'}`}>
              <span className="text-xs uppercase">{dow}</span>
              <span className="text-lg font-bold tabular-nums">{d}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar build**

```bash
cd reservas && pnpm build
```
Expected: compila (el componente aún no se usa; se conecta en Task 3).

- [ ] **Step 3: Commit**

```bash
git add reservas/src/components/selector-fecha-mobile.tsx
git commit -m "feat(reservas): SelectorFechaMobile (pills de mes + fila de dias)"
```

---

## Task 3: `PantallaReserva` responsive (desktop grilla + mobile lista)

**Files:**
- Modify: `reservas/src/lib/types.ts` (`Grilla.canchas` con `precioHora`)
- Modify: `reservas/src/components/pantalla-reserva.tsx`

**Interfaces:**
- Consumes: `SelectorFechaMobile` (Task 2), `Calendario` (existente), `getGrilla`/`crearReserva`.
- Produces: `elegidaMobile(grilla, hora)` (helper puro) + la vista responsive.

- [ ] **Step 1: Tipo `Grilla` con `precioHora`**

En `reservas/src/lib/types.ts`, cambiar la línea de `canchas` dentro de `Grilla`:
```ts
  canchas: { id: string; nombre: string; precioHora: number }[];
```

- [ ] **Step 2: Reescribir `pantalla-reserva.tsx` (desktop + mobile)**

Reemplazar el contenido de `reservas/src/components/pantalla-reserva.tsx` por:
```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { getGrilla, crearReserva } from '@/lib/actions';
import type { Deporte, Grilla } from '@/lib/types';
import { Calendario } from './calendario';
import { SelectorFechaMobile } from './selector-fecha-mobile';

const money = (n: number | null) => (n == null ? '' : '$' + Number(n).toLocaleString('es-AR'));
const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const fechaLarga = (fecha: string) => {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
};

const DEPORTES: { key: Deporte; label: string; icon: string }[] = [
  { key: 'futbol', label: 'Fútbol', icon: '⚽' },
  { key: 'padel', label: 'Pádel', icon: '🎾' },
];

/** Cancha libre más barata a una hora (o null si ninguna libre). */
export function elegidaMobile(grilla: Grilla, hora: string): { id: string; nombre: string; precioHora: number } | null {
  const libres = grilla.canchas.filter((c) => grilla.libres[c.id]?.[hora]);
  if (libres.length === 0) return null;
  return libres.reduce((min, c) => (c.precioHora < min.precioHora ? c : min));
}

export function PantallaReserva() {
  const [deporte, setDeporte] = useState<Deporte>('futbol');
  const [fecha, setFecha] = useState(hoyISO());
  const [grilla, setGrilla] = useState<Grilla | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorGrilla, setErrorGrilla] = useState('');
  const [sel, setSel] = useState<{ canchaId: string; canchaNombre: string; hora: string } | null>(null);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [errorForm, setErrorForm] = useState('');
  const [ok, setOk] = useState<{ senia: number | null } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let vivo = true;
    setCargando(true); setErrorGrilla('');
    getGrilla(deporte, fecha).then((r) => {
      if (!vivo) return;
      if (r.ok) setGrilla(r.data); else { setGrilla(null); setErrorGrilla(r.error); }
      setCargando(false);
    });
    return () => { vivo = false; };
  }, [deporte, fecha]);

  function recargar() { getGrilla(deporte, fecha).then((r) => { if (r.ok) setGrilla(r.data); }); }
  function abrirForm(canchaId: string, canchaNombre: string, hora: string) {
    setSel({ canchaId, canchaNombre, hora }); setNombre(''); setTelefono(''); setErrorForm(''); setOk(null);
  }
  function cerrarModal() { setSel(null); setOk(null); setErrorForm(''); }

  function confirmar() {
    if (!sel) return;
    if (nombre.trim().length < 2) { setErrorForm('Ingresá tu nombre'); return; }
    if (telefono.replace(/\D/g, '').length < 10) { setErrorForm('Ingresá un teléfono válido (10 dígitos)'); return; }
    setErrorForm('');
    start(async () => {
      const r = await crearReserva({ canchaId: sel.canchaId, fecha, horaInicio: sel.hora, nombre: nombre.trim(), telefono });
      if (!r.ok) { setErrorForm(r.error); recargar(); return; }
      setOk({ senia: r.data.montoSena == null ? null : Number(r.data.montoSena) });
      recargar();
    });
  }

  const deporteBotones = (
    <div className="flex gap-4">
      {DEPORTES.map((d) => (
        <button key={d.key} type="button" onClick={() => setDeporte(d.key)}
          className={`flex flex-1 flex-col items-center gap-1 rounded-2xl border-2 p-4 ${deporte === d.key ? 'border-lime-500 bg-neutral-800' : 'border-neutral-700 bg-neutral-900'}`}>
          <span className="text-3xl">{d.icon}</span>
          <span className="text-sm font-bold uppercase text-neutral-200">{d.label}</span>
        </button>
      ))}
    </div>
  );

  const tituloGrilla = `${deporte === 'futbol' ? 'Fútbol' : 'Pádel'} · ${fechaLarga(fecha)}`;
  const sinDatos = !grilla || grilla.canchas.length === 0 || grilla.horas.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      {/* ===== Desktop: grilla (sin cambios) ===== */}
      <div className="hidden flex-1 gap-6 p-4 md:grid md:grid-cols-[minmax(280px,380px)_1fr]">
        <aside className="flex flex-col gap-5">
          <div className="text-sm font-semibold uppercase leading-relaxed tracking-wide text-neutral-300">
            Seleccioná el deporte y la fecha que estás buscando.<br />
            En la tabla, buscá el horario disponible.<br />
            Seleccioná y completá el formulario.
          </div>
          {deporteBotones}
          <Calendario value={fecha} onChange={setFecha} min={hoyISO()} />
        </aside>
        <section className="flex min-w-0 flex-col">
          <h2 className="mb-3 text-lg font-bold uppercase text-lime-400">{tituloGrilla}</h2>
          {cargando ? <p className="p-6 text-neutral-500">Cargando…</p>
            : errorGrilla ? <p className="p-6 text-red-400">{errorGrilla}</p>
            : sinDatos ? <p className="p-6 text-neutral-500">No hay disponibilidad para ese día.</p>
            : (
              <div className="overflow-x-auto rounded-xl border border-neutral-800">
                <table className="w-full border-collapse text-center text-sm">
                  <thead>
                    <tr className="bg-neutral-900 text-neutral-300">
                      <th className="sticky left-0 bg-neutral-900 p-2">Hora</th>
                      {grilla!.canchas.map((c) => <th key={c.id} className="p-2 font-semibold">{c.nombre}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {grilla!.horas.map((h, i) => (
                      <tr key={h} className={i % 2 ? 'bg-neutral-950' : 'bg-neutral-900/40'}>
                        <td className="sticky left-0 bg-inherit p-2 font-semibold tabular-nums text-neutral-300">{h}</td>
                        {grilla!.canchas.map((c) => {
                          const libre = grilla!.libres[c.id]?.[h];
                          return (
                            <td key={c.id} className="p-1">
                              <button type="button" disabled={!libre} onClick={() => abrirForm(c.id, c.nombre, h)}
                                className={`h-9 w-full rounded ${libre ? 'bg-lime-500 font-semibold text-black hover:bg-lime-400 active:scale-95' : 'cursor-not-allowed bg-neutral-800 text-neutral-600'}`}>
                                {libre ? 'Libre' : '—'}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      </div>

      {/* ===== Mobile: lista de horarios ===== */}
      <div className="flex flex-1 flex-col gap-4 p-4 md:hidden">
        {deporteBotones}
        <SelectorFechaMobile value={fecha} onChange={setFecha} />
        <h2 className="text-base font-bold uppercase text-lime-400">{tituloGrilla}</h2>
        {cargando ? <p className="p-6 text-center text-neutral-500">Cargando…</p>
          : errorGrilla ? <p className="p-6 text-center text-red-400">{errorGrilla}</p>
          : sinDatos ? <p className="p-6 text-center text-neutral-500">No hay disponibilidad para ese día.</p>
          : (
            <div className="flex flex-col">
              {grilla!.horas.map((h) => {
                const el = elegidaMobile(grilla!, h);
                return (
                  <div key={h} className="flex items-center gap-3 border-b border-neutral-800 py-3">
                    <span className="w-14 font-semibold tabular-nums text-neutral-300">{h}</span>
                    {el ? (
                      <button type="button" onClick={() => abrirForm(el.id, el.nombre, h)}
                        className="flex-1 rounded-full bg-lime-500 py-3 text-center font-bold uppercase text-black active:scale-95">
                        Disponible
                      </button>
                    ) : (
                      <span className="flex-1 rounded-full bg-neutral-800 py-3 text-center font-semibold uppercase text-neutral-600">Ocupado</span>
                    )}
                    <span className="w-24 text-right font-semibold text-lime-400">{el ? money(el.precioHora) : ''}</span>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* ===== Modal (compartido) ===== */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={cerrarModal}>
          <div className="w-full max-w-sm rounded-2xl bg-neutral-900 p-6 text-neutral-100 ring-1 ring-neutral-700" onClick={(e) => e.stopPropagation()}>
            {ok ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="text-5xl">✅</div>
                <h3 className="text-xl font-bold">¡Reserva registrada!</h3>
                <p className="text-neutral-400">{sel.canchaNombre} · {fechaLarga(fecha)} · {sel.hora}</p>
                {ok.senia != null && ok.senia > 0
                  ? <p>Para confirmarla, aboná la seña de <b>{money(ok.senia)}</b>.</p>
                  : <p>Te contactamos para confirmarla.</p>}
                <button type="button" onClick={cerrarModal} className="mt-2 rounded-xl bg-lime-500 px-6 py-2 font-bold text-black">Listo</button>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold">Reservar</h3>
                <p className="mt-1 text-sm text-neutral-400">{sel.canchaNombre} · {fechaLarga(fecha)} · {sel.hora}</p>
                <div className="mt-4 space-y-3">
                  <input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-xl border border-neutral-700 bg-neutral-800 p-3 text-neutral-100 placeholder:text-neutral-500" />
                  <input placeholder="Teléfono (ej: 11 3662 0274)" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="w-full rounded-xl border border-neutral-700 bg-neutral-800 p-3 text-neutral-100 placeholder:text-neutral-500" />
                </div>
                {errorForm && <p className="mt-2 text-red-400">{errorForm}</p>}
                <div className="mt-4 flex gap-3">
                  <button type="button" onClick={cerrarModal} className="flex-1 rounded-xl border border-neutral-600 py-2 font-semibold">Cancelar</button>
                  <button type="button" disabled={pending} onClick={confirmar} className="flex-[2] rounded-xl bg-lime-500 py-2 font-bold text-black disabled:opacity-50">{pending ? 'Reservando…' : 'Confirmar'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar build**

```bash
cd reservas && pnpm build
```
Expected: compila/typecheck limpio; ruta `/reservar` generada.

- [ ] **Step 4: Commit**

```bash
git add reservas/src/lib/types.ts reservas/src/components/pantalla-reserva.tsx
git commit -m "feat(reservas): vista mobile de lista de horarios (precio + auto-asignacion), desktop intacto"
```

---

## Notas de cierre

- Desktop y mobile comparten el mismo estado (`deporte`, `fecha`, `grilla`, modal); solo cambia el
  render por breakpoint (`hidden md:*` / `md:hidden`). No hay detección de viewport por JS.
- En mobile, cada hora reserva la cancha libre más barata (`elegidaMobile`); el precio mostrado es
  el de esa cancha. Horas totalmente ocupadas → "Ocupado"; horas pasadas ya no vienen en la grilla.
- Sin migraciones; el único cambio de backend es el campo `precioHora` en la grilla.

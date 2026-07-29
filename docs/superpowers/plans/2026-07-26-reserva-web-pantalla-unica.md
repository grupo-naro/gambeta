# Reserva online — pantalla única (rediseño web) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la web de reservas (`reservas/`) a una sola pantalla (tema oscuro): a la izquierda instrucciones + botones de deporte + calendario mensual; a la derecha la grilla de disponibilidad (libre/ocupado). Formulario en modal. Sin cambios de backend.

**Architecture:** Se reemplaza el wizard de pasos por una vista única (`PantallaReserva`) que muestra deporte + calendario + grilla al mismo tiempo y recarga la grilla al cambiar deporte/fecha (`getGrilla`). Un componente `Calendario` propio maneja la elección del día. La reserva se hace en un modal (`crearReserva`). Reusa `/disponibilidad/grilla` y `/reservas`.

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4 (app `reservas/`, pnpm).

## Global Constraints

- Sin cambios de backend; usa las server actions `getGrilla`/`crearReserva` (Task de sub-proyecto A).
- Turnos de 1 hora (filas por hora, tal como devuelve la grilla). Celdas: Libre (verde tocable) / Ocupado (gris).
- Deportes: Fútbol y Pádel.
- Tema oscuro (fondo casi negro, acentos verde lima), coherente con la referencia del cliente.
- `reservas/` usa **pnpm** (nunca `npm install`).
- La `SERVICE_API_KEY` sigue solo del lado server (no se toca `api.ts`/`actions.ts`).
- No tocar `ortigoza/`.

---

## Task 1: Componente `Calendario` (mes navegable)

**Files:**
- Create: `reservas/src/components/calendario.tsx`

**Interfaces:**
- Produces:
  - `matrizMes(anio: number, mes0: number): (number | null)[][]` — semanas de 7 celdas (día o null), lunes primero.
  - `Calendario({ value, onChange, min })` — `value`/`min` en `YYYY-MM-DD`; `onChange(fecha)` al elegir un día.

- [ ] **Step 1: Crear `reservas/src/components/calendario.tsx`**

```tsx
'use client';
import { useState } from 'react';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (a: number, m0: number, d: number) => `${a}-${pad(m0 + 1)}-${pad(d)}`;

/** Matriz del mes: semanas de 7 celdas (día o null), lunes primero. */
export function matrizMes(anio: number, mes0: number): (number | null)[][] {
  const primero = new Date(anio, mes0, 1);
  const offset = (primero.getDay() + 6) % 7; // 0 = lunes
  const dias = new Date(anio, mes0 + 1, 0).getDate();
  const celdas: (number | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= dias; d++) celdas.push(d);
  while (celdas.length % 7 !== 0) celdas.push(null);
  const semanas: (number | null)[][] = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}

export function Calendario({ value, onChange, min }: { value: string; onChange: (fecha: string) => void; min?: string }) {
  const [y0, m0] = value.split('-').map(Number);
  const [vista, setVista] = useState({ anio: y0, mes0: m0 - 1 });
  const semanas = matrizMes(vista.anio, vista.mes0);
  const cambiarMes = (delta: number) => {
    const d = new Date(vista.anio, vista.mes0 + delta, 1);
    setVista({ anio: d.getFullYear(), mes0: d.getMonth() });
  };
  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-neutral-200">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => cambiarMes(-1)} aria-label="Mes anterior" className="px-3 py-1 text-lg text-neutral-400 hover:text-white">‹</button>
        <span className="font-semibold text-lime-400">{MESES[vista.mes0]} {vista.anio}</span>
        <button type="button" onClick={() => cambiarMes(1)} aria-label="Mes siguiente" className="px-3 py-1 text-lg text-neutral-400 hover:text-white">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-neutral-500">
        {DIAS.map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {semanas.flat().map((d, i) => {
          if (d == null) return <div key={i} />;
          const fecha = iso(vista.anio, vista.mes0, d);
          const deshab = min ? fecha < min : false;
          const sel = fecha === value;
          return (
            <button key={i} type="button" disabled={deshab} onClick={() => onChange(fecha)}
              className={`aspect-square rounded-md ${sel ? 'bg-lime-500 font-bold text-black' : deshab ? 'text-neutral-700' : 'text-neutral-200 hover:bg-neutral-700'}`}>
              {d}
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
Expected: compila sin errores de tipo (el componente aún no se usa; se conecta en Task 2).

- [ ] **Step 3: Commit**

```bash
git add reservas/src/components/calendario.tsx
git commit -m "feat(reservas): componente Calendario mensual"
```

---

## Task 2: Pantalla única (reemplaza el wizard)

**Files:**
- Create: `reservas/src/components/pantalla-reserva.tsx`
- Delete: `reservas/src/components/wizard-reserva.tsx`
- Modify: `reservas/src/app/reservar/page.tsx`

**Interfaces:**
- Consumes: `getGrilla`, `crearReserva` (de `@/lib/actions`); tipos `Deporte`, `Grilla`; `Calendario` (Task 1).
- Produces: `PantallaReserva` (vista única).

- [ ] **Step 1: Crear `reservas/src/components/pantalla-reserva.tsx`**

```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { getGrilla, crearReserva } from '@/lib/actions';
import type { Deporte, Grilla } from '@/lib/types';
import { Calendario } from './calendario';

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

  // Recarga la grilla cuando cambia deporte o fecha.
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

  return (
    <div className="grid flex-1 gap-6 p-4 md:grid-cols-[minmax(280px,380px)_1fr]">
      {/* Izquierda: instrucciones + deporte + calendario */}
      <aside className="flex flex-col gap-5">
        <div className="text-sm font-semibold uppercase leading-relaxed tracking-wide text-neutral-300">
          Seleccioná el deporte y la fecha que estás buscando.<br />
          En la tabla, buscá el horario disponible.<br />
          Seleccioná y completá el formulario.
        </div>
        <div className="flex gap-4">
          {DEPORTES.map((d) => (
            <button key={d.key} type="button" onClick={() => setDeporte(d.key)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-2xl border-2 p-4 ${deporte === d.key ? 'border-lime-500 bg-neutral-800' : 'border-neutral-700 bg-neutral-900'}`}>
              <span className="text-3xl">{d.icon}</span>
              <span className="text-sm font-bold uppercase text-neutral-200">{d.label}</span>
            </button>
          ))}
        </div>
        <Calendario value={fecha} onChange={setFecha} min={hoyISO()} />
      </aside>

      {/* Derecha: grilla */}
      <section className="flex min-w-0 flex-col">
        <h2 className="mb-3 text-lg font-bold uppercase text-lime-400">
          {deporte === 'futbol' ? 'Fútbol' : 'Pádel'} · {fechaLarga(fecha)}
        </h2>
        {cargando ? (
          <p className="p-6 text-neutral-500">Cargando…</p>
        ) : errorGrilla ? (
          <p className="p-6 text-red-400">{errorGrilla}</p>
        ) : !grilla || grilla.canchas.length === 0 || grilla.horas.length === 0 ? (
          <p className="p-6 text-neutral-500">No hay disponibilidad para ese día.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            <table className="w-full border-collapse text-center text-sm">
              <thead>
                <tr className="bg-neutral-900 text-neutral-300">
                  <th className="sticky left-0 bg-neutral-900 p-2">Hora</th>
                  {grilla.canchas.map((c) => <th key={c.id} className="p-2 font-semibold">{c.nombre}</th>)}
                </tr>
              </thead>
              <tbody>
                {grilla.horas.map((h, i) => (
                  <tr key={h} className={i % 2 ? 'bg-neutral-950' : 'bg-neutral-900/40'}>
                    <td className="sticky left-0 bg-inherit p-2 font-semibold tabular-nums text-neutral-300">{h}</td>
                    {grilla.canchas.map((c) => {
                      const libre = grilla.libres[c.id]?.[h];
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

      {/* Modal formulario / confirmación */}
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

- [ ] **Step 2: Actualizar la página `/reservar` (fondo oscuro + nuevo componente)**

Reemplazar `reservas/src/app/reservar/page.tsx` por:
```tsx
import { PantallaReserva } from "@/components/pantalla-reserva";

export default function ReservarPage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col bg-neutral-950 text-neutral-100">
      <PantallaReserva />
    </main>
  );
}
```

- [ ] **Step 3: Borrar el wizard viejo**

```bash
cd "c:/Users/Lautaro/Desktop/proyecto-canchas" && git rm reservas/src/components/wizard-reserva.tsx
```
(Verificar que nada más lo importe: `grep -rn "wizard-reserva" reservas/src` no debe devolver nada.)

- [ ] **Step 4: Verificar build**

```bash
cd reservas && pnpm build
```
Expected: compila sin errores; ruta `/reservar` generada. `grep -rn "wizard-reserva" reservas/src` vacío.

- [ ] **Step 5: Commit**

```bash
git add reservas/src/components/pantalla-reserva.tsx reservas/src/app/reservar/page.tsx
git commit -m "feat(reservas): reserva en pantalla unica (deporte + calendario + grilla, tema oscuro)"
```

---

## Notas de cierre

- Sin cambios de backend: la vista sigue consumiendo `getGrilla`/`crearReserva`. La grilla se
  recarga sola al cambiar deporte o fecha (efecto sobre `[deporte, fecha]`).
- Los íconos de deporte son emojis simples (`⚽`/`🎾`) como placeholder; se pueden reemplazar por
  SVGs de marca más adelante sin cambiar la lógica.
- Los nombres de columnas de la grilla son los nombres reales de las canchas (backend); la ventana
  horaria de las filas sale de la config del negocio (`horaApertura`/`horaCierre`).
- El landing (`/`) queda como está; el rediseño aplica a la pantalla `/reservar`.

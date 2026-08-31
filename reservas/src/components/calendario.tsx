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

export function Calendario({ value, onChange, min, max }: { value: string; onChange: (fecha: string) => void; min?: string; max?: string }) {
  const [y0, m0] = value.split('-').map(Number);
  const [vista, setVista] = useState({ anio: y0, mes0: m0 - 1 });
  const semanas = matrizMes(vista.anio, vista.mes0);
  // Si el mes de al lado cae entero fuera de la ventana, se apaga la flecha: navegar hasta un
  // mes con 31 días grises es peor que no poder navegar.
  const primeroDelMes = iso(vista.anio, vista.mes0, 1);
  const ultimoDelMes = iso(vista.anio, vista.mes0, new Date(vista.anio, vista.mes0 + 1, 0).getDate());
  const hayAnterior = !min || primeroDelMes > min;
  const haySiguiente = !max || ultimoDelMes < max;
  const cambiarMes = (delta: number) => {
    const d = new Date(vista.anio, vista.mes0 + delta, 1);
    setVista({ anio: d.getFullYear(), mes0: d.getMonth() });
  };
  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-neutral-200">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" disabled={!hayAnterior} onClick={() => cambiarMes(-1)} aria-label="Mes anterior" className="px-3 py-1 text-lg text-neutral-400 hover:text-white disabled:text-neutral-700 disabled:hover:text-neutral-700">‹</button>
        <span className="font-semibold text-lime-400">{MESES[vista.mes0]} {vista.anio}</span>
        <button type="button" disabled={!haySiguiente} onClick={() => cambiarMes(1)} aria-label="Mes siguiente" className="px-3 py-1 text-lg text-neutral-400 hover:text-white disabled:text-neutral-700 disabled:hover:text-neutral-700">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-neutral-500">
        {DIAS.map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {semanas.flat().map((d, i) => {
          if (d == null) return <div key={i} />;
          const fecha = iso(vista.anio, vista.mes0, d);
          const deshab = (min ? fecha < min : false) || (max ? fecha > max : false);
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

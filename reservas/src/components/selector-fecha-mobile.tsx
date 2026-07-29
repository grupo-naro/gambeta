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

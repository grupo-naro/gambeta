'use client';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIA_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function SelectorFechaMobile({ value, onChange, min, max }: { value: string; onChange: (fecha: string) => void; min: string; max: string }) {
  // La ventana es corta (8 días con el default), así que se listan los días uno por uno y se
  // dejan de lado las pastillas de mes: con este rango no hay nada que elegir a nivel mes.
  const dias: string[] = [];
  for (let f = min; f <= max; ) {
    dias.push(f);
    const [y, m, d] = f.split('-').map(Number);
    f = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {dias.map((fecha) => {
        const [y, m, d] = fecha.split('-').map(Number);
        const sel = fecha === value;
        const dow = DIA_SEM[new Date(y, m - 1, d).getDay()];
        return (
          <button key={fecha} type="button" onClick={() => onChange(fecha)}
            className={`flex min-w-[64px] flex-col items-center rounded-xl px-3 py-2 ${sel ? 'bg-lime-500 text-black' : 'bg-neutral-900 text-neutral-300'}`}>
            <span className="text-xs uppercase">{MESES[m - 1].slice(0, 3)}</span>
            <span className="text-lg font-bold tabular-nums">{d}</span>
            <span className="text-xs uppercase">{dow}</span>
          </button>
        );
      })}
    </div>
  );
}

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dashboardHref, type VistaDashboard } from '@/lib/dashboard-vista';

const OPCIONES: { v: string; label: string }[] = [
  { v: 'hoy', label: 'Hoy' },
  { v: '7', label: '7 días' },
  { v: 'semana', label: 'Esta semana' },
  { v: '30', label: '30 días' },
  { v: 'mes', label: 'Este mes' },
];

/**
 * Los atajos de siempre más "Elegir fecha": un día puntual (dejando "Hasta" vacío) o un rango.
 * `desde` y `hasta` son el período que se está viendo: sirven de punto de partida al abrir el selector.
 */
export function PeriodoSelector({ periodo, vista = 'canchas', desde, hasta, hoy }: { periodo: string; vista?: VistaDashboard; desde: string; hasta: string; hoy: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState(periodo === 'fecha' ? desde : '');
  const [h, setH] = useState(periodo === 'fecha' && hasta !== desde ? hasta : '');

  function aplicar() {
    if (!d) return;
    router.push(dashboardHref({ periodo: 'fecha', vista, desde: d, hasta: h || undefined }));
    setAbierto(false);
  }

  return (
    <div className="relative">
      <div className="inline-flex rounded-lg border bg-white p-0.5">
        {OPCIONES.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => { setAbierto(false); router.push(dashboardHref({ periodo: o.v, vista })); }}
            className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', periodo === o.v ? 'bg-primary text-primary-foreground' : 'text-neutral-600 hover:bg-neutral-100')}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          aria-expanded={abierto}
          onClick={() => setAbierto((v) => !v)}
          className={cn('inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition', periodo === 'fecha' ? 'bg-primary text-primary-foreground' : 'text-neutral-600 hover:bg-neutral-100')}
        >
          <CalendarSearch className="h-4 w-4" /> Elegir fecha
        </button>
      </div>

      {abierto && (
        <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-lg border bg-white p-4 shadow-lg">
          <div className="space-y-1">
            <Label htmlFor="dash-desde">Día (o desde)</Label>
            <Input id="dash-desde" type="date" max={hoy} value={d} onChange={(e) => setD(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dash-hasta">Hasta (opcional)</Label>
            <Input id="dash-hasta" type="date" max={hoy} min={d || undefined} value={h} onChange={(e) => setH(e.target.value)} />
            <p className="text-xs text-neutral-500">Dejalo vacío para ver un solo día.</p>
          </div>
          <Button className="w-full" disabled={!d} onClick={aplicar}>Ver</Button>
        </div>
      )}
    </div>
  );
}

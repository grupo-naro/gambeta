'use client';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { dashboardHref, type VistaDashboard } from '@/lib/dashboard-vista';

const OPCIONES: { v: string; label: string }[] = [
  { v: 'hoy', label: 'Hoy' },
  { v: '7', label: '7 días' },
  { v: 'semana', label: 'Esta semana' },
  { v: '30', label: '30 días' },
  { v: 'mes', label: 'Este mes' },
];

export function PeriodoSelector({ periodo, vista = 'canchas' }: { periodo: string; vista?: VistaDashboard }) {
  const router = useRouter();
  return (
    <div className="inline-flex rounded-lg border bg-white p-0.5">
      {OPCIONES.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => router.push(dashboardHref({ periodo: o.v, vista }))}
          className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', periodo === o.v ? 'bg-primary text-primary-foreground' : 'text-neutral-600 hover:bg-neutral-100')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
